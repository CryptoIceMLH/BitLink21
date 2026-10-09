"""Streaming HSModem receiver with automatic frequency acquisition.

Signal chain (all state is carried across process() calls):

    SDR IQ
      -> ChannelSelector A: mix nominal channel to DC, decimate to a wide
         "search" rate covering +-search_span_hz
      -> [acquisition] Welch PSD matched to the RRC spectrum finds the
         signal (coarse), M-th power spectrum gives the fine offset
      -> ChannelSelector B: mix the acquired offset to DC, decimate to
         >= 4 samples/symbol, channel filter
      -> RRC matched filter (+ derivative filter for timing)
      -> symbol timing loop (signal-times-slope ML TED, cubic interpolation)
      -> symbol AGC -> decision-directed carrier PLL (2/4/7-fold)
      -> header search over all phase / mirror hypotheses
      -> de-scramble, RS(255,223), CRC16 -> Frame

Like gr-dvbs2rx, the frequency estimate is fed back to an upstream mixer
(ChannelSelector B) instead of being left to the PLL, so the signal stays
centred in the channel filter. Unlike gr-dvbs2rx there is no long known
preamble in HSModem, so acquisition is non-data-aided (spectrum based).
"""

import time
from collections import deque
from typing import Callable, List, Optional

import numpy as np
from scipy import signal as sps_signal

from . import framing
from .dsp import ChannelSelector, FirDecimator, lowpass_taps, rrc_taps, wrap_phase
from .modes import RRC_ROLLOFF, SpeedMode

STATE_SEARCHING = "searching"
STATE_ACQUIRED = "acquired"
STATE_LOCKED = "locked"


PLL_TRACK_HZ = 48.0  # minimum carrier-tracking loop bandwidth (Hz)


def _loop_gains(bw: float, damping: float, ted_gain: float = 1.0):
    """Second-order loop gains (per update) from normalized noise bandwidth."""
    theta = bw / (damping + 1 / (4 * damping))
    d = 1 + 2 * damping * theta + theta ** 2
    return 4 * damping * theta / d / ted_gain, 4 * theta ** 2 / d / ted_gain


