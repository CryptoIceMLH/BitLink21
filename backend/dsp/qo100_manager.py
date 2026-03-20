"""
BitLink21 QO-100 Manager — Manages the streaming DSP flowgraph.

Singleton that owns the streaming RX/TX flowgraphs, handles parameter
changes from the frontend, and bridges between the PlutoSDR worker
and the GNU Radio chain.

Socket.IO handlers call methods on this manager to control DSP.
"""

import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("bitlink21-dsp")

try:
    from dsp.streaming_flowgraph import StreamingRXFlowgraph, GR_AVAILABLE
except ImportError:
    GR_AVAILABLE = False


class QO100Manager:
    """Manages the QO-100 streaming DSP chain."""

    def __init__(self):
        self.rx_flowgraph: Optional[StreamingRXFlowgraph] = None
        self.active = False

        # Callbacks for frontend updates
        self.on_beacon_status = None
        self.on_constellation = None
        self.on_decoded_data = None

    def start(self, sample_rate=1000000, center_freq=739750000):
        """Start the QO-100 streaming DSP."""
        if not GR_AVAILABLE:
            logger.error("GNU Radio not available — cannot start QO-100 DSP")
            return False

        if self.active:
            self.stop()

        self.rx_flowgraph = StreamingRXFlowgraph(sample_rate, center_freq)
        self.rx_flowgraph.on_constellation = self.on_constellation
        self.rx_flowgraph.on_beacon_status = self.on_beacon_status

        try:
            self.rx_flowgraph.start()
            self.active = True
            logger.info("QO-100 DSP started")
            return True
        except Exception as e:
            logger.error(f"Failed to start QO-100 DSP: {e}")
            return False

    def stop(self):
        """Stop the QO-100 streaming DSP."""
        if self.rx_flowgraph:
            self.rx_flowgraph.stop()
        self.active = False
        logger.info("QO-100 DSP stopped")

    def push_iq(self, samples):
        """Push IQ samples from PlutoSDR worker."""
        if self.rx_flowgraph and self.active:
            self.rx_flowgraph.push_iq(samples)

    def set_filter(self, bandwidth_hz):
        """Change RX filter bandwidth."""
        if self.rx_flowgraph:
            self.rx_flowgraph.set_filter_bandwidth(bandwidth_hz)

    def set_modulation(self, modulation, baudrate=None):
        """Change modem modulation/baudrate."""
        if self.rx_flowgraph:
            self.rx_flowgraph.set_modulation(modulation, baudrate)

    def get_status(self):
        """Get DSP status."""
        if self.rx_flowgraph:
            return self.rx_flowgraph.get_status()
        return {"running": False}


# Singleton
qo100_manager = QO100Manager()
