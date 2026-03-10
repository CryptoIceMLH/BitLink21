/**
 * BitLink21-Radio Main Entry Point (Phase 9)
 *
 * This is the main executable for the BitLink21 radio transceiver.
 * It initializes all components in the correct order and runs the main event loop
 * until shutdown is requested.
 *
 * Initialization sequence:
 *   1. Parse command-line arguments
 *   2. Print startup banner with configuration
 *   3. Create HwPlutoSDR (hardware abstraction layer)
 *   4. Create RadioController (ties together all DSP/control modules)
 *   5. Create WsServer (WebSocket telemetry server)
 *   6. Create CSMA (multi-node channel access protocol)
 *   7. Start RadioController (spawns RX/TX/UDP threads)
 *   8. Start WsServer (spawns listener thread)
 *   9. Enter main loop with signal handling
 *   10. Graceful shutdown on SIGINT/SIGTERM
 *
 * Exit codes:
 *   0 = Successful shutdown
 *   1 = Initialization error (hardware, configuration, etc.)
 *   2 = Signal-based termination (Ctrl+C, SIGTERM)
 */

#include <iostream>
#include <iomanip>
#include <sstream>
#include <cstdlib>
#include <csignal>
#include <cstring>
#include <thread>
#include <chrono>
#include <atomic>
#include <memory>

// Component headers
#include "radio_controller.h"
#include "hw_plutosdr.h"
#include "ws_server.h"
#include "csma.h"
#include "logger.h"

// Global atomic for signal handling
static std::atomic<bool> shutdown_requested(false);

/**
 * Signal handler for graceful shutdown
 * Sets shutdown_requested flag when SIGINT (Ctrl+C) or SIGTERM is received
 */
void signal_handler(int sig_num) {
    std::cout << "\n[MAIN] Received signal " << sig_num << " - initiating graceful shutdown..." << std::endl;
    shutdown_requested = true;
}

/**
 * Configuration struct holding all runtime parameters
 */
struct Config {
    float freq_mhz = 10489.550000f;       // Center frequency (MHz) — QO-100 NB downlink
    float sample_rate_hz = 560.0e3f;      // Sample rate (Hz) — 560 kHz (matches reference QO-100 SAMPRATE)
    float rx_gain_db = 60.0f;             // RX gain (dB)
    float tx_gain_db = 10.0f;             // TX gain (dB)
    float lnb_offset_mhz = 9750.0f;       // LNB offset (MHz) — typical C-band LNB
    std::string pluto_uri;                // PlutoSDR network URI (set from env or default)
    int log_level = 2;                    // 0=errors, 1=info, 2=debug
    std::string modem_scheme = "qpsk";    // Modulation scheme for liquid-dsp (lowercase)

    // Constructor: Check environment variables for PLUTO_URI
    Config() {
        const char* env_pluto_uri = std::getenv("PLUTO_URI");
        if (env_pluto_uri && std::strlen(env_pluto_uri) > 0) {
            pluto_uri = env_pluto_uri;
        } else {
            pluto_uri = "ip:192.168.1.200";  // Default fallback
        }
    }
};

/**
 * Print startup banner with configuration summary
 */
void print_banner(const Config& cfg) {
    std::cout << "\n";
    std::cout << "╔════════════════════════════════════════════════════════════════╗\n";
    std::cout << "║         BitLink21-Radio — Phase 9 Integration (Final)          ║\n";
    std::cout << "║                                                                ║\n";
    std::cout << "║  A high-speed digital radio transceiver for QO-100 satellite   ║\n";
    std::cout << "║  featuring QPSK/BPSK modulation, FEC, beacon lock, & CSMA      ║\n";
    std::cout << "╚════════════════════════════════════════════════════════════════╝\n";
    std::cout << "\n";
    std::cout << "[CONFIG] Center Frequency:   " << std::fixed << std::setprecision(2)
              << cfg.freq_mhz << " MHz\n";
    std::cout << "[CONFIG] Sample Rate:        " << std::fixed << std::setprecision(0)
              << cfg.sample_rate_hz / 1e6 << " MSps\n";
    std::cout << "[CONFIG] RX Gain:            " << std::fixed << std::setprecision(1)
              << cfg.rx_gain_db << " dB\n";
    std::cout << "[CONFIG] TX Gain:            " << std::fixed << std::setprecision(1)
              << cfg.tx_gain_db << " dB\n";
    std::cout << "[CONFIG] PlutoSDR URI:       " << cfg.pluto_uri << "\n";
    std::cout << "[CONFIG] Log Level:          " << cfg.log_level
              << " (0=errors, 1=info, 2=debug)\n";
    std::cout << "[CONFIG] Modem Scheme:       " << (cfg.modem_scheme.empty() ? "qpsk (default)" : cfg.modem_scheme) << "\n";
    std::cout << "\n";
}

