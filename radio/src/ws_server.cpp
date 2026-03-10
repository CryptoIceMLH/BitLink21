#include "ws_server.h"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <ctime>

// Platform-specific socket includes
#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    #define SHUT_RDWR SD_BOTH
    #define close closesocket
    typedef int socklen_t;
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #include <fcntl.h>
    #define INVALID_SOCKET -1
    #define SOCKET_ERROR -1
#endif

// SHA1 for WebSocket handshake
#include <openssl/sha.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>

// ============================================================================
// Helper: Base64 encode (for WebSocket handshake)
// ============================================================================

static std::string base64_encode(const unsigned char* data, size_t len) {
    static const char base64_chars[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string ret;
    int i = 0;
    unsigned char char_array_3[3];
    unsigned char char_array_4[4];

    for (size_t j = 0; j < len; ++j) {
        char_array_3[i++] = data[j];
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for (i = 0; i < 4; ++i)
                ret += base64_chars[char_array_4[i]];
            i = 0;
        }
    }

    if (i > 0) {
        for (int j = i; j < 3; ++j)
            char_array_3[j] = '\0';

        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);

        for (int j = 0; j <= i; ++j)
            ret += base64_chars[char_array_4[j]];

        while (i++ < 3)
            ret += '=';
    }

    return ret;
}

// ============================================================================
// Helper: WebSocket frame encoding/decoding
// ============================================================================

