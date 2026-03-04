#include "radio_controller.h"
#include "beacon_lock.h"
#include "rx_dsp_psk.h"
#include "tx_dsp_psk.h"
#include "hw_plutosdr.h"
#include "ssp.h"
#include "logger.h"
#include "ws_server.h"

#include <iostream>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <cerrno>
#include <liquid/liquid.h>

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    typedef int socklen_t;
    #ifndef INET_ADDRSTRLEN
        #define INET_ADDRSTRLEN 16
    #endif
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <netdb.h>
    #include <unistd.h>
    #define closesocket close
    #define INVALID_SOCKET -1
#endif

// Constants
static const int RX_BUFFER_SIZE = 65536;  // Large enough for any sample rate/10 buffer
static const int TX_BUFFER_SIZE = 4096;
static const int SSP_FRAME_SIZE = 219;
static const int UDP_TIMEOUT_MS = 1000;
static const float BEACON_LOCK_PHASE_ERROR_THRESHOLD_DEG = 30.0f;
static const uint32_t BEACON_LOCK_LOSS_TIMEOUT_MS = 5000;
static const int RX_FRAME_LOG_FREQUENCY = 1000;  // Log every 1000 frames

RadioController::RadioController(const std::string& pluto_uri,
                                 float center_freq_mhz,
                                 float sample_rate_hz)
    : pluto_uri_(pluto_uri),
      beacon_mode_(BeaconMode::MODE_AUTO),
      modem_scheme_(LIQUID_MODEM_QPSK),
      center_freq_mhz_(center_freq_mhz),
      sample_rate_hz_(sample_rate_hz),
      rx_gain_db_(0.0f),
      tx_gain_db_(0.0f),
      log_level_(1),
      udp_listen_addr_("0.0.0.0"),  // Listen on all interfaces for Docker networking
      udp_listen_port_tx_(40133),
      udp_send_port_rx_(40132),
      rx_bit_count_(0)
{
    log_(1, "RadioController initialized with center_freq=" + std::to_string(center_freq_mhz) +
         " MHz, sample_rate=" + std::to_string(sample_rate_hz) + " Hz");
    udp_cmd_listen_port_ = 40135;  // Control command listener port
}

RadioController::~RadioController()
{
    stop();
}

bool RadioController::start()
{
    if (running_) {
        log_(0, "RadioController already running");
        return false;
    }

    log_(1, "Starting RadioController...");
    stop_requested_ = false;

    // NOTE: SDR is NOT initialized here anymore. User must explicitly connect via sdr_connect UDP command.
    // This allows radio to start and serve metrics even without hardware available.
    log_(1, "Note: SDR will NOT be auto-connected. User must manually trigger connection via API.");

    // Initialize beacon lock (hardware-independent)
    try {
        // Note: BeaconLock expects float by value and BeaconLock::BeaconMode by value
        // RadioController::BeaconMode == BeaconLock::BeaconMode (same enum)
        beacon_lock_ = std::make_unique<BeaconLock>(sample_rate_hz_, static_cast<BeaconLock::BeaconMode>(beacon_mode_));
        log_(1, "BeaconLock initialized");
    } catch (const std::exception& e) {
        log_(0, std::string("Failed to initialize BeaconLock: ") + e.what());
        return false;
    }

    // NOTE: RxDspPsk and TxDspPsk are NOT initialized here.
    // They will be initialized in connect_sdr_() when user actually connects the SDR.
    // This prevents failures from invalid modem_scheme_=0 at startup.
    log_(1, "Note: RX/TX DSP will be initialized on SDR connect");

    // Initialize SSP codec and FEC (hardware-independent)
    try {
        ssp_codec_ = std::make_unique<SSPCodec>();
        ssp_fec_ = std::make_unique<SSPFEC>();
        log_(1, "SSP codec and FEC initialized");
    } catch (const std::exception& e) {
        log_(0, std::string("Failed to initialize SSP: ") + e.what());
        return false;
    }

    // Initialize RX bit buffer
    rx_bit_buffer_.resize(SSP_FRAME_SIZE * 8);
    rx_bit_count_ = 0;

    // Start threads
    running_ = true;
    iio_stop_requested_ = false;
    try {
        iio_worker_thread_ = std::thread(&RadioController::iio_worker_, this);
        waterfall_thread_ = std::thread(&RadioController::waterfall_worker_, this);
        udp_listener_thread_ = std::thread(&RadioController::udp_listener_worker_, this);
        udp_cmd_listener_thread_ = std::thread(&RadioController::udp_cmd_listener_worker_, this);
        log_(1, "IIO worker, waterfall, UDP listener, and UDP command listener threads started");
    } catch (const std::exception& e) {
        log_(0, std::string("Failed to start threads: ") + e.what());
        running_ = false;
        return false;
    }

    log_(1, "RadioController started successfully");
    return true;
}

void RadioController::stop()
{
    if (!running_) {
        return;
    }

    log_(1, "Stopping RadioController...");
    stop_requested_ = true;
    iio_stop_requested_ = true;
    running_ = false;
    tx_queue_cv_.notify_one();
    waterfall_fifo_cv_.notify_all();  // Wake waterfall thread

    // Join threads
    if (iio_worker_thread_.joinable()) {
        iio_worker_thread_.join();
    }
    if (waterfall_thread_.joinable()) {
        waterfall_thread_.join();
    }
    if (udp_listener_thread_.joinable()) {
        udp_listener_thread_.join();
    }
    if (udp_cmd_listener_thread_.joinable()) {
        udp_cmd_listener_thread_.join();
    }

    // Cleanup hardware
    if (hw_plutosdr_) {
        hw_plutosdr_.reset();
    }

    log_(1, "RadioController stopped");
}

bool RadioController::is_running() const
{
    return running_;
}

bool RadioController::sdr_connected() const
{
    return hw_plutosdr_ != nullptr && hw_plutosdr_->is_running();
}

bool RadioController::is_sdr_hw_connected() const
{
    return sdr_connected_.load(std::memory_order_acquire);
}

// ============================================================================
// SDR Connection Management (Manual Connect Flow)
// ============================================================================

