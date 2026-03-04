#ifndef RADIO_CONTROLLER_H
#define RADIO_CONTROLLER_H

#include <string>
#include <thread>
#include <mutex>
#include <atomic>
#include <queue>
#include <cstdint>
#include <complex>
#include <array>
#include <memory>
#include <condition_variable>
#include <netinet/in.h>  // for sockaddr_in

// Forward declarations of dependencies
class BeaconLock;
class RxDspPsk;
class TxDspPsk;
class HwPlutoSDR;
class SSPCodec;
class SSPFEC;

// Enums and data structures
enum class BeaconMode {
    MODE_AUTO,
    MODE_CW_ONLY,
    MODE_BPSK_ONLY,
    MODE_OFF
};

enum class BeaconLockState {
    UNLOCKED,
    COARSE_LOCK,
    FINE_LOCK
};

struct RadioStats {
    float rx_rssi_db;
    float rx_snr_db;
    float rx_evm_db;
    uint32_t rx_frame_count;
    uint32_t rx_error_count;
    BeaconLockState beacon_lock_state;
    float beacon_lock_phase_error_deg;
    float beacon_lock_freq_error_hz;
    size_t tx_queue_depth;
    uint32_t beacon_lock_age_ms;
};

class RadioController {
public:
    // Constructor with default parameters
    RadioController(const std::string& pluto_uri = "ip:192.168.1.200",
                    float center_freq_mhz = 10489.55,
                    float sample_rate_hz = 2e6);

    // Destructor
    ~RadioController();

    // Lifecycle management
    bool start();
    void stop();
    bool is_running() const;

    // Configuration methods
    void set_beacon_mode(BeaconMode mode);
    void set_modem_scheme(int scheme);  // liquid_modem_scheme
    void set_center_freq(float freq_mhz);
    void set_rx_gain(float gain_db);
    void set_tx_gain(float gain_db);
    void set_lnb_offset(float lnb_offset_mhz);
    void set_rit_offset(int32_t hz);
    void set_xit_offset(int32_t hz);
    int32_t get_rit_offset() const { return rit_offset_hz_.load(); }
    int32_t get_xit_offset() const { return xit_offset_hz_.load(); }
    void ptt_set(bool on);

    // SDR Connection (manual connect flow)
    bool sdr_connected() const;  // Returns true if SDR is initialized and running
    bool is_sdr_hw_connected() const;  // Returns atomic sdr_connected_ flag (more reliable for UI status)

    // RX Statistics
    float get_rx_rssi() const;
    float get_rx_snr() const;
    float get_rx_evm() const;
    uint32_t get_rx_frame_count() const;
    uint32_t get_rx_error_count() const;
    BeaconLockState get_beacon_lock_state() const;
    float get_beacon_lock_phase_error() const;
    float get_beacon_lock_freq_error() const;
    uint32_t get_beacon_lock_age_ms() const;

    // SDR Hardware Info (requires SDR to be connected)
    struct SdrInfo {
        bool connected = false;
        std::string hw_model;
        std::string fw_version;
        std::string serial;
    };
    SdrInfo get_sdr_info() const;

    // TX Queue management
    size_t get_tx_queue_depth() const;

    // Statistics snapshot
    RadioStats get_stats() const;

    // Configuration getters
    float get_center_freq_mhz() const;
    float get_tx_freq_hz() const;

    // Logging
    void set_log_level(int level);  // 0=errors, 1=info, 2=debug

    // WebSocket server integration (for waterfall telemetry)
    void set_ws_server(class WsServer* ws_server);

private:
    // Hardware and DSP components
    std::unique_ptr<HwPlutoSDR> hw_plutosdr_;
    std::unique_ptr<BeaconLock> beacon_lock_;
    std::unique_ptr<RxDspPsk> rx_dsp_psk_;
    std::unique_ptr<TxDspPsk> tx_dsp_psk_;
    std::unique_ptr<SSPCodec> ssp_codec_;
    std::unique_ptr<SSPFEC> ssp_fec_;

    // WebSocket server (raw pointer, owned by main.cpp)
    class WsServer* ws_server_ = nullptr;

    // Thread management
    std::thread iio_worker_thread_;        // Single IIO buffer manager (owns RX/TX buffers exclusively)
    std::thread udp_listener_thread_;
    std::thread udp_cmd_listener_thread_;  // Control commands on port 40135
    std::thread waterfall_thread_;         // Separate waterfall FFT/publish thread
    std::atomic<bool> running_{false};
    std::atomic<bool> stop_requested_{false};
    std::atomic<bool> sdr_connected_{false};   // release/acquire barrier for hw_plutosdr_
    std::atomic<bool> iio_stop_requested_{false};  // Signal IIO worker to exit
    std::atomic<uint64_t> sdr_connect_time_ms_{0};  // Timestamp when SDR was connected (for stabilization delay)
    std::atomic<bool> sdr_probe_pending_{false};  // Flag: IIO worker should send probe response on first successful read