static std::vector<uint8_t> encode_websocket_frame(
    const std::string& payload, bool is_binary = false)
{
    std::vector<uint8_t> frame;
    uint8_t opcode = is_binary ? 0x02 : 0x01;  // Binary or text frame
    uint8_t fin = 0x80;  // FIN bit

    uint64_t payload_len = payload.length();

    // First byte: FIN + opcode
    frame.push_back(fin | opcode);

    // Length bytes (no masking for server->client)
    if (payload_len < 126) {
        frame.push_back((uint8_t)payload_len);
    } else if (payload_len < 65536) {
        frame.push_back(126);
        frame.push_back((uint8_t)(payload_len >> 8));
        frame.push_back((uint8_t)(payload_len & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; --i) {
            frame.push_back((uint8_t)((payload_len >> (i * 8)) & 0xFF));
        }
    }

    // Payload
    frame.insert(frame.end(), payload.begin(), payload.end());

    return frame;
}

static bool decode_websocket_frame(
    const uint8_t* data, size_t len, std::string& payload)
{
    if (len < 2) return false;

    uint8_t fin = (data[0] & 0x80) >> 7;
    uint8_t opcode = data[0] & 0x0F;

    if (opcode == 0x08) {  // Close frame
        return false;
    }

    uint8_t mask = (data[1] & 0x80) >> 7;
    uint64_t payload_len = data[1] & 0x7F;

    size_t offset = 2;

    // Extended payload length
    if (payload_len == 126) {
        if (len < 4) return false;
        payload_len = ((uint64_t)data[2] << 8) | data[3];
        offset = 4;
    } else if (payload_len == 127) {
        if (len < 10) return false;
        payload_len = 0;
        for (int i = 0; i < 8; ++i) {
            payload_len = (payload_len << 8) | data[2 + i];
        }
        offset = 10;
    }

    // Masking key
    uint8_t mask_key[4] = {0, 0, 0, 0};
    if (mask) {
        if (len < offset + 4) return false;
        std::memcpy(mask_key, data + offset, 4);
        offset += 4;
    }

    // Payload
    if (len < offset + payload_len) return false;

    payload.clear();
    payload.resize(payload_len);

    for (uint64_t i = 0; i < payload_len; ++i) {
        payload[i] = (char)(data[offset + i] ^ mask_key[i % 4]);
    }

    return true;
}

// ============================================================================
// WsServer Implementation
// ============================================================================

WsServer::WsServer(RadioController* radio, uint16_t port)
    : radio_(radio), port_(port), running_(false), listen_socket_(INVALID_SOCKET),
      waterfall_buffer_index_(0), fft_plan_(nullptr)
{
    std::cerr << "[WS] DEBUG: WsServer constructor - port=" << port << "\n";

    // Initialize FFT plan for 2048-bin transform (2048 = 2^11)
    // liquid-dsp FFT: create plan with pre-allocated input/output buffers
    // Cast std::complex<float>* to liquid_float_complex* (ABI-compatible)
    std::cerr << "[WS] DEBUG: Creating FFT plan (2048 bins)\n";
    fft_plan_ = fft_create_plan(2048, (liquid_float_complex*)fft_input_, (liquid_float_complex*)fft_output_, LIQUID_FFT_FORWARD, 0);
    if (!fft_plan_) {
        std::cerr << "[WS] DEBUG: FFT plan creation FAILED\n";
    } else {
        std::cerr << "[WS] DEBUG: FFT plan created successfully\n";
    }

    // Initialize Hann window
    std::cerr << "[WS] DEBUG: Initializing Hann window\n";
    init_hann_window_();

    // Initialize metrics with defaults
    std::cerr << "[WS] DEBUG: Initializing default metrics\n";
    latest_metrics_.timestamp_ms = 0;
    latest_metrics_.rssi_db = -100.0f;
    latest_metrics_.snr_db = 0.0f;
    latest_metrics_.evm_db = -40.0f;
    latest_metrics_.beacon_lock_state = "UNLOCKED";
    latest_metrics_.beacon_phase_error_deg = 0.0f;
    latest_metrics_.beacon_lock_age_sec = 0.0f;
    latest_metrics_.rx_frame_count = 0;
    latest_metrics_.rx_error_count = 0;
    latest_metrics_.tx_queue_depth = 0;
    latest_metrics_.ptt_state = false;
    latest_metrics_.modem_scheme = "LIQUID_MODEM_QPSK";
    latest_metrics_.center_freq_mhz = 10489.55f;
    latest_metrics_.rx_gain_db = 60.0f;
    latest_metrics_.tx_gain_db = 10.0f;
    latest_metrics_.sample_rate_mhz = 2.0f;
    latest_metrics_.signal_detected = false;

    std::cerr << "[WS] DEBUG: WsServer constructor SUCCESSFUL\n";
    latest_metrics_.frame_sync = false;
    latest_metrics_.tx_vu = 0.0f;
    latest_metrics_.rx_vu = 0.0f;
    latest_metrics_.pb_fifo = 0.0f;
    latest_metrics_.cap_fifo = 0.0f;
    latest_metrics_.ber = 0.0f;
    latest_metrics_.speed_mode_str = "QPSK 4800 bps";
    latest_metrics_.rx_freq_hz = 10489550000;
    latest_metrics_.tx_freq_hz = 10489550000;
    latest_metrics_.rit_offset_hz = 0;
    latest_metrics_.xit_offset_hz = 0;
    latest_metrics_.rf_loopback = false;
    latest_metrics_.test_tone_hz = 0;
    latest_metrics_.tx_spectrum.resize(200, 0.0f);  // 200-bin TX spectrum

    last_waterfall_time_ = std::chrono::steady_clock::now();
    last_metrics_time_ = std::chrono::steady_clock::now();
    last_constellation_time_ = std::chrono::steady_clock::now();
}

WsServer::~WsServer() {
    stop();

    if (fft_plan_ != nullptr) {
        fft_destroy_plan(fft_plan_);
    }
}

bool WsServer::start() {
    std::cerr << "[WS] DEBUG: start() called\n";

    if (running_.load()) {
        std::cerr << "[WS] DEBUG: Already running\n";
        std::cerr << "WsServer already running" << std::endl;
        return false;
    }

    // Initialize Winsock on Windows
#ifdef _WIN32
    std::cerr << "[WS] DEBUG: Initializing Winsock\n";
    WSADATA wsa_data;
    if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
        std::cerr << "[WS] DEBUG: WSAStartup() FAILED\n";
        std::cerr << "WSAStartup failed" << std::endl;
        return false;
    }
    std::cerr << "[WS] DEBUG: Winsock initialized\n";
#endif

    // Create listening socket
    std::cerr << "[WS] DEBUG: Creating listening socket\n";
    listen_socket_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_socket_ == INVALID_SOCKET) {
        std::cerr << "[WS] DEBUG: socket() FAILED\n";
        std::cerr << "Failed to create socket" << std::endl;
        return false;
    }
    std::cerr << "[WS] DEBUG: Socket created: fd=" << listen_socket_ << "\n";

    // Allow address reuse
    std::cerr << "[WS] DEBUG: Setting SO_REUSEADDR\n";
    int reuse = 1;
