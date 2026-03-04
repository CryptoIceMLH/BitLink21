#include "dsp_common.h"
#include <stdexcept>
#include <cmath>
#include <algorithm>

// ============================================================================
// RRCFilter Implementation
// ============================================================================

RRCFilter::RRCFilter(int num_taps, int span, float sps, float alpha)
    : num_taps_(num_taps),
      span_(span),
      sps_(sps),
      alpha_(alpha),
      filter_(nullptr) {

    if (num_taps < 1) {
        throw std::runtime_error("RRCFilter: num_taps must be >= 1");
    }
    if (alpha < 0.0f || alpha > 1.0f) {
        throw std::runtime_error("RRCFilter: alpha must be in [0, 1]");
    }

    // Create liquid-dsp RRC filter using built-in designer
    // LIQUID_FIRFILT_RRC = root raised cosine
    // k = samples per symbol, m = span, beta = roll-off factor, mu = phase offset (0)
    filter_ = firfilt_crcf_create_rnyquist(
        LIQUID_FIRFILT_RRC,
        (unsigned int)sps_,
        span_,
        alpha_,
        0.0f);
    if (filter_ == nullptr) {
        throw std::runtime_error("RRCFilter: failed to create liquid-dsp RRC filter");
    }
}

RRCFilter::~RRCFilter() {
    if (filter_ != nullptr) {
        firfilt_crcf_destroy(filter_);
        filter_ = nullptr;
    }
}

std::complex<float> RRCFilter::process_sample(std::complex<float> in) {
    std::complex<float> out;
    firfilt_crcf_push(filter_, in);
    firfilt_crcf_execute(filter_, &out);
    return out;
}

void RRCFilter::process_buffer(std::complex<float>* buffer, size_t count) {
    if (buffer == nullptr || count == 0) {
        return;
    }

    for (size_t i = 0; i < count; i++) {
        buffer[i] = process_sample(buffer[i]);
    }
}

void RRCFilter::reset() {
    if (filter_ != nullptr) {
        firfilt_crcf_reset(filter_);
    }
}

// ============================================================================
// Resampler Implementation
// ============================================================================

Resampler::Resampler(float resample_ratio, unsigned int filter_len)
    : resample_ratio_(resample_ratio),
      resampler_(nullptr) {

    if (resample_ratio < 0.1f || resample_ratio > 10.0f) {
        throw std::runtime_error("Resampler: ratio must be in [0.1, 10]");
    }
    if (filter_len < 10) {
        throw std::runtime_error("Resampler: filter_len must be >= 10");
    }

    // Create liquid-dsp resampler with default parameters
    // Uses m=7 (filter semi-length), fc=min(0.49,rate/2), As=60dB, npfb=64
    resampler_ = resamp_crcf_create_default(resample_ratio);
    if (resampler_ == nullptr) {
        throw std::runtime_error("Resampler: failed to create liquid-dsp resampler");
    }

    // Pre-allocate output buffer (max ceil(ratio)+1 samples per push)
    output_buffer_.reserve(16);
}

Resampler::~Resampler() {
    if (resampler_ != nullptr) {
        resamp_crcf_destroy(resampler_);
        resampler_ = nullptr;
    }
}

void Resampler::push_sample(std::complex<float> in) {
    // Pre-size buffer to max possible output (ceil(ratio)+1)
    output_buffer_.clear();
    output_buffer_.resize(16);  // Max pre-allocated

    // Resample the input sample, get actual output count
    unsigned int num_written = 0;
    resamp_crcf_execute(resampler_, in, output_buffer_.data(), &num_written);

    // Resize to actual output samples generated
    output_buffer_.resize(num_written);
}

void Resampler::reset() {
    if (resampler_ != nullptr) {
        resamp_crcf_reset(resampler_);
    }
    output_buffer_.clear();
}

// ============================================================================
// Power Computation Functions
// ============================================================================

float compute_power_linear(const std::complex<float>* samples, size_t count) {
    if (samples == nullptr || count == 0) {
        return 0.0f;
    }

    float power_sum = 0.0f;
    for (size_t i = 0; i < count; i++) {
        power_sum += std::norm(samples[i]);  // |sample|^2
    }

    return power_sum / static_cast<float>(count);
}

