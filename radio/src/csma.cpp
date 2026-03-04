#include "csma.h"
#include <iostream>
#include <chrono>
#include <thread>
#include <algorithm>
#include <cmath>

/**
 * CSMA Implementation
 *
 * Provides carrier sense and exponential backoff for collision avoidance.
 * Thread-safe for use in RadioController TX thread.
 */

// Static time reference for relative RSSI measurements
static std::chrono::steady_clock::time_point startup_time = std::chrono::steady_clock::now();

CSMA::CSMA(float center_freq_mhz, float rssi_threshold_db,
           uint16_t backoff_ms, uint16_t max_backoff_ms)
    : center_freq_mhz_(center_freq_mhz),
      rssi_threshold_db_(rssi_threshold_db),
      backoff_slot_ms_(backoff_ms),
      max_backoff_ms_(max_backoff_ms) {
    // Seed RNG with current time + address entropy
    uint32_t seed = std::chrono::system_clock::now().time_since_epoch().count() ^
                    reinterpret_cast<uintptr_t>(this);
    rng_.seed(seed);

    // Initialize timing reference
    last_tx_timestamp_ms_ = static_cast<uint32_t>(-1);

    std::cerr << "[CSMA] Initialized at " << center_freq_mhz_ << " MHz"
              << " | threshold: " << rssi_threshold_db_ << " dB"
              << " | backoff: " << backoff_slot_ms_ << " ms"
              << " | max: " << max_backoff_ms_ << " ms" << std::endl;
}

CSMA::~CSMA() {
    std::cerr << "[CSMA] Destroyed" << std::endl;
}

/**
 * Measure RSSI by repeated sampling over duration_ms
 *
 * Simulates RSSI measurement from radio hardware.
 * In production, this calls hw_plutosdr_->get_rx_rssi() in a loop.
 *
 * For now, returns a pseudo-random value around noise floor.
 */
float CSMA::measure_rssi_blocking_(uint32_t duration_ms) {
    // In production integration with RadioController:
    // Loop: hw_plutosdr_->get_rx_rssi() every RSSI_SAMPLE_INTERVAL_US
    // Average the samples
    // Return average

    // Placeholder: simulate RSSI measurement
    // Noise floor at -115 dBm, occasionally spike to -100 dBm
    std::uniform_real_distribution<float> dist(-115.0f, -100.0f);

    float sum_rssi = 0.0f;
    int samples = 0;

    for (uint32_t elapsed = 0; elapsed < duration_ms; elapsed += 1) {
        sum_rssi += dist(rng_);
        samples++;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    float avg_rssi = sum_rssi / samples;
    last_rssi_db_ = avg_rssi;
    return avg_rssi;
}

/**
 * Calculate exponential backoff delay
 *
 * Formula: delay = random(0, min(2^backoff_counter, max_backoff_ms))
 *
 * Exponential growth prevents collision cascade:
 * Counter 0: 0-100 ms
 * Counter 1: 0-200 ms
 * Counter 2: 0-400 ms
 * Counter 3: 0-800 ms
 * Counter 4: 0-1600 ms
 * Counter 5+: 0-3200 ms (capped)
 */
uint32_t CSMA::calculate_backoff_delay_ms_() {
    uint16_t counter = backoff_counter_.load();

    // Cap exponent to prevent overflow
    uint16_t exponent = std::min(counter, static_cast<uint16_t>(MAX_BACKOFF_EXPONENT));

    // Calculate maximum backoff: slot_time * 2^exponent
    uint32_t max_delay = backoff_slot_ms_ * (1U << exponent);

    // Cap to global maximum
    max_delay = std::min(max_delay, static_cast<uint32_t>(max_backoff_ms_));

    // Random delay in [0, max_delay]
    std::uniform_int_distribution<uint32_t> dist(0, max_delay);
    uint32_t delay = dist(rng_);

    return delay;
}

/**
 * Get time elapsed since startup (ms)
 */
uint32_t CSMA::get_time_since_startup_ms_() const {
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - startup_time);
    return static_cast<uint32_t>(elapsed.count());
}

bool CSMA::can_transmit() {
    // Measure RSSI over 10 ms window
    float rssi_db = measure_rssi_blocking_(RSSI_SENSE_WINDOW_MS);

    std::cerr << "[CSMA] CCA: RSSI=" << rssi_db << " dB | threshold=" << rssi_threshold_db_ << " dB";

    if (rssi_db > rssi_threshold_db_) {
        // Channel busy
        std::cerr << " -> BUSY, backoff initiated" << std::endl;

        // Increment backoff counter for next retry
        uint16_t old_counter = backoff_counter_.load();
        backoff_counter_++;

        return false;
    } else {
        // Channel idle
        std::cerr << " -> IDLE, ready to transmit" << std::endl;
        return true;
    }
}

uint32_t CSMA::request_tx(uint32_t frame_size_bytes) {
    std::cerr << "[CSMA] request_tx: frame_size=" << frame_size_bytes << " bytes" << std::endl;

    // Attempt TX until channel is clear
    while (!can_transmit()) {
        // Channel busy, calculate backoff delay
        uint32_t backoff_ms = calculate_backoff_delay_ms_();

        std::cerr << "[CSMA] Backing off for " << backoff_ms << " ms"
                  << " (counter=" << backoff_counter_.load() << ")" << std::endl;

        // Sleep for backoff period
        std::this_thread::sleep_for(std::chrono::milliseconds(backoff_ms));

        // Retry CCA
    }

    // Channel clear, ready to transmit
    std::cerr << "[CSMA] Channel acquired, transmitting" << std::endl;
    return 0;  // Immediate, no estimated wait time
}

void CSMA::on_tx_start() {
    tx_in_progress_ = true;
    tx_start_time_ = std::chrono::steady_clock::now();
    std::cerr << "[CSMA] TX started" << std::endl;
}

void CSMA::on_tx_done() {
    tx_in_progress_ = false;
    last_tx_timestamp_ms_ = get_time_since_startup_ms_();

    // Reset backoff counter after successful transmission
    uint16_t old_counter = backoff_counter_.exchange(0);

    std::cerr << "[CSMA] TX done | backoff_counter reset from " << old_counter << " to 0" << std::endl;
}

void CSMA::set_rssi_threshold(float db) {
    rssi_threshold_db_ = db;
    std::cerr << "[CSMA] RSSI threshold updated to " << db << " dB" << std::endl;
}

float CSMA::get_rssi_threshold() const {
    return rssi_threshold_db_;
}

uint16_t CSMA::get_backoff_counter() const {
    return backoff_counter_.load();
}

uint32_t CSMA::get_time_since_last_tx_ms() const {
    uint32_t last_tx = last_tx_timestamp_ms_.load();
    if (last_tx == static_cast<uint32_t>(-1)) {
        return static_cast<uint32_t>(-1);  // Never transmitted
    }

    uint32_t now = get_time_since_startup_ms_();
    if (now >= last_tx) {
        return now - last_tx;
    } else {
        // Wrap-around (unlikely in practice)
        return 0;
    }
}

float CSMA::get_last_rssi_db() const {
    return last_rssi_db_.load();
}

void CSMA::reset() {
    backoff_counter_ = 0;
    last_rssi_db_ = -120.0f;
    last_tx_timestamp_ms_ = static_cast<uint32_t>(-1);
    tx_in_progress_ = false;

    std::cerr << "[CSMA] Reset" << std::endl;
}
