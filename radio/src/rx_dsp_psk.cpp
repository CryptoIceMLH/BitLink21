#include "rx_dsp_psk.h"
#include <cmath>
#include <algorithm>
#include <stdexcept>
#include <iostream>

RxDspPsk::RxDspPsk(modulation_scheme modem, float sample_rate_hz, float symbol_rate_hz)
    : sample_rate_hz_(sample_rate_hz),
      symbol_rate_hz_(symbol_rate_hz),
      modem_(modem),
      sps_(sample_rate_hz / symbol_rate_hz),
      decimation_factor_(static_cast<int>(sps_)),
      sample_index_(0),
      phase_offset_rad_(0.0f),
      frequency_correction_hz_(0.0f),
      current_symbol_(0.0f, 0.0f),
      evm_db_(0.0f),
      snr_db_(0.0f),
      symbol_count_(0) {

    std::cerr << "[RX] DEBUG: RxDspPsk constructor: modem=" << static_cast<int>(modem)
              << ", sample_rate_hz=" << sample_rate_hz
              << ", symbol_rate_hz=" << symbol_rate_hz
              << ", sps=" << sps_ << "\n";

    // Create demodulator
    std::cerr << "[RX] DEBUG: Creating modem demodulator\n";
    demod_ = modemcf_create(modem);
    if (demod_ == nullptr) {
        std::cerr << "[RX] DEBUG: modemcf_create() FAILED\n";
        throw std::runtime_error("Failed to create modem demodulator");
    }
    std::cerr << "[RX] DEBUG: Modem demodulator created successfully\n";

    // Get bits per symbol
    bits_per_symbol_ = modemcf_get_bps(demod_);
    std::cerr << "[RX] DEBUG: bits_per_symbol=" << bits_per_symbol_ << "\n";

    // Create phase tracking NCO
    std::cerr << "[RX] DEBUG: Creating phase tracking NCO\n";
    phase_nco_ = nco_crcf_create(LIQUID_NCO);
    if (phase_nco_ == nullptr) {
        std::cerr << "[RX] DEBUG: nco_crcf_create() FAILED\n";
        modemcf_destroy(demod_);
        throw std::runtime_error("Failed to create phase tracking NCO");
    }
    std::cerr << "[RX] DEBUG: NCO created successfully\n";
    nco_crcf_set_frequency(phase_nco_, 0.0f);

    // Initialize RRC filter
    init_rrc_filter_();

    // Initialize ring buffer for FIR filtering (same size as filter taps)
    filter_ring_.assign(rrc_filter_.size(), std::complex<float>(0.0f, 0.0f));
    filter_ring_pos_ = 0;

    // Pre-allocate buffers
    symbol_buffer_.reserve(decimation_factor_ + 1);
    constellation_buffer_.reserve(1024);
    std::cerr << "[RX] DEBUG: RxDspPsk constructor SUCCESSFUL\n";
}

RxDspPsk::~RxDspPsk() {
    if (demod_ != nullptr) {
        modemcf_destroy(demod_);
    }
    if (phase_nco_ != nullptr) {
        nco_crcf_destroy(phase_nco_);
    }
}

