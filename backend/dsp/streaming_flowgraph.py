"""
BitLink21 Streaming DSP Flowgraph — Real-time GNU Radio signal processing.

Replaces the batched BPSK decoder approach with a persistent streaming flowgraph.
Matches QO100_Transceiver's architecture: single processing chain, elliptic IIR
filters, polyphase resampler, continuous operation.

Architecture:
  pyadi-iio IQ → GNU Radio streaming chain → Audio / Decoded Data / Beacon Status

The flowgraph runs continuously. Parameters (filter width, modulation, baudrate,
beacon frequency) can be changed at runtime via GNU Radio's set_* methods
without stopping/rebuilding the flowgraph.
"""

import logging
import threading
import time
import numpy as np
from typing import Optional, Dict, Any, Callable
from scipy import signal as sp_signal

logger = logging.getLogger("bitlink21-dsp")

# Try to import GNU Radio
try:
    from gnuradio import gr, blocks, digital, analog, fft as gr_fft
    from gnuradio import filter as gr_filter
    GR_AVAILABLE = True
    logger.info("GNU Radio available for streaming DSP")
except ImportError:
    GR_AVAILABLE = False
    logger.warning("GNU Radio not available — streaming DSP disabled")


class BeaconTracker(gr.sync_block):
    """
    GNU Radio block for beacon lock — matches QO100_Transceiver liquiddrv.cpp.

    Receives narrowband IQ centered on beacon, does FFT, finds peak,
    calculates offset, reports via callback.

    Processing (every 0.2 seconds at 4 kS/s = 800 samples):
    1. Accumulate 800 samples
    2. FFT
    3. Find magnitude peak
    4. Calculate offset from expected frequency
    5. Report offset + lock state via callback
    """

    def __init__(self, sample_rate=4000, fft_size=800, expected_freq=0,
                 callback=None):
        gr.sync_block.__init__(
            self, name="BeaconTracker",
            in_sig=[np.complex64], out_sig=None
        )
        self.sample_rate = sample_rate
        self.fft_size = fft_size
        self.expected_freq = expected_freq  # Expected beacon freq in baseband (0 Hz)
        self.callback = callback

        self.buffer = np.array([], dtype=np.complex64)
        self.lock_state = "UNLOCKED"
        self.lock_count = 0
        self.offset_hz = 0.0

    def work(self, input_items, output_items):
        """Process incoming IQ samples."""
        samples = input_items[0]
        self.buffer = np.concatenate([self.buffer, samples])

        # Process when we have enough samples (800 = 0.2 sec at 4 kS/s)
        while len(self.buffer) >= self.fft_size:
            chunk = self.buffer[:self.fft_size]
            self.buffer = self.buffer[self.fft_size:]
            self._process_fft(chunk)

        return len(samples)

    def _process_fft(self, samples):
        """FFT peak detection — matches QO100_Transceiver beacon lock."""
        try:
            # FFT
            fft_data = np.abs(np.fft.fftshift(np.fft.fft(samples)))

            # Find peak
            peak_idx = np.argmax(fft_data)
            peak_val = fft_data[peak_idx]

            if peak_val < 1e-10:
                return  # No signal

            # Find all bins > 50% of peak (signal extent)
            threshold = peak_val * 0.5
            signal_bins = np.where(fft_data > threshold)[0]

            if len(signal_bins) < 2:
                return

            # Signal center frequency
            center_bin = (signal_bins[0] + signal_bins[-1]) / 2.0
            freq_resolution = self.sample_rate / self.fft_size
            center_freq = (center_bin - self.fft_size / 2.0) * freq_resolution

            # Offset from expected
            self.offset_hz = center_freq - self.expected_freq

            # Lock state machine
            if abs(self.offset_hz) < 50:
                self.lock_count = min(self.lock_count + 1, 10)
                if self.lock_count >= 5:
                    self.lock_state = "LOCKED"
            elif abs(self.offset_hz) < 500:
                self.lock_state = "TRACKING"
                self.lock_count = max(0, self.lock_count - 1)
            else:
                self.lock_state = "TRACKING"
                self.lock_count = 0

            # Report via callback
            if self.callback:
                self.callback({
                    "lock_state": self.lock_state,
                    "offset_hz": round(self.offset_hz, 1),
                    "peak_db": 20 * np.log10(peak_val + 1e-10),
                })

        except Exception as e:
            logger.debug(f"Beacon FFT error: {e}")


