"""
BitLink21 Beacon AFC — Passive status holder.

The actual beacon tracking runs inside the PlutoSDR worker process.
Simple FFT peak measurement + two-state correction (measuring/correcting).
This module holds the latest status for handlers that call get_status().
"""

import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("bitlink21")


class BeaconAFC:
    """Passive beacon status holder — updated by PlutoSDR worker via processlifecycle."""

    def __init__(self):
        self.measuring: bool = False
        self.correcting: bool = False
        self.offset_hz: float = 0.0
        self.beacon_freq_hz: float = 0.0

    def update_from_worker(self, data: Dict[str, Any]):
        """Called by processlifecycle when beacon_status arrives from worker."""
        if "measuring" in data:
            self.measuring = data["measuring"]
        if "correcting" in data:
            self.correcting = data["correcting"]
        if "offset_hz" in data:
            self.offset_hz = data["offset_hz"]

    def get_status(self) -> Dict[str, Any]:
        return {
            "measuring": self.measuring,
            "correcting": self.correcting,
            "offset_hz": round(self.offset_hz, 1),
            "beacon_freq_hz": self.beacon_freq_hz,
        }

    def get_mini_spectrum(self) -> Optional[Dict]:
        """For CSMA — return None since we no longer store spectrum data."""
        return None


# Singleton
beacon_afc = BeaconAFC()