    // Waterfall FIFO — raw IIO bytes (matches reference pattern)
    std::vector<uint8_t> waterfall_fifo_;
    std::mutex waterfall_fifo_mutex_;
    std::condition_variable waterfall_fifo_cv_;
    size_t waterfall_pending_chunks_{0};
    static constexpr size_t WATERFALL_FIFO_MAX = 4;

    // Synchronization
    mutable std::mutex stats_mutex_;
    mutable std::recursive_mutex config_mutex_;
    mutable std::mutex tx_queue_mutex_;
    std::condition_variable tx_queue_cv_;

    // Configuration state
    std::string pluto_uri_;
    BeaconMode beacon_mode_;
    int modem_scheme_;
    float center_freq_mhz_;
    float sample_rate_hz_;
    float rx_gain_db_;
    float tx_gain_db_;
    std::atomic<bool> ptt_on_{false};
    int log_level_;
    float lnb_offset_mhz_{9750.0f};  // LNB offset (MHz)
    int xo_correction_ppb_{0};        // XO correction (PPB)

    // Reconfiguration flags (atomic to signal DSP to reinitialize)
    std::atomic<bool> modem_scheme_changed_{false};   // M2: Modem change requires DSP reset
    std::atomic<bool> lnb_offset_changed_{false};     // M3: LNB offset change requires frequency retune

    // RX statistics
    std::atomic<float> rx_rssi_db_{-120.0f};
    std::atomic<float> rx_snr_db_{-20.0f};
    std::atomic<float> rx_evm_db_{-30.0f};
    std::atomic<uint32_t> rx_frame_count_{0};
    std::atomic<uint32_t> rx_error_count_{0};
    std::atomic<uint32_t> beacon_lock_age_ms_{0};

    // Extended metrics for WebSocket telemetry
    std::atomic<int64_t> rx_freq_hz_{10489550000};  // RX LO frequency in Hz
    std::atomic<int64_t> tx_freq_hz_{10489550000};  // TX LO frequency in Hz
    std::atomic<int32_t> rit_offset_hz_{0};         // RX offset (RIT)
    std::atomic<int32_t> xit_offset_hz_{0};         // TX offset (XIT)
    std::atomic<float> tx_vu_level_{0.0f};          // TX VU meter (0-1)
    std::atomic<float> rx_vu_level_{0.0f};          // RX VU meter (0-1)
    std::atomic<float> pb_fifo_fill_{0.0f};         // Playback FIFO fill percent (0-1)
    std::atomic<float> cap_fifo_fill_{0.0f};        // Capture FIFO fill percent (0-1)
    std::atomic<float> ber_current_{0.0f};          // Current BER (0-1)
    std::atomic<bool> signal_detected_{false};      // Signal detection flag
    std::atomic<bool> frame_sync_{false};           // Frame sync flag
    std::atomic<int32_t> test_tone_hz_{0};          // Test tone frequency (0=off)
    std::atomic<bool> rf_loopback_{false};          // RF loopback enabled

    // TX queue (FIFO for SSP frames from Python core)
    std::queue<std::vector<uint8_t>> tx_queue_;

    // Network configuration
    std::string udp_listen_addr_;
    uint16_t udp_listen_port_tx_;   // Port to receive TX frames from Python core
    uint16_t udp_send_port_rx_;     // Port to send RX frames to Python core
    uint16_t udp_cmd_listen_port_;  // Port to receive control commands (40135)
    uint16_t udp_response_port_{40136};  // Port to send connect/disconnect responses to Python

    // Response address caching (resolved once, reused to avoid per-message DNS)
    struct sockaddr_in response_addr_{};
    bool response_addr_resolved_{false};

    // RX buffer state
    std::vector<uint8_t> rx_bit_buffer_;
    size_t rx_bit_count_;

    // Thread worker functions
    void iio_worker_();  // Single thread managing IIO RX/TX buffers (replaces rx_thread/tx_thread)
    void waterfall_worker_();  // Separate thread for waterfall FFT + publish
    void udp_listener_worker_();
    void udp_cmd_listener_worker_();  // Control command listener on port 40135

    // SDR connection helper functions
    bool connect_sdr_(const std::string& uri, float lnb_offset_mhz, float bandwidth_hz);
    void disconnect_sdr_();
    void send_udp_response_(const std::string& json);  // Send response to Python on port 40136

    // Helper functions
    void log_(int level, const std::string& msg) const;
    void update_beacon_lock_state_();
    bool process_rx_sample_(std::complex<float> sample);
    void process_rx_frame_();
    void send_rx_frame_to_python_(const std::vector<uint8_t>& frame);
};

#endif // RADIO_CONTROLLER_H