bool RadioController::connect_sdr_(const std::string& uri, float lnb_offset_mhz, float bandwidth_hz)
{
    bool success = false;
    {
        std::lock_guard<std::recursive_mutex> lock(config_mutex_);

        log_(1, "Connecting to SDR: uri=" + uri + ", lnb_offset=" + std::to_string(lnb_offset_mhz) +
             " MHz, bandwidth=" + std::to_string(bandwidth_hz) + " Hz");

        // Disconnect existing SDR if present
        if (hw_plutosdr_) {
            try {
                hw_plutosdr_->rx_stop();
                hw_plutosdr_->tx_stop();
            } catch (...) {
                log_(1, "Note: Previous SDR RX/TX streams already stopped or not running");
            }
            hw_plutosdr_.reset();
        }

        // Update configuration
        pluto_uri_ = uri;
        lnb_offset_mhz_ = lnb_offset_mhz;

        // bandwidth_hz from UI is the channel bandwidth (e.g. 1000 kHz for QO-100 NB).
        // Calculate sample_rate as 1.35x bandwidth (slightly above Nyquist) to capture full signal
        // Keep PlutoSDR in sane range: 512 kHz minimum (matches our default), 30.72 MHz maximum
        float sample_rate = bandwidth_hz * 1.35f;
        if (sample_rate < 512000.0f) sample_rate = 512000.0f;
        if (sample_rate > 30720000.0f) sample_rate = 30720000.0f;
        sample_rate_hz_ = sample_rate;

        try {
            // Create new HwPlutoSDR with specified parameters
            hw_plutosdr_ = std::make_unique<HwPlutoSDR>(
                uri.c_str(),
                center_freq_mhz_,
                sample_rate,
                tx_gain_db_,
                rx_gain_db_,
                lnb_offset_mhz
            );

            // Initialize RX/TX DSP with the connected modem scheme
            try {
                modulation_scheme modem_enum = static_cast<modulation_scheme>(modem_scheme_);

                rx_dsp_psk_ = std::make_unique<RxDspPsk>(modem_enum, sample_rate, sample_rate / 100.0f);
                log_(1, "RxDspPsk initialized for modem scheme " + std::to_string(modem_scheme_));

                tx_dsp_psk_ = std::make_unique<TxDspPsk>(modem_enum, sample_rate, sample_rate / 100.0f);
                log_(1, "TxDspPsk initialized for modem scheme " + std::to_string(modem_scheme_));
            } catch (const std::exception& e) {
                log_(0, std::string("Failed to initialize RX/TX DSP: ") + e.what());
                hw_plutosdr_.reset();
                throw;
            }

            // Validate hardware initialization (constructor doesn't throw on failure)
            if (!hw_plutosdr_->is_running()) {
                std::string error = hw_plutosdr_->get_last_error();
                if (error.empty()) error = "Hardware initialization failed";
                log_(0, std::string("SDR init failed: ") + error);
                hw_plutosdr_.reset();

                std::string response = std::string(R"({"connected":false,"error":")" + error + R"("})");
                send_udp_response_(response);
                return false;
            }

            // Start RX/TX streams
            if (!hw_plutosdr_->rx_start()) {
                std::string error = hw_plutosdr_->get_last_error();
                if (error.empty()) error = "Failed to start RX stream";
                log_(0, std::string("RX start failed: ") + error);
                hw_plutosdr_.reset();

                std::string response = std::string(R"({"connected":false,"error":")" + error + R"("})");
                send_udp_response_(response);
                return false;
            }

            if (!hw_plutosdr_->tx_start()) {
                std::string error = hw_plutosdr_->get_last_error();
                if (error.empty()) error = "Failed to start TX stream";
                log_(0, std::string("TX start failed: ") + error);
                hw_plutosdr_.reset();

                std::string response = std::string(R"({"connected":false,"error":")" + error + R"("})");
                send_udp_response_(response);
                return false;
            }

            // Now that all channels are enabled, create the RX+TX buffers
            log_(1, "All channels enabled, creating buffers...");
            if (!hw_plutosdr_->start_streaming()) {
                std::string error = hw_plutosdr_->get_last_error();
                if (error.empty()) error = "Failed to create streaming buffers";
                log_(0, std::string("start_streaming() failed: ") + error);
                hw_plutosdr_.reset();

                std::string response = std::string(R"({"connected":false,"error":")" + error + R"("})");
                send_udp_response_(response);
                return false;
            }

            log_(1, "SDR connected successfully");

            // Send success response immediately — buffers are now ready
            auto sdr_info = hw_plutosdr_->get_sdr_info();
            std::string response = R"({"connected":true,"hw_model":")" + sdr_info.hw_model +
                                  R"(","fw_version":")" + sdr_info.fw_version +
                                  R"(","serial":")" + sdr_info.serial +
                                  R"(","freq_min_mhz":70.0,"freq_max_mhz":6000.0})";
            send_udp_response_(response);

            success = true;
        } catch (const std::exception& e) {
            log_(0, std::string("SDR connection failed: ") + e.what());
            hw_plutosdr_.reset();

            // Send error response
            std::string response = std::string(R"({"connected":false,"error":")" + std::string(e.what()) + R"("})");
            send_udp_response_(response);

            return false;
        }
    }
    // Mutex released here. Now safe to signal RX thread.
    if (success) {
        log_(1, "CRITICAL: Setting sdr_connected_=true, IIO worker should now start reading samples");
        auto now = std::chrono::system_clock::now();
        uint64_t ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
        sdr_connect_time_ms_.store(ms, std::memory_order_release);
        sdr_connected_.store(true, std::memory_order_release);
        log_(1, "CRITICAL: sdr_connected_ set to true");
    } else {
        log_(1, "SDR connection failed, sdr_connected_ remains false");
    }
    return success;
}

void RadioController::disconnect_sdr_()
{
    // Signal IIO worker to stop handling hardware
    sdr_connected_.store(false, std::memory_order_release);

    // Give IIO worker a moment to exit hardware loop
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    std::lock_guard<std::recursive_mutex> lock(config_mutex_);

    log_(1, "Disconnecting from SDR");

    if (hw_plutosdr_) {
        try {
            hw_plutosdr_->rx_stop();
            hw_plutosdr_->tx_stop();
        } catch (const std::exception& e) {
            log_(0, std::string("Error stopping RX/TX during disconnect: ") + e.what());
        }
        hw_plutosdr_.reset();
    }

    // Clean up RX/TX DSP components
    rx_dsp_psk_.reset();
    tx_dsp_psk_.reset();
    log_(1, "RX/TX DSP components cleaned up");

    log_(1, "SDR disconnected");
    send_udp_response_(R"({"connected":false})");
}

