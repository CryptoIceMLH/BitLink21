#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <queue>
#include <array>
#include <complex>
#include <thread>
#include <mutex>
#include <atomic>
#include <memory>
#include <chrono>
#include <liquid/liquid.h>
#include "ssp.h"
#include "beacon_lock.h"

// Forward declaration
class RadioController;

/**
 * WsServer — WebSocket Telemetry Server
 *
 * Publishes real-time telemetry from radio_controller to React web UI via WebSocket:
 * - Waterfall FFT (2048-bin power spectrum at 20 Hz)
 * - Signal metrics (RSSI, SNR, EVM, lock state at 5 Hz)
 * - RX/TX frame logs (on frame events)
 *
 * Threading:
 * - Main listener thread: blocking accept on WebSocket port
 * - One worker thread per client: non-blocking send with backpressure handling
 * - Ring buffer for late subscribers (1 sec of waterfall frames)
 * - Mutex protection for client list and telemetry buffers
 *
 * WebSocket Protocol:
 * - HTTP upgrade handshake (RFC 6455)
 * - JSON frames sent directly (no additional framing)
 * - Auto-reconnect friendly (graceful close on stalls)
 */

class WsServer {
public:
    // Telemetry data structures for JSON serialization

    // Waterfall FFT frame (2048 bins, dB scale)
    struct WaterfallFrame {
        uint64_t timestamp_ms;
        std::array<float, 2048> bins;  // Power in dB
        float center_freq_mhz;
        float bandwidth_mhz;
        float max_level_db;
        float min_level_db;
    };

    // Signal metrics frame
    struct MetricsFrame {
        uint64_t timestamp_ms;
        float rssi_db;
        float snr_db;
        float evm_db;
        std::string beacon_lock_state;  // "UNLOCKED", "COARSE_LOCK", "FINE_LOCK"
        float beacon_phase_error_deg;
        float beacon_lock_age_sec;
        uint32_t rx_frame_count;
        uint32_t rx_error_count;
        uint16_t tx_queue_depth;
        bool ptt_state;
        std::string modem_scheme;       // e.g., "LIQUID_MODEM_QPSK"
        float center_freq_mhz;
        float rx_gain_db;
        float tx_gain_db;
        float sample_rate_mhz;
        bool sdr_connected = false;
        std::string sdr_hw_model;
        std::string sdr_fw_version;
        std::string sdr_serial;
        // Extended metrics (B3+B4)
        bool signal_detected = false;
        bool frame_sync = false;
        float tx_vu = 0.0f;             // TX VU meter 0-1
        float rx_vu = 0.0f;             // RX VU meter 0-1
        float pb_fifo = 0.0f;           // Playback FIFO fill 0-1
        float cap_fifo = 0.0f;          // Capture FIFO fill 0-1
        float ber = 0.0f;               // BER 0-1
        std::string speed_mode_str;     // e.g. "QPSK 4800 bps"
        int64_t rx_freq_hz = 10489550000;  // RX LO frequency
        int64_t tx_freq_hz = 10489550000;  // TX LO frequency
        int32_t rit_offset_hz = 0;      // RX offset
        int32_t xit_offset_hz = 0;      // TX offset
        bool rf_loopback = false;
        int32_t test_tone_hz = 0;
        std::vector<float> tx_spectrum;  // TX spectrum FFT (200 bins)
    };

    // RX frame log entry
    struct RxFrameLog {
        uint64_t timestamp_ms;
        uint16_t msg_id;
        uint8_t seq_num;
        uint8_t total_frags;
        uint8_t payload_type;
        uint16_t payload_len;
        float rssi_at_rx_db;
        float snr_at_rx_db;
    };

    // TX frame log entry
    struct TxFrameLog {
        uint64_t timestamp_ms;
        uint16_t msg_id;
        uint8_t seq_num;
        uint8_t total_frags;
        uint8_t payload_type;
        uint16_t payload_len;
        uint64_t samples_sent;
    };

    /**
     * Constructor
     *
     * @param radio: pointer to RadioController instance (must remain valid)
     * @param port: TCP port to bind (default 40134)
     */
    WsServer(RadioController* radio, uint16_t port = 40134);

    /**
     * Destructor
     */
    ~WsServer();

    /**
     * Start WebSocket server
     *
     * Binds to port, creates listener thread. Non-blocking.
     *
     * @return true if server started successfully
     */
    bool start();

    /**
     * Stop WebSocket server
     *
     * Closes all client connections, stops listener thread.
     */
    void stop();

    /**
     * Check if server is running
     *
     * @return true if listener thread is active
     */
    bool is_running() const;

    /**
     * Publish waterfall FFT frame
     *
     * Called periodically from radio_controller RX thread (50 ms interval).
     * Taps raw I/Q stream, computes FFT using liquid-dsp.
     *
     * @param iq_buffer: array of complex I/Q samples (2048 samples)
     * @param sample_rate_hz: sample rate for FFT
     * @param center_freq_mhz: RF center frequency
     * @param bandwidth_mhz: bandwidth
     */
    void publish_waterfall(
        const std::complex<float>* iq_buffer,
        float sample_rate_hz,
        float center_freq_mhz,
        float bandwidth_mhz
    );

