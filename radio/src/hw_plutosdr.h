#pragma once

#include <cstdint>
#include <cstring>
#include <cstdio>
#include <complex>
#include <vector>
#include <memory>
#include <mutex>
#include <condition_variable>

// Forward declarations for libiio + libad9361 opaque types
struct iio_context;
struct iio_device;
struct iio_channel;
struct iio_buffer;

/**
 * HwPlutoSDR — Hardware Abstraction Layer for ADALM-PLUTO (AD9361)
 *
 * Provides unified RX/TX interface for the PlutoSDR transceiver. Encapsulates
 * libiio + libad9361 details behind a clean C++ API.
 *
 * Design Notes:
 * - Single logical device wraps PHY (control) + DATA (streaming) iio_device's
 * - Ring buffers (65K samples) for RX and TX path
 * - Thread-safe queue interface (non-blocking RX/TX)
 * - All frequency/gain operations are atomic via PHY attributes
 * - Error logging to stderr with context
 */

class HwPlutoSDR {
public:
    /**
     * Constructor
     *
     * @param uri Network URI for PlutoSDR (default: "ip:192.168.1.200")
     * @param center_freq_mhz Initial RX/TX center frequency (MHz)
     * @param sample_rate_hz Common RX/TX sample rate (Hz)
     * @param tx_gain_db Initial TX gain (dB)
     * @param rx_gain_db Initial RX gain (dB)
     *
     * Initializes iio_context, finds ad9361-phy and cf-ad9361-lpc devices,
     * enables RX1_I/Q and TX1_I/Q channels, configures AGC, sets DC offset
     * correction and IQ imbalance correction.
     */
    HwPlutoSDR(const char* uri = "ip:192.168.1.200",
               float center_freq_mhz = 10489.55,
               float sample_rate_hz = 2e6,
               float tx_gain_db = 10,
               float rx_gain_db = 60,
               float lnb_offset_mhz = 9750.0f);

    /**
     * Destructor
     * Releases iio_context, deallocates buffers, stops hardware.
     */
    ~HwPlutoSDR();

    // ========================================================================
    // RX Chain
    // ========================================================================

    /**
     * Initialize RX path
     *
     * Creates RX buffer (65536 samples, non-blocking mode).
     * Enables RX1_I and RX1_Q channels.
     * Returns false on buffer allocation failure.
     */
    bool rx_start();

    /**
     * Read RX samples (non-blocking)
     *
     * @param buffer Output buffer for complex<float> samples
     * @param samples_read Number of samples actually read (0 if no data available)
     * @return true if no error, false on underlying iio error
     *
     * Calls iio_buffer_refill() to pull from hardware.
     * Extracts I/Q from RX1_I and RX1_Q channels as int16_t,
     * converts to complex<float> normalized by 32768.
     * Automatically refills buffer when depleted.
     */
    bool rx_get_buffer(std::complex<float>* buffer, size_t& samples_read);

    /**
     * Get RX signal strength (dB)
     *
     * Reads "in_voltage0_hardwaregain" PHY attribute.
     * Returns -1.0 on error.
     */
    float get_rx_rssi();

    /**
     * Refill raw RX buffer (for separate waterfall thread)
     *
     * @param out Output buffer for raw IIO bytes
     * @param max_bytes Maximum bytes to copy
     * @return Number of bytes refilled, <= 0 on error
     *
     * Blocking call to iio_buffer_refill(), returns raw int16 IIO bytes
     * without conversion. Used by waterfall thread for processing.
     */
    ssize_t rx_refill_raw(uint8_t* out, size_t max_bytes);

    /**
     * Stop RX path
     *
     * Disables RX1_I and RX1_Q channels, releases buffer.
     */
    bool rx_stop();

    // ========================================================================
    // TX Chain
    // ========================================================================

    /**
     * Initialize TX path
     *
     * Creates TX buffer (65536 samples, write mode).
     * Enables TX1_I and TX1_Q channels.
     * Returns false on buffer allocation failure.
     */
    bool tx_start();

    /**
     * Queue TX samples (non-blocking)
     *
     * @param buffer Input buffer of complex<float> samples
     * @param samples_to_write Number of samples to transmit
     * @return true if successful, false on buffer full or iio error
     *
     * Converts complex<float> to int16_t I/Q (multiply by 32000 for headroom),
     * clips to ±32767, pushes via iio_buffer_push().
     * Returns false if TX buffer is full (caller should retry or drop samples).
     */
    bool tx_put_buffer(const std::complex<float>* buffer, size_t samples_to_write);