void RadioController::send_udp_response_(const std::string& json)
{
    try {
        log_(2, "DEBUG: Entering send_udp_response_()");

        log_(2, "DEBUG: Creating UDP socket");
        int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock == INVALID_SOCKET) {
            log_(0, "Failed to create UDP response socket");
            return;
        }
        log_(2, "DEBUG: UDP socket created successfully (fd=" + std::to_string(sock) + ")");

        // Resolve response address on first call and cache it to avoid per-response DNS lookups
        if (!response_addr_resolved_) {
            log_(2, "DEBUG: Resolving response address for bitlink21-core");

            struct addrinfo hints, *res = nullptr;
            std::memset(&hints, 0, sizeof(hints));
            hints.ai_family = AF_INET;
            hints.ai_socktype = SOCK_DGRAM;

            const char* response_host = "bitlink21-core";  // Docker service name
            log_(2, "DEBUG: Calling getaddrinfo() for " + std::string(response_host));
            int status = getaddrinfo(response_host, nullptr, &hints, &res);
            log_(2, "DEBUG: getaddrinfo() returned status=" + std::to_string(status));

            std::memset(&response_addr_, 0, sizeof(response_addr_));
            response_addr_.sin_family = AF_INET;
            response_addr_.sin_port = htons(udp_response_port_);

            if (status == 0 && res != nullptr) {
                log_(2, "DEBUG: Address resolution succeeded, extracting sockaddr");

                if (res->ai_addr == nullptr) {
                    log_(0, "ERROR: getaddrinfo returned null ai_addr");
                    freeaddrinfo(res);
                    closesocket(sock);
                    return;
                }

                struct sockaddr_in* addr_in = (struct sockaddr_in*)res->ai_addr;
                response_addr_.sin_addr = addr_in->sin_addr;

                // Convert to string SAFELY (inet_ntoa uses static buffer, not thread-safe)
                char addr_str[INET_ADDRSTRLEN];
                const char* conv_result = inet_ntop(AF_INET, &response_addr_.sin_addr, addr_str, INET_ADDRSTRLEN);
                if (conv_result != nullptr) {
                    log_(1, "Cached response address for bitlink21-core: " + std::string(addr_str));
                } else {
                    log_(1, "Cached response address for bitlink21-core (inet_ntop failed, but address set)");
                }

                log_(2, "DEBUG: About to freeaddrinfo(res)");
                freeaddrinfo(res);
                log_(2, "DEBUG: freeaddrinfo() completed successfully");
                response_addr_resolved_ = true;
                log_(2, "DEBUG: Address resolution cached, response_addr_resolved_ = true");
            } else {
                // Fallback to localhost if DNS resolution fails (first time only)
                log_(1, "Could not resolve bitlink21-core (status=" + std::to_string(status) + "), using fallback 127.0.0.1");

                // Use inet_pton instead of deprecated inet_addr
                int conv_status = inet_pton(AF_INET, "127.0.0.1", &response_addr_.sin_addr);
                if (conv_status <= 0) {
                    log_(0, "ERROR: Failed to convert fallback address 127.0.0.1");
                    closesocket(sock);
                    return;
                }
                log_(2, "DEBUG: Fallback address set to 127.0.0.1");
            }
        } else {
            log_(2, "DEBUG: Using cached response address (already resolved)");
        }

        log_(2, "DEBUG: About to call sendto() with json length=" + std::to_string(json.length()));
        ssize_t sent = sendto(sock, json.c_str(), json.length(), 0,
                              (struct sockaddr*)&response_addr_, sizeof(response_addr_));
        log_(2, "DEBUG: sendto() returned " + std::to_string(sent));

        if (sent < 0) {
            #ifdef _WIN32
                log_(0, "Failed to send UDP response (error code: " + std::to_string(WSAGetLastError()) + ")");
            #else
                log_(0, "Failed to send UDP response (errno: " + std::to_string(errno) + ")");
            #endif
        } else {
            log_(2, "UDP response sent (" + std::to_string(sent) + " bytes): " + json);
        }

        log_(2, "DEBUG: Closing socket");
        int close_result = closesocket(sock);
        if (close_result != 0) {
            #ifdef _WIN32
                log_(0, "Warning: closesocket() failed (error: " + std::to_string(WSAGetLastError()) + ")");
            #else
                log_(0, "Warning: closesocket() failed (errno: " + std::to_string(errno) + ")");
            #endif
        }
        log_(2, "DEBUG: Exiting send_udp_response_() successfully");

    } catch (const std::exception& e) {
        log_(0, std::string("UDP response send error: ") + e.what());
    }
}

void RadioController::set_beacon_mode(BeaconMode mode)
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    beacon_mode_ = mode;
    if (beacon_lock_) {
        switch (mode) {
            case BeaconMode::MODE_AUTO:
                beacon_lock_->set_mode(BeaconLock::MODE_AUTO);
                break;
            case BeaconMode::MODE_CW_ONLY:
                beacon_lock_->set_mode(BeaconLock::MODE_CW_ONLY);
                break;
            case BeaconMode::MODE_BPSK_ONLY:
                beacon_lock_->set_mode(BeaconLock::MODE_BPSK_ONLY);
                break;
            case BeaconMode::MODE_OFF:
                beacon_lock_->set_mode(BeaconLock::MODE_OFF);
                break;
        }
    }
    log_(1, "Beacon mode changed to " + std::to_string(static_cast<int>(mode)));
}

void RadioController::set_modem_scheme(int scheme)
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    modem_scheme_ = scheme;
    modem_scheme_changed_.store(true);  // Signal RX thread to reinitialize DSP
    log_(1, "Modem scheme changed to " + std::to_string(scheme) + " (will reinitialize on next frame)");
}

void RadioController::set_center_freq(float freq_mhz)
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    center_freq_mhz_ = freq_mhz;
    if (hw_plutosdr_) {
        try {
            hw_plutosdr_->set_center_freq(freq_mhz);
            log_(1, "Center frequency set to " + std::to_string(freq_mhz) + " MHz");
        } catch (const std::exception& e) {
            log_(0, std::string("Failed to set center frequency: ") + e.what());
        }
    }
}

void RadioController::set_rx_gain(float gain_db)
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    rx_gain_db_ = gain_db;
    if (hw_plutosdr_) {
        try {
            hw_plutosdr_->set_rx_gain(gain_db);
            log_(2, "RX gain set to " + std::to_string(gain_db) + " dB");
        } catch (const std::exception& e) {
            log_(0, std::string("Failed to set RX gain: ") + e.what());
        }
    }
}

void RadioController::set_tx_gain(float gain_db)
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    tx_gain_db_ = gain_db;
    if (hw_plutosdr_) {
        try {
            hw_plutosdr_->set_tx_gain(gain_db);
            log_(2, "TX gain set to " + std::to_string(gain_db) + " dB");
        } catch (const std::exception& e) {
            log_(0, std::string("Failed to set TX gain: ") + e.what());
        }
    }
}

void RadioController::set_lnb_offset(float lnb_offset_mhz)
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    lnb_offset_mhz_ = lnb_offset_mhz;
    lnb_offset_changed_.store(true);  // Signal RX thread to retune frequency
    if (hw_plutosdr_) {
        hw_plutosdr_->set_lnb_offset(lnb_offset_mhz);
        log_(1, "LNB offset set to " + std::to_string(lnb_offset_mhz) + " MHz (will retune on next frame)");
    }
}

void RadioController::set_rit_offset(int32_t hz)
{
    rit_offset_hz_.store(hz);
    log_(1, "RIT offset set to " + std::to_string(hz) + " Hz");
}

void RadioController::set_xit_offset(int32_t hz)
{
    xit_offset_hz_.store(hz);
    log_(1, "XIT offset set to " + std::to_string(hz) + " Hz");
}

void RadioController::ptt_set(bool on)
{
    ptt_on_ = on;
    if (on) {
        log_(1, "PTT ON");
        tx_queue_cv_.notify_one();
    } else {
        log_(1, "PTT OFF");
    }
}

float RadioController::get_rx_rssi() const
{
    return rx_rssi_db_.load();
}

float RadioController::get_rx_snr() const
{
    return rx_snr_db_.load();
}

float RadioController::get_rx_evm() const
{
    return rx_evm_db_.load();
}

uint32_t RadioController::get_rx_frame_count() const
{
    return rx_frame_count_.load();
}

uint32_t RadioController::get_rx_error_count() const
{
    return rx_error_count_.load();
}

BeaconLockState RadioController::get_beacon_lock_state() const
{
    if (!beacon_lock_) {
        return BeaconLockState::UNLOCKED;
    }
    BeaconLock::Status status = beacon_lock_->get_status();
    if (status.is_locked) {
        return BeaconLockState::FINE_LOCK;
    }
    // TODO: Distinguish between COARSE_LOCK and UNLOCKED based on beacon_lock state
    return BeaconLockState::UNLOCKED;
}

float RadioController::get_beacon_lock_phase_error() const
{
    if (!beacon_lock_) {
        return 0.0f;
    }
    BeaconLock::Status status = beacon_lock_->get_status();
    return status.phase_error_deg;
}

