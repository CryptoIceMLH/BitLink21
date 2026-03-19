"""
BitLink21 SSP Modem Decoder — receives raw IQ, demodulates SSP frames.

Follows the same subprocess pattern as BPSKDecoder:
- Runs as a separate process (multiprocessing.Process)
- Receives IQ from IQ broadcaster via iq_queue
- Demodulates using BitLink21 modem (NumPy, GNU Radio when available)
- Reassembles SSP frames via SSPFrameAssembler
- Passes decoded messages to storage + emits via data_queue

Signal processing chain:
  IQ samples → frequency translation → decimation → matched RRC filter →
  clock recovery → carrier recovery → symbol detection → FEC decode →
  SSP frame reassembly → payload routing → storage
"""

import argparse
import logging
import time
import numpy as np
from typing import Optional, Dict, Any

from demodulators.basedecoderprocess import BaseDecoderProcess

logger = logging.getLogger("ssp-modem")

# Default batch processing interval
BATCH_INTERVAL_SECONDS = 5


class SSPFlowgraph:
    """
    SSP modem signal processing chain.

    Uses NumPy for demodulation (GNU Radio integration when available).
    Processes batches of IQ samples and outputs decoded bytes.
    """

    def __init__(self, scheme_name="QPSK", baudrate=9600, sample_rate=48000,
                 use_fec=True, samples_per_symbol=4, callback=None):
        self.scheme_name = scheme_name
        self.baudrate = baudrate
        self.sample_rate = sample_rate
        self.use_fec = use_fec
        self.samples_per_symbol = samples_per_symbol
        self.callback = callback

        # Import modem classes
        from bitlink21.modem import (
            Demodulator, FECDecoder, ModScheme, SCHEME_INFO,
            create_demodulator, create_fec_decoder
        )
        from bitlink21.ssp_frame import SSPFrameAssembler, SSPFrame
        self._SSPFrame = SSPFrame

        # Find scheme enum from name
        self.scheme = ModScheme.QPSK  # default
        for s, info in SCHEME_INFO.items():
            if info["name"] == scheme_name:
                self.scheme = s
                break

        self._demodulator = create_demodulator(self.scheme, samples_per_symbol)
        self._fec_decoder = create_fec_decoder(use_fec)
        self._assembler = SSPFrameAssembler()

        # Stats
        self.frames_decoded = 0
        self.fec_corrections = 0
        self.errors = 0
        self.constellation_points = []

        logger.info(
            f"SSP Flowgraph: {scheme_name}, {baudrate} baud, {sample_rate} sps, "
            f"FEC={'ON' if use_fec else 'OFF'}"
        )

    def process_samples(self, iq_samples: np.ndarray) -> None:
        """Process a batch of IQ samples through the demod chain."""
        try:
            if len(iq_samples) < self.samples_per_symbol * 10:
                return  # Too few samples

            # Normalize
            max_val = np.max(np.abs(iq_samples))
            if max_val > 0:
                iq_samples = iq_samples / max_val

            # Demodulate — produces raw bytes + constellation points
            data, constellation_pts, evm_db = self._demodulator.demodulate(iq_samples)
            self.constellation_points = constellation_pts[-100:]  # Keep last 100 for display

            if not data or len(data) == 0:
                return

            # FEC decode (if enabled)
            if self.use_fec and self._fec_decoder:
                decoded, fec_errors = self._fec_decoder.decode(data)
                if fec_errors >= 0:
                    self.fec_corrections += fec_errors
                elif fec_errors == -1:
                    self.errors += 1
                    return  # Uncorrectable
            else:
                decoded = data

            # Scan for SSP magic header (0x53535021 = "SSP!") in decoded bytes
            magic = b'\x53\x53\x50\x21'
            idx = decoded.find(magic) if isinstance(decoded, bytes) else -1
            if idx >= 0 and idx + 219 <= len(decoded):
                # Found potential SSP frame (219 bytes)
                frame_bytes = decoded[idx:idx + 219]
                try:
                    frame = self._SSPFrame.from_bytes(frame_bytes)
                    if frame:
                        result = self._assembler.add_frame(frame)
                        if result is not None:
                            self.frames_decoded += 1
                            if self.callback:
                                self.callback(result)
                except Exception as e:
                    logger.debug(f"SSP frame parse error: {e}")

        except Exception as e:
            self.errors += 1
            logger.error(f"SSP demod error: {e}", exc_info=True)