#ifdef _WIN32
    if (setsockopt(listen_socket_, SOL_SOCKET, SO_REUSEADDR,
                   (const char*)&reuse, sizeof(reuse)) == SOCKET_ERROR) {
#else
    if (setsockopt(listen_socket_, SOL_SOCKET, SO_REUSEADDR,
                   &reuse, sizeof(reuse)) == -1) {
#endif
        std::cerr << "[WS] DEBUG: setsockopt(SO_REUSEADDR) FAILED\n";
        std::cerr << "Failed to set SO_REUSEADDR" << std::endl;
        close(listen_socket_);
        return false;
    }

    // Bind to port
    std::cerr << "[WS] DEBUG: Binding to port " << port_ << "\n";
    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(port_);

    if (bind(listen_socket_, (struct sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        std::cerr << "[WS] DEBUG: bind() FAILED for port " << port_ << "\n";
        std::cerr << "Failed to bind to port " << port_ << std::endl;
        close(listen_socket_);
        return false;
    }
    std::cerr << "[WS] DEBUG: bind() SUCCESSFUL\n";

    // Listen for connections
    std::cerr << "[WS] DEBUG: Listening for connections\n";
    if (listen(listen_socket_, 5) == SOCKET_ERROR) {
        std::cerr << "[WS] DEBUG: listen() FAILED\n";
        std::cerr << "Failed to listen on socket" << std::endl;
        close(listen_socket_);
        return false;
    }
    std::cerr << "[WS] DEBUG: listen() SUCCESSFUL\n";

    std::cout << "WsServer listening on port " << port_ << std::endl;
    std::cerr << "[WS] DEBUG: Starting listener thread\n";

    running_ = true;

    // Start listener thread
    listener_thread_ = std::make_unique<std::thread>(
        &WsServer::listener_thread_main_, this);

    std::cerr << "[WS] DEBUG: Listener thread started\n";
    std::cerr << "[WS] DEBUG: start() SUCCESSFUL\n";
    return true;
}

void WsServer::stop() {
    std::cerr << "[WS] DEBUG: stop() called\n";

    if (!running_.load()) {
        std::cerr << "[WS] DEBUG: Not running, returning\n";
        return;
    }

    std::cerr << "[WS] DEBUG: Setting running_=false\n";
    running_ = false;

    // Close listening socket
    std::cerr << "[WS] DEBUG: Closing listening socket\n";
    if (listen_socket_ != INVALID_SOCKET) {
        close(listen_socket_);
        listen_socket_ = INVALID_SOCKET;
    }
    std::cerr << "[WS] DEBUG: Listening socket closed\n";

    // Close all client connections
    {
        std::cerr << "[WS] DEBUG: Closing all client connections\n";
        std::lock_guard<std::mutex> lock(clients_mutex_);
        int client_count = 0;
        for (auto& client : clients_) {
            if (client && client->socket_fd != INVALID_SOCKET) {
                close(client->socket_fd);
                client->socket_fd = INVALID_SOCKET;
                client->connected = false;
                client_count++;
            }
        }
        std::cerr << "[WS] DEBUG: Closed " << client_count << " client connections\n";
        clients_.clear();
    }

    // Wait for threads to finish
    std::cerr << "[WS] DEBUG: Waiting for listener thread to finish\n";
    if (listener_thread_ && listener_thread_->joinable()) {
        listener_thread_->join();
    }
    std::cerr << "[WS] DEBUG: Listener thread joined\n";

    std::cerr << "[WS] DEBUG: Waiting for " << worker_threads_.size() << " worker threads to finish\n";
    for (auto& thread : worker_threads_) {
        if (thread && thread->joinable()) {
            thread->join();
        }
    }
    worker_threads_.clear();

#ifdef _WIN32
    WSACleanup();
#endif

    std::cout << "WsServer stopped" << std::endl;
}

bool WsServer::is_running() const {
    return running_.load();
}

void WsServer::publish_waterfall(
    const std::complex<float>* iq_buffer,
    float sample_rate_hz,
    float center_freq_mhz,
    float bandwidth_mhz)
{
    static uint32_t call_count = 0;
    call_count++;

    if (call_count % 10 == 0) {
        std::cerr << "[WS] publish_waterfall called " << call_count << " times" << std::endl;
    }

    // Rate limiting: 20 Hz (50 ms minimum between frames)
    auto now = std::chrono::steady_clock::now();
    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - last_waterfall_time_).count();

    if (elapsed_ms < 50) {
        if (call_count % 100 == 0) {
            std::cerr << "[WS] Skipping waterfall (rate limit: " << elapsed_ms << "ms < 50ms)" << std::endl;
        }
        return;  // Skip this frame, too soon
    }

    std::cerr << "[WS] Publishing waterfall #" << call_count << " (freq=" << center_freq_mhz << " MHz, bw=" << bandwidth_mhz << " MHz)" << std::endl;

    last_waterfall_time_ = now;

    WaterfallFrame frame;
    frame.timestamp_ms = get_timestamp_ms_();
    frame.center_freq_mhz = center_freq_mhz;
    frame.bandwidth_mhz = bandwidth_mhz;

    // Compute FFT
    std::cerr << "[WS] Computing FFT..." << std::endl;
    compute_waterfall_(iq_buffer, frame);
    std::cerr << "[WS] FFT computed" << std::endl;

    // Store in ring buffer for late subscribers
    {
        std::lock_guard<std::mutex> lock(waterfall_buffer_mutex_);
        waterfall_buffer_[waterfall_buffer_index_] = frame;
        waterfall_buffer_index_ = (waterfall_buffer_index_ + 1) % WATERFALL_BUFFER_SIZE;
    }

    // Broadcast to all clients
    std::string json = waterfall_to_json_(frame);
    std::cerr << "[WS] Broadcasting waterfall JSON (" << json.length() << " bytes) to clients" << std::endl;
    broadcast_message_(json, true);  // true = is_waterfall (apply backpressure)
    std::cerr << "[WS] Waterfall broadcast complete" << std::endl;
}

void WsServer::publish_constellation(const std::complex<float>* iq_buffer, size_t iq_count) {
    // Rate limiting: 10 Hz (100 ms minimum between constellation updates)
    auto now = std::chrono::steady_clock::now();
    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - last_constellation_time_).count();

    if (elapsed_ms < 100) {
        return;  // Skip this frame, too soon
    }

    last_constellation_time_ = now;

    if (!iq_buffer || iq_count == 0) {
        return;
    }

    // Sample every 4th point to limit data volume (keep ~128 points per frame)
    std::stringstream ss;
    ss << "{\"type\":\"constellation\",\"points\":[";

    size_t count = 0;
    const size_t step = std::max(size_t(1), iq_count / 128);

    for (size_t i = 0; i < iq_count; i += step) {
        if (count > 0) ss << ",";
        float i_val = iq_buffer[i].real();
        float q_val = iq_buffer[i].imag();

        // Normalize to -1.0 to 1.0 range (assuming IQ amplitude ~ 1.0)
        ss << "{\"i\":" << (i_val / 2.0f) << ",\"q\":" << (q_val / 2.0f) << "}";
        count++;
    }

    ss << "]}";
    std::string json = ss.str();
    broadcast_message_(json, false);  // No backpressure for constellation
}