float RadioController::get_beacon_lock_freq_error() const
{
    if (!beacon_lock_) {
        return 0.0f;
    }
    BeaconLock::Status status = beacon_lock_->get_status();
    return status.frequency_offset_hz;
}

uint32_t RadioController::get_beacon_lock_age_ms() const
{
    return beacon_lock_age_ms_.load();
}

size_t RadioController::get_tx_queue_depth() const
{
    std::lock_guard<std::mutex> lock(tx_queue_mutex_);
    return tx_queue_.size();
}

RadioController::SdrInfo RadioController::get_sdr_info() const
{
    SdrInfo info;
    info.connected = false;

    if (hw_plutosdr_ && hw_plutosdr_->is_running()) {
        try {
            auto hw_info = hw_plutosdr_->get_sdr_info();
            info.connected = hw_info.connected;
            info.hw_model = hw_info.hw_model;
            info.fw_version = hw_info.fw_version;
            info.serial = hw_info.serial;
        } catch (...) {
            info.connected = false;
        }
    }

    return info;
}

RadioStats RadioController::get_stats() const
{
    std::lock_guard<std::mutex> lock(stats_mutex_);
    RadioStats stats;
    stats.rx_rssi_db = rx_rssi_db_.load();
    stats.rx_snr_db = rx_snr_db_.load();
    stats.rx_evm_db = rx_evm_db_.load();
    stats.rx_frame_count = rx_frame_count_.load();
    stats.rx_error_count = rx_error_count_.load();
    stats.beacon_lock_state = get_beacon_lock_state();
    stats.beacon_lock_phase_error_deg = get_beacon_lock_phase_error();
    stats.beacon_lock_freq_error_hz = get_beacon_lock_freq_error();
    stats.tx_queue_depth = get_tx_queue_depth();
    stats.beacon_lock_age_ms = beacon_lock_age_ms_.load();
    return stats;
}

float RadioController::get_center_freq_mhz() const
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    return center_freq_mhz_;
}

float RadioController::get_tx_freq_hz() const
{
    std::lock_guard<std::recursive_mutex> lock(config_mutex_);
    return tx_freq_hz_;
}

void RadioController::set_log_level(int level)
{
    log_level_ = level;
    log_(1, "Log level set to " + std::to_string(level));
}

void RadioController::set_ws_server(class WsServer* ws_server)
{
    ws_server_ = ws_server;
    if (ws_server_) {
        log_(1, "WebSocket server connected for waterfall telemetry");
    }
}

void RadioController::log_(int level, const std::string& msg) const
{
    if (level > log_level_) {
        return;
    }

    std::string prefix;
    switch (level) {
        case 0: prefix = "[ERROR]"; break;
        case 1: prefix = "[INFO]"; break;
        case 2: prefix = "[DEBUG]"; break;
        default: prefix = "[LOG]"; break;
    }

    auto now = std::chrono::system_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;

    std::ostringstream oss;
    // Skip timestamp formatting - localtime() is NOT thread-safe!
    oss << prefix << " " << msg;

    std::cerr << oss.str() << std::endl;
}

void RadioController::iio_worker_()
{
    log_(1, "IIO worker thread started (refill only — matches reference)");
    LOG_INFO("radio", "IIO worker thread started", "{\"thread\": \"iio_worker\"}");

    // Raw byte buffer: sample_rate/10 (matches PLUTOBUFSIZE in reference)
    size_t buf_samples = (size_t)(sample_rate_hz_ / 10.0f);
    if (buf_samples < 4096) buf_samples = 4096;
    size_t buf_bytes = buf_samples * 4;  // 4 bytes per IQ pair (int16 I + int16 Q)
    std::vector<uint8_t> raw_bytes(buf_bytes);

    std::vector<std::complex<float>> tx_buffer;
    uint32_t tx_frame_count = 0;
    bool was_transmitting = false;
    uint32_t loop_count = 0;

    while (running_ && !iio_stop_requested_) {
        try {
            loop_count++;
            if (loop_count % 100 == 0) {
                log_(2, "DEBUG: IIO worker loop iteration " + std::to_string(loop_count));
            }

            // ========== RX PROCESSING ==========
            bool sdr_connected = sdr_connected_.load(std::memory_order_acquire);
            if (!sdr_connected && loop_count % 50 == 0) {
                log_(2, "DEBUG: IIO worker waiting for SDR connection");
            }

            if (sdr_connected) {
                // STABILIZATION: 500ms after connect
                auto now = std::chrono::system_clock::now();
                uint64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
                uint64_t connect_time_ms = sdr_connect_time_ms_.load(std::memory_order_acquire);
                uint64_t time_since_connect = (connect_time_ms > 0) ? (now_ms - connect_time_ms) : 1000;

                if (time_since_connect < 500) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(10));
                } else {
                    HwPlutoSDR* hw = nullptr;
                    {
                        std::lock_guard<std::recursive_mutex> lock(config_mutex_);
                        hw = hw_plutosdr_.get();
                    }
                    if (!hw) {
                        sdr_connected_.store(false, std::memory_order_release);
                        continue;
                    }

                    // ===== REFERENCE PATTERN: refill → raw copy → sleep =====
                    ssize_t nbytes = hw->rx_refill_raw(raw_bytes.data(), buf_bytes);
                    if (nbytes <= 0) {
                        disconnect_sdr_();
                        continue;
                    }

                    // PROBE: send response on first successful read
                    if (sdr_probe_pending_.exchange(false)) {
                        log_(1, "PROBE: First successful read confirmed, sending probe response");
                        try {
                            std::lock_guard<std::recursive_mutex> lock(config_mutex_);
                            if (hw_plutosdr_) {
                                auto sdr_info = hw_plutosdr_->get_sdr_info();
                                std::string response = R"({"connected":true,"hw_model":")" + sdr_info.hw_model +
                                                      R"(","fw_version":")" + sdr_info.fw_version +
                                                      R"(","serial":")" + sdr_info.serial +
                                                      R"(","freq_min_mhz":70.0,"freq_max_mhz":6000.0})";
                                send_udp_response_(response);
                                log_(1, "PROBE: Response sent successfully");
                            }
                        } catch (const std::exception& e) {
                            log_(0, std::string("PROBE: Failed to send response: ") + e.what());
                        }
                    }

                    // Push raw bytes to waterfall FIFO (non-blocking drop if full)
                    {
                        std::lock_guard<std::mutex> lock(waterfall_fifo_mutex_);
                        if (waterfall_pending_chunks_ < WATERFALL_FIFO_MAX) {
                            waterfall_fifo_.insert(waterfall_fifo_.end(),
                                raw_bytes.data(), raw_bytes.data() + nbytes);
                            waterfall_pending_chunks_++;
                            waterfall_fifo_cv_.notify_one();
                        }
                    }

                    usleep(1000);  // match reference exactly
                }
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }

            // ========== TX PROCESSING ==========
            if (sdr_connected_.load(std::memory_order_acquire)) {
                std::unique_lock<std::mutex> lock(tx_queue_mutex_);

                // Wait for PTT ON or queue non-empty
                if (!ptt_on_ || tx_queue_.empty()) {
                    lock.unlock();
                    // PTT OFF or queue empty - transmit padding (zeros)
                    if (was_transmitting) {
                        try {
                            if (hw_plutosdr_) {
                                tx_buffer.assign(TX_BUFFER_SIZE, std::complex<float>(0.0f, 0.0f));
                                hw_plutosdr_->tx_put_buffer(tx_buffer.data(), TX_BUFFER_SIZE);
                                was_transmitting = false;
                                log_(2, "TX padding transmitted (end of frame)");
                            }
                        } catch (const std::exception& e) {
                            log_(0, std::string("TX padding error: ") + e.what());
                        }
                    }
                } else {
                    // Dequeue SSP frame
                    std::vector<uint8_t> ssp_frame = tx_queue_.front();
                    tx_queue_.pop();
                    lock.unlock();

                    tx_frame_count++;
                    log_(2, "Processing TX SSP frame of size " + std::to_string(ssp_frame.size()));
                    LOG_DEBUG("dsp", "TX frame dequeued",
                              "{\"frame_id\": " + std::to_string(tx_frame_count) +
                              ", \"payload_len\": " + std::to_string(ssp_frame.size()) + "}");

                    // FEC encode
                    std::vector<uint8_t> fec_encoded(ssp_frame.size() * 2);  // Placeholder
                    size_t fec_len = fec_encoded.size();
                    try {
                        if (ssp_fec_) {
                            ssp_fec_->encode(ssp_frame.data(), ssp_frame.size(),
                                            fec_encoded.data(), fec_len);
                            fec_encoded.resize(fec_len);
                        }
                    } catch (const std::exception& e) {
                        log_(0, std::string("FEC encode error: ") + e.what());
                        continue;
                    }

                    // Modulate bits
                    if (tx_dsp_psk_) {
                        try {
                            // Push FEC-encoded bytes as bits to modulator
                            tx_dsp_psk_->push_bits(fec_encoded.data(), fec_encoded.size() * 8);
                            tx_dsp_psk_->flush();  // Mark end of transmission

                            // Get modulated samples
                            std::complex<float> sample;
                            tx_buffer.clear();
                            while (tx_dsp_psk_->get_sample(sample)) {
                                tx_buffer.push_back(sample);

                                // Send when buffer is full
                                if (tx_buffer.size() >= TX_BUFFER_SIZE) {
                                    try {
                                        if (hw_plutosdr_) {
                                            hw_plutosdr_->tx_put_buffer(tx_buffer.data(), tx_buffer.size());
                                            was_transmitting = true;
                                            log_(2, "TX buffer sent (" + std::to_string(tx_buffer.size()) + " samples)");
                                        }
                                    } catch (const std::exception& e) {
                                        log_(0, std::string("TX buffer error: ") + e.what());
                                    }
                                    tx_buffer.clear();
                                }
                            }

                            // Send remaining samples
                            if (!tx_buffer.empty()) {
                                try {
                                    if (hw_plutosdr_) {
                                        hw_plutosdr_->tx_put_buffer(tx_buffer.data(), tx_buffer.size());
                                        was_transmitting = true;
                                        log_(2, "TX frame transmitted (" + std::to_string(tx_buffer.size()) + " samples)");
                                        LOG_DEBUG("dsp", "TX frame complete",
                                                  "{\"frame_id\": " + std::to_string(tx_frame_count) +
                                                  ", \"samples\": " + std::to_string(tx_buffer.size()) + "}");
                                    }
                                } catch (const std::exception& e) {
                                    log_(0, std::string("TX frame error: ") + e.what());
                                }
                                tx_buffer.clear();
                            }

                        } catch (const std::exception& e) {
                            log_(0, std::string("TX modulation error: ") + e.what());
                        }
                    }
                }
            }

        } catch (const std::exception& e) {
            log_(0, std::string("IIO worker exception: ") + e.what());
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    }

    LOG_INFO("radio", "IIO worker thread stopped",
             "{\"rx_frames\": " + std::to_string(rx_frame_count_.load()) +
             ", \"rx_errors\": " + std::to_string(rx_error_count_.load()) +
             ", \"tx_frames\": " + std::to_string(tx_frame_count) + "}");
    log_(1, "IIO worker thread stopped");
}