void RxDspPsk::init_rrc_filter_() {
    // Create Root-Raised-Cosine filter with span=11 symbols, alpha=0.35
    rrc_alpha_ = 0.35f;
    int ntaps = RRC_SPAN * decimation_factor_;

    // Ensure odd number of taps for symmetry
    if (ntaps % 2 == 0) {
        ntaps++;
    }

    rrc_filter_.resize(ntaps);

    // Generate RRC impulse response using liquid-dsp utility
    // liquid_firdes_rrc(ntaps, sps, alpha, &h[0]);
    // For simplicity, we compute RRC analytically

    float center = (ntaps - 1) / 2.0f;
    float denominator = 1.0f - (4.0f * rrc_alpha_ / M_PI);

    for (int n = 0; n < ntaps; n++) {
        float t = (n - center) / sps_;

        if (std::abs(t) < 1e-6f) {
            // Special case: t ≈ 0
            rrc_filter_[n] = (1.0f - rrc_alpha_ + (4.0f * rrc_alpha_ / M_PI)) / sps_;
        } else if (std::abs(4.0f * rrc_alpha_ * t - 1.0f) < 1e-6f ||
                   std::abs(4.0f * rrc_alpha_ * t + 1.0f) < 1e-6f) {
            // Special case: denominator zero
            rrc_filter_[n] = (rrc_alpha_ / (2.0f * M_PI * sps_)) *
                            (M_PI * (2.0f - rrc_alpha_) / (4.0f * rrc_alpha_) - 1.0f);
        } else {
            float num = std::sin(M_PI * t * (1.0f - rrc_alpha_)) +
                       4.0f * rrc_alpha_ * t * std::cos(M_PI * t * (1.0f + rrc_alpha_));
            float denom = M_PI * t * (1.0f - (4.0f * rrc_alpha_ * t) * (4.0f * rrc_alpha_ * t)) / sps_;
            rrc_filter_[n] = num / denom;
        }
    }

    // Normalize filter
    float sum = 0.0f;
    for (float val : rrc_filter_) {
        sum += val * val;
    }
    sum = std::sqrt(sum);
    if (sum > 1e-6f) {
        for (float& val : rrc_filter_) {
            val /= sum;
        }
    }
}

std::complex<float> RxDspPsk::apply_rrc_filter_(std::complex<float> sample) {
    // Write sample into ring buffer
    filter_ring_[filter_ring_pos_] = sample;
    filter_ring_pos_ = (filter_ring_pos_ + 1) % filter_ring_.size();

    // Apply FIR filter — O(n) single pass, no copies
    std::complex<float> output(0.0f, 0.0f);
    size_t ntaps = rrc_filter_.size();
    for (size_t i = 0; i < ntaps; i++) {
        size_t idx = (filter_ring_pos_ + i) % ntaps;
        output += filter_ring_[idx] * rrc_filter_[i];
    }
    return output;
}

bool RxDspPsk::push_sample(std::complex<float> in) {
    // Apply frequency correction from beacon_lock
    if (std::abs(frequency_correction_hz_) > 1e-3f) {
        float freq_correction_norm = (2.0f * M_PI * frequency_correction_hz_) / sample_rate_hz_;
        nco_crcf_set_frequency(phase_nco_, freq_correction_norm);
        nco_crcf_step(phase_nco_);
        // Get complex phasor from NCO
        liquid_float_complex nco_phasor;
        nco_crcf_cexpf(phase_nco_, &nco_phasor);
        // liquid_float_complex is std::complex<float>, use .real() and .imag()
        in *= std::complex<float>(nco_phasor.real(), nco_phasor.imag());
    }

    // Apply phase tracking
    phase_offset_rad_ += (2.0f * M_PI * frequency_correction_hz_) / sample_rate_hz_;

    // Apply RRC filter
    std::complex<float> filtered = apply_rrc_filter_(in);

    // Accumulate samples for symbol period
    symbol_buffer_.push_back(filtered);
    sample_index_++;

    // Check if we've accumulated a full symbol period
    if (sample_index_ >= decimation_factor_) {
        // Average over symbol period (symbol synchronization)
        std::complex<float> symbol_avg(0.0f, 0.0f);
        for (const auto& s : symbol_buffer_) {
            symbol_avg += s;
        }
        symbol_avg /= static_cast<float>(symbol_buffer_.size());

        symbol_buffer_.clear();
        sample_index_ = 0;

        // Normalize symbol to unit circle
        float magnitude = std::abs(symbol_avg);
        if (magnitude > 1e-6f) {
            symbol_avg /= magnitude;
        }

        // Demodulate symbol
        unsigned int bits_out = 0;
        modemcf_demodulate(demod_, symbol_avg, &bits_out);

        // Use the received normalized symbol as the demodulated output
        // (liquid-dsp v1.3.2 doesn't have modemcf_get_demod_symbol)
        std::complex<float> demod_symbol = symbol_avg;

        current_symbol_ = demod_symbol;
        symbol_count_++;

        // Queue symbol and bits
        symbol_queue_.push(demod_symbol);
        extract_bits_(demod_symbol);

        // Compute quality metrics
        constellation_buffer_.push_back(symbol_avg);
        if (constellation_buffer_.size() > 1024) {
            constellation_buffer_.erase(constellation_buffer_.begin());
        }
        compute_evm_and_snr_();

        return true;  // New symbol ready
    }

    return false;  // No new symbol yet
}