void WsServer::publish_metrics(const MetricsFrame& metrics) {
    // Rate limiting: 5 Hz (200 ms minimum between frames)
    auto now = std::chrono::steady_clock::now();
    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - last_metrics_time_).count();

    if (elapsed_ms < 200) {
        return;  // Skip this frame, too soon
    }

    last_metrics_time_ = now;

    {
        std::lock_guard<std::mutex> lock(metrics_mutex_);
        latest_metrics_ = metrics;
    }

    // Broadcast to all clients
    std::string json = metrics_to_json_(metrics);
    broadcast_message_(json, false);  // false = is_waterfall
}

void WsServer::on_rx_frame(const SSPFrame& frame_header, float rssi_db, float snr_db) {
    RxFrameLog log;
    log.timestamp_ms = get_timestamp_ms_();
    log.msg_id = frame_header.msg_id;
    log.seq_num = frame_header.seq_num;
    log.total_frags = frame_header.total_frags;
    log.payload_type = frame_header.payload_type;
    log.payload_len = frame_header.payload_len;
    log.rssi_at_rx_db = rssi_db;
    log.snr_at_rx_db = snr_db;

    std::string json = rx_frame_to_json_(log);
    broadcast_message_(json, false);
}

void WsServer::on_tx_frame(const SSPFrame& frame_header, uint64_t samples_sent) {
    TxFrameLog log;
    log.timestamp_ms = get_timestamp_ms_();
    log.msg_id = frame_header.msg_id;
    log.seq_num = frame_header.seq_num;
    log.total_frags = frame_header.total_frags;
    log.payload_type = frame_header.payload_type;
    log.payload_len = frame_header.payload_len;
    log.samples_sent = samples_sent;

    std::string json = tx_frame_to_json_(log);
    broadcast_message_(json, false);
}

bool WsServer::get_fft_buffer(WaterfallFrame& frame) const {
    std::lock_guard<std::mutex> lock(waterfall_buffer_mutex_);

    if (waterfall_buffer_index_ == 0) {
        return false;  // No frames yet
    }

    // Get the most recent frame (before current index)
    size_t most_recent_idx = (waterfall_buffer_index_ - 1 + WATERFALL_BUFFER_SIZE) % WATERFALL_BUFFER_SIZE;
    frame = waterfall_buffer_[most_recent_idx];

    return true;
}

bool WsServer::get_metrics(MetricsFrame& frame) const {
    std::lock_guard<std::mutex> lock(metrics_mutex_);

    if (latest_metrics_.timestamp_ms == 0) {
        return false;  // No metrics yet
    }

    frame = latest_metrics_;
    return true;
}

// ============================================================================
// Private: Threading and Client Management
// ============================================================================