void RadioController::waterfall_worker_()
{
    log_(1, "Waterfall worker thread started");
    LOG_INFO("radio", "Waterfall worker thread started", "{\"thread\": \"waterfall_worker\"}");

    while (running_) {
        std::vector<uint8_t> chunk;
        {
            std::unique_lock<std::mutex> lk(waterfall_fifo_mutex_);
            waterfall_fifo_cv_.wait(lk, [this]{
                return !waterfall_fifo_.empty() || !running_;
            });
            if (!running_) break;
            chunk.swap(waterfall_fifo_);
            waterfall_pending_chunks_ = 0;
        }

        if (!ws_server_ || chunk.size() < 4) continue;

        // Convert raw bytes → complex<float> here (off IIO hot path)
        // Format: [I_lo, I_hi, Q_lo, Q_hi] per sample (little-endian int16)
        size_t n = chunk.size() / 4;
        std::vector<std::complex<float>> iq(n);
        for (size_t i = 0; i < n; i++) {
            int16_t iv = (int16_t)(chunk[i*4+0] | (chunk[i*4+1] << 8));
            int16_t qv = (int16_t)(chunk[i*4+2] | (chunk[i*4+3] << 8));
            iq[i] = std::complex<float>{iv / 32768.0f, qv / 32768.0f};
        }

        // ===== RSSI from raw IQ power (fast, no DSP needed) =====
        {
            float power_sum = 0.0f;
            size_t count = std::min(n, (size_t)2048);
            for (size_t i = 0; i < count; i++) {
                power_sum += std::norm(iq[i]);
            }
            float avg_power = power_sum / std::max(count, (size_t)1);
            float rssi_db = 10.0f * std::log10(avg_power + 1e-20f);
            rx_rssi_db_.store(rssi_db, std::memory_order_relaxed);
        }

        // Update signal detection flags
        signal_detected_.store(rx_rssi_db_.load() > -80.0f, std::memory_order_relaxed);

        // Update FIFO fill %
        pb_fifo_fill_.store((float)waterfall_pending_chunks_ / WATERFALL_FIFO_MAX, std::memory_order_relaxed);

        // ===== Waterfall publish (priority — must not be blocked by DSP) =====
        try {
            ws_server_->publish_waterfall(iq.data(), sample_rate_hz_,
                                          center_freq_mhz_,
                                          sample_rate_hz_ * 0.8f / 1e6f);
        } catch (const std::exception& e) {
            log_(0, std::string("Waterfall publish error: ") + e.what());
        }

        // ===== Feed samples to RX DSP for SNR/EVM/constellation =====
        if (rx_dsp_psk_) {
            // Heavily decimated: ~64 samples max to keep waterfall fast
            size_t step = std::max((size_t)1, n / 64);
            for (size_t i = 0; i < n; i += step) {
                rx_dsp_psk_->push_sample(iq[i]);
            }
            rx_snr_db_.store(rx_dsp_psk_->get_snr(), std::memory_order_relaxed);
            rx_evm_db_.store(rx_dsp_psk_->get_evm(), std::memory_order_relaxed);
            frame_sync_.store(rx_dsp_psk_->get_symbol_count() > 0, std::memory_order_relaxed);
        }

        // Publish constellation data from demodulator (if available)
        try {
            if (rx_dsp_psk_) {
                const auto& constellation = rx_dsp_psk_->get_constellation();
                if (!constellation.empty()) {
                    ws_server_->publish_constellation(constellation.data(), constellation.size());
                }
            }
        } catch (const std::exception& e) {
            log_(0, std::string("Constellation publish error: ") + e.what());
        }
    }

    log_(1, "Waterfall worker thread stopped");
}