class SSPModemDecoder(BaseDecoderProcess):
    """
    BitLink21 SSP Modem decoder (multiprocessing-based).

    Receives raw IQ from IQ broadcaster, demodulates SSP protocol frames.
    Follows same pattern as BPSKDecoder.
    """

    def __init__(
        self,
        iq_queue,
        data_queue,
        session_id,
        config,
        output_dir="data/decoded",
        vfo=None,
        batch_interval=BATCH_INTERVAL_SECONDS,
        shm_monitor_interval=10,
        shm_restart_threshold=1000,
    ):
        super().__init__(
            iq_queue=iq_queue,
            data_queue=data_queue,
            session_id=session_id,
            config=config,
            output_dir=output_dir,
            vfo=vfo,
            shm_monitor_interval=shm_monitor_interval,
            shm_restart_threshold=shm_restart_threshold,
        )

        # SSP modem parameters from config
        self.scheme = getattr(config, "scheme", None) or "QPSK"
        self.baudrate = config.baudrate or 9600
        self.use_fec = getattr(config, "fec", True)
        self.batch_interval = batch_interval

        # Will be set during run()
        self.sample_rate = None
        self.sdr_sample_rate = None
        self.sdr_center_freq = None
        self.flowgraph = None

        logger.info(
            f"SSPModemDecoder initialized: scheme={self.scheme}, "
            f"baudrate={self.baudrate}, fec={self.use_fec}"
        )

    @staticmethod
    def _get_decoder_type_for_init():
        return "SSPModem"

    def run(self):
        """Main process loop — receive IQ, demodulate, output SSP frames."""
        import signal
        import queue as queue_module
        signal.signal(signal.SIGINT, signal.SIG_IGN)

        logger.info(f"SSPModemDecoder process started (PID: {self.pid})")

        sample_buffer = np.array([], dtype=np.complex64)
        last_process_time = time.time()

        try:
            while self.running.value:
                try:
                    # Read IQ message from queue (same format as BPSK decoder)
                    try:
                        iq_message = self.iq_queue.get(timeout=0.5)
                    except queue_module.Empty:
                        continue

                    if iq_message is None:
                        break  # Poison pill

                    # IQ data comes as dict: {samples, center_freq, sample_rate, timestamp}
                    if isinstance(iq_message, dict):
                        samples = iq_message.get("samples")
                        sdr_center = iq_message.get("center_freq")
                        sdr_rate = iq_message.get("sample_rate")

                        if sdr_rate and sdr_rate != self.sample_rate:
                            self.sample_rate = sdr_rate
                            self.sdr_sample_rate = sdr_rate
                        if sdr_center:
                            self.sdr_center_freq = sdr_center

                        if samples is None or len(samples) == 0:
                            continue

                        # Accumulate IQ samples
                        if not isinstance(samples, np.ndarray):
                            samples = np.array(samples, dtype=np.complex64)
                        elif samples.dtype != np.complex64:
                            samples = samples.astype(np.complex64)

                        sample_buffer = np.concatenate([sample_buffer, samples])

                        # Process in batches
                        now = time.time()
                        if now - last_process_time >= self.batch_interval:
                            if len(sample_buffer) > 0 and self.sample_rate:
                                self._process_batch(sample_buffer)
                                sample_buffer = np.array([], dtype=np.complex64)
                            last_process_time = now
                    else:
                        logger.warning(f"SSP modem received non-dict IQ data: {type(iq_message)}")

                except Exception as e:
                    logger.error(f"SSPModemDecoder loop error: {e}", exc_info=True)

        except Exception as e:
            logger.error(f"SSPModemDecoder fatal error: {e}", exc_info=True)
        finally:
            logger.info(f"SSPModemDecoder process exiting (PID: {self.pid})")

    def _process_batch(self, samples: np.ndarray):
        """Process a batch of accumulated IQ samples."""
        if self.flowgraph is None:
            self.flowgraph = SSPFlowgraph(
                scheme_name=self.scheme,
                baudrate=self.baudrate,
                sample_rate=self.sample_rate,
                use_fec=self.use_fec,
                callback=self._on_frame_decoded,
            )

        self.flowgraph.process_samples(samples)

        # Send constellation data for visualization
        if self.flowgraph.constellation_points:
            try:
                self.data_queue.put_nowait({
                    "type": "constellation",
                    "session_id": self.session_id,
                    "points": [
                        {"I": float(p.real), "Q": float(p.imag)}
                        for p in self.flowgraph.constellation_points[:50]
                    ],
                })
            except Exception:
                pass

        # Send stats
        try:
            self.data_queue.put_nowait({
                "type": "decoder_status",
                "session_id": self.session_id,
                "decoder_type": "ssp",
                "status": "decoding",
                "frames_decoded": self.flowgraph.frames_decoded,
                "fec_corrections": self.flowgraph.fec_corrections,
                "errors": self.flowgraph.errors,
            })
        except Exception:
            pass

    def _on_frame_decoded(self, frame_data):
        """Called when a complete SSP frame is decoded."""
        logger.info(f"SSP frame decoded: {len(frame_data)} bytes")

        try:
            self.data_queue.put_nowait({
                "type": "decoded_packet",
                "session_id": self.session_id,
                "decoder_type": "ssp",
                "data": frame_data.hex() if isinstance(frame_data, bytes) else str(frame_data),
                "timestamp": time.time(),
            })
        except Exception as e:
            logger.error(f"Failed to send decoded frame: {e}")
