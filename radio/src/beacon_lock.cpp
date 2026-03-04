#include "beacon_lock.h"
#include <cmath>
#include <chrono>
#include <algorithm>
#include <iostream>

// Helper: compute phase difference between two complex samples
float BeaconLock::phase_diff(std::complex<float> a, std::complex<float> b) {
    // Compute phase of a * conj(b)
    std::complex<float> diff = a * std::conj(b);
    float phase = std::atan2(diff.imag(), diff.real());
    // Wrap to [-pi, pi]
    while (phase > M_PI) phase -= 2 * M_PI;
    while (phase < -M_PI) phase += 2 * M_PI;
    return phase;
}

BeaconLock::BeaconLock(float sample_rate_hz, BeaconMode initial_mode)
    : sample_rate_hz_(sample_rate_hz),
      mode_(initial_mode),
      lock_state_(UNLOCKED),
      integrator_(0.0f),
      frequency_offset_hz_(0.0f),
      phase_error_rad_(0.0f),
      phase_error_low_pass_(0.0f),
      last_sample_(0, 0),
      last_confidence_db_(-100.0f),
      confidence_db_filtered_(-100.0f),
      lock_timestamp_ms_(0) {

    std::cerr << "[BEACON] DEBUG: BeaconLock constructor: sample_rate_hz=" << sample_rate_hz
              << ", initial_mode=" << static_cast<int>(initial_mode) << "\n";

    // Initialize NCO at zero frequency
    std::cerr << "[BEACON] DEBUG: Creating NCO\n";
    nco_ = nco_crcf_create(LIQUID_NCO);
    if (nco_ == nullptr) {
        std::cerr << "[BEACON] DEBUG: nco_crcf_create() FAILED\n";
        throw std::runtime_error("Failed to create NCO");
    }
    std::cerr << "[BEACON] DEBUG: NCO created successfully\n";
    nco_crcf_set_frequency(nco_, 0.0f);
    std::cerr << "[BEACON] DEBUG: BeaconLock constructor SUCCESSFUL\n";
}

BeaconLock::~BeaconLock() {
    if (nco_ != nullptr) {
        nco_crcf_destroy(nco_);
    }
}

void BeaconLock::set_mode(BeaconMode mode) {
    std::cerr << "[BEACON] DEBUG: set_mode() called - mode=" << static_cast<int>(mode) << "\n";
    if (mode != mode_) {
        std::cerr << "[BEACON] DEBUG: Mode changed from " << static_cast<int>(mode_)
                  << " to " << static_cast<int>(mode) << ", resetting\n";
        mode_ = mode;
        reset();
    } else {
        std::cerr << "[BEACON] DEBUG: Mode unchanged\n";
    }
}

void BeaconLock::reset() {
    std::cerr << "[BEACON] DEBUG: reset() called\n";
    lock_state_ = UNLOCKED;
    integrator_ = 0.0f;
    frequency_offset_hz_ = 0.0f;
    phase_error_rad_ = 0.0f;
    phase_error_low_pass_ = 0.0f;
    last_sample_ = std::complex<float>(0, 0);
    last_confidence_db_ = -100.0f;
    confidence_db_filtered_ = -100.0f;
    lock_timestamp_ms_ = 0;

    if (nco_ != nullptr) {
        nco_crcf_set_frequency(nco_, 0.0f);
        nco_crcf_set_phase(nco_, 0.0f);
    }
    std::cerr << "[BEACON] DEBUG: reset() COMPLETE\n";
}

void BeaconLock::process_sample(std::complex<float> beacon_sample, float confidence_db) {
    // Low-pass filter the confidence metric
    confidence_db_filtered_ = CONFIDENCE_ALPHA * confidence_db_filtered_ +
                              (1.0f - CONFIDENCE_ALPHA) * confidence_db;

    std::cerr << "[BEACON] DEBUG: process_sample() - confidence_db=" << confidence_db
              << ", filtered=" << confidence_db_filtered_ << "\n";

    // If no signal, clear lock
    if (confidence_db_filtered_ < -50.0f) {
        std::cerr << "[BEACON] DEBUG: No signal (confidence < -50 dB), clearing lock\n";
        lock_state_ = UNLOCKED;
        integrator_ = 0.0f;
        return;
    }

    // Compute phase error between current and previous sample
    if (std::abs(last_sample_) > 1e-6f) {
        phase_error_rad_ = phase_diff(beacon_sample, last_sample_);

        // Low-pass filter phase error for display
        phase_error_low_pass_ = 0.95f * phase_error_low_pass_ +
                                0.05f * phase_error_rad_;

        std::cerr << "[BEACON] DEBUG: Phase error: " << (phase_error_rad_ * 180.0f / M_PI)
                  << " deg (raw), " << (phase_error_low_pass_ * 180.0f / M_PI) << " deg (filtered)\n";
    }

    last_sample_ = beacon_sample;
    last_confidence_db_ = confidence_db;

    // Update lock state machine
    update_lock_state_(confidence_db_filtered_);

    // Apply loop filter to update NCO frequency
    update_loop_filter_(phase_error_rad_);
}

