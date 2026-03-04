#pragma once

#include <cstdint>
#include <cstring>
#include <complex>
#include <vector>
#include <queue>
#include <mutex>
#include <cmath>
#include <algorithm>
#include <liquid/liquid.h>

/**
 * dsp_common.h — Shared DSP Utilities for TNA-BitLink21
 *
 * Provides common digital signal processing utilities used by rx_dsp_psk and tx_dsp_psk:
 * - RRCFilter: Root-Raised-Cosine filter wrapper around liquid-dsp firfilt_crcf
 * - Resampler: Polyphase resampler wrapper around liquid-dsp resamp_crcf
 * - Power and SNR computation functions
 * - Phase unwrapping utility
 * - SymbolTimingSync: Gardner symbol timing recovery
 * - Constellation rotation helper
 *
 * Design:
 * - Memory-efficient: preallocated buffers, minimal copying
 * - Thread-safe per-instance: no shared mutable state
 * - Integrated with liquid-dsp for DSP kernels
 * - Matches project code style (see beacon_lock.h/cpp patterns)
 */

/**
 * RRCFilter — Root-Raised-Cosine FIR filter
 *
 * Wraps liquid-dsp firfilt_crcf for efficient filtering of complex I/Q signals.
 * Used in both rx_dsp_psk (matched filter) and tx_dsp_psk (transmit shaping).
 */
class RRCFilter {
public:
    /**
     * Constructor
     * @param num_taps Number of filter taps (should be odd for symmetry)
     * @param span Number of symbol periods covered by filter
     * @param sps Samples per symbol
     * @param alpha Roll-off factor (0.35 typical for satellite)
     */
    RRCFilter(int num_taps, int span, float sps, float alpha = 0.35f);

    // Destructor
    ~RRCFilter();

    // Push one complex sample, return filtered output
    std::complex<float> process_sample(std::complex<float> in);

    // Process array of samples (in-place)
    void process_buffer(std::complex<float>* buffer, size_t count);

    // Reset filter state
    void reset();

    // Get number of taps
    int get_num_taps() const { return num_taps_; }

private:
    int num_taps_;
    int span_;
    float sps_;
    float alpha_;
    firfilt_crcf filter_;  // liquid-dsp filter object
};

/**
 * Resampler — Polyphase resampler for arbitrary rate conversion
 *
 * Wraps liquid-dsp resamp_crcf for efficient sample rate conversion.
 * Used when input sample rate doesn't match target symbol rate exactly.
 */
class Resampler {
public:
    /**
     * Constructor
     * @param resample_ratio Output samples per input sample (e.g., 1.5 for 3:2 upsample)
     * @param filter_len Length of internal polyphase filter (recommended: 100+)
     */
    Resampler(float resample_ratio, unsigned int filter_len = 100);

    // Destructor
    ~Resampler();

    // Push one input sample, retrieve output samples via get_output_buffer()
    void push_sample(std::complex<float> in);

    // Get output buffer (may contain 0, 1, or 2 samples depending on phase)
    const std::vector<std::complex<float>>& get_output_buffer() const { return output_buffer_; }

    // Clear output buffer after reading
    void clear_output() { output_buffer_.clear(); }

    // Reset resampler state
    void reset();

    // Get resample ratio
    float get_ratio() const { return resample_ratio_; }

private:
    float resample_ratio_;
    resamp_crcf resampler_;  // liquid-dsp resampler object
    std::vector<std::complex<float>> output_buffer_;
};

/**
 * Power computation — compute average power of complex signal
 *
 * @param samples Array of complex samples
 * @param count Number of samples
 * @return Average power (linear, not dB)
 */
float compute_power_linear(const std::complex<float>* samples, size_t count);

/**
 * Power computation — dB version
 *
 * @param samples Array of complex samples
 * @param count Number of samples
 * @return Average power in dB (10*log10(power_linear))
 */
float compute_power_db(const std::complex<float>* samples, size_t count);

/**
 * SNR computation — estimate signal-to-noise ratio
 *
 * Assumes samples contain signal + noise. Uses power normalization
 * to distinguish signal from noise floor.
 *
 * @param received Array of received samples (signal + noise)
 * @param ideal Array of ideal noiseless samples
 * @param count Number of samples
 * @return SNR in dB
 */
float compute_snr_db(const std::complex<float>* received,
                     const std::complex<float>* ideal,
                     size_t count);

/**
 * Phase unwrap — convert wrapped phase to continuous phase
 *
 * Removes 2*pi jumps from phase array (in-place).
 *
 * @param phase Array of phase values (in radians)
 * @param count Number of phase values
 * @param threshold Jump threshold (default: pi, detects +/- 2*pi wraps)
 */