float compute_power_db(const std::complex<float>* samples, size_t count) {
    float power_linear = compute_power_linear(samples, count);
    return 10.0f * std::log10(power_linear + 1e-10f);
}

float compute_snr_db(const std::complex<float>* received,
                     const std::complex<float>* ideal,
                     size_t count) {
    if (received == nullptr || ideal == nullptr || count == 0) {
        return -100.0f;
    }

    // Compute signal power (average of ideal symbols, normalized to magnitude 1)
    float signal_power = 1.0f;

    // Compute noise power (MSE between received and ideal)
    float error_power = 0.0f;
    for (size_t i = 0; i < count; i++) {
        std::complex<float> error = received[i] - ideal[i];
        error_power += std::norm(error);
    }
    error_power /= static_cast<float>(count);

    // SNR = signal_power / noise_power
    float snr_linear = signal_power / std::max(error_power, 1e-10f);
    return 10.0f * std::log10(snr_linear + 1e-10f);
}

// ============================================================================
// Phase Utilities
// ============================================================================

void unwrap_phase(float* phase, size_t count, float threshold) {
    if (phase == nullptr || count < 2) {
        return;
    }

    for (size_t i = 1; i < count; i++) {
        float diff = phase[i] - phase[i - 1];

        // Detect jumps larger than threshold
        if (diff > threshold) {
            phase[i] -= 2.0f * M_PI;
        } else if (diff < -threshold) {
            phase[i] += 2.0f * M_PI;
        }
    }
}

float phase_diff(std::complex<float> a, std::complex<float> b) {
    // Compute phase of a * conj(b)
    std::complex<float> diff = a * std::conj(b);
    float phase = std::atan2(diff.imag(), diff.real());

    // Wrap to [-pi, pi]
    while (phase > M_PI) phase -= 2.0f * M_PI;
    while (phase < -M_PI) phase += 2.0f * M_PI;

    return phase;
}

void rotate_constellation(std::complex<float>* samples, size_t count, float phase_rad) {
    if (samples == nullptr || count == 0) {
        return;
    }

    // Pre-compute rotation phasor
    std::complex<float> phasor(std::cos(phase_rad), std::sin(phase_rad));

    for (size_t i = 0; i < count; i++) {
        samples[i] *= phasor;
    }
}

float compute_evm_db(const std::complex<float>* received,
                     const std::complex<float>* ideal,
                     size_t count) {
    if (received == nullptr || ideal == nullptr || count == 0) {
        return -100.0f;
    }

    float evm_sum = 0.0f;
    float signal_power = 0.0f;

    for (size_t i = 0; i < count; i++) {
        // Error vector
        std::complex<float> error = received[i] - ideal[i];
        evm_sum += std::norm(error);  // |error|^2

        // Ideal power (normalized to magnitude 1)
        signal_power += 1.0f;
    }

    // EVM = sqrt(error_power / signal_power)
    float evm_mse = evm_sum / std::max(signal_power, 1.0f);
    float evm_linear = std::sqrt(evm_mse);

    return 20.0f * std::log10(evm_linear + 1e-10f);
}

// ============================================================================
// SymbolTimingSync Implementation
// ============================================================================

SymbolTimingSync::SymbolTimingSync(float samples_per_symbol, float loop_bw)
    : sps_(samples_per_symbol),
      loop_bw_(loop_bw),
      integrator_(0.0f),
      sample_offset_(0.0f),
      timing_error_(0.0f),
      timing_error_filtered_(0.0f),
      symbol_count_(0) {

    if (sps_ < 1.0f) {
        throw std::runtime_error("SymbolTimingSync: samples_per_symbol must be >= 1");
    }
    if (loop_bw < 1.0f || loop_bw > 10000.0f) {
        throw std::runtime_error("SymbolTimingSync: loop_bw should be in range (1, 10000)");
    }

    // PLL gains derived from loop bandwidth
    // For a proportional-integral loop: Kp and Ki are chosen to achieve
    // desired natural frequency and damping (typically zeta = 0.707)
    float wn = 2.0f * M_PI * loop_bw;  // Natural frequency
    kp_ = wn * 0.5f;  // Proportional gain
    ki_ = wn * wn * 0.1f;  // Integral gain
}

