#pragma once

#include <cstdint>
#include <cstring>
#include <complex>
#include <queue>
#include <liquid/liquid.h>

/**
 * BeaconLock — Digital PLL-based frequency lock for QO-100 satellite
 *
 * Replaces the open-loop beacon frequency tracking with a proper 2nd-order
 * proportional-integral loop filter. Uses liquid-dsp nco_crcf for the
 * numerically-controlled oscillator (NCO).
 *
 * Design:
 * - Loop filter: Kp=0.001, Ki=0.0001 (2nd order, ~1 Hz bandwidth)
 * - Tracks CW beacon or BPSK data beacon independently
 * - Lock detection: phase error < 3dB threshold
 * - User-selectable modes: Auto, CW only, BPSK only, OFF
 */

class BeaconLock {
public:
    // Beacon mode selection
    enum BeaconMode {
        MODE_OFF = 0,         // No beacon locking
        MODE_CW_ONLY = 1,     // Lock to CW beacon (~10489.500 MHz)
        MODE_BPSK_ONLY = 2,   // Lock to BPSK beacon (~10489.750 MHz)
        MODE_AUTO = 3         // Two-stage: CW coarse → BPSK fine (default)
    };

    // Lock state machine
    enum LockState {
        UNLOCKED = 0,
        COARSE_LOCK = 1,      // CW beacon acquired (auto mode)
        FINE_LOCK = 2         // BPSK beacon acquired (auto or BPSK mode)
    };

    // Status structure for UI feedback
    struct Status {
        LockState state;
        bool is_locked;                // true if fine_lock or locked in single mode
        float phase_error_deg;         // Current phase error in degrees
        float frequency_offset_hz;     // Current frequency offset from reference
        float confidence_db;           // Lock confidence in dB (larger = more confident)
        uint32_t lock_age_ms;          // How long we've been in current lock state
        float loop_integrator;         // Integral term of loop filter (for debugging)
    };

    // Constructor
    BeaconLock(float sample_rate_hz = 30.72e6, BeaconMode initial_mode = MODE_AUTO);

    // Destructor
    ~BeaconLock();

    // Set beacon mode
    void set_mode(BeaconMode mode);
    BeaconMode get_mode() const { return mode_; }

    // Process one complex sample with beacon (CW or BPSK)
    // beacon_sample: complex IQ sample from demodulated beacon
    // confidence_db: signal confidence metric (0 = no signal, 3+ = locked)
    void process_sample(std::complex<float> beacon_sample, float confidence_db);

    // Get current lock status for UI
    Status get_status() const;

    // Get current frequency correction (Hz) to apply in transceiver
    float get_frequency_correction_hz() const { return frequency_offset_hz_; }

    // Get current NCO phase (radians)
    float get_nco_phase_rad() const;

    // Reset lock state (e.g., on frequency change)
    void reset();

private:
    // Parameters
    float sample_rate_hz_;
    BeaconMode mode_;
    LockState lock_state_;

    // NCO (numerically-controlled oscillator)
    nco_crcf nco_;  // liquid-dsp NCO for phase tracking

    // Loop filter state (2nd-order proportional-integral)
    static constexpr float KP = 0.001f;   // Proportional gain
    static constexpr float KI = 0.0001f;  // Integral gain
    float integrator_;                     // Running integral of phase error

    // Tracking variables
    float frequency_offset_hz_;           // Current frequency offset estimate
    float phase_error_rad_;               // Current phase error
    float phase_error_low_pass_;          // Low-pass filtered phase error for display
    std::complex<float> last_sample_;     // Previous sample for phase computation
    float last_confidence_db_;            // Previous confidence value

    // Lock detection
    static constexpr float LOCK_THRESHOLD_DB = 3.0f;  // Confidence threshold for lock
    static constexpr float CONFIDENCE_ALPHA = 0.9f;   // Low-pass filter coefficient
    float confidence_db_filtered_;
    uint32_t lock_timestamp_ms_;          // When we entered current lock state

    // Helper: compute phase difference between samples (wrapped to [-pi, pi])
    static float phase_diff(std::complex<float> a, std::complex<float> b);

    // Helper: update lock state machine based on confidence
    void update_lock_state_(float confidence_db);

    // Helper: apply loop filter and update NCO frequency
    void update_loop_filter_(float phase_error);
};