class ConstellationProbe(gr.sync_block):
    """
    GNU Radio block to extract constellation points for UI display.

    Taps the output of the symbol sync / costas loop and collects
    recent complex symbols for the constellation diagram.
    """

    def __init__(self, max_points=100, callback=None):
        gr.sync_block.__init__(
            self, name="ConstellationProbe",
            in_sig=[np.complex64], out_sig=[np.complex64]
        )
        self.max_points = max_points
        self.callback = callback
        self.points = []
        self.last_emit = time.time()
        self.emit_interval = 0.2  # Send to UI every 200ms

    def work(self, input_items, output_items):
        """Pass-through block that captures constellation points."""
        samples = input_items[0]
        output_items[0][:] = samples

        # Collect points
        self.points.extend(samples.tolist())
        if len(self.points) > self.max_points:
            self.points = self.points[-self.max_points:]

        # Emit periodically
        now = time.time()
        if now - self.last_emit >= self.emit_interval and self.callback:
            self.last_emit = now
            pts = self.points[-self.max_points:]
            self.callback([
                {"I": float(p.real), "Q": float(p.imag)}
                for p in pts
            ])

        return len(samples)


class StreamingRXFlowgraph:
    """
    Persistent streaming RX flowgraph for QO-100 operation.

    Replaces batched BPSK decoder. Runs continuously, parameters
    changeable at runtime without rebuilding.

    Signal chain:
    IQ input → Channel Filter (elliptic IIR) → Polyphase Resampler →
      ├── SSB Demodulator → Audio output
      └── Modem: AGC → Symbol Sync → Costas Loop → Constellation Decoder → Data output
    """

    def __init__(self, sample_rate=1000000, center_freq=739750000):
        if not GR_AVAILABLE:
            raise RuntimeError("GNU Radio not available")

        self.sample_rate = sample_rate
        self.center_freq = center_freq
        self.running = False
        self._tb = None
        self._thread = None

        # Callbacks
        self.on_audio = None        # (float32 array) → audio samples
        self.on_decoded = None      # (bytes) → decoded data
        self.on_constellation = None  # (list of {I, Q}) → constellation points
        self.on_beacon_status = None  # (dict) → beacon lock status

        # Default parameters
        self.filter_bw = 3600       # Hz — RX filter bandwidth
        self.filter_order = 4       # Elliptic filter order
        self.filter_ripple = 1.0    # dB passband ripple
        self.filter_atten = 40.0    # dB stopband attenuation
        self.modulation = 'qpsk'    # Constellation type
        self.baudrate = 4800        # Symbol rate
        self.audio_rate = 48000     # Audio output sample rate

        # Beacon parameters
        self.beacon_enabled = False
        self.beacon_freq_offset = 0  # Hz offset from center for beacon

        logger.info(
            f"StreamingRXFlowgraph initialized: sr={sample_rate/1e6:.3f} MHz, "
            f"filter={self.filter_bw} Hz, mod={self.modulation}, baud={self.baudrate}"
        )

    def _design_elliptic_filter(self, bandwidth, sample_rate):
        """Design elliptic IIR filter — matches QO100_Transceiver."""
        normalized_cutoff = bandwidth / (sample_rate / 2.0)
        normalized_cutoff = min(0.9, max(0.01, normalized_cutoff))

        b, a = sp_signal.ellip(
            self.filter_order,
            self.filter_ripple,
            self.filter_atten,
            normalized_cutoff,
            btype='low'
        )
        return b.tolist(), a.tolist()

    def _get_constellation(self, modulation):
        """Get GNU Radio constellation object for modulation type."""
        mod = modulation.lower()
        if mod == 'bpsk':
            return digital.constellation_bpsk().base(), 2
        elif mod == 'qpsk':
            return digital.constellation_qpsk().base(), 4
        elif mod == '8psk':
            return digital.constellation_8psk().base(), 8
        elif mod == 'dqpsk':
            return digital.constellation_dqpsk().base(), 4
        elif mod == '16qam':
            return digital.constellation_16qam().base(), 4
        else:
            # Generic PSK/QAM
            if 'psk' in mod:
                order = int(''.join(c for c in mod if c.isdigit()) or '4')
                pts = [np.exp(1j * 2 * np.pi * i / order) for i in range(order)]
                return digital.constellation_psk(pts, list(range(order)), order), min(order, 8)
            elif 'qam' in mod:
                order = int(''.join(c for c in mod if c.isdigit()) or '16')
                k = int(np.sqrt(order))
                pts = [complex(2*x - k + 1, 2*y - k + 1) for x in range(k) for y in range(k)]
                pts = pts[:order]
                avg = np.sqrt(np.mean([abs(p)**2 for p in pts]))
                pts = [p / avg for p in pts]
                return digital.constellation_rect(
                    pts, list(range(order)), 4,
                    int(np.sqrt(order)), int(np.sqrt(order)), 1, 1
                ), 4
            else:
                return digital.constellation_qpsk().base(), 4

    def build_flowgraph(self):
        """Build the persistent streaming flowgraph."""
        self._tb = gr.top_block("BitLink21 Streaming RX")

        # ========================================
        # IQ Source (fed externally via push method)
        # ========================================
        # Use a message-based source or a ring buffer
        # For now: use blocks.vector_source_c placeholder
        # In production: pyadi-iio feeds samples via a thread-safe queue
        self._iq_source = blocks.vector_source_c([], repeat=False)

        # ========================================
        # Channel Filter — Elliptic IIR
        # ========================================
        b, a = self._design_elliptic_filter(self.filter_bw, self.sample_rate)
        self._channel_filter = gr_filter.iir_filter_ccf(b, a)

        # ========================================
        # Polyphase Resampler — decimate to audio rate
        # ========================================
        decimation_rate = float(self.audio_rate) / float(self.sample_rate)
        nfilts = 32
        resampler_taps = gr_filter.firdes.low_pass(
            nfilts, nfilts * self.sample_rate, self.audio_rate / 2.0,
            self.audio_rate / 4.0, gr_filter.firdes.WIN_KAISER, 6.76
        )
        self._resampler = gr_filter.pfb_arb_resampler_ccf(decimation_rate, resampler_taps, nfilts)

        # ========================================
        # Audio Path — complex to real (USB demod)
        # ========================================
        self._complex_to_real = blocks.complex_to_real(1)
        self._audio_sink = blocks.vector_sink_f()  # Placeholder — replace with actual audio output

        # ========================================
        # Modem Path — AGC → Symbol Sync → Costas → Decoder
        # ========================================
        constellation, costas_order = self._get_constellation(self.modulation)
        sps = max(2, int(self.audio_rate / self.baudrate))

        self._agc = analog.agc_cc(1e-3, 1.0, 1.0)

        # RRC matched filter taps for symbol sync
        rrc_taps = gr_filter.firdes.root_raised_cosine(
            nfilts, nfilts, 1.0, 0.35, int(11 * nfilts * sps)
        )

        self._symbol_sync = digital.symbol_sync_cc(
            digital.TED_MUELLER_AND_MULLER,
            sps, 0.045, 1.0, 0.01,
            1.5, 1, constellation,
            digital.IR_PFB_MF, nfilts, rrc_taps
        )

        costas_bw = 2 * np.pi * 100 / self.audio_rate  # 100 Hz loop bandwidth
        self._costas = digital.costas_loop_cc(costas_bw, costas_order)

        # Constellation probe (for UI)
        self._constellation_probe = ConstellationProbe(
            max_points=100, callback=self.on_constellation
        )

        self._decoder = digital.constellation_decoder_cb(constellation)
        self._data_sink = blocks.vector_sink_b()

        # ========================================
        # Connect the flowgraph
        # ========================================
        # IQ → Filter → Resample
        self._tb.connect(self._iq_source, self._channel_filter, self._resampler)

        # Audio path: Resample → Complex to Real → Audio Sink
        self._tb.connect(self._resampler, self._complex_to_real, self._audio_sink)

        # Modem path: Resample → AGC → Symbol Sync → Constellation Probe → Costas → Decoder → Data Sink
        self._tb.connect(self._resampler, self._agc, self._symbol_sync,
                         self._constellation_probe, self._costas, self._decoder, self._data_sink)

        logger.info(
            f"Flowgraph built: filter={self.filter_bw}Hz elliptic(order={self.filter_order}), "
            f"mod={self.modulation}, baud={self.baudrate}, sps={sps}, "
            f"costas_order={costas_order}"
        )

    def start(self):
        """Start the streaming flowgraph."""
        if self.running:
            return
        self.build_flowgraph()
        self._tb.start()
        self.running = True
        logger.info("Streaming RX flowgraph started")

    def stop(self):
        """Stop the streaming flowgraph."""
        if not self.running:
            return
        try:
            self._tb.stop()
            self._tb.wait()
        except Exception:
            pass
        self.running = False
        logger.info("Streaming RX flowgraph stopped")

    def push_iq(self, samples):
        """Push IQ samples from pyadi-iio into the flowgraph."""
        if not self.running or self._iq_source is None:
            return
        # TODO: Replace vector_source_c with a proper streaming source
        # that accepts pushed samples (e.g., blocks.message_source or custom block)
        pass

    def set_filter_bandwidth(self, bandwidth_hz):
        """Change filter bandwidth at runtime."""
        self.filter_bw = bandwidth_hz
        if self.running and self._channel_filter:
            b, a = self._design_elliptic_filter(bandwidth_hz, self.sample_rate)
            self._channel_filter.set_taps(b, a)
            logger.info(f"Filter bandwidth updated: {bandwidth_hz} Hz")

    def set_modulation(self, modulation, baudrate=None):
        """Change modulation scheme at runtime."""
        self.modulation = modulation
        if baudrate:
            self.baudrate = baudrate
        # Note: changing constellation in a running flowgraph requires
        # rebuilding the modem chain. For now, stop/rebuild/start.
        if self.running:
            self.stop()
            self.start()
            logger.info(f"Modulation changed to {modulation} @ {self.baudrate} baud")

    def get_status(self):
        """Get current flowgraph status."""
        return {
            "running": self.running,
            "filter_bw": self.filter_bw,
            "modulation": self.modulation,
            "baudrate": self.baudrate,
            "sample_rate": self.sample_rate,
        }