SymbolTimingSync::~SymbolTimingSync() {
    // No dynamic allocation, nothing to cleanup
}

bool SymbolTimingSync::process_symbol(std::complex<float> symbol) {
    // Add to history
    symbol_history_.push(symbol);

    // Gardner detector needs 3 symbols (early, prompt, late)
    if (symbol_history_.size() < 3) {
        return false;  // Not ready yet
    }

    // Remove oldest symbol if we have more than 3
    if (symbol_history_.size() > 3) {
        symbol_history_.pop();
    }

    // Extract the three symbols for Gardner detector
    std::complex<float> early = symbol_history_.front();
    std::complex<float> prompt;
    std::complex<float> late;

    std::queue<std::complex<float>> temp = symbol_history_;
    early = temp.front(); temp.pop();
    prompt = temp.front(); temp.pop();
    late = temp.front();

    // Compute timing error using Gardner detector
    timing_error_ = gardner_error_(early, prompt, late);

    // Low-pass filter timing error for stability
    timing_error_filtered_ = 0.9f * timing_error_filtered_ + 0.1f * timing_error_;

    // Update PLL integrator
    integrator_ += ki_ * timing_error_filtered_;

    // Clamp integrator to prevent wind-up
    integrator_ = std::max(-1.0f, std::min(1.0f, integrator_));

    // Compute phase correction
    float phase_correction = kp_ * timing_error_filtered_ + integrator_;

    // Update sample offset
    sample_offset_ += phase_correction;

    // Wrap sample offset to [0, sps_]
    while (sample_offset_ >= sps_) {
        sample_offset_ -= sps_;
    }
    while (sample_offset_ < 0.0f) {
        sample_offset_ += sps_;
    }

    symbol_count_++;

    // Decision: sample when offset is close to 0 (within 0.25 symbols)
    bool should_sample = (sample_offset_ < 0.25f * sps_) ||
                         (sample_offset_ > 0.75f * sps_);

    return should_sample;
}

float SymbolTimingSync::gardner_error_(std::complex<float> early,
                                       std::complex<float> prompt,
                                       std::complex<float> late) {
    // Gardner timing error detector:
    // e[n] = Re[(y_e[n] - y_l[n]) * conj(y_p[n])]
    // where y_e, y_p, y_l are early, prompt, late samples
    //
    // This is sensitive to symbol timing phase and insensitive to
    // carrier phase (if y_p is roughly on-constellation)

    std::complex<float> diff = early - late;
    std::complex<float> error_phasor = diff * std::conj(prompt);

    // Extract real part (in-phase error)
    float gardner_err = error_phasor.real();

    // Normalize by power to handle varying signal levels
    float prompt_power = std::norm(prompt);
    if (prompt_power > 1e-6f) {
        gardner_err /= prompt_power;
    }

    // Scale to sample period
    return gardner_err * sps_;
}

void SymbolTimingSync::reset() {
    integrator_ = 0.0f;
    sample_offset_ = 0.0f;
    timing_error_ = 0.0f;
    timing_error_filtered_ = 0.0f;
    symbol_count_ = 0;

    symbol_history_ = std::queue<std::complex<float>>();
}

// ============================================================================
// SampleFIFO Implementation
// ============================================================================

SampleFIFO::SampleFIFO(size_t capacity)
    : samples_(), mutex_() {
    // capacity parameter reserved for future lock-free implementation
}

bool SampleFIFO::push(const std::complex<float>& sample) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (samples_.size() >= MAX_SIZE) {
        return false;  // FIFO full
    }
    samples_.push(sample);
    return true;
}

bool SampleFIFO::pop(std::complex<float>& sample) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (samples_.empty()) {
        return false;  // FIFO empty
    }
    sample = samples_.front();
    samples_.pop();
    return true;
}

size_t SampleFIFO::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return samples_.size();
}

bool SampleFIFO::empty() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return samples_.empty();
}

void SampleFIFO::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    while (!samples_.empty()) {
        samples_.pop();
    }
}