void BeaconLock::update_lock_state_(float confidence_db) {
    auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

    switch (mode_) {
        case MODE_OFF:
            lock_state_ = UNLOCKED;
            integrator_ = 0.0f;
            frequency_offset_hz_ = 0.0f;
            break;

        case MODE_CW_ONLY:
            if (confidence_db > LOCK_THRESHOLD_DB) {
                if (lock_state_ == UNLOCKED) {
                    lock_state_ = FINE_LOCK;
                    lock_timestamp_ms_ = now_ms;
                }
            } else {
                lock_state_ = UNLOCKED;
            }
            break;

        case MODE_BPSK_ONLY:
            if (confidence_db > LOCK_THRESHOLD_DB) {
                if (lock_state_ == UNLOCKED) {
                    lock_state_ = FINE_LOCK;
                    lock_timestamp_ms_ = now_ms;
                }
            } else {
                lock_state_ = UNLOCKED;
            }
            break;

        case MODE_AUTO:
            // Two-stage: CW coarse lock first, then BPSK fine lock
            if (confidence_db > LOCK_THRESHOLD_DB) {
                if (lock_state_ == UNLOCKED) {
                    // First confidence above threshold: enter coarse lock
                    lock_state_ = COARSE_LOCK;
                    lock_timestamp_ms_ = now_ms;
                } else if (lock_state_ == COARSE_LOCK) {
                    // Sustained confidence in coarse lock > 1 second: promote to fine
                    uint32_t lock_age = now_ms - lock_timestamp_ms_;
                    if (lock_age > 1000) {
                        lock_state_ = FINE_LOCK;
                        lock_timestamp_ms_ = now_ms;
                    }
                }
            } else {
                // Lost confidence: drop back to unlocked
                if (lock_state_ != UNLOCKED) {
                    lock_state_ = UNLOCKED;
                }
            }
            break;
    }
}

void BeaconLock::update_loop_filter_(float phase_error) {
    // 2nd-order PLL loop filter
    // Error signal: phase_error_rad_
    // Update integrator
    integrator_ += KI * phase_error;

    // Clamp integrator to prevent wind-up
    integrator_ = std::max(-0.1f, std::min(0.1f, integrator_));

    // Compute frequency correction
    float freq_correction = KP * phase_error + integrator_;

    // Update NCO frequency (in normalized rad/sample)
    float nco_freq_normalized = (2.0f * M_PI * freq_correction) / sample_rate_hz_;
    nco_freq_normalized = std::max(-0.5f, std::min(0.5f, nco_freq_normalized));  // Clamp to valid range

    nco_crcf_set_frequency(nco_, nco_freq_normalized);

    // Track frequency offset in Hz for reporting
    frequency_offset_hz_ = freq_correction;
}

BeaconLock::Status BeaconLock::get_status() const {
    Status status;
    status.state = lock_state_;
    status.is_locked = (lock_state_ == FINE_LOCK) ||
                       (lock_state_ == COARSE_LOCK && mode_ == MODE_AUTO);
    status.phase_error_deg = phase_error_low_pass_ * 180.0f / M_PI;
    status.frequency_offset_hz = frequency_offset_hz_;
    status.confidence_db = confidence_db_filtered_;

    auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    status.lock_age_ms = (lock_state_ != UNLOCKED) ? (now_ms - lock_timestamp_ms_) : 0;

    status.loop_integrator = integrator_;

    return status;
}

float BeaconLock::get_nco_phase_rad() const {
    return nco_crcf_get_phase(nco_);
}
