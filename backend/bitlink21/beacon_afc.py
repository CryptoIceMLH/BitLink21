"""
BitLink21 Beacon AFC (Automatic Frequency Control).

SDR Console-style beacon lock:
1. User sets beacon frequency (e.g., 10489.500 MHz for QO-100 CW beacon)
2. Mini spectrum shows narrow band around beacon
3. Tuning bars bracket the beacon peak
4. Lock button engages AFC loop
5. Backend finds peak in FFT, computes offset, adjusts XO correction
6. All frequencies shift — global correction for TCXO/LNB drift

States: UNLOCKED → TRACKING → LOCKED
"""

import asyncio
import logging
import time
from enum import Enum
from typing import Optional, Dict, Any

import numpy as np

logger = logging.getLogger("bitlink21")


class AFCState(str, Enum):
    UNLOCKED = "UNLOCKED"
    TRACKING = "TRACKING"
    LOCKED = "LOCKED"


class BeaconAFC:
    """
    Beacon AFC loop — peak detection + XO correction.

    Taps into the PlutoSDR worker's FFT pipeline, finds the beacon peak
    within user-defined marker range, and adjusts xo_correction to
    compensate for TCXO/LNB thermal drift.
    """

    def __init__(self):
        self.state = AFCState.UNLOCKED
        self.beacon_freq_hz: float = 10489.500e6  # Default: QO-100 CW beacon
        self.marker_low_hz: float = self.beacon_freq_hz - 2500  # ±2.5 kHz window
        self.marker_high_hz: float = self.beacon_freq_hz + 2500
        self.center_freq_hz: float = 0.0
        self.sample_rate_hz: float = 0.0
        self.fft_size: int = 0

        # AFC loop parameters
        self.offset_hz: float = 0.0
        self.phase_error_deg: float = 0.0
        self.xo_correction: int = 0
        self.loop_gain: float = 0.5  # PLL-style gain (0-1)
        self.lock_threshold_hz: float = 50.0  # Consider locked within ±50 Hz
        self.tracking_threshold_hz: float = 500.0  # Start tracking within ±500 Hz
        self.update_interval_sec: float = 1.0

        # State tracking
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_fft: Optional[np.ndarray] = None
        self._sdr_handle = None  # Reference to PlutoSDR for XO writes
        self._sio = None  # Socket.IO for status updates
        self._lock_count: int = 0
        self._lock_threshold_count: int = 5  # Need 5 consecutive locks

    def configure(self, config: Dict[str, Any]):
        """Update AFC configuration from frontend."""
        if "beacon_freq_hz" in config:
            self.beacon_freq_hz = float(config["beacon_freq_hz"])
        if "marker_low_hz" in config:
            self.marker_low_hz = float(config["marker_low_hz"])
        if "marker_high_hz" in config:
            self.marker_high_hz = float(config["marker_high_hz"])
        if "loop_gain" in config:
            self.loop_gain = float(config["loop_gain"])
        if "lock_threshold_hz" in config:
            self.lock_threshold_hz = float(config["lock_threshold_hz"])

        logger.info(
            f"Beacon AFC configured: freq={self.beacon_freq_hz / 1e6:.3f} MHz, "
            f"markers=[{self.marker_low_hz / 1e6:.6f}, {self.marker_high_hz / 1e6:.6f}] MHz"
        )

    def set_sdr_handle(self, sdr):
        """Set reference to PlutoSDR instance for XO correction writes."""
        self._sdr_handle = sdr

    def set_sio(self, sio):
        """Set Socket.IO instance for status broadcasts."""
        self._sio = sio

    def update_fft(self, fft_data: np.ndarray, center_freq: float, sample_rate: float, fft_size: int):
        """
        Called by PlutoSDR worker with each FFT frame.
        fft_data: power spectrum in dB (float32 array of fft_size elements)
        """
        self._last_fft = fft_data
        self.center_freq_hz = center_freq
        self.sample_rate_hz = sample_rate
        self.fft_size = fft_size

    def _find_peak_in_range(self) -> Optional[float]:
        """
        Find peak frequency within marker range.
        Returns frequency offset from expected beacon position (in Hz),
        or None if no valid peak found.
        """
        if self._last_fft is None or self.fft_size == 0 or self.sample_rate_hz == 0:
            return None

        fft_data = self._last_fft
        freq_resolution = self.sample_rate_hz / self.fft_size

        # Convert marker frequencies to FFT bin indices
        # FFT bins: [0..N/2-1] = [center..center+sr/2], [N/2..N-1] = [center-sr/2..center]
        # Easier: freq_for_bin(k) = center + (k - N/2) * resolution

        def freq_to_bin(freq_hz):
            bin_idx = int((freq_hz - self.center_freq_hz) / freq_resolution + self.fft_size / 2)
            return max(0, min(self.fft_size - 1, bin_idx))

        bin_low = freq_to_bin(self.marker_low_hz)
        bin_high = freq_to_bin(self.marker_high_hz)

        if bin_low >= bin_high or bin_high >= len(fft_data):
            return None

        # Find peak within range
        search_range = fft_data[bin_low:bin_high + 1]
        if len(search_range) == 0:
            return None

        peak_local_idx = np.argmax(search_range)
        peak_bin = bin_low + peak_local_idx

        # Convert peak bin to frequency
        peak_freq = self.center_freq_hz + (peak_bin - self.fft_size / 2) * freq_resolution

        # Offset from expected beacon frequency
        offset = peak_freq - self.beacon_freq_hz
        return offset

    def _apply_xo_correction(self, correction_hz: int):
        """Write XO correction to PlutoSDR."""
        if self._sdr_handle is None:
            return

        try:
            self._sdr_handle._ctrl.attrs["xo_correction"].value = str(correction_hz)
            self.xo_correction = correction_hz
            logger.debug(f"Beacon AFC: XO correction set to {correction_hz} Hz")
        except Exception as e:
            logger.error(f"Beacon AFC: Failed to set XO correction: {e}")

    async def _emit_status(self):
        """Broadcast current AFC status via Socket.IO."""
        if self._sio is None:
            return

        status = {
            "lock_state": self.state.value,
            "offset_hz": round(self.offset_hz, 1),
            "phase_error_deg": round(self.phase_error_deg, 2),
            "xo_correction": self.xo_correction,
            "beacon_freq_hz": self.beacon_freq_hz,
        }
        try:
            await self._sio.emit("bitlink21:beacon_status", status)
        except Exception:
            pass

    async def _afc_loop(self):
        """Main AFC loop — runs at ~1 Hz."""
        logger.info("Beacon AFC loop started")
        self.state = AFCState.TRACKING
        self._lock_count = 0

        while self._running:
            try:
                offset = self._find_peak_in_range()

                if offset is not None:
                    self.offset_hz = offset
                    self.phase_error_deg = offset * 360.0 / self.sample_rate_hz if self.sample_rate_hz > 0 else 0

                    # Apply correction (PLL-style loop filter)
                    correction = int(self.xo_correction - self.loop_gain * offset)
                    self._apply_xo_correction(correction)

                    # Update state machine
                    if abs(offset) < self.lock_threshold_hz:
                        self._lock_count += 1
                        if self._lock_count >= self._lock_threshold_count:
                            self.state = AFCState.LOCKED
                    elif abs(offset) < self.tracking_threshold_hz:
                        self.state = AFCState.TRACKING
                        self._lock_count = max(0, self._lock_count - 1)
                    else:
                        self.state = AFCState.TRACKING
                        self._lock_count = 0

                await self._emit_status()
                await asyncio.sleep(self.update_interval_sec)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Beacon AFC loop error: {e}", exc_info=True)
                await asyncio.sleep(self.update_interval_sec)

        self.state = AFCState.UNLOCKED
        await self._emit_status()
        logger.info("Beacon AFC loop stopped")

    async def start(self):
        """Start the AFC loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._afc_loop())
        logger.info("Beacon AFC started")

    async def stop(self):
        """Stop the AFC loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.state = AFCState.UNLOCKED
        self._lock_count = 0
        logger.info("Beacon AFC stopped")

    def get_status(self) -> Dict[str, Any]:
        """Get current AFC status."""
        return {
            "lock_state": self.state.value,
            "offset_hz": round(self.offset_hz, 1),
            "phase_error_deg": round(self.phase_error_deg, 2),
            "xo_correction": self.xo_correction,
            "beacon_freq_hz": self.beacon_freq_hz,
            "running": self._running,
        }

    def get_mini_spectrum(self) -> Optional[Dict]:
        """
        Return narrow-band FFT data around beacon for mini spectrum display.
        Returns dict with frequencies and power values for the frontend.
        """
        if self._last_fft is None or self.fft_size == 0:
            return None

        freq_resolution = self.sample_rate_hz / self.fft_size

        def freq_to_bin(freq_hz):
            bin_idx = int((freq_hz - self.center_freq_hz) / freq_resolution + self.fft_size / 2)
            return max(0, min(self.fft_size - 1, bin_idx))

        # Wider view: ±5 kHz around beacon
        view_low = freq_to_bin(self.beacon_freq_hz - 5000)
        view_high = freq_to_bin(self.beacon_freq_hz + 5000)

        if view_low >= view_high or view_high >= len(self._last_fft):
            return None

        spectrum = self._last_fft[view_low:view_high + 1].tolist()
        freqs = [
            (self.center_freq_hz + (i + view_low - self.fft_size / 2) * freq_resolution)
            for i in range(len(spectrum))
        ]

        return {
            "frequencies": freqs,
            "power_db": spectrum,
            "beacon_freq": self.beacon_freq_hz,
            "marker_low": self.marker_low_hz,
            "marker_high": self.marker_high_hz,
        }


# Singleton instance
beacon_afc = BeaconAFC()
