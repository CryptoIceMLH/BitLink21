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
from typing import Optional, Dict, Any, Callable, List
from scipy import signal as sp_signal
from dsp.iq_bridge import IQBridge

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
        self._fft_spectrum = None  # Last FFT spectrum for mini-spectrum display

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
            fft_complex = np.fft.fftshift(np.fft.fft(samples))
            fft_data = np.abs(fft_complex)
            fft_db = 20 * np.log10(fft_data + 1e-10)
            self._fft_spectrum = fft_db.tolist()

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
                    "peak_db": float(20 * np.log10(peak_val + 1e-10)),
                    "spectrum": self._fft_spectrum,
                })

        except Exception as e:
            logger.debug(f"Beacon FFT error: {e}")

    def get_spectrum(self) -> Optional[List[float]]:
        """Return last FFT spectrum for mini-spectrum display."""
        return self._fft_spectrum


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

        # Collect points (downsample: take every Nth to avoid overwhelming)
        step = max(1, len(samples) // 20)
        self.points.extend(samples[::step].tolist())
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


class AudioDrainBlock(gr.sync_block):
    """
    GNU Radio sink block that drains audio samples and forwards them
    via a callback to the existing audio broadcaster queue.
    """

    def __init__(self, callback=None, chunk_size=1024):
        gr.sync_block.__init__(
            self, name="AudioDrain",
            in_sig=[np.float32], out_sig=None
        )
        self.callback = callback
        self.chunk_size = chunk_size
        self.buffer = np.array([], dtype=np.float32)

    def work(self, input_items, output_items):
        """Drain audio samples and forward to callback."""
        samples = input_items[0]
        if self.callback is None:
            return len(samples)

        self.buffer = np.concatenate([self.buffer, samples])
        while len(self.buffer) >= self.chunk_size:
            chunk = self.buffer[:self.chunk_size]
            self.buffer = self.buffer[self.chunk_size:]
            try:
                self.callback(chunk)
            except Exception as e:
                logger.debug(f"Audio callback error: {e}")

        return len(samples)


class DataDrainBlock(gr.sync_block):
    """
    GNU Radio sink block that collects decoded bytes and forwards
    them to a callback for SSP frame reassembly.
    """

    def __init__(self, callback=None, frame_size=219):
        gr.sync_block.__init__(
            self, name="DataDrain",
            in_sig=[np.uint8], out_sig=None
        )
        self.callback = callback
        self.frame_size = frame_size
        self.buffer = bytearray()

    def work(self, input_items, output_items):
        """Collect decoded bytes and forward complete frames."""
        data = input_items[0]
        if self.callback is None:
            return len(data)

        self.buffer.extend(data.tobytes())

        # Forward complete frames
        while len(self.buffer) >= self.frame_size:
            frame = bytes(self.buffer[:self.frame_size])
            self.buffer = self.buffer[self.frame_size:]
            try:
                self.callback(frame)
            except Exception as e:
                logger.debug(f"Data callback error: {e}")

        return len(data)


class StreamingRXFlowgraph:
    """
    Persistent streaming RX flowgraph for QO-100 operation.

    Replaces batched BPSK decoder. Runs continuously, parameters
    changeable at runtime without rebuilding.

    Signal chain:
    IQ input → Channel Filter (elliptic IIR) → Polyphase Resampler →
      ├── SSB Demodulator → Audio output (→ audio broadcaster queue)
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

        # Callbacks — set by caller before start()
        self.on_audio = None        # (float32 array) → audio samples
        self.on_decoded = None      # (bytes) → decoded data frame
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
        """
        Design elliptic IIR filter — matches QO100_Transceiver.

        Returns (b, a) coefficient lists suitable for GNU Radio iir_filter_ccf
        with oldstyle=False (scipy convention).
        """
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
        """
        Get GNU Radio constellation object for modulation type.

        Returns (constellation_object, costas_loop_order).
        """
        mod = modulation.lower()

        # Built-in convenience constellations
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
            # Generic PSK — use psk_constellation helper
            if 'psk' in mod or 'dpsk' in mod:
                order = int(''.join(c for c in mod if c.isdigit()) or '4')
                # Generate PSK points on unit circle
                points = [complex(np.cos(2 * np.pi * i / order),
                                  np.sin(2 * np.pi * i / order))
                          for i in range(order)]
                # constellation_calcdist: general-purpose, computes decision boundaries
                const = digital.constellation_calcdist(
                    points, list(range(order)), 0, 1
                )
                costas_order = min(order, 8)
                return const.base(), costas_order

            elif 'qam' in mod or 'sqam' in mod:
                order = int(''.join(c for c in mod if c.isdigit()) or '16')
                k = int(np.ceil(np.sqrt(order)))
                points = []
                for x in range(k):
                    for y in range(k):
                        if len(points) < order:
                            points.append(complex(2 * x - k + 1, 2 * y - k + 1))
                # Normalize average power to 1
                avg = np.sqrt(np.mean([abs(p)**2 for p in points]))
                if avg > 0:
                    points = [p / avg for p in points]
                const = digital.constellation_calcdist(
                    points, list(range(order)), 0, 1
                )
                return const.base(), 4

            elif 'ask' in mod or mod == 'ook':
                order = int(''.join(c for c in mod if c.isdigit()) or '2')
                if order < 2:
                    order = 2
                # ASK: real-valued constellation on I axis
                points = [complex((2 * i - order + 1) / max(order - 1, 1), 0)
                          for i in range(order)]
                const = digital.constellation_calcdist(
                    points, list(range(order)), 0, 1
                )
                return const.base(), 2

            elif 'apsk' in mod:
                order = int(''.join(c for c in mod if c.isdigit()) or '16')
                # DVB-S2 style APSK: inner ring + outer ring
                if order <= 4:
                    points = [complex(np.cos(2 * np.pi * i / order),
                                      np.sin(2 * np.pi * i / order))
                              for i in range(order)]
                elif order <= 16:
                    # 4+12 APSK (DVB-S2 standard)
                    inner = 4
                    outer = order - inner
                    r1 = 1.0
                    r2 = 2.5  # Standard DVB-S2 ring ratio
                    points = []
                    for i in range(inner):
                        points.append(complex(
                            r1 * np.cos(2 * np.pi * i / inner + np.pi / 4),
                            r1 * np.sin(2 * np.pi * i / inner + np.pi / 4)))
                    for i in range(outer):
                        points.append(complex(
                            r2 * np.cos(2 * np.pi * i / outer),
                            r2 * np.sin(2 * np.pi * i / outer)))
                else:
                    # Higher order: 4+12+16 rings
                    r1, r2, r3 = 1.0, 2.5, 4.3
                    points = []
                    for i in range(4):
                        points.append(complex(
                            r1 * np.cos(2 * np.pi * i / 4 + np.pi / 4),
                            r1 * np.sin(2 * np.pi * i / 4 + np.pi / 4)))
                    for i in range(12):
                        points.append(complex(
                            r2 * np.cos(2 * np.pi * i / 12),
                            r2 * np.sin(2 * np.pi * i / 12)))
                    remaining = order - 16
                    if remaining < 1:
                        remaining = 16
                    for i in range(remaining):
                        points.append(complex(
                            r3 * np.cos(2 * np.pi * i / remaining),
                            r3 * np.sin(2 * np.pi * i / remaining)))
                    points = points[:order]
                # Normalize
                avg = np.sqrt(np.mean([abs(p)**2 for p in points]))
                if avg > 0:
                    points = [p / avg for p in points]
                const = digital.constellation_calcdist(
                    points, list(range(len(points))), 0, 1
                )
                return const.base(), 4

            elif 'fsk' in mod or mod == 'gmsk':
                # FSK/GMSK: use BPSK constellation as carrier lock reference,
                # actual demod done by frequency discriminator (separate path)
                return digital.constellation_bpsk().base(), 2

            elif mod == 'v29':
                # V.29 modem: 16-point constellation (ITU-T V.29)
                points = [
                    complex(1, 0), complex(0, 1), complex(-1, 0), complex(0, -1),
                    complex(3, 0), complex(0, 3), complex(-3, 0), complex(0, -3),
                    complex(1, 1), complex(-1, 1), complex(-1, -1), complex(1, -1),
                    complex(3, 3), complex(-3, 3), complex(-3, -3), complex(3, -3),
                ]
                avg = np.sqrt(np.mean([abs(p)**2 for p in points]))
                points = [p / avg for p in points]
                const = digital.constellation_calcdist(
                    points, list(range(16)), 0, 1
                )
                return const.base(), 4

            elif mod == 'pi4dqpsk':
                # π/4-DQPSK
                return digital.constellation_dqpsk().base(), 4

            else:
                # Fallback to QPSK
                return digital.constellation_qpsk().base(), 4

    def build_flowgraph(self):
        """Build the persistent streaming flowgraph."""
        self._tb = gr.top_block("BitLink21 Streaming RX")

        # ========================================
        # IQ Source — fed from pyadi-iio via IQ bridge
        # ========================================
        self._iq_bridge = IQBridge()
        self._iq_source = self._iq_bridge.create_source(buffer_size=self.sample_rate)  # 1 second buffer

        # ========================================
        # Channel Filter — Elliptic IIR
        # oldstyle=False because we use scipy-generated taps (standard convention)
        # ========================================
        b, a = self._design_elliptic_filter(self.filter_bw, self.sample_rate)
        self._channel_filter = gr_filter.iir_filter_ccf(b, a, False)

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
        # Audio Path — complex to real (USB demod) → callback sink
        # Routes audio to the existing audio broadcaster queue
        # ========================================
        self._complex_to_real = blocks.complex_to_real(1)
        self._audio_sink = AudioDrainBlock(callback=self.on_audio, chunk_size=1024)

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

        # Data sink — forwards decoded bytes to callback for SSP frame reassembly
        self._data_sink = DataDrainBlock(callback=self.on_decoded, frame_size=219)

        # ========================================
        # Connect the flowgraph
        # ========================================
        # IQ → Filter → Resample
        self._tb.connect(self._iq_source, self._channel_filter, self._resampler)

        # Audio path: Resample → Complex to Real → Audio Drain (→ broadcaster)
        self._tb.connect(self._resampler, self._complex_to_real, self._audio_sink)

        # Modem path: Resample → AGC → Symbol Sync → Constellation Probe → Costas → Decoder → Data Drain
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
        self._iq_bridge.start()
        self._tb.start()
        self.running = True
        logger.info("Streaming RX flowgraph started")

    def stop(self):
        """Stop the streaming flowgraph."""
        if not self.running:
            return
        if self._iq_bridge:
            self._iq_bridge.stop()
        try:
            self._tb.stop()
            self._tb.wait()
        except Exception:
            pass
        self.running = False
        logger.info("Streaming RX flowgraph stopped")

    def push_iq(self, samples):
        """Push IQ samples from pyadi-iio into the flowgraph."""
        if not self.running or self._iq_bridge is None:
            return
        self._iq_bridge.push_samples(samples)

    def set_filter_bandwidth(self, bandwidth_hz):
        """Change filter bandwidth at runtime (hot-swap via set_taps)."""
        self.filter_bw = bandwidth_hz
        if self.running and self._channel_filter:
            b, a = self._design_elliptic_filter(bandwidth_hz, self.sample_rate)
            self._channel_filter.set_taps(b, a)
            logger.info(f"Filter bandwidth updated: {bandwidth_hz} Hz")

    def set_modulation(self, modulation, baudrate=None):
        """Change modulation scheme at runtime (requires flowgraph rebuild)."""
        self.modulation = modulation
        if baudrate:
            self.baudrate = baudrate
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
