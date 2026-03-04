#pragma once

#include <cstdint>
#include <cstring>
#include <complex>
#include <queue>
#include <vector>
#include <cmath>
#include <liquid/liquid.h>

/**
 * RxDspPsk — PSK (BPSK/QPSK/8PSK/etc) Demodulator
 *
 * Implements a complete receive DSP chain for phase-shift keying modulations:
 * - Symbol synchronization (Gardner timing recovery)
 * - Root-Raised-Cosine matched filter (span=11 symbols)
 * - Modem demodulation (liquid-dsp)
 * - Phase tracking NCO (frequency correction from beacon lock)
 * - EVM and SNR computation
 * - Hard bit decisions
 *
 * Input: Complex I/Q samples at sample_rate_hz
 * Output: Demodulated symbols, bit stream, quality metrics
 */

class RxDspPsk {
public:
    // Constructor
    // modem: liquid-dsp modulation scheme (LIQUID_MODEM_BPSK, LIQUID_MODEM_QPSK, etc.)
    // sample_rate_hz: I/Q sample rate (e.g., 30.72e6)
    // symbol_rate_hz: Desired symbol rate (e.g., 230400.0)
    RxDspPsk(modulation_scheme modem, float sample_rate_hz, float symbol_rate_hz);

    // Destructor
    ~RxDspPsk();

    // Feed one I/Q sample, return true if new symbol ready
    bool push_sample(std::complex<float> in);

    // Retrieve demodulated symbol (normalized 0.0-1.0 on unit circle)
    std::complex<float> get_symbol() const { return current_symbol_; }

    // Get Error Vector Magnitude in dB (constellation quality)
    float get_evm() const { return evm_db_; }

    // Get Signal-to-Noise Ratio in dB
    float get_snr() const { return snr_db_; }

    // Extract bit decisions (hard decision) for bits_per_symbol bits
    uint8_t get_bits(int bits_per_symbol);

    // Get total symbols demodulated
    uint32_t get_symbol_count() const { return symbol_count_; }

    // Get number of symbols in output queue
    size_t symbols_available() const { return symbol_queue_.size(); }

    // Get constellation buffer for IQ visualization (last 1024 symbols)
    const std::vector<std::complex<float>>& get_constellation() const { return constellation_buffer_; }

    // Get bits per symbol for current modem scheme
    int get_bits_per_symbol() const { return bits_per_symbol_; }

    // Reset state (e.g., on mode change)
    void reset();

private:
    // Parameters
    float sample_rate_hz_;
    float symbol_rate_hz_;
    modulation_scheme modem_;
    int bits_per_symbol_;

    // Liquid-dsp objects
    modemcf demod_;  // Demodulator instance

    // Symbol timing synchronization
    float sps_;  // Samples per symbol
    int decimation_factor_;
    int sample_index_;  // Current position in symbol period
    std::vector<std::complex<float>> symbol_buffer_;  // Buffer for matched filtering

    // RRC filter state
    static constexpr int RRC_SPAN = 11;  // Number of symbol periods
    std::vector<float> rrc_filter_;      // RRC impulse response
    std::vector<std::complex<float>> filter_ring_;  // Ring buffer for FIR filtering
    size_t filter_ring_pos_;                         // Write position in ring buffer
    float rrc_alpha_;  // RRC roll-off factor (0.35)

    // Phase tracking
    nco_crcf phase_nco_;  // Numerically-controlled oscillator for phase correction
    float phase_offset_rad_;  // Current phase offset (accumulates)
    float frequency_correction_hz_;  // Frequency offset from beacon_lock

    // Output state
    std::complex<float> current_symbol_;  // Last demodulated symbol
    std::queue<std::complex<float>> symbol_queue_;  // Symbols pending bit extraction
    std::queue<uint8_t> bits_queue_;  // Hard decision bits

    // Quality metrics
    float evm_db_;  // Error Vector Magnitude
    float snr_db_;  // Signal-to-Noise Ratio
    uint32_t symbol_count_;  // Total symbols demodulated
    std::vector<std::complex<float>> constellation_buffer_;  // For EVM/SNR computation

    // Helper methods
    void init_rrc_filter_();
    std::complex<float> apply_rrc_filter_(std::complex<float> sample);
    void compute_evm_and_snr_();
    void extract_bits_(std::complex<float> symbol);
};
