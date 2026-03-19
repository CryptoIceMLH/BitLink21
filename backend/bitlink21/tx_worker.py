"""
BitLink21 TX Worker — Outbox consumer + SSP framing + modulation → tx_queue.

Runs as a thread in the main process. Reads queued messages from the outbox
database, frames them as SSP packets, modulates via GNU Radio (or NumPy fallback),
and puts IQ samples into the tx_queue for the PlutoSDR worker process to transmit.

Architecture:
  Outbox DB (SQLite) → SSP framing → FEC encode → Modulate → IQ samples → tx_queue
  PlutoSDR worker process reads tx_queue → sdr.tx(iq_samples)

The tx_queue is a multiprocessing.Queue shared between this thread (main process)
and the PlutoSDR worker (separate process).
"""

import asyncio
import logging
import threading
import time
from typing import Optional, Dict, Any
from multiprocessing import Queue

import numpy as np

from bitlink21.ssp_frame import SSPFrame
from bitlink21.modem import (
    Modulator, FECEncoder, ModScheme, SCHEME_INFO,
    create_modulator, create_fec_encoder, is_gnuradio_available, GNURadioModem
)
from bitlink21.csma import csma
import sqlite3

DB_PATH = "/app/data/bitlink21.db"

logger = logging.getLogger("bitlink21")