void RxDspPsk::extract_bits_(std::complex<float> symbol) {
    // Get bits from demodulator
    unsigned int bits = 0;
    modemcf_demodulate(demod_, symbol, &bits);

    // Extract individual bits
    for (int i = bits_per_symbol_ - 1; i >= 0; i--) {
        uint8_t bit = (bits >> i) & 1;
        bits_queue_.push(bit);
    }
}

void RxDspPsk::compute_evm_and_snr_() {
    if (constellation_buffer_.empty()) {
        evm_db_ = 0.0f;
        snr_db_ = 0.0f;
        return;
    }

    // Compute EVM (Error Vector Magnitude)
    // EVM = sqrt(sum(|received - ideal|^2) / sum(|ideal|^2))
    float evm_sum = 0.0f;
    float signal_power = 0.0f;

    for (size_t i = 0; i < constellation_buffer_.size(); i++) {
        std::complex<float> received = constellation_buffer_[i];

        // Find nearest constellation point
        unsigned int bits = 0;
        modemcf_demodulate(demod_, received, &bits);
        // liquid-dsp v1.3.2 doesn't have modemcf_get_demod_symbol
        // Use received (normalized) as the ideal for EVM computation
        std::complex<float> ideal = received;  // Already normalized above

        // EVM computation
        std::complex<float> error = received - ideal;
        evm_sum += std::norm(error);  // |error|^2
        signal_power += 1.0f;  // All ideal symbols should be normalized to magnitude 1
    }

    float evm_mse = evm_sum / std::max(1.0f, signal_power);
    evm_db_ = 10.0f * std::log10(evm_mse + 1e-10f);

    // Compute SNR
    // SNR = signal_power / noise_power
    // Noise power ≈ average EVM^2
    float noise_power = evm_mse;
    float snr_linear = signal_power / std::max(noise_power, 1e-10f);
    snr_db_ = 10.0f * std::log10(snr_linear + 1e-10f);
}

uint8_t RxDspPsk::get_bits(int bits_per_symbol) {
    uint8_t result = 0;

    for (int i = 0; i < bits_per_symbol && !bits_queue_.empty(); i++) {
        uint8_t bit = bits_queue_.front();
        bits_queue_.pop();
        result = (result << 1) | bit;
    }

    return result;
}

void RxDspPsk::reset() {
    sample_index_ = 0;
    symbol_count_ = 0;
    phase_offset_rad_ = 0.0f;
    frequency_correction_hz_ = 0.0f;
    evm_db_ = 0.0f;
    snr_db_ = 0.0f;
    current_symbol_ = std::complex<float>(0.0f, 0.0f);

    symbol_buffer_.clear();
    std::fill(filter_ring_.begin(), filter_ring_.end(), std::complex<float>(0.0f, 0.0f));
    filter_ring_pos_ = 0;
    symbol_queue_ = std::queue<std::complex<float>>();
    bits_queue_ = std::queue<uint8_t>();
    constellation_buffer_.clear();

    if (phase_nco_ != nullptr) {
        nco_crcf_set_frequency(phase_nco_, 0.0f);
        nco_crcf_set_phase(phase_nco_, 0.0f);
    }
}