class HsModemReceiver:
    def __init__(
        self,
        fs_in: float,
        mode: SpeedMode,
        channel_offset_hz: float = 0.0,
        search_span_hz: float = 3000.0,
        on_frame: Optional[Callable[[framing.Frame], None]] = None,
        detect_snr_db: float = 3.0,
    ):
        self.mode = mode
        self.modulation = mode.modulation
        self.rs = mode.symbol_rate
        self.on_frame = on_frame
        self.search_span_hz = float(search_span_hz)
        self.detect_snr_db = detect_snr_db
        self.symmetry = framing.SYMMETRY[self.modulation]
        self.frame_syms = framing.symbols_per_block(self.modulation)

        occupied = self.rs * (1 + RRC_ROLLOFF)

        # Stage A: wide search channel around the nominal frequency
        self.stage_a = ChannelSelector(
            fs_in, channel_offset_hz,
            min_out_rate=max(2.5 * (self.search_span_hz + occupied / 2), 4 * self.rs),
            passband_hz=self.search_span_hz + occupied / 2,
        )
        self.fs_a = self.stage_a.fs_out

        # Stage B: residual offset mix + channel filter + decimation to >= 4 sps
        from .dsp import Nco
        self.nco_b = Nco(self.fs_a, 0.0)
        d_b = max(1, int(self.fs_a // (4 * self.rs)))
        self.fs_b = self.fs_a / d_b
        # Channel filter: flat over the signal (+ margin for residual offset),
        # steep enough to reject neighbouring QO-100 stations.
        pass_b = occupied / 2 + 150
        stop_b = min(pass_b + max(300.0, 0.15 * self.rs), self.fs_b - pass_b)
        self.stage_b = FirDecimator(lowpass_taps(pass_b, self.fs_a, stop_b, 60), d_b)
        self.sps = self.fs_b / self.rs

        # Matched filter and its time derivative (derivative scaled per symbol)
        h = rrc_taps(self.sps, RRC_ROLLOFF, span_symbols=14)
        dh = np.gradient(h) * self.sps
        self.mf = FirDecimator(h, 1)
        self.dmf = FirDecimator(dh, 1)

        # Timing loop
        self._y = np.zeros(0, dtype=np.complex64)
        self._dy = np.zeros(0, dtype=np.complex64)
        self._y_abs0 = 0  # absolute matched-filter index of self._y[0]
        self._a_count = 0  # stage-A samples fed into stage B so far
        self._pending_freq_steps: List[tuple] = []  # (mf index, Hz)
        self._t = 2.0
        self._t_integ = 0.0
        # Wide while acquiring, narrow once frames decode (less self-noise).
        # TED gain measured from the S-curve: ~0.95 per symbol of timing
        # error (normalized to matched-filter power), same for all modes.
        ted_gain = 0.95 / self.sps
        self._ted_acq = _loop_gains(0.01, 1.0, ted_gain=ted_gain)
        self._ted_track = _loop_gains(0.003, 1.0, ted_gain=ted_gain)
        self._mf_power = 1.0

        # Carrier loop
        self._phase = 0.0
        self._freq = 0.0  # rad/symbol
        self._pll_acq = _loop_gains(0.04, 0.707)
        # Tracking bandwidth at least PLL_TRACK_HZ: the receive frequency can
        # run at 20-40 Hz/s (seen live while transmitting); a 1%-of-symbol-rate
        # loop (12 Hz at BPSK 1200) could not follow it
        self._pll_track = _loop_gains(max(0.01, PLL_TRACK_HZ / self.rs), 0.707)
        self.drift_hz_s = 0.0  # receive-chain drift rate from the beacon tracker
        self._sym_power = 1.0
        self._theta0 = {"bpsk": 0.0, "qpsk": np.pi / 4, "8apsk": 0.0}[self.modulation]
        self._ring_min = 0.5 if self.modulation == "8apsk" else 0.0

        # Symbol buffer for header search
        self._syms = np.zeros(0, dtype=np.complex64)
        self._sym_base = 0
        self._search_from = 0
        self._next_allowed = 0
        self.header = framing.HeaderSearch(self.modulation)
        self._locked_hyp = None

        # Acquisition buffers
        self._acq_len = int(self.fs_a * 1.5)
        self._acq_a = np.zeros(0, dtype=np.complex64)
        self._acq_mf: List[np.ndarray] = []
        self._acq_mf_len = 0
        self._last_acq = 0.0
        self._samples_seen = 0.0  # seconds of input processed
        self._deferred_nominal: Optional[float] = None

        # Status
        self.state = STATE_SEARCHING
        self.signal_detected = False
        self.snr_db: Optional[float] = None
        self.mer_db: Optional[float] = None
        self.frames_ok = 0
        self.frames_failed = 0
        self.last_frame_at: Optional[float] = None
        self._last_frame_stream_t = -1e9
        self._recent_syms = deque(maxlen=512)
        self.constellation: List[List[float]] = []

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    @property
    def channel_offset_hz(self) -> float:
        """Nominal channel offset from SDR centre (set from the profile)."""
        return self.stage_a.offset_hz

    @channel_offset_hz.setter
    def channel_offset_hz(self, value: float) -> None:
        self.stage_a.offset_hz = value
        self._reset_acquisition()

    def set_nominal(self, offset_hz: float) -> None:
        """Move the search centre (e.g. from a beacon correction).

        While frame-locked the modem tracks the signal by itself, so only the
        mixer reference changes and the residual mixer compensates; the
        signal does not move relative to the demodulator.
        """
        delta = float(offset_hz) - self.stage_a.offset_hz
        if self.state == STATE_LOCKED:
            self._deferred_nominal = float(offset_hz)
            return
        self._deferred_nominal = None
        # Small beacon updates arrive twice a second; only re-centre the
        # search window when it has moved meaningfully, otherwise the
        # acquisition buffer would never fill.
        if abs(delta) < 20.0:
            return
        self.stage_a.offset_hz = float(offset_hz)
        self.nco_b.freq_hz -= delta
        if abs(delta) > 100.0:
            self._acq_a = np.zeros(0, dtype=np.complex64)

    @property
    def residual_offset_hz(self) -> float:
        """Measured signal offset relative to the nominal channel."""
        in_flight = sum(d for _, d in self._pending_freq_steps)
        return self.nco_b.freq_hz - in_flight + self._freq * self.rs / (2 * np.pi)

    def status(self) -> dict:
        return {
            "state": self.state,
            "mode": self.mode.to_dict(),
            "signal_detected": bool(self.signal_detected),
            "snr_db": None if self.snr_db is None else round(float(self.snr_db), 1),
            "mer_db": None if self.mer_db is None else round(float(self.mer_db), 1),
            "offset_hz": round(float(self.residual_offset_hz), 1),
            "frames_ok": int(self.frames_ok),
            "frames_failed": int(self.frames_failed),
            "last_frame_at": self.last_frame_at,
            "sps": round(float(self.sps), 3),
        }

    def process(self, iq: np.ndarray) -> List[framing.Frame]:
        self._samples_seen += len(iq) / self.stage_a.fs_in
        if self.state in (STATE_LOCKED, STATE_ACQUIRED) and self.drift_hz_s:
            # Feed-forward the receive-chain drift measured on the beacon (it
            # moves our channel by the same amount): the carrier loop then
            # only tracks what is left
            self.nco_b.freq_hz += self.drift_hz_s * len(iq) / self.stage_a.fs_in
        a = self.stage_a.process(iq)
        if len(a) == 0:
            return []
        self._acq_a = np.concatenate([self._acq_a, a])[-self._acq_len:]

        b = self.stage_b.process(self.nco_b.mix(a))
        self._a_count += len(a)
        y = self.mf.process(b)
        dy = self.dmf.process(b)
        if len(y):
            self._mf_power = 0.9 * self._mf_power + 0.1 * float(np.mean(np.abs(y) ** 2) + 1e-20)
            self._acq_mf.append(y)
            self._acq_mf_len += len(y)
            while self._acq_mf_len - len(self._acq_mf[0]) > 2 ** 15:
                self._acq_mf_len -= len(self._acq_mf.pop(0))

        self._run_acquisition()
        self._run_symbol_loops(y, dy)
        return self._run_deframer()

    # ------------------------------------------------------------------
    # acquisition
    # ------------------------------------------------------------------

    def _reset_acquisition(self):
        self._acq_a = np.zeros(0, dtype=np.complex64)
        self._acq_mf = []
        self._acq_mf_len = 0
        self.state = STATE_SEARCHING
        self._locked_hyp = None

    def _is_frame_locked(self) -> bool:
        frame_time = self.frame_syms / self.rs
        return self._samples_seen - self._last_frame_stream_t < 3 * frame_time + 1.0

    def _run_acquisition(self):
        interval = 1.0 if self.state == STATE_LOCKED else 0.25
        if self._samples_seen - self._last_acq < interval:
            return
        self._last_acq = self._samples_seen

        if self._is_frame_locked():
            self.state = STATE_LOCKED
            self._recentre()
            self._measure_snr(update_detect_only=True)
            return
        if self.state == STATE_LOCKED:
            self.state = STATE_ACQUIRED  # lost frames, keep tracking a bit
            self._locked_hyp = None
            if self._deferred_nominal is not None:
                self.set_nominal(self._deferred_nominal)

        coarse = self._measure_snr()
        if coarse is None:
            self.state = STATE_SEARCHING
            return

        # Only retune if the signal is not already where we are listening
        if abs(coarse - self.nco_b.freq_hz) > 0.25 * self.rs or self.state == STATE_SEARCHING:
            self._retune(coarse)
            self.state = STATE_ACQUIRED
            return

        fine = self._fine_offset()
        if fine is not None:
            self._retune(self.nco_b.freq_hz + fine)
        self.state = STATE_ACQUIRED

    # Listen before talk: anything on air inside our SSB channel (another
    # station's modem, voice, a carrier) counts, not just our own mode.
    CHANNEL_BW_HZ = 2700.0
    BUSY_SNR_DB = 6.0

    def channel_occupancy_db(self) -> Optional[float]:
        """Power inside the channel over the noise around it (dB), from the
        last 0.5 s of the acquisition buffer; None until enough samples."""
        n = int(self.fs_a * 0.5)
        x = self._acq_a
        if len(x) < n:
            return None
        x = x[-n:]
        nfft = 1 << int(np.ceil(np.log2(self.fs_a / 25)))  # ~25 Hz bins
        f, p = sps_signal.welch(x, fs=self.fs_a, nperseg=min(nfft, n), return_onesided=False, detrend=False)
        inband = np.abs(f) <= self.CHANNEL_BW_HZ / 2
        passband = np.abs(f) <= self.search_span_hz + self.mode.occupied_bw_hz / 2
        # Low percentile of the passband: robust to neighbouring channels
        floor = float(np.percentile(p[passband], 25)) + 1e-30
        excess = float(np.sum(p[inband]) - floor * np.count_nonzero(inband))
        snr = excess / (floor * np.count_nonzero(inband))
        return round(float(10 * np.log10(snr)), 1) if snr > 0 else -99.0

    def channel_busy(self) -> bool:
        level = self.channel_occupancy_db()
        return bool(level is not None and level >= self.BUSY_SNR_DB)

    def _measure_snr(self, update_detect_only: bool = False) -> Optional[float]:
        """PSD-based detection; returns coarse offset (Hz) or None."""
        if len(self._acq_a) < self.fs_a * 0.5:
            return None
        x = self._acq_a
        nfft = 1 << int(np.ceil(np.log2(self.fs_a / 8)))  # ~8 Hz bins
        nfft = min(nfft, len(x))
        f, p = sps_signal.welch(x, fs=self.fs_a, nperseg=nfft, return_onesided=False, detrend=False)
        f = np.fft.fftshift(f)
        p = np.fft.fftshift(p)
        df = f[1] - f[0]

        floor = float(np.median(p))
        excess = np.clip(p - floor, 0, None)
        # Raised-cosine (RRC^2) spectral template
        half = self.rs * (1 + RRC_ROLLOFF) / 2
        kf = np.arange(-half, half + df, df)
        af = np.abs(kf)
        f1 = self.rs * (1 - RRC_ROLLOFF) / 2
        tmpl = np.where(af <= f1, 1.0, 0.5 * (1 + np.cos(np.pi / (self.rs * RRC_ROLLOFF) * (af - f1))))
        score = np.correlate(excess, tmpl, mode="same")
        allowed = np.abs(f) <= self.search_span_hz
        if not np.any(allowed):
            return None
        score[~allowed] = -1
        k = int(np.argmax(score))
        inband = np.abs(f - f[k]) <= self.rs / 2
        sig = float(np.sum(p[inband]) - floor * np.count_nonzero(inband))
        snr = sig / (floor * np.count_nonzero(inband)) if floor > 0 else 0.0
        self.snr_db = 10 * np.log10(snr) if snr > 0 else -99.0
        self.signal_detected = self.snr_db >= self.detect_snr_db
        if update_detect_only or not self.signal_detected:
            return None
        # Sub-bin refinement: centroid of the score peak
        lo, hi = max(k - 3, 0), min(k + 4, len(score))
        w = np.clip(score[lo:hi], 0, None)
        centre = float(np.sum(f[lo:hi] * w) / np.sum(w)) if np.sum(w) > 0 else float(f[k])
        return centre

    def _fine_offset(self) -> Optional[float]:
        """M-th power estimate on the matched-filter output (Hz, relative)."""
        if self._acq_mf_len < 2 ** 13:
            return None
        y = np.concatenate(self._acq_mf)[-2 ** 15:]
        y = y / (np.sqrt(np.mean(np.abs(y) ** 2)) + 1e-12)
        m = self.symmetry
        if self.modulation == "qpsk":
            z = -(y ** 4)  # 45-degree constellation -> line at 4*df with phase pi
        else:
            z = y ** m
        n = 1 << int(np.ceil(np.log2(len(z)))) + 2
        spec = np.abs(np.fft.fftshift(np.fft.fft(z * np.hanning(len(z)), n)))
        freqs = np.fft.fftshift(np.fft.fftfreq(n, 1 / self.fs_b))
        k = int(np.argmax(spec))
        if spec[k] < 8 * np.median(spec):
            return None
        return float(freqs[k] / m)

    def _retune(self, offset_hz: float):
        self.nco_b.freq_hz = float(offset_hz)
        self._freq = 0.0
        self._pending_freq_steps = []
        self._acq_mf = []
        self._acq_mf_len = 0

    def _recentre(self):
        """While locked, move the PLL frequency into the mixer.

        The mixer change only reaches the PLL after the stage-B and matched
        filter delays, so the matching PLL correction is scheduled for the
        exact matched-filter sample where the shifted samples arrive (the
        same idea as gr-dvbs2rx's tagged rotator updates).
        """
        df = self._freq * self.rs / (2 * np.pi) - sum(d for _, d in self._pending_freq_steps)
        if abs(df) < 2.0:
            return
        self.nco_b.freq_hz += df
        switch_at = (self._a_count + self.stage_b.delay) / self.stage_b.decim + self.mf.delay
        self._pending_freq_steps.append((switch_at, df))

    # ------------------------------------------------------------------
    # timing + carrier loops
    # ------------------------------------------------------------------

    def _run_symbol_loops(self, y: np.ndarray, dy: np.ndarray):
        if len(y) == 0:
            return
        self._y = np.concatenate([self._y, y])
        self._dy = np.concatenate([self._dy, dy])
        Y, DY = self._y, self._dy
        n = len(Y)
        t = self._t
        sps = self.sps
        locked = self.state == STATE_LOCKED
        kp, ki = self._ted_track if locked else self._ted_acq
        integ = self._t_integ
        max_dev = 0.01 * sps
        inv_mfp = 1.0 / self._mf_power

        alpha, beta = self._pll_track if locked else self._pll_acq
        phase, freq = self._phase, self._freq
        fmax = 2 * np.pi * 0.05  # +-5% of symbol rate
        m = self.symmetry
        theta0 = self._theta0
        ring_min = self._ring_min
        p_sym = self._sym_power
        out = []
        pending = self._pending_freq_steps
        y_abs0 = self._y_abs0
        next_switch = pending[0][0] if pending else float("inf")
        hz_to_rad = 2 * np.pi / self.rs

        while t + 2 < n:
            if y_abs0 + t >= next_switch:
                freq -= pending.pop(0)[1] * hz_to_rad
                next_switch = pending[0][0] if pending else float("inf")
            i = int(t)
            mu = t - i
            # cubic Lagrange interpolation on samples i-1..i+2
            c0 = -mu * (mu - 1) * (mu - 2) / 6
            c1 = (mu + 1) * (mu - 1) * (mu - 2) / 2
            c2 = -(mu + 1) * mu * (mu - 2) / 2
            c3 = (mu + 1) * mu * (mu - 1) / 6
            ys = c0 * Y[i - 1] + c1 * Y[i] + c2 * Y[i + 1] + c3 * Y[i + 2]
            dys = c0 * DY[i - 1] + c1 * DY[i] + c2 * DY[i + 1] + c3 * DY[i + 2]

            e_t = (ys.real * dys.real + ys.imag * dys.imag) * inv_mfp
            if e_t > 1.0:
                e_t = 1.0
            elif e_t < -1.0:
                e_t = -1.0
            integ += ki * e_t
            if integ > max_dev:
                integ = max_dev
            elif integ < -max_dev:
                integ = -max_dev
            t += sps + kp * e_t + integ

            # symbol AGC
            mag2 = ys.real * ys.real + ys.imag * ys.imag
            p_sym += 0.01 * (mag2 - p_sym)
            z = ys / np.sqrt(p_sym + 1e-20) * np.exp(-1j * phase)

            # carrier phase detector
            if abs(z) >= ring_min:
                e_c = wrap_phase(m * (np.angle(z) - theta0)) / m
            else:
                e_c = 0.0
            freq += beta * e_c
            if freq > fmax:
                freq = fmax
            elif freq < -fmax:
                freq = -fmax
            phase = (phase + alpha * e_c + freq + np.pi) % (2 * np.pi) - np.pi
            out.append(z)

        # keep 4 samples of history for the interpolator
        drop = max(0, int(t) - 2)
        self._y = Y[drop:]
        self._dy = DY[drop:]
        self._t = t - drop
        self._y_abs0 = y_abs0 + drop
        self._t_integ = integ
        self._phase, self._freq = phase, freq
        self._sym_power = p_sym

        if out:
            z = np.asarray(out, dtype=np.complex64)
            self._syms = np.concatenate([self._syms, z])
            self._recent_syms.extend(z)
            self._update_quality()

    def _update_quality(self):
        if len(self._recent_syms) < 64:
            return
        z = np.fromiter(self._recent_syms, dtype=np.complex64, count=len(self._recent_syms))
        pts = framing.CONSTELLATIONS[self.modulation]
        # Remove the residual phase ambiguity before measuring EVM
        best = None
        for k in range(self.symmetry):
            zr = z * np.exp(-2j * np.pi * k / self.symmetry)
            for zz in (zr, np.conj(zr)):
                err = np.min(np.abs(zz[:, None] - pts[None, :]) ** 2, axis=1)
                e = float(np.mean(err))
                if best is None or e < best:
                    best = e
        self.mer_db = 10 * np.log10(1.0 / max(best, 1e-6))
        step = max(1, len(z) // 200)
        self.constellation = [[round(float(v.real), 3), round(float(v.imag), 3)] for v in z[::step]]

    # ------------------------------------------------------------------
    # deframing
    # ------------------------------------------------------------------

    def _run_deframer(self) -> List[framing.Frame]:
        frames: List[framing.Frame] = []
        syms = self._syms
        base = self._sym_base
        start = self._search_from - base
        if len(syms) - start < self.header.header_len:
            return frames

        hyps = None
        if self._locked_hyp is not None:
            conj = self._locked_hyp[1]
            hyps = [(k, conj) for k in range(self.symmetry)]

        candidates = sorted(self.header.find(syms[start:], hyps), key=lambda c: (c[0], c[2]))
        pending = None
        tried = set()
        for rel_idx, hyp, _errs in candidates:
            idx = start + rel_idx
            abs_idx = base + idx
            if abs_idx < self._next_allowed or (abs_idx, hyp) in tried:
                continue
            if idx + self.frame_syms > len(syms):
                pending = idx if pending is None else min(pending, idx)
                continue
            tried.add((abs_idx, hyp))
            block_syms = self.header.derotate(syms[idx: idx + self.frame_syms], hyp)
            values = framing.decide(block_syms, self.modulation)
            frame = framing.unpack_block(framing.symbols_to_bytes(values, self.modulation))
            if frame is None:
                if self.state == STATE_LOCKED:
                    self.frames_failed += 1
                continue
            frames.append(frame)
            self.frames_ok += 1
            self.last_frame_at = time.time()
            self._last_frame_stream_t = self._samples_seen
            self._locked_hyp = hyp
            self._next_allowed = abs_idx + self.frame_syms - 2
            self.state = STATE_LOCKED
            if self.on_frame:
                self.on_frame(frame)

        # Everything before the earliest frame that is still incomplete (or
        # before the last position a header could start) is finished.
        done = len(syms) - self.header.header_len + 1
        if pending is not None:
            done = min(done, pending)
        done = max(done, start)
        self._search_from = base + done
        # Trim the buffer
        self._syms = syms[done:]
        self._sym_base = base + done
        return frames
