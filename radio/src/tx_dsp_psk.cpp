#include "tx_dsp_psk.h"
#include <algorithm>
#include <stdexcept>
#include <iostream>
#include <cmath>

TxDspPsk::TxDspPsk(modulation_scheme modem, float sample_rate_hz, float symbol_rate_hz)
    : sample_rate_hz_(sample_rate_hz),
      symbol_rate_hz_(symbol_rate_hz),
      modem_(modem),
      symbol_count_(0),
      rrc_alpha_(0.35f),
      sps_(static_cast<int>(sample_rate_hz / symbol_rate_hz)),
      filter_output_index_(0),
      is_flushed_(false),
      output_scale_(1.0f),
      agc_filter_coeff_(0.01f),
      estimated_power_(0.0f) {

    std::cerr << "[TX] DEBUG: TxDspPsk constructor: modem=" << static_cast<int>(modem)
              << ", sample_rate_hz=" << sample_rate_hz
              << ", symbol_rate_hz=" << symbol_rate_hz
              << ", sps=" << sps_ << "\n";

    // Validate sps
    if (sps_ < 2) {
        std::cerr << "[TX] DEBUG: Invalid sps=" << sps_ << " (must be >= 2)\n";
        throw std::runtime_error("Samples per symbol must be >= 2");
    }

    // Create modulator
    std::cerr << "[TX] DEBUG: Creating modem modulator\n";
    mod_ = modemcf_create(modem);
    if (mod_ == nullptr) {
        std::cerr << "[TX] DEBUG: modemcf_create() FAILED\n";
        throw std::runtime_error("Failed to create modem modulator");
    }
    std::cerr << "[TX] DEBUG: Modem modulator created successfully\n";

    // Get bits per symbol
    bits_per_symbol_ = modemcf_get_bps(mod_);
    std::cerr << "[TX] DEBUG: bits_per_symbol=" << bits_per_symbol_ << "\n";

    // Initialize RRC filter
    init_rrc_filter_();

    // Initialize ring buffer for FIR filtering
    filter_ring_.assign(rrc_filter_.size(), std::complex<float>(0.0f, 0.0f));
    filter_ring_pos_ = 0;
}

TxDspPsk::~TxDspPsk() {
    if (mod_ != nullptr) {
        modemcf_destroy(mod_);
    }
}

void TxDspPsk::init_rrc_filter_() {
    // Create Root-Raised-Cosine filter with span=11 symbols, alpha=0.35
    int ntaps = RRC_SPAN * sps_;

    // Ensure odd number of taps for symmetry
    if (ntaps % 2 == 0) {
        ntaps++;
    }

    rrc_filter_.resize(ntaps);

    // Generate RRC impulse response analytically
    float center = (ntaps - 1) / 2.0f;

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

void TxDspPsk::push_bits(const uint8_t* bits, size_t bit_count) {
    if (is_flushed_) {
        return;  // Ignore bits after flush
    }

    for (size_t i = 0; i < bit_count; i++) {
        input_bits_.push(bits[i] ? 1 : 0);
    }

    // Generate symbols from accumulated bits
    generate_symbols_from_bits_();
}

void TxDspPsk::generate_symbols_from_bits_() {
    while ((int)input_bits_.size() >= bits_per_symbol_) {
        unsigned int bits = 0;

        // Extract bits_per_symbol bits
        for (int i = 0; i < bits_per_symbol_; i++) {
            uint8_t bit = input_bits_.front();
            input_bits_.pop();
            bits = (bits << 1) | bit;
        }

        // Modulate bits to symbol
        liquid_float_complex symbol_complex;
        modemcf_modulate(mod_, bits, &symbol_complex);
        std::complex<float> symbol = symbol_complex;

        // Normalize symbol to unit circle
        float magnitude = std::abs(symbol);
        if (magnitude > 1e-6f) {
            symbol /= magnitude;
        }

        symbol_queue_.push(symbol);
        symbol_count_++;

        // Generate filter outputs for this symbol
        // Apply RRC filter: one symbol becomes sps samples
        for (int s = 0; s < sps_; s++) {
            std::complex<float> filtered = apply_rrc_filter_(symbol);
            apply_agc_(filtered);

            // Tap for TX spectrum visualization
            tx_spectrum_buffer_.push_back(filtered);
            if (tx_spectrum_buffer_.size() > 2048) {
                tx_spectrum_buffer_.erase(tx_spectrum_buffer_.begin());
            }

            output_queue_.push(filtered);
        }
    }
}

std::complex<float> TxDspPsk::apply_rrc_filter_(std::complex<float> symbol) {
    // Write sample into ring buffer
    filter_ring_[filter_ring_pos_] = symbol;
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

void TxDspPsk::apply_agc_(std::complex<float>& sample) {
    // Compute instantaneous power
    float instant_power = std::norm(sample);  // |sample|^2

    // Low-pass filter power estimate
    estimated_power_ = agc_filter_coeff_ * instant_power +
                      (1.0f - agc_filter_coeff_) * estimated_power_;

    // Compute gain to achieve target power
    if (estimated_power_ > 1e-6f) {
        output_scale_ = std::sqrt(TARGET_POWER / estimated_power_);
    }

    // Clamp gain to prevent instability
    output_scale_ = std::max(0.1f, std::min(10.0f, output_scale_));

    // Apply gain
    sample *= output_scale_;
}

bool TxDspPsk::get_sample(std::complex<float>& out) {
    if (output_queue_.empty()) {
        return false;
    }

    out = output_queue_.front();
    output_queue_.pop();
    return true;
}

void TxDspPsk::flush() {
    is_flushed_ = true;

    // Pad remaining bits with zeros if necessary
    int bits_to_pad = bits_per_symbol_ - ((int)input_bits_.size() % bits_per_symbol_);
    if (bits_to_pad > 0 && bits_to_pad < bits_per_symbol_) {
        while ((int)input_bits_.size() % bits_per_symbol_ != 0) {
            input_bits_.push(0);
        }
    }

    // Generate symbols for remaining bits
    generate_symbols_from_bits_();

    // Add trailing zeros (symbol period) to allow filter to ring down
    for (int i = 0; i < RRC_SPAN * sps_; i++) {
        std::complex<float> zero(0.0f, 0.0f);
        std::complex<float> filtered = apply_rrc_filter_(zero);
        apply_agc_(filtered);
        output_queue_.push(filtered);
    }
}

void TxDspPsk::reset() {
    symbol_count_ = 0;
    is_flushed_ = false;
    filter_output_index_ = 0;
    output_scale_ = 1.0f;
    estimated_power_ = 0.0f;

    input_bits_ = std::queue<uint8_t>();
    symbol_queue_ = std::queue<std::complex<float>>();
    std::fill(filter_ring_.begin(), filter_ring_.end(), std::complex<float>(0.0f, 0.0f));
    filter_ring_pos_ = 0;
    output_queue_ = std::queue<std::complex<float>>();
}