    /**
     * Check TX queue depth (non-blocking)
     *
     * Approximate number of samples pending in TX FIFO.
     * Used by TX scheduler to avoid overrun.
     */
    size_t tx_samples_pending() const;

    /**
     * Stop TX path
     *
     * Disables TX1_I and TX1_Q channels, releases buffer.
     */
    bool tx_stop();

    /**
     * Start IIO streaming (buffer creation)
     *
     * Creates RX and TX buffers after all channels are enabled.
     * Must be called AFTER rx_start() and tx_start() succeed.
     * Returns false if buffer allocation fails.
     */
    bool start_streaming();

    // ========================================================================
    // Configuration (Tuning & Gains)
    // ========================================================================

    /**
     * Set RX/TX center frequency
     *
     * @param freq_mhz Frequency in MHz
     * @return false if out of range (70 MHz–6 GHz)
     *
     * Writes to:
     *  - "out_altvoltage0_RX_LO_frequency" (RX)
     *  - "out_altvoltage1_TX_LO_frequency" (TX)
     */
    bool set_center_freq(float freq_mhz);

    /**
     * Set RX gain (LNA)
     *
     * @param gain_db Gain in dB (typical range: 0–76 dB)
     * @return false if out of range
     *
     * Writes to: "in_voltage0_hardwaregain" (RX1)
     * Automatically disables AGC when manual gain is set.
     */
    bool set_rx_gain(float gain_db);

    /**
     * Set TX gain (DAC attenuation)
     *
     * @param gain_db Gain in dB (typical range: 0–89 dB)
     * @return false if out of range
     *
     * Writes to: "out_voltage0_hardwaregain" (TX1)
     */
    bool set_tx_gain(float gain_db);

    /**
     * Set common RX/TX sample rate
     *
     * @param rate_hz Sample rate in Hz
     * @return false if out of range or hardware error
     *
     * Writes to:
     *  - "in_voltage_sampling_frequency" (RX)
     *  - "out_voltage_sampling_frequency" (TX)
     */
    bool set_sample_rate(float rate_hz);

    /**
     * Set LNB (Local Oscillator) downconverter offset
     *
     * @param lnb_offset_mhz LNB LO frequency in MHz (e.g., 9750 for typical C-band)
     *
     * The actual frequency tuned on PlutoSDR will be: requested_rf_freq - lnb_offset_mhz
     * This allows receiving at satellite frequencies >6 GHz via downconversion.
     * Example: RF 10489.55 MHz with LNB 9750 MHz = PlutoSDR tunes to 739.55 MHz
     *
     * Calls set_center_freq() after updating offset to re-apply frequency tuning math.
     */
    void set_lnb_offset(float lnb_offset_mhz) {
        lnb_offset_mhz_ = lnb_offset_mhz;
        // Re-tune center frequency to apply new LNB offset
        if (center_freq_mhz_ > 0) {
            set_center_freq(center_freq_mhz_);
        }
    }

    /**
     * Get current LNB offset (MHz)
     */
    float get_lnb_offset_mhz() const { return lnb_offset_mhz_; }

    // ========================================================================
    // Status & Getters
    // ========================================================================

    /**
     * Get current RX/TX center frequency (MHz)
     * Returns 0.0 if not configured.
     */
    float get_center_freq_mhz() const { return center_freq_mhz_; }

    /**
     * Get current sample rate (Hz)
     * Returns 0.0 if not configured.
     */
    float get_sample_rate_hz() const { return sample_rate_hz_; }

    /**
     * Get current RX gain (dB)
     * Returns -1.0 on error.
     */
    float get_rx_gain() const { return rx_gain_db_; }

    /**
     * Get current TX gain (dB)
     * Returns -1.0 on error.
     */
    float get_tx_gain() const { return tx_gain_db_; }

    /**
     * Check overall hardware state
     *
     * @return true if context is valid and hardware is initialized
     */
    bool is_running() const { return ctx_ != nullptr; }

    /**
     * Get detailed error message from last failed operation
     * Clears after read.
     */
    std::string get_last_error();

    // SDR hardware info snapshot
    struct SdrInfo {
        bool connected = false;
        std::string hw_model;     // from iio_context "hw_model" attr
        std::string fw_version;   // from iio_context "fw_version" attr
        std::string serial;       // from iio_context "serial" attr
    };