/**
 * Print usage information and exit with error code
 */
void print_usage(const char* program_name) {
    std::cout << "Usage: " << program_name << " [OPTIONS]\n\n";
    std::cout << "Options:\n";
    std::cout << "  --freq FREQ_MHZ           Center frequency in MHz (default: 10489.55)\n";
    std::cout << "  --rate SAMPLE_RATE_HZ     Sample rate (default: 512000)\n";
    std::cout << "  --rx-gain RX_GAIN_DB      RX gain 0-73 (default: 60)\n";
    std::cout << "  --tx-gain TX_GAIN_DB      TX gain 0-89 (default: 10)\n";
    std::cout << "  --lnb-offset LNB_OFFSET_MHZ  LNB offset in MHz (default: 9750)\n";
    std::cout << "  --pluto-uri URI           PlutoSDR URI (default: ip:192.168.1.200)\n";
    std::cout << "  --log-level LEVEL         0=errors, 1=info, 2=debug (default: 1)\n";
    std::cout << "  --modem SCHEME            Liquid-dsp modem: qpsk,bpsk,8psk,etc (default: qpsk)\n";
    std::cout << "  --help                    Print this message\n";
    std::cout << "\n";
}

/**
 * Parse command-line arguments into Config struct
 * Returns true on success, false on error or --help
 */
bool parse_arguments(int argc, char* argv[], Config& cfg) {
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return false;  // Signal that we should exit early
        }
        else if (arg == "--freq") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --freq requires an argument\n";
                return false;
            }
            cfg.freq_mhz = std::stof(argv[++i]);
        }
        else if (arg == "--rate") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --rate requires an argument\n";
                return false;
            }
            cfg.sample_rate_hz = std::stof(argv[++i]);
        }
        else if (arg == "--rx-gain") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --rx-gain requires an argument\n";
                return false;
            }
            cfg.rx_gain_db = std::stof(argv[++i]);
        }
        else if (arg == "--tx-gain") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --tx-gain requires an argument\n";
                return false;
            }
            cfg.tx_gain_db = std::stof(argv[++i]);
        }
        else if (arg == "--lnb-offset") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --lnb-offset requires an argument\n";
                return false;
            }
            cfg.lnb_offset_mhz = std::stof(argv[++i]);
        }
        else if (arg == "--pluto-uri") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --pluto-uri requires an argument\n";
                return false;
            }
            cfg.pluto_uri = argv[++i];
        }
        else if (arg == "--log-level") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --log-level requires an argument\n";
                return false;
            }
            cfg.log_level = std::stoi(argv[++i]);
        }
        else if (arg == "--modem") {
            if (i + 1 >= argc) {
                std::cerr << "[ERROR] --modem requires an argument\n";
                return false;
            }
            cfg.modem_scheme = argv[++i];
        }
        else {
            std::cerr << "[ERROR] Unknown option: " << arg << "\n";
            print_usage(argv[0]);
            return false;
        }
    }

    return true;
}

/**
 * Convert beacon lock state enum to human-readable string
 */
const char* beacon_lock_state_to_string(BeaconLockState state) {
    switch (state) {
        case BeaconLockState::UNLOCKED:
            return "UNLOCKED";
        case BeaconLockState::COARSE_LOCK:
            return "COARSE_LOCK";
        case BeaconLockState::FINE_LOCK:
            return "FINE_LOCK";
        default:
            return "UNKNOWN";
    }
}

/**
 * Convert modulation scheme string to liquid-dsp enum
 * Uses liquid-dsp's built-in string parser
 */
modulation_scheme string_to_modem_scheme(const std::string& scheme_str) {
    // Use liquid-dsp's string parser to convert scheme name to enum
    // This handles all liquid-dsp modem schemes: BPSK, QPSK, PSK8, QAM16, etc.
    return liquid_getopt_str2mod(scheme_str.c_str());
}

