# Copyright (c) 2025 BitLink21 Contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.


import logging
import time
from typing import Any, Dict

import numpy as np
import psutil

logger = logging.getLogger("plutosdr-worker")

# Target blocks per second for constant rate streaming (matches SoapySDR worker)
TARGET_BLOCKS_PER_SEC = 15

# AD9361 hardware limits
FREQ_MIN_HZ = 70e6
FREQ_MAX_HZ = 6000e6
RX_GAIN_MIN_DB = -1.0
RX_GAIN_MAX_DB = 73.0
TX_GAIN_MIN_DB = -89.75  # PlutoSDR TX gain is negative (attenuation)
TX_GAIN_MAX_DB = 0.0
SAMPLE_RATE_MIN_HZ = 520833  # ~521 kSPS
SAMPLE_RATE_MAX_HZ = 61440000  # 61.44 MSPS with firmware unlock

# Default RX buffer size in samples
DEFAULT_RX_BUFFER_SIZE = 65536


def calculate_samples_per_scan(sample_rate: float, fft_size: int) -> int:
    """Calculate number of samples per scan for constant block rate streaming.

    Matches the logic in soapysdrlocalworker.py for consistent behavior
    across SDR backends.
    """
    if fft_size is None:
        fft_size = 8192

    num_samples = int(sample_rate / TARGET_BLOCKS_PER_SEC)
    # Round up to next power of 2 for efficient FFT processing
    num_samples = 2 ** int(np.ceil(np.log2(max(num_samples, 1))))
    # Use fft_size as floor
    num_samples = max(num_samples, fft_size)
    # Cap at reasonable maximum (1M samples)
    num_samples = min(num_samples, 1048576)
    return num_samples


def remove_dc_offset(samples: np.ndarray) -> np.ndarray:
    """Remove DC offset by subtracting the mean of I and Q components."""
    mean_val = np.mean(samples)
    return samples - mean_val




def _configure_pluto(sdr, config: Dict[str, Any]) -> None:
    """Apply full configuration to a PlutoSDR device.

    Args:
        sdr: adi.Pluto device instance
        config: Configuration dictionary with SDR parameters
    """
    channel = config.get("channel", 0)
    center_freq = config.get("center_freq", 100e6)
    sample_rate = config.get("sample_rate", 2.048e6)
    rx_gain = config.get("gain", 40.0)
    rx_rf_bandwidth = config.get("rx_rf_bandwidth", 0)
    tx_rf_bandwidth = config.get("tx_rf_bandwidth", 0)
    tx_gain = config.get("tx_gain", -10)
    rx_buffer_size = config.get("rx_buffer_size", DEFAULT_RX_BUFFER_SIZE)
    agc_mode = config.get("gain_control_mode", "manual")

    # LNB offset for satellite downconversion (e.g., 9750 MHz for QO-100)
    lnb_offset = config.get("lnb_offset", 0)

    # Apply LNB offset: actual PlutoSDR LO = desired RF freq - LNB offset
    actual_rx_freq = int(center_freq - lnb_offset)
    actual_tx_freq = int(center_freq - lnb_offset)

    # If separate TX frequency is provided, use it
    if "tx_freq" in config:
        actual_tx_freq = int(config["tx_freq"] - lnb_offset)

    # Sample rate (common for RX and TX on AD9361)
    sdr.sample_rate = int(sample_rate)
    logger.info(f"Sample rate set to {sample_rate / 1e6:.3f} MHz")

    # RX LO frequency
    sdr.rx_lo = actual_rx_freq
    logger.info(
        f"RX LO set to {actual_rx_freq / 1e6:.3f} MHz "
        f"(RF: {center_freq / 1e6:.3f} MHz, LNB offset: {lnb_offset / 1e6:.3f} MHz)"
    )

    # TX LO frequency
    sdr.tx_lo = actual_tx_freq
    logger.info(f"TX LO set to {actual_tx_freq / 1e6:.3f} MHz")

    # RX RF bandwidth (analog filter)
    if rx_rf_bandwidth > 0:
        sdr.rx_rf_bandwidth = int(rx_rf_bandwidth)
        logger.info(f"RX RF bandwidth set to {rx_rf_bandwidth / 1e3:.1f} kHz")

    # TX RF bandwidth (analog filter)
    if tx_rf_bandwidth > 0:
        sdr.tx_rf_bandwidth = int(tx_rf_bandwidth)
        logger.info(f"TX RF bandwidth set to {tx_rf_bandwidth / 1e3:.1f} kHz")

    # RX gain control mode and gain
    sdr.gain_control_mode_chan0 = agc_mode
    if agc_mode == "manual":
        sdr.rx_hardwaregain_chan0 = float(rx_gain)
        logger.info(f"RX gain set to {rx_gain} dB (manual mode)")
    else:
        logger.info(f"RX gain control mode: {agc_mode}")

    # TX attenuation (negative dB on PlutoSDR)
    sdr.tx_hardwaregain_chan0 = float(tx_gain)
    logger.info(f"TX gain set to {tx_gain} dB")

    # RX buffer size
    sdr.rx_buffer_size = int(rx_buffer_size)
    logger.info(f"RX buffer size set to {rx_buffer_size} samples")

    # XO correction (crystal oscillator frequency adjustment)
    xo_correction = config.get("xo_correction", None)
    if xo_correction is not None:
        try:
            sdr._ctrl.attrs["xo_correction"].value = str(int(xo_correction))
            logger.info(f"XO correction set to {xo_correction} Hz")
        except Exception as e:
            logger.warning(f"Failed to set XO correction: {e}")


