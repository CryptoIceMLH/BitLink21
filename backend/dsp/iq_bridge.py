"""
BitLink21 IQ Bridge — Streams IQ samples from pyadi-iio to GNU Radio.

The PlutoSDR worker reads IQ via pyadi-iio (sdr.rx()). This bridge
feeds those samples into the GNU Radio streaming flowgraph using a
thread-safe ring buffer and a custom GNU Radio source block.

Architecture:
  PlutoSDR worker thread → push_samples() → ring buffer → GR source block → flowgraph
"""

import logging
import threading
import numpy as np
from collections import deque
from typing import Optional

logger = logging.getLogger("bitlink21-dsp")

try:
    from gnuradio import gr
    GR_AVAILABLE = True
except ImportError:
    GR_AVAILABLE = False


if GR_AVAILABLE:
    class IQSourceBlock(gr.sync_block):
        """
        GNU Radio source block that reads from a thread-safe ring buffer.

        The PlutoSDR worker pushes IQ samples into the buffer via push_samples().
        This block pulls samples out and feeds them to the flowgraph.
        """

        def __init__(self, buffer_size=65536):
            gr.sync_block.__init__(
                self, name="IQSourceBlock",
                in_sig=None, out_sig=[np.complex64]
            )
            self._buffer = deque(maxlen=buffer_size)
            self._lock = threading.Lock()
            self._event = threading.Event()

        def push_samples(self, samples):
            """Push IQ samples from pyadi-iio (called from PlutoSDR worker thread)."""
            with self._lock:
                self._buffer.extend(samples)
            self._event.set()

        def work(self, input_items, output_items):
            """Pull samples from buffer into GNU Radio flowgraph."""
            out = output_items[0]
            n_requested = len(out)

            with self._lock:
                n_available = len(self._buffer)
                if n_available == 0:
                    # No data — output zeros (silence)
                    out[:] = np.zeros(n_requested, dtype=np.complex64)
                    return n_requested

                n_copy = min(n_requested, n_available)
                for i in range(n_copy):
                    out[i] = self._buffer.popleft()

                # Fill remainder with zeros if not enough data
                if n_copy < n_requested:
                    out[n_copy:] = np.zeros(n_requested - n_copy, dtype=np.complex64)

            return n_requested

        def buffer_level(self):
            """Return current buffer fill level."""
            with self._lock:
                return len(self._buffer)


class IQBridge:
    """
    Bridge between pyadi-iio and GNU Radio streaming flowgraph.

    Usage:
        bridge = IQBridge()
        bridge.set_flowgraph(streaming_flowgraph)
        bridge.start()

        # In PlutoSDR worker loop:
        samples = sdr.rx()
        bridge.push_samples(samples)

        bridge.stop()
    """

    def __init__(self):
        self._source_block = None
        self._flowgraph = None
        self.running = False

    def create_source(self, buffer_size=65536):
        """Create the GNU Radio source block."""
        if not GR_AVAILABLE:
            logger.warning("GNU Radio not available — IQ bridge disabled")
            return None
        self._source_block = IQSourceBlock(buffer_size)
        return self._source_block

    def push_samples(self, samples):
        """Push IQ samples from pyadi-iio."""
        if self._source_block and self.running:
            if not isinstance(samples, np.ndarray):
                samples = np.array(samples, dtype=np.complex64)
            elif samples.dtype != np.complex64:
                samples = samples.astype(np.complex64)
            self._source_block.push_samples(samples)

    def get_buffer_level(self):
        """Get current buffer fill level."""
        if self._source_block:
            return self._source_block.buffer_level()
        return 0

    def start(self):
        self.running = True

    def stop(self):
        self.running = False
