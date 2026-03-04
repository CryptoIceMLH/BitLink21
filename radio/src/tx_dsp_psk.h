#pragma once

#include <cstdint>
#include <cstring>
#include <complex>
#include <queue>
#include <vector>
#include <cmath>
#include <liquid/liquid.h>

/**
 * TxDspPsk — PSK (BPSK/QPSK/8PSK/etc) Modulator
 *
 * Implements a complete transmit DSP chain for phase-shift keying modulations:
 * - Bit-to-symbol mapping (liquid-dsp modulator)
 * - Root-Raised-Cosine transmit filter (span=11 symbols, roll-off=0.35)
 * - Automatic Gain Control (AGC) for output normalization
 * - Interpolation to sample rate
 * - Soft symbol gating
 *
 * Input: Bit stream via push_bits()
 * Output: Complex I/Q samples via get_sample()
 */

class TxDspPsk {
public:
    // Constructor
    // modem: liquid-dsp modulation scheme (LIQUID_MODEM_BPSK, LIQUID_MODEM_QPSK, etc.)
    // sample_rate_hz: I/Q sample rate (e.g., 30.72e6)
    // symbol_rate_hz: Desired symbol rate (e.g., 230400.0)
    TxDspPsk(modulation_scheme modem, float sample_rate_hz, float symbol_rate_hz);

    // Destructor
    ~TxDspPsk();

    // Queue bits for transmission
    // bits: array of bit values (0 or 1)
    // bit_count: number of bits to queue
    void push_bits(const uint8_t* bits, size_t bit_count);

    // Get next I/Q sample
    // Returns false when no more samples available (after flush)
    bool get_sample(std::complex<float>& out);

    // Check how many samples are queued for output
    size_t samples_available() const { return output_queue_.size(); }

    // Pad with zeros and mark end of transmission
    void flush();

    // Check if transmission is complete
    bool is_complete() const { return is_flushed_ && output_queue_.empty(); }

    // Reset state (e.g., on mode change)
    void reset();

    // Get total symbols transmitted
    uint32_t get_symbol_count() const { return symbol_count_; }

    // Get TX spectrum buffer for visualization (last 2048 I/Q samples)
    const std::vector<std::complex<float>>& get_tx_spectrum() const { return tx_spectrum_buffer_; }

private:
    // Parameters
    float sample_rate_hz_;
    float symbol_rate_hz_;
    modulation_scheme modem_;
    int bits_per_symbol_;

    // Liquid-dsp objects
    modemcf mod_;  // Modulator instance

    // Input bit buffer
    std::queue<uint8_t> input_bits_;

    // Symbol generation
    std::queue<std::complex<float>> symbol_queue_;  // Modulated symbols
    uint32_t symbol_count_;  // Total symbols transmitted

    // RRC filter state
    static constexpr int RRC_SPAN = 11;  // Number of symbol periods
    std::vector<float> rrc_filter_;      // RRC impulse response
    std::vector<std::complex<float>> filter_ring_;  // Ring buffer for FIR filtering
    size_t filter_ring_pos_;                         // Write position in ring buffer
    float rrc_alpha_;  // RRC roll-off factor (0.35)
    int sps_;  // Samples per symbol
    int filter_output_index_;  // Current position in filter output generation

    // Output stage
    std::queue<std::complex<float>> output_queue_;  // Final I/Q samples
    std::vector<std::complex<float>> tx_spectrum_buffer_;  // Ring buffer for TX spectrum visualization (max 2048)
    bool is_flushed_;  // True after flush() called
    float output_scale_;  // Normalization factor for AGC

    // AGC state
    float agc_filter_coeff_;  // Smoothing for power estimation
    float estimated_power_;   // Estimated output power
    static constexpr float TARGET_POWER = 0.5f;  // Target output power

    // Helper methods
    void init_rrc_filter_();
    void generate_symbols_from_bits_();
    std::complex<float> apply_rrc_filter_(std::complex<float> symbol);
    void apply_agc_(std::complex<float>& sample);
};