def plutosdr_worker_process(
    config_queue,
    data_queue,
    stop_event,
    iq_queue_fft=None,
    iq_queue_demod=None,
    tx_queue=None,
):
    """Worker process for PlutoSDR (ADALM-PLUTO) using pyadi-iio.

    This function runs in a separate process to handle PlutoSDR I/Q streaming.
    It receives configuration through a queue, streams RX IQ data to FFT and
    demodulation queues, handles TX from a transmit queue, and sends status/error
    messages through data_queue.

    The PlutoSDR operates in FDD (Full Duplex) mode, so TX and RX run
    simultaneously on independent LOs.

    Args:
        config_queue: Queue for receiving configuration from the main process
        data_queue: Queue for sending status/error messages back to the main process
        stop_event: multiprocessing.Event to signal the process to stop
        iq_queue_fft: Queue for streaming raw IQ samples to FFT processor (waterfall)
        iq_queue_demod: Queue for streaming raw IQ samples to demodulators
        tx_queue: Queue for outbound TX IQ sample buffers (SSP frames)
    """
    sdr = None
    sdr_id = None
    client_id = None
    config = {}

    logger.info("PlutoSDR worker process started")

    try:
        # Import adi here so import errors are caught gracefully in-process
        try:
            import adi
        except ImportError as e:
            error_msg = (
                f"pyadi-iio is not installed. Install with: pip install pyadi-iio. Error: {e}"
            )
            logger.error(error_msg)
            data_queue.put(
                {
                    "type": "error",
                    "client_id": None,
                    "message": error_msg,
                    "timestamp": time.time(),
                }
            )
            return

        # Wait for initial configuration
        logger.info("Waiting for initial configuration...")
        config = config_queue.get()
        logger.info(f"Initial configuration received: {config}")

        new_config = config
        old_config = config

        sdr_id = config.get("sdr_id")
        client_id = config.get("client_id")
        fft_size = config.get("fft_size", 16384)
        fft_window = config.get("fft_window", "hanning")
        fft_averaging = config.get("fft_averaging", 6)
        fft_overlap = config.get("fft_overlap", False)

        has_iq_consumers = iq_queue_fft is not None or iq_queue_demod is not None

        # PlutoSDR connection URI
        uri = config.get("uri", config.get("pluto_uri", "ip:192.168.1.200"))
        logger.info(f"Connecting to PlutoSDR at {uri}")

        # Create the PlutoSDR device instance
        try:
            sdr = adi.Pluto(uri=uri)
            logger.info(f"Connected to PlutoSDR at {uri}")
        except Exception as e:
            error_msg = f"Failed to connect to PlutoSDR at {uri}: {e}"
            logger.error(error_msg)
            raise

        # Apply initial configuration
        _configure_pluto(sdr, config)

        sample_rate = sdr.sample_rate
        center_freq = config.get("center_freq", 100e6)
        num_samples = calculate_samples_per_scan(sample_rate, fft_size)

        # Signal to the main process that streaming has started
        data_queue.put(
            {
                "type": "streamingstart",
                "client_id": client_id,
                "message": None,
                "timestamp": time.time(),
            }
        )

        # Performance monitoring stats
        stats: Dict[str, Any] = {
            "samples_read": 0,
            "iq_chunks_out": 0,
            "read_errors": 0,
            "queue_drops": 0,
            "tx_frames_sent": 0,
            "tx_errors": 0,
            "last_activity": None,
            "errors": 0,
            "cpu_percent": 0.0,
            "memory_mb": 0.0,
            "memory_percent": 0.0,
        }
        last_stats_send = time.time()
        stats_send_interval = 1.0

        # CPU and memory monitoring
        process = psutil.Process()
        last_cpu_check = time.time()
        cpu_check_interval = 0.5

        # ----------------------------------------------------------------
        # QO-100 Streaming DSP (GNU Radio flowgraph — runs in this process)
        # ----------------------------------------------------------------
        qo100_flowgraph = None
        try:
            from dsp.streaming_flowgraph import StreamingRXFlowgraph, GR_AVAILABLE
            if GR_AVAILABLE:
                logger.info("GNU Radio streaming DSP available in PlutoSDR worker")
            else:
                logger.info("GNU Radio not available — QO-100 streaming DSP disabled")
        except ImportError:
            GR_AVAILABLE = False
            logger.info("DSP module not available")

        # ----------------------------------------------------------------
        # Beacon tracking — simple two-state: measuring + correcting
        # Matches QO100_Transceiver UX: position markers, then lock
        # ----------------------------------------------------------------
        beacon_active = False        # Markers visible, measuring drift
        beacon_correcting = False    # Actively correcting RX frequency
        beacon_freq = 0.0            # User-set beacon center frequency (IF Hz)
        beacon_marker_low = 0.0      # Search range low (IF)
        beacon_marker_high = 0.0     # Search range high (IF)
        beacon_offset_hz = 0.0       # Measured drift from beacon_freq
        beacon_last_update = 0.0
        beacon_update_interval = 1.0 # 1 second between measurements

        # ----------------------------------------------------------------
        # Main processing loop
        # ----------------------------------------------------------------
        while not stop_event.is_set():
            current_time = time.time()

            # Update CPU and memory usage periodically
            if current_time - last_cpu_check >= cpu_check_interval:
                try:
                    stats["cpu_percent"] = process.cpu_percent()
                    mem_info = process.memory_info()
                    stats["memory_mb"] = mem_info.rss / (1024 * 1024)
                    stats["memory_percent"] = process.memory_percent()
                    last_cpu_check = current_time
                except Exception as e:
                    logger.debug(f"Error updating CPU/memory usage: {e}")

            # Send stats periodically
            if current_time - last_stats_send >= stats_send_interval:
                data_queue.put(
                    {
                        "type": "stats",
                        "client_id": client_id,
                        "sdr_id": sdr_id,
                        "stats": stats.copy(),
                        "timestamp": current_time,
                    }
                )
                last_stats_send = current_time

            # --------------------------------------------------------
            # Handle configuration updates (non-blocking)
            # --------------------------------------------------------
            try:
                if not config_queue.empty():
                    new_config = config_queue.get_nowait()

                    if "sample_rate" in new_config:
                        if sample_rate != new_config["sample_rate"]:
                            sdr.sample_rate = int(new_config["sample_rate"])
                            sample_rate = sdr.sample_rate
                            num_samples = calculate_samples_per_scan(sample_rate, fft_size)
                            logger.info(f"Updated sample rate: {sample_rate / 1e6:.3f} MHz")

                    if "center_freq" in new_config:
                        if center_freq != new_config["center_freq"]:
                            center_freq = new_config["center_freq"]
                            lnb_offset = new_config.get(
                                "lnb_offset", old_config.get("lnb_offset", 0)
                            )
                            sdr.rx_lo = int(center_freq - lnb_offset)
                            logger.info(
                                f"Updated RX LO: {sdr.rx_lo / 1e6:.3f} MHz "
                                f"(RF: {center_freq / 1e6:.3f} MHz)"
                            )

                    if "tx_freq" in new_config:
                        lnb_offset = new_config.get(
                            "lnb_offset", old_config.get("lnb_offset", 0)
                        )
                        sdr.tx_lo = int(new_config["tx_freq"] - lnb_offset)
                        logger.info(f"Updated TX LO: {sdr.tx_lo / 1e6:.3f} MHz")

                    if "gain" in new_config:
                        agc_mode = new_config.get(
                            "gain_control_mode",
                            old_config.get("gain_control_mode", "manual"),
                        )
                        if agc_mode == "manual":
                            sdr.rx_hardwaregain_chan0 = float(new_config["gain"])
                            logger.info(f"Updated RX gain: {new_config['gain']} dB")

                    if "gain_control_mode" in new_config:
                        if old_config.get("gain_control_mode") != new_config["gain_control_mode"]:
                            sdr.gain_control_mode_chan0 = new_config["gain_control_mode"]
                            logger.info(
                                f"Updated gain control mode: {new_config['gain_control_mode']}"
                            )
                            if new_config["gain_control_mode"] == "manual" and "gain" in new_config:
                                sdr.rx_hardwaregain_chan0 = float(new_config["gain"])

                    if "tx_gain" in new_config:
                        if old_config.get("tx_gain") != new_config["tx_gain"]:
                            sdr.tx_hardwaregain_chan0 = float(new_config["tx_gain"])
                            logger.info(f"Updated TX gain: {new_config['tx_gain']} dB")

                    if "rx_rf_bandwidth" in new_config:
                        if old_config.get("rx_rf_bandwidth") != new_config["rx_rf_bandwidth"]:
                            sdr.rx_rf_bandwidth = int(new_config["rx_rf_bandwidth"])
                            logger.info(
                                f"Updated RX RF bandwidth: "
                                f"{new_config['rx_rf_bandwidth'] / 1e3:.1f} kHz"
                            )

                    if "tx_rf_bandwidth" in new_config:
                        if old_config.get("tx_rf_bandwidth") != new_config["tx_rf_bandwidth"]:
                            sdr.tx_rf_bandwidth = int(new_config["tx_rf_bandwidth"])
                            logger.info(
                                f"Updated TX RF bandwidth: "
                                f"{new_config['tx_rf_bandwidth'] / 1e3:.1f} kHz"
                            )

                    if "rx_buffer_size" in new_config:
                        if old_config.get("rx_buffer_size") != new_config["rx_buffer_size"]:
                            sdr.rx_buffer_size = int(new_config["rx_buffer_size"])
                            logger.info(
                                f"Updated RX buffer size: {new_config['rx_buffer_size']} samples"
                            )

                    if "fft_size" in new_config:
                        if old_config.get("fft_size", 0) != new_config["fft_size"]:
                            fft_size = new_config["fft_size"]
                            num_samples = calculate_samples_per_scan(sample_rate, fft_size)
                            logger.info(
                                f"Updated FFT size: {fft_size}, num_samples: {num_samples}"
                            )

                    if "fft_window" in new_config:
                        if old_config.get("fft_window") != new_config["fft_window"]:
                            fft_window = new_config["fft_window"]
                            logger.info(f"Updated FFT window: {fft_window}")

                    if "fft_averaging" in new_config:
                        if old_config.get("fft_averaging", 4) != new_config["fft_averaging"]:
                            fft_averaging = new_config["fft_averaging"]
                            logger.info(f"Updated FFT averaging: {fft_averaging}")

                    if "fft_overlap" in new_config:
                        if old_config.get("fft_overlap", True) != new_config["fft_overlap"]:
                            fft_overlap = new_config["fft_overlap"]
                            logger.info(f"Updated FFT overlap: {fft_overlap}")

                    if "lnb_offset" in new_config:
                        if old_config.get("lnb_offset", 0) != new_config["lnb_offset"]:
                            lnb_offset = new_config["lnb_offset"]
                            # Re-apply center frequency with new LNB offset
                            sdr.rx_lo = int(center_freq - lnb_offset)
                            logger.info(
                                f"Updated LNB offset: {lnb_offset / 1e6:.3f} MHz, "
                                f"RX LO now: {sdr.rx_lo / 1e6:.3f} MHz"
                            )

                    if "xo_correction" in new_config:
                        if old_config.get("xo_correction") != new_config["xo_correction"]:
                            try:
                                sdr._ctrl.attrs["xo_correction"].value = str(
                                    int(new_config["xo_correction"])
                                )
                                logger.info(
                                    f"Updated XO correction: {new_config['xo_correction']} Hz"
                                )
                            except Exception as e:
                                logger.warning(f"Failed to set XO correction: {e}")

                    # QO-100 streaming DSP commands
                    if "qo100_start" in new_config and GR_AVAILABLE:
                        try:
                            qo100_flowgraph = StreamingRXFlowgraph(
                                sample_rate=sample_rate,
                                center_freq=center_freq,
                            )
                            # Set filter/modulation from config
                            if "qo100_filter_bw" in new_config:
                                qo100_flowgraph.filter_bw = new_config["qo100_filter_bw"]
                            if "qo100_modulation" in new_config:
                                qo100_flowgraph.modulation = new_config["qo100_modulation"]
                            if "qo100_baudrate" in new_config:
                                qo100_flowgraph.baudrate = new_config["qo100_baudrate"]

                            # Wire callbacks to data_queue so data reaches Socket.IO
                            def _on_constellation(points):
                                try:
                                    data_queue.put({
                                        "type": "constellation_data",
                                        "points": points,
                                    })
                                except Exception:
                                    pass

                            def _on_decoded(frame_bytes):
                                try:
                                    data_queue.put({
                                        "type": "decoded_frame",
                                        "data": frame_bytes.hex(),
                                        "length": len(frame_bytes),
                                    })
                                except Exception:
                                    pass

                            qo100_flowgraph.on_constellation = _on_constellation
                            qo100_flowgraph.on_decoded = _on_decoded
                            # Audio goes to existing demod audio path (via audio_queue if needed)

                            qo100_flowgraph.start()
                            logger.info("QO-100 streaming DSP started in PlutoSDR worker")
                        except Exception as e:
                            logger.error(f"QO-100 DSP start failed: {e}")
                            qo100_flowgraph = None

                    if "qo100_stop" in new_config:
                        if qo100_flowgraph:
                            qo100_flowgraph.stop()
                            qo100_flowgraph = None
                            logger.info("QO-100 streaming DSP stopped")

                    if "qo100_set_filter" in new_config and qo100_flowgraph:
                        qo100_flowgraph.set_filter_bandwidth(new_config.get("bandwidth", 3600))

                    if "qo100_set_modulation" in new_config and qo100_flowgraph:
                        qo100_flowgraph.set_modulation(
                            new_config.get("modulation", "qpsk"),
                            new_config.get("baudrate")
                        )

                    # BitLink21 beacon commands (two-step: position then lock)
                    if "beacon_set_position" in new_config:
                        # Step 1: Show markers, start measuring drift (no correction)
                        beacon_active = True
                        beacon_correcting = False
                        beacon_freq = new_config.get("beacon_freq", center_freq)
                        beacon_marker_low = new_config.get("marker_low", beacon_freq - 2500)
                        beacon_marker_high = new_config.get("marker_high", beacon_freq + 2500)
                        beacon_offset_hz = 0.0
                        logger.info(
                            f"Beacon positioned: freq={beacon_freq/1e6:.3f} MHz, "
                            f"range=[{beacon_marker_low/1e6:.6f}, {beacon_marker_high/1e6:.6f}] MHz"
                        )

                    if "beacon_lock" in new_config:
                        # Step 2: Start correcting (requires beacon_active)
                        if beacon_active:
                            beacon_correcting = True
                            logger.info("Beacon lock engaged — correcting drift")

                    if "beacon_unlock" in new_config:
                        # Stop correcting but keep measuring
                        beacon_correcting = False
                        logger.info("Beacon unlocked — still measuring")

                    if "beacon_stop" in new_config:
                        beacon_active = False
                        beacon_correcting = False
                        beacon_offset_hz = 0.0
                        logger.info("Beacon stopped")
                        data_queue.put({
                            "type": "beacon_status",
                            "measuring": False,
                            "correcting": False,
                            "offset_hz": 0.0,
                        })

                    if "beacon_config" in new_config:
                        beacon_marker_low = new_config.get("marker_low", beacon_marker_low)
                        beacon_marker_high = new_config.get("marker_high", beacon_marker_high)
                        if "beacon_freq" in new_config and new_config["beacon_freq"]:
                            beacon_freq = new_config["beacon_freq"]
                            beacon_offset_hz = 0.0
                            logger.info(f"Beacon freq repositioned to {beacon_freq/1e6:.3f} MHz")

                    # BitLink21 test tone command
                    if "test_tone_start" in new_config:
                        try:
                            tone_freq = new_config.get("tone_freq_hz", 1000)
                            tone_gain = new_config.get("tone_gain_db", -20)
                            num_tone_samples = int(sample_rate * 0.1)  # 100ms of samples
                            t = np.arange(num_tone_samples) / sample_rate
                            tone_iq = np.exp(1j * 2 * np.pi * tone_freq * t)
                            tone_iq = tone_iq * (2**14 - 1) * 0.8
                            sdr.tx_hardwaregain_chan0 = tone_gain
                            sdr.tx_cyclic_buffer = True
                            sdr.tx(tone_iq.astype(np.complex64))
                            logger.info(f"Test tone started: {tone_freq} Hz, gain={tone_gain} dB")
                        except Exception as e:
                            logger.error(f"Test tone failed: {e}")

                    if "test_tone_stop" in new_config:
                        try:
                            sdr.tx_destroy_buffer()
                            sdr.tx_cyclic_buffer = False
                            logger.info("Test tone stopped")
                        except Exception as e:
                            logger.warning(f"Test tone stop failed: {e}")

                    old_config = new_config

            except Exception as e:
                error_msg = f"Error processing configuration: {e}"
                logger.error(error_msg)
                logger.exception(e)
                data_queue.put(
                    {
                        "type": "error",
                        "client_id": client_id,
                        "message": error_msg,
                        "timestamp": time.time(),
                    }
                )

            # --------------------------------------------------------
            # RX: Read IQ samples from PlutoSDR
            # --------------------------------------------------------
            try:
                # sdr.rx() returns a complex64 numpy array
                samples = sdr.rx()

                if samples is not None and len(samples) > 0:
                    stats["samples_read"] += len(samples)
                    stats["last_activity"] = time.time()

                    # Normalize to float32 complex if needed (pyadi-iio
                    # typically returns complex64 already, but ensure dtype)
                    if samples.dtype != np.complex64:
                        samples = samples.astype(np.complex64)

                    # Remove DC offset spike
                    samples = remove_dc_offset(samples)

                    # Feed QO-100 streaming DSP (if active)
                    if qo100_flowgraph is not None and qo100_flowgraph.running:
                        qo100_flowgraph.push_iq(samples)

                    # Broadcast IQ data to consumer queues
                    if has_iq_consumers:
                        timestamp = time.time()

                        # FFT queue (for waterfall display)
                        if iq_queue_fft is not None:
                            try:
                                if not iq_queue_fft.full():
                                    iq_message = {
                                        "samples": samples.copy(),
                                        "center_freq": center_freq,
                                        "sample_rate": sample_rate,
                                        "timestamp": timestamp,
                                        "config": {
                                            "fft_size": fft_size,
                                            "fft_window": fft_window,
                                            "fft_averaging": fft_averaging,
                                            "fft_overlap": fft_overlap,
                                        },
                                    }
                                    iq_queue_fft.put_nowait(iq_message)
                                    stats["iq_chunks_out"] += 1
                                else:
                                    stats["queue_drops"] += 1
                            except Exception:
                                stats["queue_drops"] += 1

                        # Demodulation queue
                        if iq_queue_demod is not None:
                            try:
                                if not iq_queue_demod.full():
                                    demod_message = {
                                        "samples": samples.copy(),
                                        "center_freq": center_freq,
                                        "sample_rate": sample_rate,
                                        "timestamp": timestamp,
                                    }
                                    iq_queue_demod.put_nowait(demod_message)
                                    stats["iq_chunks_out"] += 1
                                else:
                                    stats["queue_drops"] += 1
                            except Exception:
                                stats["queue_drops"] += 1

            except Exception as e:
                logger.error(f"Error reading RX samples: {e}")
                stats["read_errors"] += 1
                stats["errors"] += 1

                data_queue.put(
                    {
                        "type": "error",
                        "client_id": client_id,
                        "message": f"RX error: {e}",
                        "timestamp": time.time(),
                    }
                )
                # Brief pause before retrying to avoid tight error loops
                time.sleep(0.1)

            # --------------------------------------------------------
            # Beacon tracking — simple FFT peak measurement
            # Two states: measuring (display drift) + correcting (nudge RX)
            # --------------------------------------------------------
            if (beacon_active and samples is not None and len(samples) > 0
                    and beacon_freq and current_time - beacon_last_update >= beacon_update_interval):
                beacon_last_update = current_time
                try:
                    # Simple FFT on current IQ buffer
                    fft_size_b = min(len(samples), 4096)
                    fft_data = np.abs(np.fft.fftshift(np.fft.fft(samples[:fft_size_b])))
                    fft_db = 20 * np.log10(fft_data + 1e-10)

                    # Convert marker frequencies to FFT bin indices
                    freq_resolution = float(sample_rate) / fft_size_b
                    start_freq = float(center_freq) - float(sample_rate) / 2
                    bin_low = int((float(beacon_marker_low) - start_freq) / freq_resolution)
                    bin_high = int((float(beacon_marker_high) - start_freq) / freq_resolution)
                    bin_low = max(0, min(fft_size_b - 1, bin_low))
                    bin_high = max(bin_low + 1, min(fft_size_b, bin_high))

                    # Find peak in marker range
                    search_range = fft_db[bin_low:bin_high]
                    if len(search_range) > 0:
                        peak_local_idx = np.argmax(search_range)
                        peak_bin = bin_low + peak_local_idx
                        peak_freq = start_freq + peak_bin * freq_resolution

                        # Drift = peak position minus expected beacon position
                        beacon_offset_hz = peak_freq - beacon_freq

                        # Extract mini spectrum around beacon (±5 kHz)
                        beacon_center_bin = int((float(beacon_freq) - start_freq) / freq_resolution)
                        view_bins = int(5000 / freq_resolution)
                        spec_lo = max(0, beacon_center_bin - view_bins)
                        spec_hi = min(fft_size_b, beacon_center_bin + view_bins)
                        mini_spectrum = fft_db[spec_lo:spec_hi].tolist() if spec_lo < spec_hi else []

                        # Report to main process — correction applied there via VFO update
                        # NEVER touch sdr.rx_lo here — that shifts the entire waterfall
                        status_msg = {
                            "type": "beacon_status",
                            "measuring": beacon_active,
                            "correcting": beacon_correcting,
                            "offset_hz": round(beacon_offset_hz, 1),
                            "spectrum": mini_spectrum,
                        }
                        if beacon_correcting:
                            status_msg["correction_hz"] = round(-beacon_offset_hz, 1)
                        data_queue.put(status_msg)

                except Exception as e:
                    logger.debug(f"Beacon tracking error: {e}")

            # --------------------------------------------------------
            # TX: Transmit queued IQ frames (non-blocking check)
            # --------------------------------------------------------
            if tx_queue is not None:
                try:
                    if not tx_queue.empty():
                        tx_data = tx_queue.get_nowait()

                        if tx_data is not None:
                            # tx_data should be a numpy complex64 array (modulated SSP frame)
                            if isinstance(tx_data, dict):
                                tx_samples = tx_data.get("samples")
                            else:
                                tx_samples = tx_data

                            if tx_samples is not None and len(tx_samples) > 0:
                                if not isinstance(tx_samples, np.ndarray):
                                    tx_samples = np.array(tx_samples, dtype=np.complex64)
                                elif tx_samples.dtype != np.complex64:
                                    tx_samples = tx_samples.astype(np.complex64)

                                # Burst transmit -- sdr.tx() handles the DMA transfer
                                sdr.tx(tx_samples)
                                stats["tx_frames_sent"] += 1
                                logger.debug(
                                    f"TX burst: {len(tx_samples)} samples transmitted"
                                )

                except Exception as e:
                    logger.error(f"Error transmitting samples: {e}")
                    stats["tx_errors"] += 1
                    stats["errors"] += 1

                    data_queue.put(
                        {
                            "type": "error",
                            "client_id": client_id,
                            "message": f"TX error: {e}",
                            "timestamp": time.time(),
                        }
                    )

    except Exception as e:
        error_msg = f"Fatal error in PlutoSDR worker process: {e}"
        logger.error(error_msg)
        logger.exception(e)

        data_queue.put(
            {
                "type": "error",
                "client_id": client_id,
                "message": error_msg,
                "timestamp": time.time(),
            }
        )

    finally:
        # Allow main process time to read queued messages
        time.sleep(0.5)

        # Clean up PlutoSDR resources
        logger.info(f"Cleaning up PlutoSDR resources for SDR {sdr_id}...")
        if sdr is not None:
            try:
                # Destroy TX buffer to stop any pending DMA transfers
                sdr.tx_destroy_buffer()
                logger.info("PlutoSDR TX buffer destroyed")
            except Exception as e:
                logger.debug(f"Error destroying TX buffer: {e}")

            try:
                # Release the device context
                del sdr
                logger.info("PlutoSDR device released")
            except Exception as e:
                logger.error(f"Error releasing PlutoSDR device: {e}")

        # Send termination signal
        data_queue.put(
            {
                "type": "terminated",
                "client_id": client_id,
                "sdr_id": sdr_id,
                "timestamp": time.time(),
            }
        )

        logger.info("PlutoSDR worker process terminated")
