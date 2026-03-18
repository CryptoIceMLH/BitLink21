"""
BitLink21 CSMA — Carrier Sense Multiple Access with exponential backoff.

Don't transmit when someone else is transmitting on the channel.
Integrates with PTT: PTT press → CSMA check → TX or wait.
"""

import asyncio
import logging
import random
import time
from typing import Optional, Callable, Awaitable

import numpy as np

logger = logging.getLogger("bitlink21")


class CSMAState:
    IDLE = "idle"
    SENSING = "sensing"
    BACKOFF = "backoff"
    CLEAR = "clear"
    BUSY = "busy"


class CSMA:
    """
    Carrier Sense Multiple Access with exponential backoff.

    Measures power in the TX band; if above threshold, the channel is busy.
    Implements binary exponential backoff before retrying.
    """

    def __init__(self):
        self.enabled: bool = True
        self.state: str = CSMAState.IDLE

        # Detection parameters
        self.power_threshold_db: float = -60.0  # Channel busy above this (dB)
        self.sensing_duration_ms: int = 100  # How long to sense (ms)

        # Backoff parameters
        self.min_backoff_ms: int = 50
        self.max_backoff_ms: int = 5000
        self.max_retries: int = 10
        self.backoff_exponent: int = 0
        self.retry_count: int = 0

        # Current state
        self.channel_power_db: float = -100.0
        self.channel_busy: bool = False
        self._last_sense_time: float = 0

    def configure(self, config: dict):
        """Update CSMA parameters."""
        if "enabled" in config:
            self.enabled = bool(config["enabled"])
        if "power_threshold_db" in config:
            self.power_threshold_db = float(config["power_threshold_db"])
        if "sensing_duration_ms" in config:
            self.sensing_duration_ms = int(config["sensing_duration_ms"])
        if "max_retries" in config:
            self.max_retries = int(config["max_retries"])
        if "min_backoff_ms" in config:
            self.min_backoff_ms = int(config["min_backoff_ms"])
        if "max_backoff_ms" in config:
            self.max_backoff_ms = int(config["max_backoff_ms"])

    def sense_channel(self, fft_power_db: np.ndarray, tx_bin_start: int, tx_bin_end: int) -> bool:
        """
        Measure power in the TX band from FFT data.
        Returns True if channel is clear, False if busy.
        """
        if not self.enabled:
            return True  # CSMA disabled = always clear

        if tx_bin_start >= tx_bin_end or tx_bin_end > len(fft_power_db):
            return True

        # Average power in TX band
        band_power = fft_power_db[tx_bin_start:tx_bin_end]
        avg_power_db = float(np.mean(band_power))
        self.channel_power_db = avg_power_db
        self.channel_busy = avg_power_db > self.power_threshold_db
        self._last_sense_time = time.time()

        return not self.channel_busy

    async def request_transmit(self, sense_fn: Callable[[], bool]) -> bool:
        """
        Request permission to transmit with CSMA/CA.

        sense_fn: callable that returns True if channel is clear.
        Returns True if allowed to transmit, False if gave up after max retries.
        """
        if not self.enabled:
            self.state = CSMAState.CLEAR
            return True

        self.retry_count = 0
        self.backoff_exponent = 0

        while self.retry_count < self.max_retries:
            self.state = CSMAState.SENSING

            # Sense channel
            await asyncio.sleep(self.sensing_duration_ms / 1000.0)
            is_clear = sense_fn()

            if is_clear:
                self.state = CSMAState.CLEAR
                self.retry_count = 0
                self.backoff_exponent = 0
                return True

            # Channel busy — backoff
            self.state = CSMAState.BACKOFF
            self.retry_count += 1
            self.backoff_exponent = min(self.backoff_exponent + 1, 10)

            # Binary exponential backoff
            max_wait = min(
                self.min_backoff_ms * (2 ** self.backoff_exponent),
                self.max_backoff_ms
            )
            wait_ms = random.randint(self.min_backoff_ms, max_wait)

            logger.debug(
                f"CSMA: Channel busy ({self.channel_power_db:.1f} dB > {self.power_threshold_db:.1f} dB), "
                f"backoff {wait_ms} ms (retry {self.retry_count}/{self.max_retries})"
            )

            await asyncio.sleep(wait_ms / 1000.0)

        self.state = CSMAState.BUSY
        logger.warning(f"CSMA: Gave up after {self.max_retries} retries")
        return False

    def reset(self):
        """Reset CSMA state."""
        self.state = CSMAState.IDLE
        self.retry_count = 0
        self.backoff_exponent = 0
        self.channel_busy = False

    def get_status(self) -> dict:
        """Get current CSMA status for frontend."""
        return {
            "enabled": self.enabled,
            "state": self.state,
            "channel_busy": self.channel_busy,
            "channel_power_db": round(self.channel_power_db, 1),
            "threshold_db": self.power_threshold_db,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
        }


# Singleton
csma = CSMA()
