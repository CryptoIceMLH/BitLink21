"""
BitLink21 Beacon AFC — Passive status holder.

The actual beacon tracking runs inside the PlutoSDR worker process
(NCO downmix → decimate → elliptic IIR → FFT → dual-tone detection).
This module holds the latest status for handlers that call get_status().

Updated by processlifecycle when beacon_status arrives from the worker.
"""

import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("bitlink21")


class BeaconAFC:
    """Passive beacon status holder — updated by PlutoSDR worker via processlifecycle."""

    def __init__(self):
        self.lock_state: str = "UNLOCKED"
        self.offset_hz: float = 0.0
        self.nco_correction: float = 0.0
        self.beacon_freq_hz: float = 0.0
        self.peaks: list = []        # Dual-tone peak frequencies
        self.spectrum: list = []     # Mini-spectrum dB values
        self.running: bool = False

    def configure(self, config: Dict[str, Any]):
        """Update configuration from frontend."""
        if "beacon_freq_hz" in config:
            self.beacon_freq_hz = float(config["beacon_freq_hz"])

    def update_from_worker(self, data: Dict[str, Any]):
        """Called by processlifecycle when beacon_status arrives from worker data_queue."""
        self.lock_state = data.get("lock_state", self.lock_state)
        self.offset_hz = data.get("offset_hz", self.offset_hz)
        self.nco_correction = data.get("nco_correction", self.nco_correction)
        self.running = self.lock_state != "UNLOCKED"
        peaks = data.get("peaks")
        if peaks is not None:
            self.peaks = peaks
        spectrum = data.get("spectrum")
        if spectrum is not None:
            self.spectrum = spectrum

    def get_status(self) -> Dict[str, Any]:
        """Get current beacon status for handlers."""
        return {
            "lock_state": self.lock_state,
            "offset_hz": round(self.offset_hz, 1),
            "nco_correction": round(self.nco_correction, 1),
            "beacon_freq_hz": self.beacon_freq_hz,
            "peaks": self.peaks,
            "running": self.running,
        }

    def get_mini_spectrum(self) -> Optional[Dict]:
        """Return mini-spectrum data for CSMA or frontend."""
        if not self.spectrum:
            return None
        return {
            "power_db": self.spectrum,
            "beacon_freq": self.beacon_freq_hz,
        }


# Singleton instance
beacon_afc = BeaconAFC()
