"""
BitLink21 TX Test Tone Generator.

Generates a CW sine wave and transmits via PlutoSDR TX for hardware verification.
User can verify TX chain works without needing the full modem pipeline.
"""

import logging
import threading
import time
from typing import Optional

import numpy as np

logger = logging.getLogger("bitlink21")


class TestToneGenerator:
    """Generate and transmit a CW test tone via PlutoSDR."""

    def __init__(self):
        self.active = False
        self.tone_freq_hz: float = 1000.0  # Offset from TX center frequency
        self.duration_sec: float = 0  # 0 = continuous until stopped
        self.tx_gain_db: float = -20.0  # Default conservative power
        self._thread: Optional[threading.Thread] = None
        self._sdr = None
        self._stop_event = threading.Event()

    def configure(self, config: dict):
        if "tone_freq_hz" in config:
            self.tone_freq_hz = float(config["tone_freq_hz"])
        if "duration_sec" in config:
            self.duration_sec = float(config["duration_sec"])
        if "tx_gain_db" in config:
            self.tx_gain_db = float(config["tx_gain_db"])

    def set_sdr(self, sdr):
        """Set reference to PlutoSDR adi.Pluto instance."""
        self._sdr = sdr

    def _generate_tone(self, sample_rate: float, num_samples: int) -> np.ndarray:
        """Generate IQ samples for a CW tone."""
        t = np.arange(num_samples) / sample_rate
        # Complex exponential = single tone at offset frequency
        iq = np.exp(1j * 2 * np.pi * self.tone_freq_hz * t)
        # Scale to PlutoSDR range (2^14 = 16384 for AD9361)
        iq = iq * (2**14 - 1) * 0.8  # 80% of max to avoid clipping
        return iq.astype(np.complex64)

    def _tx_loop(self):
        """Transmit tone in a loop until stopped."""
        if not self._sdr:
            logger.error("Test tone: No SDR configured")
            return

        try:
            sample_rate = float(self._sdr.sample_rate)
            # Generate 100ms worth of samples
            num_samples = int(sample_rate * 0.1)
            iq = self._generate_tone(sample_rate, num_samples)

            # Set TX gain
            self._sdr.tx_hardwaregain_chan0 = self.tx_gain_db

            # Enable cyclic TX for continuous tone
            self._sdr.tx_cyclic_buffer = True
            self._sdr.tx(iq)

            logger.info(
                f"Test tone TX active: {self.tone_freq_hz} Hz offset, "
                f"gain={self.tx_gain_db} dB, rate={sample_rate/1e6:.3f} MSPS"
            )

            start_time = time.time()
            while not self._stop_event.is_set():
                if self.duration_sec > 0 and (time.time() - start_time) >= self.duration_sec:
                    break
                self._stop_event.wait(0.5)

        except Exception as e:
            logger.error(f"Test tone TX error: {e}", exc_info=True)
        finally:
            try:
                self._sdr.tx_destroy_buffer()
                self._sdr.tx_cyclic_buffer = False
            except Exception:
                pass
            self.active = False
            logger.info("Test tone TX stopped")

    def start(self):
        """Start transmitting the test tone."""
        if self.active:
            logger.warning("Test tone already active")
            return False

        if not self._sdr:
            logger.error("Test tone: No SDR available")
            return False

        self.active = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._tx_loop, daemon=True, name="BitLink21-TestTone")
        self._thread.start()
        return True

    def stop(self):
        """Stop the test tone."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3.0)
            self._thread = None
        self.active = False

    def get_status(self) -> dict:
        return {
            "active": self.active,
            "tone_freq_hz": self.tone_freq_hz,
            "tx_gain_db": self.tx_gain_db,
            "duration_sec": self.duration_sec,
        }


# Singleton
test_tone = TestToneGenerator()
