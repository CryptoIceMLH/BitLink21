#include "hw_plutosdr.h"
#include <iio.h>
#include <ad9361.h>
#include <cmath>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cstring>

// ============================================================================
// Constructor
// ============================================================================

HwPlutoSDR::HwPlutoSDR(const char* uri, float center_freq_mhz, float sample_rate_hz,
                       float tx_gain_db, float rx_gain_db, float lnb_offset_mhz)
    : ctx_(nullptr),
      phy_device_(nullptr),
      data_device_(nullptr),
      tx_data_device_(nullptr),
      rx_i_channel_(nullptr),
      rx_q_channel_(nullptr),
      rx_buffer_(nullptr),
      tx_i_channel_(nullptr),
      tx_q_channel_(nullptr),
      tx_buffer_(nullptr),
      phy_rx_channel_(nullptr),
      phy_tx_channel_(nullptr),
      phy_rx_lo_channel_(nullptr),
      phy_tx_lo_channel_(nullptr),
      center_freq_mhz_(0.0f),
      sample_rate_hz_(0.0f),
      rx_gain_db_(-1.0f),
      tx_gain_db_(-1.0f),
      lnb_offset_mhz_(lnb_offset_mhz) {

    fprintf(stderr, "[HwPlutoSDR] Initializing PlutoSDR on URI: %s\n", uri);
    fprintf(stderr, "[HwPlutoSDR] Config: Freq=%.2f MHz, SR=%.2e Hz, TX Gain=%.2f dB, RX Gain=%.2f dB\n",
            center_freq_mhz, sample_rate_hz, tx_gain_db, rx_gain_db);

    // Create iio context
    if (!create_context_(uri)) {
        set_error_("Failed to create IIO context");
        return;
    }

    // Find ad9361-phy and cf-ad9361-lpc devices
    if (!find_devices_()) {
        set_error_("Failed to find AD9361 devices");
        if (ctx_) {
            iio_context_destroy(ctx_);
            ctx_ = nullptr;
        }
        return;
    }

    // Configure PHY (LOs, gains, etc.)
    if (!configure_phy_()) {
        set_error_("Failed to configure AD9361 PHY");
        if (ctx_) {
            iio_context_destroy(ctx_);
            ctx_ = nullptr;
        }
        return;
    }

    // Set initial configuration
    if (!set_center_freq(center_freq_mhz)) {
        set_error_("Failed to set center frequency");
        if (ctx_) {
            iio_context_destroy(ctx_);
            ctx_ = nullptr;
        }
        return;
    }

    if (!set_sample_rate(sample_rate_hz)) {
        set_error_("Failed to set sample rate");
        if (ctx_) {
            iio_context_destroy(ctx_);
            ctx_ = nullptr;
        }
        return;
    }

    if (!set_rx_gain(rx_gain_db)) {
        set_error_("Failed to set RX gain");
        if (ctx_) {
            iio_context_destroy(ctx_);
            ctx_ = nullptr;
        }
        return;
    }

    if (!set_tx_gain(tx_gain_db)) {
        set_error_("Failed to set TX gain");
        if (ctx_) { iio_context_destroy(ctx_); ctx_ = nullptr; }
        return;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ Initialization complete\n");
}

// ============================================================================
// Destructor
// ============================================================================

HwPlutoSDR::~HwPlutoSDR() {
    fprintf(stderr, "[HwPlutoSDR] Shutting down\n");

    rx_stop();
    tx_stop();

    if (ctx_) {
        iio_context_destroy(ctx_);
        ctx_ = nullptr;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ Shutdown complete\n");
}

// ============================================================================
// RX Chain Implementation
// ============================================================================

bool HwPlutoSDR::rx_start() {
    fprintf(stderr, "[HW] DEBUG: rx_start() called\n");

    if (!ctx_ || !data_device_) {
        fprintf(stderr, "[HW] DEBUG: rx_start() - ctx_=0x%p, data_device_=0x%p\n",
                (void*)ctx_, (void*)data_device_);
        set_error_("rx_start: hardware not initialized");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] Starting RX\n");
    fprintf(stderr, "[HW] DEBUG: Calling enable_rx_channels_()\n");

    // Enable RX channels ONLY — NO buffer creation here
    // Buffers are created later by start_streaming() after all channels are enabled
    if (!enable_rx_channels_()) {
        fprintf(stderr, "[HW] DEBUG: enable_rx_channels_() FAILED\n");
        set_error_("rx_start: failed to enable RX channels");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ RX started\n");
    fprintf(stderr, "[HW] DEBUG: rx_start() SUCCESSFUL\n");
    return true;
}

bool HwPlutoSDR::rx_get_buffer(std::complex<float>* buffer, size_t& samples_read) {
    // Check preconditions
    if (!rx_buffer_ || !rx_i_channel_ || !rx_q_channel_) {
        set_error_("rx_get_buffer: RX buffer or channels not initialized");
        samples_read = 0;
        return false;
    }

    if (!buffer) {
        set_error_("rx_get_buffer: null output buffer");
        samples_read = 0;
        return false;
    }

    // Blocking refill — matches working reference code exactly
    ssize_t nbytes = iio_buffer_refill(rx_buffer_);
    fprintf(stderr, "[HW] CRITICAL: iio_buffer_refill returned %zd bytes\n", nbytes);
    if (nbytes < 0) {
        set_error_("rx_get_buffer: iio_buffer_refill failed");
        fprintf(stderr, "[HW] CRITICAL: iio_buffer_refill FAILED with error %zd\n", nbytes);
        samples_read = 0;
        return false;
    }

    if (nbytes == 0) {
        fprintf(stderr, "[HW] WARNING: iio_buffer_refill returned 0 bytes (no data available yet)\n");
        samples_read = 0;
        return true;  // Return true but with 0 samples
    }

    // Get pointer to first I sample using iio_buffer_first() - EXACT reference pattern
    uint8_t* p_buf = (uint8_t*)iio_buffer_first(rx_buffer_, rx_i_channel_);
    if (!p_buf) {
        set_error_("rx_get_buffer: iio_buffer_first failed");
        samples_read = 0;
        return false;
    }

    // Get the step size between consecutive I samples
    ptrdiff_t step = iio_buffer_step(rx_buffer_);
    size_t sample_size = iio_device_get_sample_size(data_device_);

    // Total samples = nbytes / sample_size (4 bytes per I/Q pair)
    size_t num_samples = (size_t)nbytes / sample_size;
    num_samples = std::min(num_samples, (size_t)65536);  // Must not exceed radio_controller RX_BUFFER_SIZE

    fprintf(stderr, "[HW] CRITICAL: p_buf=%p, step=%td, sample_size=%zu, num_samples=%zu\n",
            p_buf, step, sample_size, num_samples);

    // Extract I/Q samples using proper step-based iteration
    // Q channel is at +2 bytes from I channel (both int16_t)
    for (size_t i = 0; i < num_samples; i++) {
        int16_t iv = *(int16_t*)(p_buf + i * step);           // I sample
        int16_t qv = *(int16_t*)(p_buf + i * step + 2);       // Q sample (2 bytes after I)
        buffer[i] = i16_to_complex(iv, qv);
    }

    samples_read = num_samples;

    if (samples_read > 0) {
        fprintf(stderr, "[HW] SUCCESS: rx_get_buffer() extracted %zu samples\n", samples_read);
    }

    return true;
}

float HwPlutoSDR::get_rx_rssi() {
    if (!ctx_ || !phy_rx_channel_) {
        return -1.0f;
    }

    double rssi = 0.0;
    if (!read_channel_attr_double_(phy_rx_channel_, "rssi", rssi)) {
        return -1.0f;
    }
    return (float)rssi;
}

ssize_t HwPlutoSDR::rx_refill_raw(uint8_t* out, size_t max_bytes) {
    if (!rx_buffer_ || !rx_i_channel_) return -1;
    ssize_t nbytes = iio_buffer_refill(rx_buffer_);
    if (nbytes <= 0) return nbytes;
    uint8_t* p = (uint8_t*)iio_buffer_first(rx_buffer_, rx_i_channel_);
    if (!p) return -1;
    size_t copy_bytes = std::min((size_t)nbytes, max_bytes);
    memcpy(out, p, copy_bytes);
    return (ssize_t)copy_bytes;
}

bool HwPlutoSDR::rx_stop() {
    fprintf(stderr, "[HwPlutoSDR] Stopping RX\n");

    if (rx_buffer_) {
        iio_buffer_destroy(rx_buffer_);
        rx_buffer_ = nullptr;
    }

    // Disable RX channels
    if (rx_i_channel_) {
        iio_channel_disable(rx_i_channel_);
        rx_i_channel_ = nullptr;
    }
    if (rx_q_channel_) {
        iio_channel_disable(rx_q_channel_);
        rx_q_channel_ = nullptr;
    }

    rx_buffer_data_.clear();
    fprintf(stderr, "[HwPlutoSDR] ✓ RX stopped\n");
    return true;
}

bool HwPlutoSDR::start_streaming() {
    fprintf(stderr, "[HW] DEBUG: start_streaming() called - creating RX+TX buffers\n");

    if (!data_device_) {
        fprintf(stderr, "[HW] ERROR: data_device not initialized\n");
        set_error_("start_streaming: data_device not initialized");
        return false;
    }

    // Calculate buffer size: sample_rate / 10 (like QO100 reference)
    size_t buf_size = std::max((size_t)(sample_rate_hz_ / 10.0f), (size_t)4096);
    fprintf(stderr, "[HW] DEBUG: Creating buffers with size=%zu samples\n", buf_size);

    // Create RX buffer
    rx_buffer_ = iio_device_create_buffer(data_device_, buf_size, false);
    if (!rx_buffer_) {
        fprintf(stderr, "[HW] ERROR: iio_device_create_buffer(RX) failed\n");
        set_error_("start_streaming: RX buffer creation failed");
        return false;
    }
    fprintf(stderr, "[HW] DEBUG: RX buffer created: %p\n", (void*)rx_buffer_);

    // Create TX buffer on tx_data_device_ (cf-ad9361-dds-core-lpc) — reference code uses this device for TX
    // RX uses data_device_, TX uses tx_data_device_
    tx_buffer_ = iio_device_create_buffer(tx_data_device_, buf_size, false);
    if (!tx_buffer_) {
        fprintf(stderr, "[HW] ERROR: iio_device_create_buffer(TX) failed\n");
        iio_buffer_destroy(rx_buffer_);
        rx_buffer_ = nullptr;
        set_error_("start_streaming: TX buffer creation failed");
        return false;
    }
    fprintf(stderr, "[HW] DEBUG: TX buffer created: %p\n", (void*)tx_buffer_);

    fprintf(stderr, "[HW] Streaming started: buf_size=%zu, rx_buf=%p, tx_buf=%p\n",
            buf_size, (void*)rx_buffer_, (void*)tx_buffer_);
    return true;
}

// ============================================================================
// TX Chain Implementation
// ============================================================================

bool HwPlutoSDR::tx_start() {
    fprintf(stderr, "[HW] DEBUG: tx_start() called\n");

    if (!ctx_ || !data_device_) {
        fprintf(stderr, "[HW] DEBUG: tx_start() - ctx_=0x%p, data_device_=0x%p\n",
                (void*)ctx_, (void*)data_device_);
        set_error_("tx_start: hardware not initialized");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] Starting TX\n");
    fprintf(stderr, "[HW] DEBUG: Searching for TX channels\n");

    // Dynamically find TX channels: search tx_data_device first, then data_device
    iio_device* tx_dev = nullptr;
    if (tx_data_device_) {
        fprintf(stderr, "[HW] DEBUG: Searching tx_data_device for TX channels\n");
        tx_i_channel_ = iio_device_find_channel(tx_data_device_, "voltage0", true);
        tx_q_channel_ = iio_device_find_channel(tx_data_device_, "voltage1", true);
        if (tx_i_channel_ && tx_q_channel_) {
            tx_dev = tx_data_device_;
            fprintf(stderr, "[HwPlutoSDR] Found TX channels on cf-ad9361-dds-core-lpc\n");
            fprintf(stderr, "[HW] DEBUG: tx_i_channel_=0x%p, tx_q_channel_=0x%p\n",
                    (void*)tx_i_channel_, (void*)tx_q_channel_);
        }
    }

    // Fallback: search data_device if not found yet
    if (!tx_dev) {
        fprintf(stderr, "[HW] DEBUG: Fallback: Searching data_device for TX channels\n");
        tx_i_channel_ = iio_device_find_channel(data_device_, "voltage0", true);
        tx_q_channel_ = iio_device_find_channel(data_device_, "voltage1", true);
        if (tx_i_channel_ && tx_q_channel_) {
            tx_dev = data_device_;
            fprintf(stderr, "[HwPlutoSDR] Found TX channels on cf-ad9361-lpc\n");
            fprintf(stderr, "[HW] DEBUG: tx_i_channel_=0x%p, tx_q_channel_=0x%p\n",
                    (void*)tx_i_channel_, (void*)tx_q_channel_);
        }
    }

    if (!tx_dev || !tx_i_channel_ || !tx_q_channel_) {
        fprintf(stderr, "[HW] DEBUG: TX channel search FAILED - tx_dev=0x%p, tx_i=0x%p, tx_q=0x%p\n",
                (void*)tx_dev, (void*)tx_i_channel_, (void*)tx_q_channel_);
        set_error_("tx_start: failed to find TX channels on any device");
        return false;
    }

    // Enable TX channels ONLY — NO buffer creation here
    // Buffers are created later by start_streaming() after all channels are enabled
    fprintf(stderr, "[HW] DEBUG: Enabling TX I/Q channels\n");
    iio_channel_enable(tx_i_channel_);
    iio_channel_enable(tx_q_channel_);
    fprintf(stderr, "[HW] DEBUG: TX channels enabled\n");

    fprintf(stderr, "[HwPlutoSDR] ✓ TX started\n");
    fprintf(stderr, "[HW] DEBUG: tx_start() SUCCESSFUL\n");
    return true;
}

bool HwPlutoSDR::tx_put_buffer(const std::complex<float>* buffer, size_t samples_to_write) {
    if (!ctx_ || !tx_buffer_) {
        set_error_("tx_put_buffer: TX not running");
        return false;
    }

    if (!buffer || samples_to_write == 0) {
        return true;  // No-op for empty buffer
    }

    fprintf(stderr, "[HW] DEBUG: tx_put_buffer() writing %zu samples\n", samples_to_write);

    // Check if we have space
    // iio_buffer_end/start return void*, need to cast to ptrdiff_t
    ptrdiff_t available_bytes = (uint8_t*)iio_buffer_end(tx_buffer_) - (uint8_t*)iio_buffer_start(tx_buffer_);
    size_t available = available_bytes > 0 ? (size_t)available_bytes : 0;
    size_t bytes_needed = samples_to_write * sizeof(int16_t) * 2;

    fprintf(stderr, "[HW] DEBUG: TX buffer - available=%zu bytes, needed=%zu bytes\n",
            available, bytes_needed);

    if (bytes_needed > available) {
        fprintf(stderr, "[HW] DEBUG: TX buffer FULL - not enough space\n");
        set_error_("tx_put_buffer: TX buffer full");
        return false;
    }

    // Write I/Q samples to TX buffer
    uint8_t* start = (uint8_t*)iio_buffer_start(tx_buffer_);
    ptrdiff_t step = iio_buffer_step(tx_buffer_);

    for (size_t i = 0; i < samples_to_write; ++i) {
        int16_t i_val, q_val;
        complex_to_i16(buffer[i], i_val, q_val);

        uint8_t* p = start + (i * step);
        *(int16_t*)(p) = i_val;
        *(int16_t*)(p + 2) = q_val;
    }

    fprintf(stderr, "[HW] DEBUG: Pushing %zu samples to hardware\n", samples_to_write);

    // Push data to hardware
    int ret = iio_buffer_push(tx_buffer_);
    if (ret < 0) {
        fprintf(stderr, "[HW] DEBUG: iio_buffer_push() FAILED with ret=%d\n", ret);
        set_error_("tx_put_buffer: iio_buffer_push failed");
        return false;
    }

    fprintf(stderr, "[HW] DEBUG: tx_put_buffer() SUCCESSFUL\n");
    return true;
}

size_t HwPlutoSDR::tx_samples_pending() const {
    if (!tx_buffer_) {
        return 0;
    }

    // Approximate pending samples in FIFO
    // iio_buffer_end/start return void*, need to cast to ptrdiff_t
    ptrdiff_t available_bytes = (uint8_t*)iio_buffer_end(tx_buffer_) - (uint8_t*)iio_buffer_start(tx_buffer_);
    return available_bytes > 0 ? (size_t)available_bytes / (sizeof(int16_t) * 2) : 0;
}

bool HwPlutoSDR::tx_stop() {
    fprintf(stderr, "[HwPlutoSDR] Stopping TX\n");

    if (tx_buffer_) {
        iio_buffer_destroy(tx_buffer_);
        tx_buffer_ = nullptr;
    }

    // Disable TX channels
    if (tx_i_channel_) {
        iio_channel_disable(tx_i_channel_);
        tx_i_channel_ = nullptr;
    }
    if (tx_q_channel_) {
        iio_channel_disable(tx_q_channel_);
        tx_q_channel_ = nullptr;
    }

    tx_buffer_data_.clear();
    fprintf(stderr, "[HwPlutoSDR] ✓ TX stopped\n");
    return true;
}

// ============================================================================
// Configuration Methods
// ============================================================================

bool HwPlutoSDR::set_center_freq(float freq_mhz) {
    fprintf(stderr, "[HW] DEBUG: set_center_freq() called with freq_mhz=%.2f\n", freq_mhz);

    // Apply LNB offset: actual_pluto_freq = rf_freq - lnb_offset
    float actual_freq_mhz = freq_mhz - lnb_offset_mhz_;
    fprintf(stderr, "[HW] DEBUG: LNB offset=%.2f MHz, actual_freq_mhz=%.2f MHz\n",
            lnb_offset_mhz_, actual_freq_mhz);

    if (actual_freq_mhz < FREQ_MIN_MHZ || actual_freq_mhz > FREQ_MAX_MHZ) {
        std::ostringstream oss;
        oss << "set_center_freq: RF frequency " << freq_mhz << " MHz with LNB offset "
            << lnb_offset_mhz_ << " MHz = " << actual_freq_mhz
            << " MHz (PlutoSDR range: " << FREQ_MIN_MHZ << "–" << FREQ_MAX_MHZ << " MHz)";
        fprintf(stderr, "[HW] DEBUG: Frequency OUT OF RANGE\n");
        set_error_(oss.str());
        return false;
    }

    // Ensure LO channels are available
    if (!phy_rx_lo_channel_ || !phy_tx_lo_channel_) {
        fprintf(stderr, "[HW] DEBUG: LO channels not initialized - phy_rx_lo=0x%p, phy_tx_lo=0x%p\n",
                (void*)phy_rx_lo_channel_, (void*)phy_tx_lo_channel_);
        set_error_("set_center_freq: LO channels not initialized");
        return false;
    }

    // Convert actual MHz to Hz
    long long freq_hz = (long long)(actual_freq_mhz * 1e6);
    fprintf(stderr, "[HW] DEBUG: Writing RX LO frequency: %lld Hz\n", freq_hz);

    // Write RX LO using channel attribute (as longlong)
    if (!write_channel_attr_(phy_rx_lo_channel_, "frequency", freq_hz)) {
        fprintf(stderr, "[HW] DEBUG: Failed to write RX LO frequency\n");
        set_error_("set_center_freq: failed to write RX LO");
        return false;
    }

    fprintf(stderr, "[HW] DEBUG: Writing TX LO frequency: %lld Hz\n", freq_hz);

    // Write TX LO using channel attribute (as longlong)
    if (!write_channel_attr_(phy_tx_lo_channel_, "frequency", freq_hz)) {
        fprintf(stderr, "[HW] DEBUG: Failed to write TX LO frequency\n");
        set_error_("set_center_freq: failed to write TX LO");
        return false;
    }

    center_freq_mhz_ = freq_mhz;
    fprintf(stderr, "[HwPlutoSDR] ✓ Center frequency set to %.2f MHz (PlutoSDR LO: %.2f MHz)\n",
            freq_mhz, actual_freq_mhz);
    fprintf(stderr, "[HW] DEBUG: set_center_freq() SUCCESSFUL\n");
    return true;
}

bool HwPlutoSDR::set_rx_gain(float gain_db) {
    fprintf(stderr, "[HW] DEBUG: set_rx_gain() called with gain_db=%.2f\n", gain_db);

    if (gain_db < RX_GAIN_MIN_DB || gain_db > RX_GAIN_MAX_DB) {
        std::ostringstream oss;
        oss << "set_rx_gain: gain " << gain_db << " dB out of range ["
            << RX_GAIN_MIN_DB << ", " << RX_GAIN_MAX_DB << "] dB";
        fprintf(stderr, "[HW] DEBUG: RX gain OUT OF RANGE\n");
        set_error_(oss.str());
        return false;
    }

    // Ensure RX channel is available
    if (!phy_rx_channel_) {
        fprintf(stderr, "[HW] DEBUG: RX channel not initialized (0x%p)\n", (void*)phy_rx_channel_);
        set_error_("set_rx_gain: RX channel not initialized");
        return false;
    }

    // Disable AGC (set to manual mode via channel attribute)
    fprintf(stderr, "[HW] DEBUG: Setting gain_control_mode to 'manual'\n");
    if (!write_channel_attr_str_(phy_rx_channel_, "gain_control_mode", "manual")) {
        fprintf(stderr, "[HW] DEBUG: Failed to set gain_control_mode\n");
        set_error_("set_rx_gain: failed to set gain control mode to manual");
        return false;
    }

    // Write RX gain (in dB, as double)
    fprintf(stderr, "[HW] DEBUG: Writing RX hardwaregain: %.2f dB\n", gain_db);
    if (!write_channel_attr_double_(phy_rx_channel_, "hardwaregain", (double)gain_db)) {
        fprintf(stderr, "[HW] DEBUG: Failed to write RX hardwaregain\n");
        set_error_("set_rx_gain: failed to write RX gain");
        return false;
    }

    rx_gain_db_ = gain_db;
    fprintf(stderr, "[HwPlutoSDR] ✓ RX gain set to %.2f dB\n", gain_db);
    fprintf(stderr, "[HW] DEBUG: set_rx_gain() SUCCESSFUL\n");
    return true;
}

bool HwPlutoSDR::set_tx_gain(float gain_db) {
    fprintf(stderr, "[HW] DEBUG: set_tx_gain() called with gain_db=%.2f\n", gain_db);

    // PlutoSDR TX hardwaregain is attenuation: valid range is -89.75 to 0 dB (0 = max power)
    // Clamp positive values to 0 (matches reference QO100_Transceiver behavior)
    if (gain_db > 0.0f) {
        fprintf(stderr, "[HW] DEBUG: TX gain positive (%.2f), clamping to 0 (max power)\n", gain_db);
        gain_db = 0.0f;
    }

    if (gain_db < TX_GAIN_MIN_DB || gain_db > TX_GAIN_MAX_DB) {
        std::ostringstream oss;
        oss << "set_tx_gain: gain " << gain_db << " dB out of range ["
            << TX_GAIN_MIN_DB << ", " << TX_GAIN_MAX_DB << "] dB";
        fprintf(stderr, "[HW] DEBUG: TX gain OUT OF RANGE\n");
        set_error_(oss.str());
        return false;
    }

    // Ensure TX channel is available
    if (!phy_tx_channel_) {
        fprintf(stderr, "[HW] DEBUG: TX channel not initialized (0x%p)\n", (void*)phy_tx_channel_);
        set_error_("set_tx_gain: TX channel not initialized");
        return false;
    }

    // Write TX gain (in dB, as double — matches reference code)
    fprintf(stderr, "[HW] DEBUG: Writing TX hardwaregain: %.2f dB\n", gain_db);
    if (!write_channel_attr_double_(phy_tx_channel_, "hardwaregain", (double)gain_db)) {
        fprintf(stderr, "[HW] DEBUG: Failed to write TX hardwaregain\n");
        set_error_("set_tx_gain: failed to write TX gain");
        return false;
    }

    tx_gain_db_ = gain_db;
    fprintf(stderr, "[HwPlutoSDR] ✓ TX gain set to %.2f dB\n", gain_db);
    fprintf(stderr, "[HW] DEBUG: set_tx_gain() SUCCESSFUL\n");
    return true;
}

bool HwPlutoSDR::set_sample_rate(float rate_hz) {
    fprintf(stderr, "[HW] DEBUG: set_sample_rate() called with rate_hz=%.2e\n", rate_hz);

    if (rate_hz < SAMPLE_RATE_MIN_HZ || rate_hz > SAMPLE_RATE_MAX_HZ) {
        std::ostringstream oss;
        oss << "set_sample_rate: rate " << rate_hz << " Hz out of range ["
            << SAMPLE_RATE_MIN_HZ << ", " << SAMPLE_RATE_MAX_HZ << "] Hz";
        fprintf(stderr, "[HW] DEBUG: Sample rate OUT OF RANGE\n");
        set_error_(oss.str());
        return false;
    }

    // Ensure RX and TX channels are available
    if (!phy_rx_channel_ || !phy_tx_channel_) {
        fprintf(stderr, "[HW] DEBUG: RX/TX channels not initialized\n");
        set_error_("set_sample_rate: RX/TX channels not initialized");
        return false;
    }

    // Convert Hz to integer (AD9361 works with integer rates)
    long long rate_fixed = (long long)rate_hz;

    if (rate_hz < 2100000.0f) {
        fprintf(stderr, "[HW] DEBUG: Low sample rate mode (< 2.1 MHz): using ad9361_set_bb_rate()\n");
        // AD9361 minimum via IIO attribute path is ~2.084 MSPS.
        // For sub-2.1 MHz rates, use ad9361_set_bb_rate() to program internal FIR decimation.
        // First set the IIO streaming rate to 3 MHz (safe for buffer management).
        long long stream_rate = 3000000LL;
        fprintf(stderr, "[HW] DEBUG: Setting RX streaming rate to %lld Hz\n", stream_rate);
        if (!write_channel_attr_(phy_rx_channel_, "sampling_frequency", stream_rate)) {
            fprintf(stderr, "[HW] DEBUG: Failed to write RX streaming rate\n");
            set_error_("set_sample_rate: failed to write RX streaming rate for low-rate mode");
            return false;
        }
        fprintf(stderr, "[HW] DEBUG: Setting TX streaming rate to %lld Hz\n", stream_rate);
        if (!write_channel_attr_(phy_tx_channel_, "sampling_frequency", stream_rate)) {
            fprintf(stderr, "[HW] DEBUG: Failed to write TX streaming rate\n");
            set_error_("set_sample_rate: failed to write TX streaming rate for low-rate mode");
            return false;
        }

        // Now program the actual decimation via libad9361
        fprintf(stderr, "[HW] DEBUG: Calling ad9361_set_bb_rate(%lld)\n", rate_fixed);
        int ret = ad9361_set_bb_rate(phy_device_, (unsigned long)rate_fixed);
        if (ret < 0) {
            std::ostringstream oss;
            oss << "set_sample_rate: ad9361_set_bb_rate(" << rate_fixed << ") failed with code " << ret;
            fprintf(stderr, "[HW] DEBUG: ad9361_set_bb_rate() FAILED with ret=%d\n", ret);
            set_error_(oss.str());
            return false;
        }
        fprintf(stderr, "[HW] DEBUG: ad9361_set_bb_rate() SUCCESSFUL\n");
        fprintf(stderr, "[HwPlutoSDR] ✓ Sample rate set to %.2e Hz (via ad9361_set_bb_rate)\n", rate_hz);
    } else {
        fprintf(stderr, "[HW] DEBUG: Normal sample rate mode (>= 2.1 MHz): using IIO attributes\n");
        // Normal path for >= 2.1 MHz — use standard IIO attribute path
        fprintf(stderr, "[HW] DEBUG: Writing RX sampling_frequency: %lld Hz\n", rate_fixed);
        if (!write_channel_attr_(phy_rx_channel_, "sampling_frequency", rate_fixed)) {
            fprintf(stderr, "[HW] DEBUG: Failed to write RX sampling_frequency\n");
            set_error_("set_sample_rate: failed to write RX sample rate");
            return false;
        }
        fprintf(stderr, "[HW] DEBUG: Writing TX sampling_frequency: %lld Hz\n", rate_fixed);
        if (!write_channel_attr_(phy_tx_channel_, "sampling_frequency", rate_fixed)) {
            fprintf(stderr, "[HW] DEBUG: Failed to write TX sampling_frequency\n");
            set_error_("set_sample_rate: failed to write TX sample rate");
            return false;
        }
        fprintf(stderr, "[HwPlutoSDR] ✓ Sample rate set to %.2e Hz\n", rate_hz);
    }

    sample_rate_hz_ = rate_hz;
    fprintf(stderr, "[HW] DEBUG: set_sample_rate() SUCCESSFUL\n");
    return true;
}

// ============================================================================
// Error Handling
// ============================================================================

std::string HwPlutoSDR::get_last_error() {
    std::lock_guard<std::mutex> lock(error_mutex_);
    std::string err = last_error_;
    last_error_.clear();
    return err;
}

HwPlutoSDR::SdrInfo HwPlutoSDR::get_sdr_info() const {
    SdrInfo info;
    info.connected = (ctx_ != nullptr);
    if (!ctx_) return info;

    const char* val;
    val = iio_context_get_attr_value(ctx_, "hw_model");
    if (val) info.hw_model = val;
    val = iio_context_get_attr_value(ctx_, "fw_version");
    if (val) info.fw_version = val;
    val = iio_context_get_attr_value(ctx_, "serial");
    if (val) info.serial = val;

    return info;
}

void HwPlutoSDR::set_error_(const std::string& msg) {
    std::lock_guard<std::mutex> lock(error_mutex_);
    last_error_ = msg;
    fprintf(stderr, "[HwPlutoSDR] ERROR: %s\n", msg.c_str());
}

// ============================================================================
// Private Implementation
// ============================================================================

bool HwPlutoSDR::create_context_(const char* uri) {
    ctx_ = iio_create_context_from_uri(uri);
    if (!ctx_) {
        set_error_("create_context: iio_create_context_from_uri failed");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ IIO context created\n");
    return true;
}

bool HwPlutoSDR::find_devices_() {
    // Find ad9361-phy (PHY device for control)
    phy_device_ = iio_context_find_device(ctx_, "ad9361-phy");
    if (!phy_device_) {
        set_error_("find_devices: ad9361-phy not found");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ Found ad9361-phy\n");

    // Find cf-ad9361-lpc (DATA device for streaming)
    data_device_ = iio_context_find_device(ctx_, "cf-ad9361-lpc");
    if (!data_device_) {
        set_error_("find_devices: cf-ad9361-lpc not found");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ Found cf-ad9361-lpc\n");

    // Find cf-ad9361-dds-core-lpc (TX DDS device)
    tx_data_device_ = iio_context_find_device(ctx_, "cf-ad9361-dds-core-lpc");
    if (!tx_data_device_) {
        // This is optional; not all firmware versions have it
        fprintf(stderr, "[HwPlutoSDR] WARNING: cf-ad9361-dds-core-lpc not found (TX DDS disabled)\n");
        tx_data_device_ = nullptr;
    } else {
        fprintf(stderr, "[HwPlutoSDR] ✓ Found cf-ad9361-dds-core-lpc\n");
    }

    return true;
}

bool HwPlutoSDR::enable_rx_channels_() {
    // Dynamically find RX channels on any device (supports various hardware/firmware)
    // RX channels are typically input (receive) channels named voltage0/1

    // Primary: search data_device
    rx_i_channel_ = iio_device_find_channel(data_device_, "voltage0", false);
    rx_q_channel_ = iio_device_find_channel(data_device_, "voltage1", false);

    if (rx_i_channel_ && rx_q_channel_) {
        fprintf(stderr, "[HwPlutoSDR] Found RX channels on primary data device\n");
    } else {
        // Fallback: search all devices for input voltage channels
        fprintf(stderr, "[HwPlutoSDR] RX channels not on data device, searching all devices...\n");
        rx_i_channel_ = nullptr;
        rx_q_channel_ = nullptr;

        // This is a fallback for future multi-device support (USB, etc.)
        // For now, log a warning if not found
        if (!rx_i_channel_ || !rx_q_channel_) {
            set_error_("enable_rx_channels: RX channels not found on primary device");
            return false;
        }
    }

    iio_channel_enable(rx_i_channel_);
    iio_channel_enable(rx_q_channel_);

    fprintf(stderr, "[HwPlutoSDR] ✓ RX channels enabled\n");
    return true;
}

bool HwPlutoSDR::enable_tx_channels_() {
    // TX channels enabled in tx_start()
    // This is a no-op here for symmetry
    return true;
}

bool HwPlutoSDR::configure_phy_() {
    fprintf(stderr, "[HwPlutoSDR] Configuring PHY\n");

    if (!phy_device_) {
        set_error_("configure_phy: phy_device not initialized");
        return false;
    }

    // Get PHY channel handles for voltage (RX/TX) and LO (RX/TX)
    phy_rx_channel_ = iio_device_find_channel(phy_device_, "voltage0", false);
    phy_tx_channel_ = iio_device_find_channel(phy_device_, "voltage0", true);
    phy_rx_lo_channel_ = iio_device_find_channel(phy_device_, "altvoltage0", true);
    phy_tx_lo_channel_ = iio_device_find_channel(phy_device_, "altvoltage1", true);

    if (!phy_rx_channel_ || !phy_tx_channel_ || !phy_rx_lo_channel_ || !phy_tx_lo_channel_) {
        set_error_("configure_phy: failed to find PHY channels");
        return false;
    }

    // Set RX port select (antenna selection) using STRING attribute
    // "A_BALANCED" for balanced antenna, "B_BALANCED", "A", "B"
    if (!write_channel_attr_str_(phy_rx_channel_, "rf_port_select", "A_BALANCED")) {
        set_error_("configure_phy: failed to set RX port");
        return false;
    }

    // Set TX port select
    if (!write_channel_attr_str_(phy_tx_channel_, "rf_port_select", "A")) {
        set_error_("configure_phy: failed to set TX port");
        return false;
    }

    // Set RX RF bandwidth (CRITICAL: must be set before or with sampling_frequency)
    // Use 80% of sample rate, minimum 200 kHz (AD9361 hardware limit)
    long long rx_bw_hz = (long long)(sample_rate_hz_ * 0.8f);
    if (rx_bw_hz < 200000LL) rx_bw_hz = 200000LL;
    if (!write_channel_attr_(phy_rx_channel_, "rf_bandwidth", rx_bw_hz)) {
        // Non-fatal — some firmware versions may not expose this attribute
        fprintf(stderr, "[HwPlutoSDR] Warning: could not set RX RF bandwidth (may be hidden)\n");
    }

    // Set TX RF bandwidth
    long long tx_bw_hz = (long long)(sample_rate_hz_ * 0.8f);
    if (tx_bw_hz < 200000LL) tx_bw_hz = 200000LL;
    if (!write_channel_attr_(phy_tx_channel_, "rf_bandwidth", tx_bw_hz)) {
        fprintf(stderr, "[HwPlutoSDR] Warning: could not set TX RF bandwidth (may be hidden)\n");
    }

    // Enable DC offset correction (device-level attribute) — non-fatal if unavailable
    write_phy_attr_str_("in_voltage_bb_dc_offset_tracking_en", "1");

    // Enable IQ imbalance correction (device-level attribute) — non-fatal if unavailable
    write_phy_attr_str_("in_voltage_quadrature_tracking_en", "1");

    // Set RX gain control mode to slow_attack (AGC) — matches reference QO100_Transceiver
    if (!write_channel_attr_str_(phy_rx_channel_, "gain_control_mode", "slow_attack")) {
        set_error_("configure_phy: failed to set RX gain control mode");
        return false;
    }

    fprintf(stderr, "[HwPlutoSDR] ✓ PHY configured\n");
    return true;
}

void HwPlutoSDR::log_error_(const char* context) {
    // libiio-v0 doesn't have iio_get_errno, use system errno instead
    int err = errno;
    std::ostringstream oss;
    oss << context << ": " << strerror(err);
    set_error_(oss.str());
}

bool HwPlutoSDR::write_phy_attr_(const char* attr, long long value) {
    if (!phy_device_ || !attr) {
        return false;
    }

    int ret = iio_device_attr_write_longlong(phy_device_, attr, value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "write_phy_attr(" << attr << "): iio_device_attr_write_longlong failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::write_phy_attr_str_(const char* attr, const char* value) {
    if (!phy_device_ || !attr || !value) {
        return false;
    }

    int ret = iio_device_attr_write(phy_device_, attr, value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "write_phy_attr_str(" << attr << "): iio_device_attr_write failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::read_phy_attr_(const char* attr, long long& value) {
    if (!phy_device_ || !attr) {
        return false;
    }

    int ret = iio_device_attr_read_longlong(phy_device_, attr, &value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "read_phy_attr(" << attr << "): iio_device_attr_read_longlong failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::read_phy_attr_float_(const char* attr, float& value) {
    if (!phy_device_ || !attr) {
        return false;
    }

    double tmp = 0.0;
    int ret = iio_device_attr_read_double(phy_device_, attr, &tmp);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "read_phy_attr_float(" << attr << "): iio_device_attr_read_double failed";
        set_error_(oss.str());
        return false;
    }

    value = static_cast<float>(tmp);
    return true;
}

// ============================================================================
// Channel-Level Attribute Wrappers (for PHY configuration)
// ============================================================================

bool HwPlutoSDR::write_channel_attr_(iio_channel* chan, const char* attr, long long value) {
    if (!chan || !attr) {
        return false;
    }

    int ret = iio_channel_attr_write_longlong(chan, attr, value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "write_channel_attr(" << attr << "): iio_channel_attr_write_longlong failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::write_channel_attr_str_(iio_channel* chan, const char* attr, const char* value) {
    if (!chan || !attr || !value) {
        return false;
    }

    int ret = iio_channel_attr_write(chan, attr, value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "write_channel_attr_str(" << attr << "): iio_channel_attr_write failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::write_channel_attr_double_(iio_channel* chan, const char* attr, double value) {
    if (!chan || !attr) {
        return false;
    }

    int ret = iio_channel_attr_write_double(chan, attr, value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "write_channel_attr_double(" << attr << "): iio_channel_attr_write_double failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::read_channel_attr_(iio_channel* chan, const char* attr, long long& value) {
    if (!chan || !attr) {
        return false;
    }

    int ret = iio_channel_attr_read_longlong(chan, attr, &value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "read_channel_attr(" << attr << "): iio_channel_attr_read_longlong failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

bool HwPlutoSDR::read_channel_attr_double_(iio_channel* chan, const char* attr, double& value) {
    if (!chan || !attr) {
        return false;
    }

    int ret = iio_channel_attr_read_double(chan, attr, &value);
    if (ret < 0) {
        std::ostringstream oss;
        oss << "read_channel_attr_double(" << attr << "): iio_channel_attr_read_double failed";
        set_error_(oss.str());
        return false;
    }

    return true;
}

// ============================================================================
// I/Q Conversion Helpers
// ============================================================================

inline std::complex<float> HwPlutoSDR::i16_to_complex(int16_t i, int16_t q) {
    return std::complex<float>(i * RX_I16_SCALE, q * RX_I16_SCALE);
}

inline void HwPlutoSDR::complex_to_i16(std::complex<float> sample, int16_t& i, int16_t& q) {
    float i_scaled = sample.real() * TX_I16_SCALE;
    float q_scaled = sample.imag() * TX_I16_SCALE;

    // Clip to int16_t range
    i = (int16_t)std::max(-32767.0f, std::min(32767.0f, i_scaled));
    q = (int16_t)std::max(-32767.0f, std::min(32767.0f, q_scaled));
}