    SdrInfo get_sdr_info() const;

private:
    // iio context and devices
    iio_context* ctx_;
    iio_device* phy_device_;       // ad9361-phy (control)
    iio_device* data_device_;      // cf-ad9361-lpc (streaming)
    iio_device* tx_data_device_;   // cf-ad9361-dds-core-lpc (TX DDS control)

    // RX path
    iio_channel* rx_i_channel_;
    iio_channel* rx_q_channel_;
    iio_buffer* rx_buffer_;
    std::vector<uint8_t> rx_buffer_data_;  // Local copy of buffer data

    // TX path
    iio_channel* tx_i_channel_;
    iio_channel* tx_q_channel_;
    iio_buffer* tx_buffer_;
    std::vector<uint8_t> tx_buffer_data_;  // Local copy of buffer data

    // PHY channel handles for attribute access
    iio_channel* phy_rx_channel_;   // voltage0 from ad9361-phy (RX)
    iio_channel* phy_tx_channel_;   // voltage0 from ad9361-phy (TX)
    iio_channel* phy_rx_lo_channel_;   // altvoltage0 from ad9361-phy (RX LO)
    iio_channel* phy_tx_lo_channel_;   // altvoltage1 from ad9361-phy (TX LO)

    // Configuration cache (for getters)
    float center_freq_mhz_;
    float sample_rate_hz_;
    float rx_gain_db_;
    float tx_gain_db_;
    float lnb_offset_mhz_;      // LNB downconverter offset (MHz) — subtracted from RF freq before setting PlutoSDR LO

    // Error tracking
    mutable std::mutex error_mutex_;
    std::string last_error_;

    // Hardware constants (AD9361 specs)
    static constexpr float FREQ_MIN_MHZ = 70.0f;
    static constexpr float FREQ_MAX_MHZ = 6000.0f;
    static constexpr float RX_GAIN_MIN_DB = -1.0f;
    static constexpr float RX_GAIN_MAX_DB = 73.0f;
    static constexpr float TX_GAIN_MIN_DB = 0.0f;
    static constexpr float TX_GAIN_MAX_DB = 89.75f;
    static constexpr float SAMPLE_RATE_MIN_HZ = 520.83e3f;   // 1/48 MHz
    static constexpr float SAMPLE_RATE_MAX_HZ = 30.72e6f;    // Standard IIO limit

    // Ring buffer size (samples)
    static constexpr size_t RX_BUFFER_SAMPLES = 65536;
    static constexpr size_t TX_BUFFER_SAMPLES = 65536;

    // Channel capacity (bytes per sample: 2 channels × 2 bytes/channel = 4 bytes)
    static constexpr size_t RX_BUFFER_BYTES = RX_BUFFER_SAMPLES * sizeof(int16_t) * 2;
    static constexpr size_t TX_BUFFER_BYTES = TX_BUFFER_SAMPLES * sizeof(int16_t) * 2;

    // I/Q normalization constants
    static constexpr float RX_I16_SCALE = 1.0f / 32768.0f;
    static constexpr float TX_I16_SCALE = 32000.0f;           // Headroom for clipping

    // Helper methods
    bool create_context_(const char* uri);
    bool find_devices_();
    bool enable_rx_channels_();
    bool enable_tx_channels_();
    bool configure_phy_();
    void log_error_(const char* context);
    void set_error_(const std::string& msg);

    // Attribute read/write wrappers (device level)
    bool write_phy_attr_(const char* attr, long long value);
    bool write_phy_attr_str_(const char* attr, const char* value);
    bool read_phy_attr_(const char* attr, long long& value);
    bool read_phy_attr_float_(const char* attr, float& value);

    // Channel-level attribute wrappers
    bool write_channel_attr_(iio_channel* chan, const char* attr, long long value);
    bool write_channel_attr_str_(iio_channel* chan, const char* attr, const char* value);
    bool write_channel_attr_double_(iio_channel* chan, const char* attr, double value);
    bool read_channel_attr_(iio_channel* chan, const char* attr, long long& value);
    bool read_channel_attr_double_(iio_channel* chan, const char* attr, double& value);

    // I/Q conversion helpers
    static inline std::complex<float> i16_to_complex(int16_t i, int16_t q);
    static inline void complex_to_i16(std::complex<float> sample, int16_t& i, int16_t& q);
};