void unwrap_phase(float* phase, size_t count, float threshold = M_PI);

/**
 * SymbolTimingSync — Gardner symbol timing recovery
 *
 * Implements Gardner timing error detector for symbol synchronization.
 * Used to recover symbol clock from oversampled I/Q data.
 *
 * Design:
 * - Early/late gating on matched filter outputs
 * - Proportional-integral feedback loop
 * - Tracks sample offset within symbol period
 * - Converges in ~100-1000 symbols depending on SNR
 */
class SymbolTimingSync {
public:
    /**
     * Constructor
     * @param samples_per_symbol Samples per symbol (e.g., 133.33 for 30.72 MHz / 230.4 kHz)
     * @param loop_bw Loop bandwidth in Hz (default: 100 Hz, conservative)
     */
    SymbolTimingSync(float samples_per_symbol, float loop_bw = 100.0f);

    // Destructor
    ~SymbolTimingSync();

    /**
     * Process one matched filter output (already filtered symbol)
     * @param symbol Filtered symbol sample
     * @return true if symbol should be sampled at this time
     */
    bool process_symbol(std::complex<float> symbol);

    // Get current sample offset within symbol period (0 to sps_)
    float get_sample_offset() const { return sample_offset_; }

    // Get timing error estimate (in samples, -0.5 to +0.5)
    float get_timing_error() const { return timing_error_filtered_; }

    // Get number of symbols processed
    uint32_t get_symbol_count() const { return symbol_count_; }

    // Reset timing sync state
    void reset();

private:
    float sps_;  // Samples per symbol
    float loop_bw_;

    // PLL state (proportional-integral)
    float kp_;  // Proportional gain
    float ki_;  // Integral gain
    float integrator_;  // Accumulated phase error

    // Timing tracking
    float sample_offset_;  // Current offset in symbol period
    float timing_error_;  // Raw timing error from Gardner detector
    float timing_error_filtered_;  // Low-pass filtered timing error
    uint32_t symbol_count_;

    // History for Gardner detector (needs 3 symbols)
    std::queue<std::complex<float>> symbol_history_;

    // Helper: Gardner timing error detector
    // Returns error in [-sps_/2, +sps_/2] range
    float gardner_error_(std::complex<float> early,
                         std::complex<float> prompt,
                         std::complex<float> late);
};

/**
 * Rotate constellation — phase rotate constellation points
 *
 * Rotates each sample by a fixed phase (used for phase correction).
 *
 * @param samples Array of complex samples (modified in-place)
 * @param count Number of samples
 * @param phase_rad Phase rotation in radians
 */
void rotate_constellation(std::complex<float>* samples, size_t count, float phase_rad);

/**
 * Phase difference — compute wrapped phase difference between two complex samples
 *
 * Computes angle(a * conj(b)), wrapped to [-pi, pi].
 * Used for phase error tracking (see beacon_lock.cpp pattern).
 *
 * @param a First complex sample
 * @param b Second complex sample
 * @return Phase difference in radians, wrapped to [-pi, pi]
 */
float phase_diff(std::complex<float> a, std::complex<float> b);

/**
 * EVM computation — compute Error Vector Magnitude
 *
 * Measures demodulation quality as RMS constellation error.
 *
 * @param received Array of received constellation points
 * @param ideal Array of ideal constellation points
 * @param count Number of points
 * @return EVM in dB (20*log10(rms_error))
 */
float compute_evm_db(const std::complex<float>* received,
                     const std::complex<float>* ideal,
                     size_t count);

/**
 * SampleFIFO — Thread-safe lock-free queue for sample passing between threads
 *
 * Used to pass samples from IIO worker thread to RX/TX DSP threads
 * without blocking on hardware buffers. Preallocated ring buffer.
 */
class SampleFIFO {
public:
    /**
     * Constructor
     * @param capacity Maximum number of samples to hold (default 65536)
     */
    explicit SampleFIFO(size_t capacity = 65536);

    /**
     * Push sample to FIFO
     * @param sample Complex float sample
     * @return true if pushed successfully, false if FIFO full
     */
    bool push(const std::complex<float>& sample);

    /**
     * Pop sample from FIFO
     * @param sample Output parameter for popped sample
     * @return true if sample popped, false if FIFO empty
     */
    bool pop(std::complex<float>& sample);

    /**
     * Current size (approximate for lock-free version)
     */
    size_t size() const;

    /**
     * Check if FIFO is empty
     */
    bool empty() const;

    /**
     * Clear FIFO
     */
    void clear();

private:
    std::queue<std::complex<float>> samples_;
    mutable std::mutex mutex_;
    static constexpr size_t MAX_SIZE = 65536;
};
