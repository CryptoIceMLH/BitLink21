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
        from bitlink21.ssp_frame import SSPFrameAssembler

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

            # Demodulate
            data, constellation_pts, evm_db = self._demodulator.demodulate(iq_samples)
            self.constellation_points = constellation_pts[-100:]  # Keep last 100 points

            if not data or len(data) == 0:
                return

            # FEC decode
            decoded, fec_errors = self._fec_decoder.decode(data)
            if fec_errors >= 0:
                self.fec_corrections += fec_errors
            elif fec_errors == -1:
                self.errors += 1
                return  # Uncorrectable

            # Try to parse SSP frames from decoded data
            # Feed bytes one at a time to the assembler
            for byte_val in decoded:
                result = self._assembler.feed_byte(byte_val)
                if result is not None:
                    # Complete SSP frame received
                    self.frames_decoded += 1
                    if self.callback:
                        self.callback(result)

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
        signal.signal(signal.SIGINT, signal.SIG_IGN)

        logger.info(f"SSPModemDecoder process started (PID: {self.pid})")

        sample_buffer = np.array([], dtype=np.complex64)
        last_process_time = time.time()

        try:
            while True:
                try:
                    # Read IQ data from queue (with timeout)
                    data = self.iq_queue.get(timeout=2.0)

                    if data is None:
                        break  # Poison pill

                    # Handle metadata updates
                    if isinstance(data, dict):
                        if "sample_rate" in data:
                            self.sdr_sample_rate = data["sample_rate"]
                            self.sample_rate = self.sdr_sample_rate
                        if "center_freq" in data:
                            self.sdr_center_freq = data["center_freq"]
                        if "vfo_freq" in data:
                            pass  # VFO frequency update
                        continue

                    # Accumulate IQ samples
                    samples = np.frombuffer(data, dtype=np.complex64)
                    sample_buffer = np.concatenate([sample_buffer, samples])

                    # Process in batches
                    now = time.time()
                    if now - last_process_time >= self.batch_interval:
                        if len(sample_buffer) > 0 and self.sample_rate:
                            self._process_batch(sample_buffer)
                            sample_buffer = np.array([], dtype=np.complex64)
                        last_process_time = now

                except Exception as e:
                    if "Empty" in str(type(e).__name__):
                        continue  # Queue timeout, normal
                    logger.error(f"SSPModemDecoder error: {e}", exc_info=True)

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