/**
 * Main entry point
 */
int main(int argc, char* argv[]) {
    Config cfg;

    std::cerr << "[MAIN] DEBUG: Entering main()\n";
    std::cerr << "[MAIN] DEBUG: argc=" << argc << "\n";

    // Parse command-line arguments
    std::cerr << "[MAIN] DEBUG: Parsing command-line arguments\n";
    if (!parse_arguments(argc, argv, cfg)) {
        std::cerr << "[MAIN] DEBUG: Argument parsing failed\n";
        // --help was requested or parse error occurred
        return (argv[1] && std::string(argv[1]) == "--help") ? 0 : 1;
    }
    std::cerr << "[MAIN] DEBUG: Command-line arguments parsed successfully\n";

    // Initialize logger with parsed log level
    std::cerr << "[MAIN] DEBUG: Initializing logger with level=" << cfg.log_level << "\n";
    g_logger = new Logger("/data/logs/bitlink21-radio.log", static_cast<LogLevel>(cfg.log_level));
    LOG_INFO("main", "BitLink21-Radio starting up", "{\"version\": \"phase9\", \"log_level\": " + std::to_string(cfg.log_level) + "}");
    std::cerr << "[MAIN] DEBUG: Logger initialized\n";

    // Print startup banner
    std::cerr << "[MAIN] DEBUG: Printing startup banner\n";
    print_banner(cfg);

    // Install signal handlers
    std::cerr << "[MAIN] DEBUG: Installing signal handlers for SIGINT and SIGTERM\n";
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
#ifndef _WIN32
    std::signal(SIGPIPE, SIG_IGN);  // Ignore SIGPIPE — broken WS client must not kill process
#endif

    LOG_INFO("main", "Signal handlers installed", "{}");
    std::cout << "[MAIN] Installing signal handlers... OK\n";
    std::cerr << "[MAIN] DEBUG: Signal handlers installed\n";

    // ========================================================================
    // Step 1: Initialize RadioController (Central Control & DSP)
    // NOTE: SDR hardware connection is deferred — user will connect manually via API
    // ========================================================================
    std::cout << "[MAIN] Creating RadioController...\n";
    std::cerr << "[MAIN] DEBUG: Creating RadioController with pluto_uri=" << cfg.pluto_uri
              << ", freq_mhz=" << cfg.freq_mhz << ", sample_rate_hz=" << cfg.sample_rate_hz << "\n";
    LOG_INFO("main", "RadioController initialization starting", "{}");

    std::unique_ptr<RadioController> radio_controller;
    try {
        std::cerr << "[MAIN] DEBUG: Calling RadioController constructor\n";
        radio_controller = std::make_unique<RadioController>(
            cfg.pluto_uri,
            cfg.freq_mhz,
            cfg.sample_rate_hz
        );
        std::cerr << "[MAIN] DEBUG: RadioController constructor completed\n";

        std::cerr << "[MAIN] DEBUG: Setting RadioController parameters\n";
        radio_controller->set_lnb_offset(cfg.lnb_offset_mhz);
        std::cerr << "[MAIN] DEBUG: LNB offset set to " << cfg.lnb_offset_mhz << " MHz\n";

        radio_controller->set_rx_gain(cfg.rx_gain_db);
        std::cerr << "[MAIN] DEBUG: RX gain set to " << cfg.rx_gain_db << " dB\n";

        radio_controller->set_tx_gain(cfg.tx_gain_db);
        std::cerr << "[MAIN] DEBUG: TX gain set to " << cfg.tx_gain_db << " dB\n";

        radio_controller->set_log_level(cfg.log_level);
        std::cerr << "[MAIN] DEBUG: Log level set to " << cfg.log_level << "\n";

        // Set modem scheme from config string using liquid-dsp's string parser
        std::cerr << "[MAIN] DEBUG: Converting modem scheme string '" << cfg.modem_scheme << "' to enum\n";
        modulation_scheme modem_enum = string_to_modem_scheme(cfg.modem_scheme);
        std::cerr << "[MAIN] DEBUG: Modem scheme enum=" << static_cast<int>(modem_enum) << "\n";
        radio_controller->set_modem_scheme(static_cast<int>(modem_enum));
        std::cerr << "[MAIN] DEBUG: Modem scheme set\n";

        LOG_INFO("main", "RadioController created successfully",
                 "{\"rx_gain_db\": " + std::to_string(cfg.rx_gain_db) +
                 ", \"tx_gain_db\": " + std::to_string(cfg.tx_gain_db) + "}");

        std::cout << "[MAIN] RadioController created successfully\n";
        std::cerr << "[MAIN] DEBUG: RadioController creation SUCCESSFUL\n";
    } catch (const std::exception& e) {
        std::cerr << "[MAIN] DEBUG: RadioController creation FAILED with exception\n";
        LOG_ERROR("main", "RadioController creation failed",
                  "{\"error\": \"" + std::string(e.what()) + "\"}");
        std::cerr << "[ERROR] Failed to create RadioController: " << e.what() << "\n";
        return 1;
    }

    // ========================================================================
    // Step 3: Initialize WebSocket Server (Telemetry & UI)
    // ========================================================================
    std::cout << "[MAIN] Creating WebSocket server...\n";
    std::cerr << "[MAIN] DEBUG: Creating WebSocket server on port 40134\n";
    LOG_INFO("ws", "WebSocket server initialization starting", "{\"port\": 40134}");

    std::unique_ptr<WsServer> ws_server;
    try {
        std::cerr << "[MAIN] DEBUG: Calling WsServer constructor\n";
        ws_server = std::make_unique<WsServer>(radio_controller.get(), 40134);
        std::cerr << "[MAIN] DEBUG: WsServer constructor completed\n";

        LOG_INFO("ws", "WebSocket server created successfully", "{\"port\": 40134}");
        std::cout << "[MAIN] WebSocket server created successfully\n";
        std::cerr << "[MAIN] DEBUG: WebSocket server creation SUCCESSFUL\n";
    } catch (const std::exception& e) {
        std::cerr << "[MAIN] DEBUG: WebSocket server creation FAILED with exception\n";
        LOG_ERROR("ws", "WebSocket server creation failed",
                  "{\"error\": \"" + std::string(e.what()) + "\"}");
        std::cerr << "[ERROR] Failed to create WebSocket server: " << e.what() << "\n";
        return 1;
    }

    // Connect RadioController to WsServer for waterfall telemetry
    std::cerr << "[MAIN] DEBUG: Connecting RadioController to WsServer\n";
    radio_controller->set_ws_server(ws_server.get());
    std::cout << "[MAIN] RadioController connected to WebSocket server for waterfall\n";
    std::cerr << "[MAIN] DEBUG: RadioController connected to WsServer\n";

    // ========================================================================
    // Step 4: Initialize CSMA Protocol (Multi-node Access)
    // ========================================================================
    std::cout << "[MAIN] Creating CSMA protocol handler...\n";
    std::cerr << "[MAIN] DEBUG: Creating CSMA with freq_mhz=" << cfg.freq_mhz << "\n";
    LOG_INFO("csma", "CSMA protocol initialization starting",
             "{\"freq_mhz\": " + std::to_string(cfg.freq_mhz) +
             ", \"rssi_threshold_db\": -90.0, \"backoff_slot_ms\": 100, \"max_backoff_ms\": 3200}");

    std::unique_ptr<CSMA> csma;
    try {
        std::cerr << "[MAIN] DEBUG: Calling CSMA constructor\n";
        csma = std::make_unique<CSMA>(
            cfg.freq_mhz,
            -90.0f,   // RSSI threshold (dB)
            100,      // Backoff slot (ms)
            3200      // Max backoff (ms)
        );
        std::cerr << "[MAIN] DEBUG: CSMA constructor completed\n";

        LOG_INFO("csma", "CSMA protocol initialized", "{}");
        std::cout << "[MAIN] CSMA protocol initialized\n";
        std::cerr << "[MAIN] DEBUG: CSMA initialization SUCCESSFUL\n";
    } catch (const std::exception& e) {
        std::cerr << "[MAIN] DEBUG: CSMA initialization FAILED with exception\n";
        LOG_ERROR("csma", "CSMA initialization failed",
                  "{\"error\": \"" + std::string(e.what()) + "\"}");
        std::cerr << "[ERROR] Failed to create CSMA: " << e.what() << "\n";
        return 1;
    }

    // ========================================================================
    // Step 5: Start RadioController (Spawn RX/TX/UDP Threads)
    // ========================================================================
    std::cout << "[MAIN] Starting RadioController...\n";
    std::cerr << "[MAIN] DEBUG: Calling radio_controller->start()\n";
    LOG_INFO("main", "RadioController start requested", "{}");

    if (!radio_controller->start()) {
        std::cerr << "[MAIN] DEBUG: radio_controller->start() FAILED\n";
        LOG_ERROR("main", "RadioController start failed", "{}");
        std::cerr << "[ERROR] Failed to start RadioController\n";
        return 1;
    }

    std::cerr << "[MAIN] DEBUG: radio_controller->start() SUCCESSFUL\n";
    LOG_INFO("main", "RadioController started successfully", "{}");
    std::cout << "[MAIN] RadioController started successfully\n";

    // ========================================================================
    // Step 6: Start WebSocket Server (Spawn Listener Thread)
    // ========================================================================
    std::cout << "[MAIN] Starting WebSocket server...\n";
    std::cerr << "[MAIN] DEBUG: Calling ws_server->start()\n";
    LOG_INFO("ws", "WebSocket server start requested", "{\"port\": 40134}");

    if (!ws_server->start()) {
        std::cerr << "[MAIN] DEBUG: ws_server->start() FAILED\n";
        LOG_ERROR("ws", "WebSocket server start failed", "{\"port\": 40134}");
        std::cerr << "[ERROR] Failed to start WebSocket server\n";
        radio_controller->stop();
        return 1;
    }

    std::cerr << "[MAIN] DEBUG: ws_server->start() SUCCESSFUL\n";
    LOG_INFO("ws", "WebSocket server listening", "{\"port\": 40134}");
    std::cout << "[MAIN] WebSocket server listening on port 40134\n";
    std::cerr << "[MAIN] DEBUG: WebSocket server listening on port 40134\n";

    std::cout << "\n[MAIN] ═══════════════════════════════════════════════════════════\n";
    std::cout << "[MAIN] Initialization complete. System ready for operation.\n";
    std::cout << "[MAIN] Connect WebSocket client to ws://localhost:40134/\n";
    std::cout << "[MAIN] Press Ctrl+C to shutdown gracefully.\n";
    std::cout << "[MAIN] ═══════════════════════════════════════════════════════════\n\n";

    LOG_INFO("main", "System initialization complete and ready for operation",
             "{\"ws_port\": 40134, \"status\": \"ready\"}");

    // ========================================================================
    // Step 7: Main Event Loop with Signal Handling
    // ========================================================================
    auto startup_time = std::chrono::steady_clock::now();
    int loop_count = 0;

    while (!shutdown_requested) {
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - startup_time
        );

        // Print status every 1 second (10 * 100ms)
        if (loop_count % 10 == 0) {
            RadioStats stats = radio_controller->get_stats();

            std::cout << "[RADIO] ";
            std::cout << std::fixed << std::setprecision(1);
            std::cout << "RSSI: " << std::setw(6) << stats.rx_rssi_db << " dB | ";
            std::cout << "SNR: " << std::setw(6) << stats.rx_snr_db << " dB | ";
            std::cout << "Lock: " << std::setw(12) << std::left
                      << beacon_lock_state_to_string(stats.beacon_lock_state)
                      << std::right << " | ";
            std::cout << "Queue: " << stats.tx_queue_depth << " frames\n";
            std::cout.flush();

            // Build and publish WebSocket metrics frame
            WsServer::MetricsFrame metrics;
            metrics.timestamp_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            metrics.rssi_db = stats.rx_rssi_db;
            metrics.snr_db = stats.rx_snr_db;
            metrics.evm_db = stats.rx_evm_db;
            metrics.beacon_lock_state = beacon_lock_state_to_string(stats.beacon_lock_state);
            metrics.beacon_phase_error_deg = stats.beacon_lock_phase_error_deg;
            metrics.beacon_lock_age_sec = stats.beacon_lock_age_ms / 1000.0f;
            metrics.rx_frame_count = stats.rx_frame_count;
            metrics.rx_error_count = stats.rx_error_count;
            metrics.tx_queue_depth = static_cast<uint16_t>(stats.tx_queue_depth);
            metrics.ptt_state = false;
            metrics.modem_scheme = cfg.modem_scheme;
            metrics.center_freq_mhz = radio_controller->get_center_freq_mhz();
            metrics.tx_freq_hz = static_cast<uint32_t>(radio_controller->get_tx_freq_hz());
            metrics.rx_gain_db = cfg.rx_gain_db;
            metrics.tx_gain_db = cfg.tx_gain_db;
            metrics.sample_rate_mhz = cfg.sample_rate_hz / 1e6f;

            // Populate extended metrics
            metrics.signal_detected = stats.rx_rssi_db > -100.0f;
            metrics.frame_sync = stats.rx_frame_count > 0;
            metrics.rit_offset_hz = radio_controller->get_rit_offset();
            metrics.xit_offset_hz = radio_controller->get_xit_offset();

            // Populate SDR hardware info from RadioController
            metrics.sdr_connected = radio_controller->is_sdr_hw_connected();
            if (metrics.sdr_connected) {
                auto sdr_info = radio_controller->get_sdr_info();
                metrics.sdr_hw_model = sdr_info.hw_model;
                metrics.sdr_fw_version = sdr_info.fw_version;
                metrics.sdr_serial = sdr_info.serial;
            }

            ws_server->publish_metrics(metrics);

            // Log statistics every 10 seconds (100 * 100ms)
            if (loop_count % 100 == 0) {
                LOG_INFO("radio", "RX statistics update",
                         "{\"rssi_db\": " + std::to_string(stats.rx_rssi_db) +
                         ", \"snr_db\": " + std::to_string(stats.rx_snr_db) +
                         ", \"evm_db\": " + std::to_string(stats.rx_evm_db) +
                         ", \"frame_count\": " + std::to_string(stats.rx_frame_count) +
                         ", \"error_count\": " + std::to_string(stats.rx_error_count) +
                         ", \"beacon_lock_state\": \"" + std::string(beacon_lock_state_to_string(stats.beacon_lock_state)) +
                         "\", \"phase_error_deg\": " + std::to_string(stats.beacon_lock_phase_error_deg) +
                         ", \"freq_error_hz\": " + std::to_string(stats.beacon_lock_freq_error_hz) +
                         ", \"tx_queue_depth\": " + std::to_string(stats.tx_queue_depth) +
                         ", \"beacon_lock_age_ms\": " + std::to_string(stats.beacon_lock_age_ms) + "}");
            }
        }

        // Sleep 100 ms between checks
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        loop_count++;

        // Check if shutdown was requested
        if (shutdown_requested) {
            break;
        }
    }

    // ========================================================================
    // Step 8: Graceful Shutdown
    // ========================================================================
    std::cout << "\n[MAIN] ═══════════════════════════════════════════════════════════\n";
    std::cout << "[MAIN] Shutdown initiated - gracefully stopping all components...\n";
    std::cout << "[MAIN] ═══════════════════════════════════════════════════════════\n\n";

    LOG_INFO("main", "Graceful shutdown initiated", "{}");

    // Stop WebSocket server first (closes client connections)
    std::cout << "[MAIN] Stopping WebSocket server...\n";
    LOG_INFO("ws", "WebSocket server shutdown requested", "{\"port\": 40134}");
    if (ws_server) {
        ws_server->stop();
    }
    LOG_INFO("ws", "WebSocket server stopped", "{}");
    std::cout << "[MAIN] WebSocket server stopped\n";

    // Stop RadioController (stops RX/TX/UDP threads)
    std::cout << "[MAIN] Stopping RadioController...\n";
    LOG_INFO("main", "RadioController shutdown requested", "{}");
    if (radio_controller) {
        radio_controller->stop();
    }
    LOG_INFO("main", "RadioController stopped", "{}");
    std::cout << "[MAIN] RadioController stopped\n";

    // CSMA will be cleaned up automatically (unique_ptr destructor)
    std::cout << "[MAIN] CSMA cleanup\n";
    LOG_INFO("csma", "CSMA cleanup complete", "{}");

    // HwPlutoSDR will be cleaned up automatically (unique_ptr destructor)
    std::cout << "[MAIN] PlutoSDR cleanup\n";
    LOG_INFO("hw", "PlutoSDR cleanup complete", "{}");

    LOG_INFO("main", "Graceful shutdown complete", "{\"exit_code\": 0}");
    std::cout << "\n[MAIN] Shutdown complete. Exiting.\n\n";

    // Cleanup logger
    if (g_logger) {
        delete g_logger;
        g_logger = nullptr;
    }

    return 0;
}