void WsServer::listener_thread_main_() {
    std::cout << "WsServer listener thread started" << std::endl;

    while (running_.load()) {
        struct sockaddr_in client_addr;
        socklen_t client_addr_len = sizeof(client_addr);

        int client_socket = accept(listen_socket_, (struct sockaddr*)&client_addr, &client_addr_len);

        if (client_socket == INVALID_SOCKET) {
            if (running_.load()) {
                // Real error
#ifdef _WIN32
                int err = WSAGetLastError();
                if (err != WSAEINTR) {
                    std::cerr << "Accept failed: " << err << std::endl;
                }
#else
                std::cerr << "Accept failed" << std::endl;
#endif
            }
            continue;
        }

        // Perform WebSocket handshake
        if (!accept_websocket_connection_(client_socket)) {
            close(client_socket);
            continue;
        }

        // Add client and start worker thread
        add_client_(client_socket);
    }

    std::cout << "WsServer listener thread exited" << std::endl;
}

void WsServer::worker_thread_main_(std::shared_ptr<ClientConnection> client) {
    std::cout << "WsServer worker thread started for client " << client->socket_fd << std::endl;

    while (running_.load() && client->connected.load()) {
        // Try to read incoming message
        std::string payload;
        if (read_websocket_frame_(client->socket_fd, payload)) {
            // Received a message (usually ping/pong or close)
            if (payload == "ping") {
                send_websocket_frame_(client->socket_fd, "pong", false);
            }
        }

        // Try to send queued messages
        {
            std::lock_guard<std::mutex> lock(client->queue_mutex);
            while (!client->send_queue.empty()) {
                std::string json = client->send_queue.front();
                client->send_queue.pop();

                if (!send_websocket_frame_(client->socket_fd, json, false)) {
                    client->connected = false;
                    break;
                }

                client->last_write_time_ms = get_timestamp_ms_();
            }
        }

        // Check for backpressure/stalls
        handle_backpressure_(client);

        // Yield to prevent busy waiting
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    std::cout << "WsServer worker thread exiting for client " << client->socket_fd << std::endl;

    remove_client_(client);
}

void WsServer::add_client_(int socket_fd) {
    // Set socket to non-blocking — prevents recv() from blocking indefinitely
    // Browser is passive (never sends), so blocking recv() starves the send queue
    int flags = fcntl(socket_fd, F_GETFL, 0);
    fcntl(socket_fd, F_SETFL, flags | O_NONBLOCK);

    auto client = std::make_shared<ClientConnection>();
    client->socket_fd = socket_fd;
    client->connected = true;
    client->last_write_time_ms = get_timestamp_ms_();
    client->waterfall_drops = 0;

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_.push_back(client);
    }

    // Start worker thread for this client
    auto worker = std::make_unique<std::thread>(
        &WsServer::worker_thread_main_, this, client);
    worker_threads_.push_back(std::move(worker));

    // Send only latest metrics on connect (NOT ring buffer)
    // Ring buffer dump was causing queue overflow on startup
    {
        std::lock_guard<std::mutex> lock(metrics_mutex_);
        if (latest_metrics_.timestamp_ms != 0) {
            std::string json = metrics_to_json_(latest_metrics_);
            send_to_client_(client, json);
        }
    }

    std::cout << "WsServer: Added client " << socket_fd << std::endl;
}

void WsServer::remove_client_(std::shared_ptr<ClientConnection> client) {
    if (!client) return;

    if (client->socket_fd != INVALID_SOCKET) {
        close(client->socket_fd);
        client->socket_fd = INVALID_SOCKET;
    }

    {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        auto it = std::find(clients_.begin(), clients_.end(), client);
        if (it != clients_.end()) {
            clients_.erase(it);
        }
    }

    std::cout << "WsServer: Removed client" << std::endl;
}

void WsServer::broadcast_message_(const std::string& json_msg, bool is_waterfall) {
    std::lock_guard<std::mutex> lock(clients_mutex_);

    int queued_count = 0;
    int dropped_count = 0;
    int disconnected_count = 0;

    for (auto& client : clients_) {
        if (!client || !client->connected.load()) {
            disconnected_count++;
            continue;
        }

        if (is_waterfall) {
            // Apply backpressure for waterfall frames
            {
                std::lock_guard<std::mutex> q_lock(client->queue_mutex);
                if (client->send_queue.size() > 10) {
                    // Queue full, drop this waterfall frame
                    client->waterfall_drops++;
                    dropped_count++;
                    continue;
                }
                client->send_queue.push(json_msg);
                queued_count++;
            }
        } else {
            // Always queue metrics/frame logs
            {
                std::lock_guard<std::mutex> q_lock(client->queue_mutex);
                client->send_queue.push(json_msg);
                queued_count++;
            }
        }
    }

    if (is_waterfall && (queued_count > 0 || dropped_count > 0)) {
        std::cerr << "[WS] Broadcast: " << queued_count << " queued, " << dropped_count << " dropped, " << disconnected_count << " disconnected\n";
    }
}

