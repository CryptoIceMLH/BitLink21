#ifndef CSMA_H
#define CSMA_H

#include <cstdint>
#include <cmath>
#include <chrono>
#include <random>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>

/**
 * CSMA (Carrier Sense Multiple Access) Protocol
 *
 * Implements slotted CSMA with exponential backoff for fair channel access
 * when multiple BitLink21 nodes share the QO-100 NB frequency.
 *
 * Algorithm Overview:
 * - Senses RSSI for 10 ms before TX decision
 * - If channel busy (RSSI > threshold): exponential backoff + retry
 * - If channel idle (RSSI < threshold): transmit immediately
 * - Max backoff: 3.2 seconds (after 5 doublings)
 * - Collision recovery: independent random backoff delays
 *
 * Integration:
 * RadioController TX thread calls:
 *   if (csma.can_transmit()) {
 *       frame = tx_queue.pop();
 *       csma.on_tx_start();
 *       // modulate and transmit...
 *       csma.on_tx_done();
 *   }
 */
class CSMA {
public:
    /**
     * Constructor
     *
     * @param center_freq_mhz Target RF frequency (for reference/logging)
     * @param rssi_threshold_db Threshold above which channel is considered busy (default: -90 dB)
     * @param backoff_ms Initial backoff slot duration in ms (default: 100 ms)
     * @param max_backoff_ms Maximum backoff limit in ms (default: 3200 ms = 3.2 sec)
     *
     * RSSI baseline: QO-100 NB noise floor ~-115 dBm
     * Threshold -90 dB leaves ~25 dB margin for weak signals
     */
    CSMA(float center_freq_mhz, float rssi_threshold_db = -90.0f,
         uint16_t backoff_ms = 100, uint16_t max_backoff_ms = 3200);

    /**
     * Destructor
     */
    ~CSMA();

    /**
     * Check if channel is clear and ready for transmission
     *
     * Performs single-shot RSSI measurement for ~10 ms.
     * If channel is busy (RSSI > threshold):
     *   - Initiates exponential backoff
     *   - Returns false (do not transmit)
     * If channel is idle (RSSI < threshold):
     *   - Returns true (channel clear, ready to transmit)
     *
     * @return true if channel is clear; false if busy (backoff started)
     *
     * Note: This is a non-blocking single check. Use request_tx() for blocking behavior.
     */
    bool can_transmit();

    /**
     * Request channel access (blocking until clear)
     *
     * Blocks until can_transmit() returns true.
     * Handles all backoff retry logic internally.
     *
     * @param frame_size_bytes Size of frame to transmit (for future use: frame length estimation)
     * @return Estimated time remaining until channel is clear (ms). 0 if immediate.
     *
     * Warning: This is blocking and may wait up to max_backoff_ms.
     * Intended for use in dedicated TX thread only.
     */
    uint32_t request_tx(uint32_t frame_size_bytes);

    /**
     * Notify CSMA that transmission has started
     *
     * Called immediately when TX modulation begins (for CCA timing reference).
     * Updates internal transmission time tracking.
     */
    void on_tx_start();

    /**
     * Notify CSMA that transmission has completed
     *
     * Called when TX frame finishes (last sample pushed to radio).
     * Resets backoff counter for next channel access attempt.
     * Clears internal TX markers.
     */
    void on_tx_done();

    /**
     * Set dynamic RSSI threshold
     *
     * Allows runtime adjustment of channel busy/idle threshold.
     * Useful for adapting to changing noise floor or signal conditions.
     *
     * @param db RSSI threshold in dB (typical range: -120 to -60 dB)
     */
    void set_rssi_threshold(float db);

    /**
     * Get current RSSI threshold
     *
     * @return Current threshold in dB
     */
    float get_rssi_threshold() const;

    /**
     * Get current backoff counter value
     *
     * Indicates number of consecutive collisions/busy periods.
     * Resets to 0 after successful TX completion.
     *
     * @return Current backoff counter (0-5 typically)
     */
    uint16_t get_backoff_counter() const;

    /**
     * Get timestamp of last successful transmission
     *
     * @return Milliseconds since last on_tx_done() call. Returns UINT32_MAX if never transmitted.
     */
    uint32_t get_time_since_last_tx_ms() const;

    /**
     * Get last measured RSSI
     *
     * @return RSSI in dB from most recent can_transmit() or request_tx() call
     */
    float get_last_rssi_db() const;

    /**
     * Reset CSMA state
     *
     * Clears backoff counter and timing markers.
     * Call on soft reset or channel reconfiguration.
     */
    void reset();

private:
    // Configuration
    float center_freq_mhz_;
    float rssi_threshold_db_;
    uint16_t backoff_slot_ms_;
    uint16_t max_backoff_ms_;

    // State tracking
    std::atomic<uint16_t> backoff_counter_{0};
    std::atomic<float> last_rssi_db_{-120.0f};
    std::atomic<uint32_t> last_tx_timestamp_ms_{0};

    // RNG for backoff delays
    std::mt19937 rng_;
    mutable std::mutex rng_mutex_;

    // TX timing markers
    std::atomic<bool> tx_in_progress_{false};
    std::chrono::steady_clock::time_point tx_start_time_;

    // Helper methods
    float measure_rssi_blocking_(uint32_t duration_ms);
    uint32_t calculate_backoff_delay_ms_();
    uint32_t get_time_since_startup_ms_() const;

    // Constants
    static constexpr uint32_t RSSI_SENSE_WINDOW_MS = 10;     // 10 ms sensing window
    static constexpr uint32_t RSSI_SAMPLE_INTERVAL_US = 100;  // 100 us between measurements
    static constexpr uint32_t MAX_BACKOFF_EXPONENT = 5;       // 2^5 = 32 multiplier
};

#endif // CSMA_H