void RadioController::udp_listener_worker_()
{
    log_(1, "UDP listener thread started");
    LOG_INFO("radio", "UDP listener thread started",
             "{\"thread\": \"udp_listener\", \"port\": 40133}");

    int sock = INVALID_SOCKET;

#ifdef _WIN32
    WSADATA wsa_data;
    if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
        log_(0, "WSAStartup failed");
        LOG_ERROR("radio", "WSAStartup failed", "{\"thread\": \"udp_listener\"}");
        return;
    }
#endif

    try {
        // Create UDP socket
        sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock == INVALID_SOCKET) {
            log_(0, "Failed to create UDP socket");
            return;
        }

        // Bind to TX listen port
        struct sockaddr_in addr;
        std::memset(&addr, 0, sizeof(addr));
        addr.sin_family = AF_INET;
        addr.sin_port = htons(udp_listen_port_tx_);

        // Use inet_pton instead of deprecated inet_addr for thread-safety
        int conv_status = inet_pton(AF_INET, udp_listen_addr_.c_str(), &addr.sin_addr);
        if (conv_status <= 0) {
            log_(0, "Failed to parse listen address: " + udp_listen_addr_);
            closesocket(sock);
            return;
        }

        if (bind(sock, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
            log_(0, "Failed to bind UDP socket");
            closesocket(sock);
            return;
        }

        log_(1, "UDP listener bound to " + udp_listen_addr_ + ":" +
             std::to_string(udp_listen_port_tx_));

        // Set socket timeout
        unsigned int timeout_ms = UDP_TIMEOUT_MS;
#ifdef _WIN32
        if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout_ms, sizeof(timeout_ms)) != 0) {
            log_(0, "Failed to set socket timeout");
        }
#else
        struct timeval tv;
        tv.tv_sec = UDP_TIMEOUT_MS / 1000;
        tv.tv_usec = (UDP_TIMEOUT_MS % 1000) * 1000;
        if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) != 0) {
            log_(0, "Failed to set socket timeout");
        }
#endif

        uint8_t buffer[1024];
        struct sockaddr_in remote_addr;

        while (running_ && !stop_requested_) {
            try {
                socklen_t addr_len = sizeof(remote_addr);
                int bytes_received = recvfrom(sock, (char*)buffer, sizeof(buffer), 0,
                                             (struct sockaddr*)&remote_addr, &addr_len);

                if (bytes_received <= 0) {
                    // Timeout is normal
                    continue;
                }

                // Enqueue frame to TX queue
                {
                    std::lock_guard<std::mutex> lock(tx_queue_mutex_);
                    std::vector<uint8_t> frame(buffer, buffer + bytes_received);
                    tx_queue_.push(frame);
                    log_(2, "RX UDP frame from Python core (" + std::to_string(bytes_received) + " bytes)");
                }
                tx_queue_cv_.notify_one();

            } catch (const std::exception& e) {
                log_(0, std::string("UDP receive error: ") + e.what());
            }
        }

    } catch (const std::exception& e) {
        log_(0, std::string("UDP listener exception: ") + e.what());
    }

    if (sock != INVALID_SOCKET) {
        closesocket(sock);
    }

#ifdef _WIN32
    WSACleanup();
#endif

    LOG_INFO("radio", "UDP listener thread stopped",
             "{\"thread\": \"udp_listener\"}");
    log_(1, "UDP listener thread stopped");
}

void RadioController::process_rx_frame_()
{
    log_(2, "Processing RX SSP frame");

    try {
        // Convert bit buffer to byte buffer
        std::vector<uint8_t> frame_bytes(SSP_FRAME_SIZE);
        for (size_t i = 0; i < SSP_FRAME_SIZE; ++i) {
            uint8_t byte = 0;
            for (int b = 0; b < 8; ++b) {
                if (rx_bit_buffer_[i * 8 + b]) {
                    byte |= (1 << b);
                }
            }
            frame_bytes[i] = byte;
        }

        // Try to decode SSP frame
        if (!ssp_codec_) {
            log_(0, "SSP codec not initialized");
            return;
        }

        SSPFrame frame;
        if (SSPCodec::decode(frame_bytes.data(), frame_bytes.size(), frame)) {
            // Valid frame received
            rx_frame_count_++;
            uint32_t frame_count = rx_frame_count_.load();
            log_(1, "Valid SSP frame received (count=" + std::to_string(frame_count) + ")");

            // Log every 1000 frames to avoid spam
            if (frame_count % RX_FRAME_LOG_FREQUENCY == 0) {
                LOG_DEBUG("dsp", "SSP frame RX milestone",
                          "{\"msg_id\": " + std::to_string(frame_count) +
                          ", \"payload_len\": " + std::to_string(SSP_FRAME_SIZE) +
                          ", \"rssi_db\": " + std::to_string(rx_rssi_db_.load()) +
                          ", \"snr_db\": " + std::to_string(rx_snr_db_.load()) +
                          ", \"evm_db\": " + std::to_string(rx_evm_db_.load()) + "}");
            }

            // Send to Python core via UDP
            send_rx_frame_to_python_(frame_bytes);
        } else {
            // Invalid frame (CRC failure)
            rx_error_count_++;
            log_(2, "Invalid SSP frame (error count=" + std::to_string(rx_error_count_.load()) + ")");
        }

    } catch (const std::exception& e) {
        log_(0, std::string("Frame processing error: ") + e.what());
        rx_error_count_++;
    }
}

void RadioController::send_rx_frame_to_python_(const std::vector<uint8_t>& frame)
{
    // TODO: Send frame to Python core via UDP on port 40132
    log_(2, "Sending RX frame to Python core (" + std::to_string(frame.size()) + " bytes)");

    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) {
        log_(0, "Failed to create UDP socket for RX frame");
        return;
    }

    try {
        struct sockaddr_in dest_addr;
        std::memset(&dest_addr, 0, sizeof(dest_addr));
        dest_addr.sin_family = AF_INET;
        dest_addr.sin_port = htons(40132);

        // Resolve bitlink21-core hostname (Docker service name) using thread-safe getaddrinfo
        struct addrinfo hints, *res = nullptr;
        std::memset(&hints, 0, sizeof(hints));
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_DGRAM;

        int status = getaddrinfo("bitlink21-core", nullptr, &hints, &res);
        if (status == 0 && res && res->ai_addr) {
            struct sockaddr_in* addr_in = (struct sockaddr_in*)res->ai_addr;
            dest_addr.sin_addr = addr_in->sin_addr;
            freeaddrinfo(res);
        } else {
            // Fallback to 127.0.0.1 if resolution fails
            int conv_status = inet_pton(AF_INET, "127.0.0.1", &dest_addr.sin_addr);
            if (conv_status <= 0) {
                log_(0, "Failed to resolve bitlink21-core and fallback to 127.0.0.1");
                closesocket(sock);
                return;
            }
            if (res) freeaddrinfo(res);
        }

        int result = sendto(sock, (const char*)frame.data(), frame.size(), 0,
                           (struct sockaddr*)&dest_addr, sizeof(dest_addr));
        if (result < 0) {
            log_(0, "Failed to send RX frame to Python core");
        }
    } catch (const std::exception& e) {
        log_(0, std::string("Error sending RX frame: ") + e.what());
    }

    closesocket(sock);
}