void WsServer::send_to_client_(std::shared_ptr<ClientConnection> client,
                               const std::string& json_msg) {
    if (!client || !client->connected.load()) return;

    std::lock_guard<std::mutex> lock(client->queue_mutex);
    client->send_queue.push(json_msg);
}

// ============================================================================
// Private: WebSocket Protocol Handling
// ============================================================================

bool WsServer::accept_websocket_connection_(int socket_fd) {
    // Ensure socket is in BLOCKING mode for handshake
#ifdef _WIN32
    u_long iMode = 0;  // blocking
    ioctlsocket(socket_fd, FIONBIO, &iMode);
#else
    int flags = fcntl(socket_fd, F_GETFL, 0);
    fcntl(socket_fd, F_SETFL, flags & ~O_NONBLOCK);  // remove non-blocking flag
#endif

    // Read HTTP upgrade request
    uint8_t buffer[4096];
    int n = recv(socket_fd, (char*)buffer, sizeof(buffer) - 1, 0);

    if (n <= 0) {
        return false;
    }

    buffer[n] = '\0';
    std::string request((char*)buffer);

    // Debug: print first 200 chars of request
    std::cerr << "[WS] Handshake request (first 200 chars): " << request.substr(0, std::min((size_t)200, request.length())) << std::endl;

    // Extract Sec-WebSocket-Key (case-insensitive)
    std::string key_header = "Sec-WebSocket-Key:";
    size_t pos = std::string::npos;

    // Try case-insensitive search
    for (size_t i = 0; i < request.length(); ++i) {
        std::string slice = request.substr(i, key_header.length());
        std::string slice_lower = slice;
        std::transform(slice_lower.begin(), slice_lower.end(), slice_lower.begin(), ::tolower);
        std::string key_lower = key_header;
        std::transform(key_lower.begin(), key_lower.end(), key_lower.begin(), ::tolower);

        if (slice_lower == key_lower) {
            pos = i;
            break;
        }
    }

    if (pos == std::string::npos) {
        std::cerr << "WebSocket handshake: No Sec-WebSocket-Key found" << std::endl;
        return false;
    }

    pos += key_header.length();
    // Skip whitespace after colon
    while (pos < request.length() && (request[pos] == ' ' || request[pos] == '\t')) {
        pos++;
    }

    size_t end = request.find('\r', pos);
    if (end == std::string::npos) {
        end = request.find('\n', pos);
    }

    std::string ws_key = request.substr(pos, end - pos);
    // Trim trailing whitespace
    while (!ws_key.empty() && (ws_key.back() == '\r' || ws_key.back() == '\n' || ws_key.back() == ' ')) {
        ws_key.pop_back();
    }

    std::cerr << "[WS] Extracted WebSocket Key: '" << ws_key << "'" << std::endl;

    // Compute Sec-WebSocket-Accept
    std::string magic_string = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    std::string sha1_input = ws_key + magic_string;

    unsigned char sha1_hash[SHA_DIGEST_LENGTH];
    SHA1((const unsigned char*)sha1_input.c_str(), sha1_input.length(), sha1_hash);

    std::string accept_key = base64_encode(sha1_hash, SHA_DIGEST_LENGTH);

    // Send upgrade response
    std::stringstream response;
    response << "HTTP/1.1 101 Switching Protocols\r\n"
             << "Upgrade: websocket\r\n"
             << "Connection: Upgrade\r\n"
             << "Sec-WebSocket-Accept: " << accept_key << "\r\n"
             << "\r\n";

    std::string resp_str = response.str();
    if (send(socket_fd, resp_str.c_str(), (int)resp_str.length(), 0) == SOCKET_ERROR) {
        std::cerr << "Failed to send WebSocket upgrade response" << std::endl;
        return false;
    }

    std::cout << "WebSocket connection established" << std::endl;
    return true;
}

bool WsServer::read_websocket_frame_(int socket_fd, std::string& payload) {
    uint8_t buffer[65536];

    int n = recv(socket_fd, (char*)buffer, sizeof(buffer), 0);

    if (n < 0) {
        // Non-blocking socket: EAGAIN/EWOULDBLOCK = no data available (not an error)
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            return false;
        }
        // Real error
        return false;
    }
    if (n == 0) {
        // Connection closed by remote
        return false;
    }

    return decode_websocket_frame(buffer, n, payload);
}

bool WsServer::send_websocket_frame_(int socket_fd, const std::string& payload, bool is_binary) {
    auto frame = encode_websocket_frame(payload, is_binary);

    int flags = 0;
#ifdef MSG_NOSIGNAL
    flags = MSG_NOSIGNAL;  // Prevent SIGPIPE on broken socket
#endif
    if (send(socket_fd, (const char*)frame.data(), (int)frame.size(), flags) == SOCKET_ERROR) {
        return false;
    }

    return true;
}