class TXWorker:
    """
    Outbox consumer + modulator.

    Polls the outbox for queued messages, frames them as SSP packets,
    modulates, and puts IQ samples into tx_queue for PlutoSDR transmission.
    """

    def __init__(self):
        self.active = False
        self.ptt_on = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._tx_queue: Optional[Queue] = None
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None
        self._sio = None

        # Modem configuration
        self.scheme: ModScheme = ModScheme.QPSK
        self.samples_per_symbol: int = 4
        self.use_fec: bool = True
        self.sample_rate: float = 2.048e6

        # Modulator instances (created when PTT activates)
        self._modulator: Optional[Modulator] = None
        self._fec_encoder: Optional[FECEncoder] = None
        self._gnuradio_modem: Optional[GNURadioModem] = None

        # TX timing
        self.poll_interval_sec: float = 0.5  # How often to check outbox
        self.inter_frame_gap_sec: float = 0.1  # Gap between TX bursts

        # Stats
        self.frames_sent: int = 0
        self.frames_failed: int = 0
        self.bytes_transmitted: int = 0

    def configure(self, config: Dict[str, Any]):
        """Update TX modem configuration."""
        if "scheme" in config:
            scheme_name = config["scheme"]
            # Find scheme by name
            for s, info in SCHEME_INFO.items():
                if info["name"] == scheme_name:
                    self.scheme = s
                    break
        if "samples_per_symbol" in config:
            self.samples_per_symbol = int(config["samples_per_symbol"])
        if "use_fec" in config:
            self.use_fec = bool(config["use_fec"])
        if "sample_rate" in config:
            self.sample_rate = float(config["sample_rate"])

    def set_tx_queue(self, tx_queue: Queue):
        """Set the multiprocessing queue shared with PlutoSDR worker."""
        self._tx_queue = tx_queue

    def set_event_loop(self, loop: asyncio.AbstractEventLoop):
        """Set the asyncio event loop for DB access."""
        self._event_loop = loop

    def set_sio(self, sio):
        """Set Socket.IO for status updates."""
        self._sio = sio

    def _create_modulator(self):
        """Create modulator instances based on current config."""
        # Try GNU Radio first, fall back to NumPy
        if is_gnuradio_available():
            try:
                self._gnuradio_modem = GNURadioModem(self.scheme, self.samples_per_symbol)
                logger.info(f"TX Worker: Using GNU Radio modem ({SCHEME_INFO[self.scheme]['name']})")
            except Exception as e:
                logger.warning(f"TX Worker: GNU Radio modem failed ({e}), falling back to NumPy")
                self._gnuradio_modem = None

        # NumPy fallback (always available)
        self._modulator = create_modulator(self.scheme, self.samples_per_symbol)
        self._fec_encoder = create_fec_encoder(self.use_fec)
        logger.info(
            f"TX Worker: Modulator ready — {SCHEME_INFO[self.scheme]['name']}, "
            f"{self.samples_per_symbol} sps, FEC={'ON' if self.use_fec else 'OFF'}"
        )

    def _modulate_frame(self, frame_bytes: bytes) -> Optional[np.ndarray]:
        """
        Modulate an SSP frame to IQ samples.
        Returns complex64 numpy array ready for PlutoSDR sdr.tx().
        """
        try:
            # FEC encode
            if self._fec_encoder:
                encoded = self._fec_encoder.encode(frame_bytes)
            else:
                encoded = frame_bytes

            # Modulate
            if self._gnuradio_modem:
                iq = self._gnuradio_modem.create_tx_flowgraph(encoded)
            elif self._modulator:
                iq, _ = self._modulator.modulate(encoded)
            else:
                logger.error("TX Worker: No modulator available")
                return None

            # Scale for PlutoSDR (AD9361 expects 2^14 range)
            max_val = np.max(np.abs(iq))
            if max_val > 0:
                iq = iq / max_val * (2**14 - 1) * 0.8  # 80% headroom

            return iq.astype(np.complex64)

        except Exception as e:
            logger.error(f"TX Worker: Modulation failed: {e}", exc_info=True)
            return None

    def _tx_loop(self):
        """Main TX loop — polls outbox, modulates, queues for TX."""
        logger.info("TX Worker started")
        self._create_modulator()

        while not self._stop_event.is_set():
            try:
                if not self.ptt_on:
                    self._stop_event.wait(self.poll_interval_sec)
                    continue

                if self._tx_queue is None:
                    logger.warning("TX Worker: No tx_queue set")
                    self._stop_event.wait(1.0)
                    continue

                # Read next queued message from outbox (sync SQLite — safe from thread)
                message = None
                try:
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.execute(
                        "SELECT id, destination_npub, payload_type, body FROM outbox "
                        "WHERE status='queued' ORDER BY rowid LIMIT 1"
                    )
                    row = cursor.fetchone()
                    if row:
                        message = {"id": row[0], "destination_npub": row[1],
                                   "payload_type": row[2], "body": row[3]}
                        conn.execute("UPDATE outbox SET status='sending' WHERE id=?", (row[0],))
                        conn.commit()
                    conn.close()
                except Exception as e:
                    logger.error(f"TX Worker: Failed to read outbox: {e}")

                if message is None:
                    # No queued messages, wait and retry
                    self._stop_event.wait(self.poll_interval_sec)
                    continue

                # Build SSP frame
                body = message.get("body", "")
                payload_type = message.get("payload_type", 0)
                if isinstance(payload_type, str):
                    type_map = {"text": 0, "bitcoin_tx": 1, "lightning": 2, "binary": 3}
                    payload_type = type_map.get(payload_type, 0)

                frame = SSPFrame.create(
                    payload=body.encode("utf-8") if isinstance(body, str) else body,
                    payload_type=payload_type,
                    msg_id=message.get("id", 0) & 0xFFFF,
                )

                frame_bytes = frame.to_bytes()
                logger.info(
                    f"TX Worker: Modulating frame {message.get('id')} — "
                    f"{len(frame_bytes)} bytes, type={payload_type}"
                )

                # Modulate to IQ
                iq_samples = self._modulate_frame(frame_bytes)
                if iq_samples is None:
                    self.frames_failed += 1
                    try:
                        conn = sqlite3.connect(DB_PATH)
                        conn.execute("UPDATE outbox SET status='error', error_msg='Modulation failed' WHERE id=?", (message["id"],))
                        conn.commit()
                        conn.close()
                    except Exception:
                        pass
                    continue

                # CSMA: check if channel is clear before transmitting
                if csma.enabled:
                    channel_clear = csma.sense_channel(
                        np.zeros(100),  # TODO: get real FFT data from beacon_afc
                        0, 100  # placeholder bin range
                    )
                    if not channel_clear:
                        logger.info(f"TX Worker: CSMA — channel busy, backing off")
                        self._stop_event.wait(0.5)
                        continue

                # Put IQ samples into tx_queue for PlutoSDR worker
                try:
                    self._tx_queue.put(iq_samples, timeout=5.0)
                    self.frames_sent += 1
                    self.bytes_transmitted += len(frame_bytes)

                    # Update outbox status to sent
                    try:
                        conn = sqlite3.connect(DB_PATH)
                        conn.execute("UPDATE outbox SET status='sent' WHERE id=?", (message["id"],))
                        conn.commit()
                        conn.close()
                    except Exception:
                        pass

                    logger.info(
                        f"TX Worker: Frame {message.get('id')} queued for TX "
                        f"({len(iq_samples)} IQ samples)"
                    )

                    # Emit status update
                    if self._sio and self._event_loop:
                        asyncio.run_coroutine_threadsafe(
                            self._sio.emit("bitlink21:tx_status", {
                                "frame_id": message.get("id"),
                                "status": "sent",
                                "frames_sent": self.frames_sent,
                            }),
                            self._event_loop,
                        )

                except Exception as e:
                    logger.error(f"TX Worker: Failed to queue IQ samples: {e}")
                    self.frames_failed += 1

                # Inter-frame gap
                self._stop_event.wait(self.inter_frame_gap_sec)

            except Exception as e:
                logger.error(f"TX Worker loop error: {e}", exc_info=True)
                self._stop_event.wait(1.0)

        logger.info(
            f"TX Worker stopped. Frames sent: {self.frames_sent}, "
            f"failed: {self.frames_failed}, bytes: {self.bytes_transmitted}"
        )

    def start(self):
        """Start the TX worker thread."""
        if self.active:
            return
        self.active = True
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._tx_loop, daemon=True, name="BitLink21-TXWorker"
        )
        self._thread.start()
        logger.info("TX Worker thread started")

    def stop(self):
        """Stop the TX worker thread."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None
        self.active = False

    def set_ptt(self, on: bool):
        """Set PTT state. When on, outbox is drained and transmitted."""
        self.ptt_on = on
        logger.info(f"TX Worker: PTT {'ON' if on else 'OFF'}")

    def get_status(self) -> Dict[str, Any]:
        """Get TX worker status for frontend."""
        return {
            "active": self.active,
            "ptt_on": self.ptt_on,
            "scheme": SCHEME_INFO.get(self.scheme, {}).get("name", "unknown"),
            "use_fec": self.use_fec,
            "frames_sent": self.frames_sent,
            "frames_failed": self.frames_failed,
            "bytes_transmitted": self.bytes_transmitted,
        }


# Singleton
tx_worker = TXWorker()