void RadioController::udp_cmd_listener_worker_()
{
    log_(1, "UDP command listener thread started (port 40135)");
    LOG_INFO("radio", "UDP command listener thread started",
             "{\"thread\": \"udp_cmd_listener\", \"port\": 40135}");

    int sock = INVALID_SOCKET;

#ifdef _WIN32
    WSADATA wsa_data;
    if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
        log_(0, "WSAStartup failed for command listener");
        return;
    }
#endif

    try {
        // Create UDP socket
        sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock == INVALID_SOCKET) {
            log_(0, "Failed to create UDP socket for command listener");
            return;
        }

        // Bind to command control port
        struct sockaddr_in addr;
        std::memset(&addr, 0, sizeof(addr));
        addr.sin_family = AF_INET;
        addr.sin_port = htons(udp_cmd_listen_port_);

        // Use inet_pton instead of deprecated inet_addr for thread-safety
        int conv_status = inet_pton(AF_INET, udp_listen_addr_.c_str(), &addr.sin_addr);
        if (conv_status <= 0) {
            log_(0, "Failed to parse listen address: " + udp_listen_addr_);
            closesocket(sock);
            return;
        }

        if (bind(sock, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
            log_(0, "Failed to bind UDP command socket");
            closesocket(sock);
            return;
        }

        log_(1, "UDP command listener bound to " + udp_listen_addr_ + ":" +
             std::to_string(udp_cmd_listen_port_));

        // Set socket timeout
        unsigned int timeout_ms = UDP_TIMEOUT_MS;
#ifdef _WIN32
        if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout_ms, sizeof(timeout_ms)) != 0) {
            log_(0, "Failed to set socket timeout for command listener");
        }
#else
        struct timeval tv;
        tv.tv_sec = UDP_TIMEOUT_MS / 1000;
        tv.tv_usec = (UDP_TIMEOUT_MS % 1000) * 1000;
        if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) != 0) {
            log_(0, "Failed to set socket timeout for command listener");
        }