// ============================================================================
// Private: FFT Computation
// ============================================================================

void WsServer::init_hann_window_() {
    for (int i = 0; i < 2048; ++i) {
        hann_window_[i] = 0.5f * (1.0f - std::cos(2.0f * M_PI * i / 2047.0f));
    }
}

void WsServer::compute_waterfall_(
    const std::complex<float>* iq_buffer,
    WaterfallFrame& frame)
{
    std::lock_guard<std::mutex> lock(fft_mutex_);

    // Apply Hann window to input
    for (int i = 0; i < 2048; ++i) {
        fft_input_[i] = iq_buffer[i] * hann_window_[i];
    }

    // Perform FFT (uses input/output buffers from plan creation)
    fft_execute(fft_plan_);

    // Convert to dB with FFT shift (swap halves so DC is center bin 1024)
    frame.max_level_db = -200.0f;
    frame.min_level_db = 200.0f;

    float db_tmp[2048];
    for (int i = 0; i < 2048; ++i) {
        std::complex<float> val = fft_output_[i];
        float mag = std::abs(val) / 2048.0f;
        if (mag > 1e-5f) {
            db_tmp[i] = 20.0f * std::log10(mag);
        } else {
            db_tmp[i] = -100.0f;
        }
    }

    // FFT shift: bin[0..1023] → right half, bin[1024..2047] → left half
    for (int i = 0; i < 1024; ++i) {
        frame.bins[i] = db_tmp[i + 1024];       // negative freqs → left
        frame.bins[i + 1024] = db_tmp[i];        // positive freqs → right
    }

    // DC notch fill: interpolate center 5 bins to hide LO leakage dip
    {
        float left_avg = (frame.bins[1021] + frame.bins[1022]) / 2.0f;
        float right_avg = (frame.bins[1027] + frame.bins[1028]) / 2.0f;
        for (int i = 1023; i <= 1025; ++i) {
            float t = (float)(i - 1022) / 4.0f;
            frame.bins[i] = left_avg * (1.0f - t) + right_avg * t;
        }
    }

    for (int i = 0; i < 2048; ++i) {
        if (frame.bins[i] > frame.max_level_db) frame.max_level_db = frame.bins[i];
        if (frame.bins[i] < frame.min_level_db) frame.min_level_db = frame.bins[i];
    }
}

// ============================================================================
// Private: JSON Serialization
// ============================================================================

std::string WsServer::waterfall_to_json_(const WaterfallFrame& frame) const {
    std::stringstream ss;

    ss << std::fixed << std::setprecision(1);

    ss << "{"
       << "\"type\":\"waterfall\","
       << "\"timestamp_ms\":" << frame.timestamp_ms << ","
       << "\"center_freq_mhz\":" << frame.center_freq_mhz << ","
       << "\"bandwidth_mhz\":" << frame.bandwidth_mhz << ","
       << "\"max_level_db\":" << frame.max_level_db << ","
       << "\"min_level_db\":" << frame.min_level_db << ","
       << "\"bins\":[";

    for (int i = 0; i < 2048; ++i) {
        if (i > 0) ss << ",";
        ss << frame.bins[i];
    }

    ss << "]}";

    return ss.str();
}