    /**
     * Publish IQ constellation data
     *
     * Called periodically from radio_controller for visualizing modulation.
     * Samples every 4th point to keep data volume manageable.
     *
     * @param iq_buffer: complex IQ samples
     * @param iq_count: number of IQ samples
     */
    void publish_constellation(const std::complex<float>* iq_buffer, size_t iq_count);

    /**
     * Publish signal metrics frame
     *
     * Called periodically from radio_controller (200 ms interval).
     *
     * @param metrics: MetricsFrame with current signal state
     */
    void publish_metrics(const MetricsFrame& metrics);

    /**
     * Log RX frame event
     *
     * Called by radio_controller after successful SSP frame RX.
     *
     * @param frame_header: SSP frame header
     * @param rssi_db: measured RSSI at reception
     * @param snr_db: measured SNR at reception
     */
    void on_rx_frame(const SSPFrame& frame_header, float rssi_db, float snr_db);

    /**
     * Log TX frame event
     *
     * Called by radio_controller after TX started.
     *
     * @param frame_header: SSP frame header
     * @param samples_sent: number of I/Q samples transmitted
     */
    void on_tx_frame(const SSPFrame& frame_header, uint64_t samples_sent);

    /**
     * Get latest FFT buffer for external use
     *
     * Thread-safe snapshot of most recent waterfall frame.
     *
     * @param[out] frame: populated with latest data
     * @return true if valid frame available
     */
    bool get_fft_buffer(WaterfallFrame& frame) const;

    /**
     * Get latest metrics for external use
     *
     * Thread-safe snapshot of most recent metrics frame.
     *
     * @param[out] frame: populated with latest data
     * @return true if valid frame available
     */
    bool get_metrics(MetricsFrame& frame) const;

private:
    // Configuration
    RadioController* radio_;
    uint16_t port_;
    std::atomic<bool> running_;

    // Server socket
    int listen_socket_;

    // Listener and worker thread management
    std::unique_ptr<std::thread> listener_thread_;
    std::vector<std::unique_ptr<std::thread>> worker_threads_;

    // Client connection structure
    struct ClientConnection {
        int socket_fd;
        std::atomic<bool> connected;
        std::atomic<uint64_t> last_write_time_ms;  // For stall detection
        std::queue<std::string> send_queue;  // JSON frames to send
        std::mutex queue_mutex;
        uint32_t waterfall_drops;  // Count of dropped waterfall frames due to backpressure
    };

    std::vector<std::shared_ptr<ClientConnection>> clients_;
    mutable std::mutex clients_mutex_;

    // Ring buffer for late subscribers (1 second of waterfall frames at 20 Hz = 20 frames)
    static constexpr size_t WATERFALL_BUFFER_SIZE = 20;
    std::array<WaterfallFrame, WATERFALL_BUFFER_SIZE> waterfall_buffer_;
    size_t waterfall_buffer_index_;
    mutable std::mutex waterfall_buffer_mutex_;

    // Latest metrics snapshot
    MetricsFrame latest_metrics_;
    mutable std::mutex metrics_mutex_;

    // FFT computation state
    fftplan fft_plan_;
    std::complex<float> fft_input_[2048];
    std::complex<float> fft_output_[2048];
    float hann_window_[2048];  // Hann window for spectral leakage reduction
    mutable std::mutex fft_mutex_;

    // Timestamp for tracking frame publication rates
    std::chrono::steady_clock::time_point last_waterfall_time_;
    std::chrono::steady_clock::time_point last_metrics_time_;
    std::chrono::steady_clock::time_point last_constellation_time_;

    // Server control
    void listener_thread_main_();
    void worker_thread_main_(std::shared_ptr<ClientConnection> client);

    // Client management
    void add_client_(int socket_fd);
    void remove_client_(std::shared_ptr<ClientConnection> client);
    void broadcast_message_(const std::string& json_msg, bool is_waterfall = false);
    void send_to_client_(std::shared_ptr<ClientConnection> client, const std::string& json_msg);

    // WebSocket frame handling
    bool accept_websocket_connection_(int socket_fd);
    bool read_websocket_frame_(int socket_fd, std::string& payload);
    bool send_websocket_frame_(int socket_fd, const std::string& payload, bool is_binary = false);

    // FFT computation
    void compute_waterfall_(
        const std::complex<float>* iq_buffer,
        WaterfallFrame& frame
    );

    // JSON serialization
    std::string waterfall_to_json_(const WaterfallFrame& frame) const;
    std::string metrics_to_json_(const MetricsFrame& frame) const;
    std::string rx_frame_to_json_(const RxFrameLog& frame) const;
    std::string tx_frame_to_json_(const TxFrameLog& frame) const;

    // Hann window initialization
    void init_hann_window_();

    // Helper: get current timestamp in milliseconds
    static uint64_t get_timestamp_ms_();

    // Helper: apply backpressure handling
    void handle_backpressure_(std::shared_ptr<ClientConnection> client);

    // Helper: detect and drop stalled clients
    void check_stalled_clients_();
};