#endif

        uint8_t buffer[512];
        struct sockaddr_in remote_addr;

        while (running_ && !stop_requested_) {
            try {
                socklen_t addr_len = sizeof(remote_addr);
                int bytes_received = recvfrom(sock, (char*)buffer, sizeof(buffer), 0,
                                             (struct sockaddr*)&remote_addr, &addr_len);

                if (bytes_received < 0) {
                    if (errno != EAGAIN && errno != EWOULDBLOCK) {
                        fprintf(stderr, "[UDP-CMD] recvfrom error: %d (errno=%d)\n", bytes_received, errno);
                        fflush(stderr);
                    }
                    // Timeout is normal
                    continue;
                }

                if (bytes_received == 0) {
                    continue;
                }

                // Convert address to string safely (inet_ntoa is not thread-safe)
                char addr_str[INET_ADDRSTRLEN];
                inet_ntop(AF_INET, &remote_addr.sin_addr, addr_str, INET_ADDRSTRLEN);
                fprintf(stderr, "[UDP-CMD] Received %d bytes from %s:%d\n", bytes_received,
                        addr_str, ntohs(remote_addr.sin_port));
                fflush(stderr);

                // Parse JSON command: {"cmd":"<command>","value":<value>}
                std::string cmd_str(buffer, buffer + bytes_received);
                log_(2, "Received command: " + cmd_str);

                // Simple JSON parsing (no external library)
                std::string cmd;
                std::string value_str;

                // Extract "cmd" field
                size_t cmd_pos = cmd_str.find("\"cmd\":");
                if (cmd_pos != std::string::npos) {
                    size_t cmd_start = cmd_str.find("\"", cmd_pos + 6) + 1;
                    size_t cmd_end = cmd_str.find("\"", cmd_start);
                    if (cmd_start != std::string::npos && cmd_end != std::string::npos) {
                        cmd = cmd_str.substr(cmd_start, cmd_end - cmd_start);
                    }
                }

                // Extract "value" field (handle nested JSON objects)
                size_t val_pos = cmd_str.find("\"value\":");
                if (val_pos != std::string::npos) {
                    size_t val_start = cmd_str.find_first_not_of(" \t", val_pos + 8);
                    if (val_start != std::string::npos) {
                        size_t val_end = val_start;
                        if (cmd_str[val_start] == '{') {
                            // Nested JSON object - use brace-depth counting
                            int depth = 0;
                            for (; val_end < cmd_str.size(); ++val_end) {
                                if (cmd_str[val_end] == '{') ++depth;
                                else if (cmd_str[val_end] == '}') {
                                    if (--depth == 0) break;
                                }
                            }
                            ++val_end; // Include closing brace
                        } else {
                            // Scalar value - use original logic
                            val_end = cmd_str.find_first_of(",}", val_start);
                            if (val_end == std::string::npos) {
                                val_end = cmd_str.length();
                            }
                        }
                        value_str = cmd_str.substr(val_start, val_end - val_start);
                        // Trim whitespace
                        while (!value_str.empty() && std::isspace(value_str.front())) value_str.erase(0, 1);
                        while (!value_str.empty() && std::isspace(value_str.back())) value_str.pop_back();
                    }
                }

                log_(1, "Parsed command: cmd=" + cmd + ", value=" + value_str);

                // Execute command
                if (cmd == "ptt") {
                    bool on = (value_str == "true" || value_str == "1");
                    ptt_set(on);
                    log_(1, "PTT set to " + std::string(on ? "ON" : "OFF"));
                } else if (cmd == "set_freq") {
                    try {
                        float freq = std::stof(value_str);
                        set_center_freq(freq);
                        log_(1, "Center frequency set to " + std::to_string(freq) + " MHz");
                    } catch (...) {
                        log_(0, "Failed to parse frequency value");
                    }
                } else if (cmd == "set_rx_gain") {
                    try {
                        float gain = std::stof(value_str);
                        set_rx_gain(gain);
                        log_(1, "RX gain set to " + std::to_string(gain) + " dB");
                    } catch (...) {
                        log_(0, "Failed to parse RX gain value");
                    }
                } else if (cmd == "set_tx_gain") {
                    try {
                        float gain = std::stof(value_str);
                        set_tx_gain(gain);
                        log_(1, "TX gain set to " + std::to_string(gain) + " dB");
                    } catch (...) {
                        log_(0, "Failed to parse TX gain value");
                    }
                } else if (cmd == "set_modem") {
                    try {
                        int scheme = std::stoi(value_str);
                        set_modem_scheme(scheme);
                        log_(1, "Modem scheme set to " + std::to_string(scheme));
                    } catch (...) {
                        log_(0, "Failed to parse modem scheme value");
                    }
                } else if (cmd == "set_bandwidth") {
                    try {
                        int bw_hz = std::stoi(value_str);
                        // Bandwidth is applied as sample rate with RRC filter factor of 1.35
                        float sample_rate = bw_hz * 1.35f;
                        if (hw_plutosdr_) {
                            hw_plutosdr_->set_sample_rate(sample_rate);
                            log_(1, "Bandwidth set to " + std::to_string(bw_hz) + " Hz (sample_rate=" + std::to_string(sample_rate) + ")");
                        }
                    } catch (...) {
                        log_(0, "Failed to parse bandwidth value");
                    }
                } else if (cmd == "set_beacon_mode") {
                    // value_str should be "auto", "cw", "bpsk", or "off"
                    if (value_str == "auto") {
                        set_beacon_mode(BeaconMode::MODE_AUTO);
                        log_(1, "Beacon mode set to AUTO");
                    } else if (value_str == "cw") {
                        set_beacon_mode(BeaconMode::MODE_CW_ONLY);
                        log_(1, "Beacon mode set to CW_ONLY");
                    } else if (value_str == "bpsk") {
                        set_beacon_mode(BeaconMode::MODE_BPSK_ONLY);
                        log_(1, "Beacon mode set to BPSK_ONLY");
                    } else if (value_str == "off") {
                        set_beacon_mode(BeaconMode::MODE_OFF);
                        log_(1, "Beacon mode set to OFF");
                    } else {
                        log_(0, "Unknown beacon mode: " + value_str);
                    }
                } else if (cmd == "rit") {
                    try {
                        int offset = std::stoi(value_str);
                        rit_offset_hz_ = offset;
                        log_(1, "RIT offset set to " + std::to_string(offset) + " Hz");
                    } catch (...) {
                        log_(0, "Failed to parse RIT offset value");
                    }
                } else if (cmd == "xit") {
                    try {
                        int offset = std::stoi(value_str);
                        xit_offset_hz_ = offset;
                        log_(1, "XIT offset set to " + std::to_string(offset) + " Hz");
                    } catch (...) {
                        log_(0, "Failed to parse XIT offset value");
                    }
                } else if (cmd == "tx_power") {
                    try {
                        float power_dbm = std::stof(value_str);
                        set_tx_gain(power_dbm);
                        log_(1, "TX power set to " + std::to_string(power_dbm) + " dBm");
                    } catch (...) {
                        log_(0, "Failed to parse TX power value");
                    }
                } else if (cmd == "rf_loopback") {
                    try {
                        int enabled = std::stoi(value_str);
                        rf_loopback_ = (enabled != 0);
                        log_(1, "RF loopback " + std::string(rf_loopback_.load() ? "enabled" : "disabled"));
                    } catch (...) {
                        log_(0, "Failed to parse rf_loopback value");
                    }
                } else if (cmd == "audio_loopback") {
                    try {
                        int enabled = std::stoi(value_str);
                        log_(1, "Audio loopback " + std::string(enabled ? "enabled" : "disabled"));
                        // TODO: Implement audio loopback
                    } catch (...) {
                        log_(0, "Failed to parse audio_loopback value");
                    }
                } else if (cmd == "test_tone") {
                    try {
                        int freq_hz = std::stoi(value_str);
                        test_tone_hz_ = freq_hz;
                        log_(1, "Test tone set to " + std::to_string(freq_hz) + " Hz");
                    } catch (...) {
                        log_(0, "Failed to parse test_tone frequency");
                    }
                } else if (cmd == "ber_start") {
                    log_(1, "BER test started");
                    // TODO: Implement BER test start
                } else if (cmd == "ber_stop") {
                    log_(1, "BER test stopped");
                    ber_current_ = 0.0f;
                } else if (cmd == "reset_modem") {
                    log_(1, "Modem reset requested");
                    // TODO: Implement modem reset
                } else if (cmd == "sdr_connect") {
                    // Parse connection parameters from JSON value string
                    // Expected format: {"uri":"ip:192.168.1.200","lnb_offset_mhz":9750.0,"bandwidth_hz":512000.0}
                    try {
                        std::string uri = "ip:192.168.1.200";  // default
                        float lnb_offset = 9750.0f;
                        float bandwidth = 2700000.0f;  // 2.7 MHz default — safely above PlutoSDR 520830 Hz minimum

                        // JSON parsing (handle nested objects with brace-counting)
                        size_t uri_pos = value_str.find("\"uri\"");
                        if (uri_pos != std::string::npos) {
                            size_t colon = value_str.find(":", uri_pos);
                            size_t quote1 = value_str.find("\"", colon);
                            size_t quote2 = value_str.find("\"", quote1 + 1);
                            if (quote1 != std::string::npos && quote2 != std::string::npos) {
                                uri = value_str.substr(quote1 + 1, quote2 - quote1 - 1);
                            }
                        }

                        size_t lnb_pos = value_str.find("lnb_offset_mhz");
                        if (lnb_pos != std::string::npos) {
                            size_t colon = value_str.find(":", lnb_pos);
                            size_t comma_or_brace = value_str.find_first_of(",}", colon);
                            std::string lnb_str = value_str.substr(colon + 1, comma_or_brace - colon - 1);
                            lnb_offset = std::stof(lnb_str);
                        }

                        size_t bw_pos = value_str.find("bandwidth_hz");
                        if (bw_pos != std::string::npos) {
                            size_t colon = value_str.find(":", bw_pos);
                            size_t comma_or_brace = value_str.find_first_of(",}", colon);
                            std::string bw_str = value_str.substr(colon + 1, comma_or_brace - colon - 1);
                            bandwidth = std::stof(bw_str);
                        }

                        log_(1, "SDR connect request: uri=" + uri + ", lnb=" + std::to_string(lnb_offset) +
                             " MHz, bw=" + std::to_string(bandwidth) + " Hz");

                        connect_sdr_(uri, lnb_offset, bandwidth);
                    } catch (const std::exception& e) {
                        log_(0, std::string("Failed to parse sdr_connect parameters: ") + e.what());
                        send_udp_response_(R"({"connected":false,"error":"parse error"})");
                    }

                } else if (cmd == "set_lnb_offset") {
                    try {
                        float lnb_mhz = std::stof(value_str);
                        set_lnb_offset(lnb_mhz);
                        log_(1, "LNB offset set to " + std::to_string(lnb_mhz) + " MHz via UDP command");
                    } catch (...) {
                        log_(0, "Failed to parse set_lnb_offset value");
                    }

                } else if (cmd == "set_xo_correction") {
                    try {
                        int xo_ppb = std::stoi(value_str);
                        xo_correction_ppb_ = xo_ppb;
                        log_(1, "XO correction stored: " + std::to_string(xo_ppb) + " PPB (applied on next retune)");
                    } catch (...) {
                        log_(0, "Failed to parse set_xo_correction value");
                    }

                } else if (cmd == "sdr_disconnect") {
                    log_(1, "SDR disconnect request");
                    disconnect_sdr_();

                } else if (cmd == "shutdown") {
                    log_(1, "Shutdown requested");
                    stop_requested_ = true;
                    running_ = false;
                } else {
                    log_(0, "Unknown command: " + cmd);
                }

            } catch (const std::exception& e) {
                log_(0, std::string("Command processing error: ") + e.what());
            }
        }

    } catch (const std::exception& e) {
        log_(0, std::string("UDP command listener exception: ") + e.what());
    }

    if (sock != INVALID_SOCKET) {
        closesocket(sock);
    }

#ifdef _WIN32
    WSACleanup();
#endif

    LOG_INFO("radio", "UDP command listener thread stopped",
             "{\"thread\": \"udp_cmd_listener\"}");
    log_(1, "UDP command listener thread stopped");
}