std::string WsServer::metrics_to_json_(const MetricsFrame& frame) const {
    std::stringstream ss;

    ss << std::fixed << std::setprecision(2);

    ss << "{"
       << "\"type\":\"metrics\","
       << "\"timestamp_ms\":" << frame.timestamp_ms << ","
       << "\"rssi_db\":" << frame.rssi_db << ","
       << "\"snr_db\":" << frame.snr_db << ","
       << "\"evm_db\":" << frame.evm_db << ","
       << "\"beacon_lock_state\":\"" << frame.beacon_lock_state << "\","
       << "\"beacon_phase_error_deg\":" << frame.beacon_phase_error_deg << ","
       << "\"beacon_lock_age_sec\":" << frame.beacon_lock_age_sec << ","
       << "\"rx_frame_count\":" << frame.rx_frame_count << ","
       << "\"rx_error_count\":" << frame.rx_error_count << ","
       << "\"tx_queue_depth\":" << frame.tx_queue_depth << ","
       << "\"ptt_state\":" << (frame.ptt_state ? "true" : "false") << ","
       << "\"modem_scheme\":\"" << frame.modem_scheme << "\","
       << "\"center_freq_mhz\":" << frame.center_freq_mhz << ","
       << "\"rx_gain_db\":" << frame.rx_gain_db << ","
       << "\"tx_gain_db\":" << frame.tx_gain_db << ","
       << "\"sample_rate_mhz\":" << frame.sample_rate_mhz << ","
       << "\"sdr_connected\":" << (frame.sdr_connected ? "true" : "false") << ","
       << "\"sdr_hw_model\":\"" << frame.sdr_hw_model << "\","
       << "\"sdr_fw_version\":\"" << frame.sdr_fw_version << "\","
       << "\"sdr_serial\":\"" << frame.sdr_serial << "\","
       // Extended metrics (B3+B4)
       << "\"signal_detected\":" << (frame.signal_detected ? "true" : "false") << ","
       << "\"frame_sync\":" << (frame.frame_sync ? "true" : "false") << ","
       << "\"tx_vu\":" << frame.tx_vu << ","
       << "\"rx_vu\":" << frame.rx_vu << ","
       << "\"pb_fifo\":" << frame.pb_fifo << ","
       << "\"cap_fifo\":" << frame.cap_fifo << ","
       << "\"ber\":" << frame.ber << ","
       << "\"speed_mode_str\":\"" << frame.speed_mode_str << "\","
       << "\"rx_freq_hz\":" << frame.rx_freq_hz << ","
       << "\"tx_freq_hz\":" << frame.tx_freq_hz << ","
       << "\"rit_offset_hz\":" << frame.rit_offset_hz << ","
       << "\"xit_offset_hz\":" << frame.xit_offset_hz << ","
       << "\"rf_loopback\":" << (frame.rf_loopback ? "true" : "false") << ","
       << "\"test_tone_hz\":" << frame.test_tone_hz << ","
       << "\"tx_spectrum\":[";

    // Serialize TX spectrum (200 bins)
    for (size_t i = 0; i < frame.tx_spectrum.size(); ++i) {
        if (i > 0) ss << ",";
        ss << frame.tx_spectrum[i];
    }

    ss << "]}";

    return ss.str();
}

std::string WsServer::rx_frame_to_json_(const RxFrameLog& frame) const {
    std::stringstream ss;

    ss << std::fixed << std::setprecision(2);

    ss << "{"
       << "\"type\":\"rx_frame\","
       << "\"timestamp_ms\":" << frame.timestamp_ms << ","
       << "\"msg_id\":" << frame.msg_id << ","
       << "\"seq_num\":" << (int)frame.seq_num << ","
       << "\"total_frags\":" << (int)frame.total_frags << ","
       << "\"payload_type\":" << (int)frame.payload_type << ","
       << "\"payload_len\":" << frame.payload_len << ","
       << "\"rssi_at_rx_db\":" << frame.rssi_at_rx_db << ","
       << "\"snr_at_rx_db\":" << frame.snr_at_rx_db
       << "}";

    return ss.str();
}

std::string WsServer::tx_frame_to_json_(const TxFrameLog& frame) const {
    std::stringstream ss;

    ss << "{"
       << "\"type\":\"tx_frame\","
       << "\"timestamp_ms\":" << frame.timestamp_ms << ","
       << "\"msg_id\":" << frame.msg_id << ","
       << "\"seq_num\":" << (int)frame.seq_num << ","
       << "\"total_frags\":" << (int)frame.total_frags << ","
       << "\"payload_type\":" << (int)frame.payload_type << ","
       << "\"payload_len\":" << frame.payload_len << ","
       << "\"samples_sent\":" << frame.samples_sent
       << "}";

    return ss.str();
}

// ============================================================================
// Private: Backpressure Handling
// ============================================================================

void WsServer::handle_backpressure_(std::shared_ptr<ClientConnection> client) {
    if (!client) return;

    // Only disconnect on QUEUE OVERFLOW (data piling up = client not reading)
    // Don't disconnect based on idle time — browser clients are allowed to be idle
    // waiting for data without penalty
    if (client->send_queue.size() > 50) {
        std::cout << "WsServer: Queue overflow on client " << client->socket_fd << " ("
                  << client->send_queue.size() << " items), disconnecting\n";
        client->connected = false;
    }
}

void WsServer::check_stalled_clients_() {
    std::lock_guard<std::mutex> lock(clients_mutex_);

    uint64_t now_ms = get_timestamp_ms_();

    auto it = clients_.begin();
    while (it != clients_.end()) {
        auto& client = *it;
        if (!client || !client->connected.load()) {
            it = clients_.erase(it);
        } else {
            uint64_t last_write_ms = client->last_write_time_ms.load();
            if (now_ms - last_write_ms > 5000) {
                std::cout << "WsServer: Closing stalled client" << std::endl;
                client->connected = false;
                it = clients_.erase(it);
            } else {
                ++it;
            }
        }
    }
}

// ============================================================================
// Private: Utility
// ============================================================================

uint64_t WsServer::get_timestamp_ms_() {
    auto now = std::chrono::system_clock::now();
    auto duration = now.time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
}
