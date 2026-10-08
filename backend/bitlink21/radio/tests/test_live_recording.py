"""Regression test on a real off-air recording.

tests/data/qo100_mm_beacon_25ksps.iq16 is 8 s of the AMSAT-DL QO-100
multimedia beacon (HSModem 8APSK 2400 Bd), received 2026-10-08 with a
PlutoSDR + LNB and channelised to 1e6/41 S/s around the beacon (int16 I/Q,
interleaved). Every frame decoded here passed hsmodem's RS(255,223) and
CRC16, i.e. this proves bit-exact compatibility with real HSModem traffic.
"""

import os

import numpy as np

from bitlink21.radio.demodulator import HsModemReceiver
from bitlink21.radio.modes import get_mode

DATA = os.path.join(os.path.dirname(__file__), "data", "qo100_mm_beacon_25ksps.iq16")
FS = 1e6 / 41


def test_decodes_real_qo100_multimedia_beacon():
    raw = np.fromfile(DATA, dtype=np.int16).reshape(-1, 2)
    x = (raw[:, 0].astype(np.float32) + 1j * raw[:, 1].astype(np.float32)) / 32768
    rx = HsModemReceiver(FS, get_mode(9), channel_offset_hz=0.0, search_span_hz=1500)
    frames = []
    for i in range(0, len(x), 4096):
        frames += rx.process(x[i: i + 4096].astype(np.complex64))
    assert len(frames) >= 15, rx.status()
    assert rx.status()["mer_db"] > 10
    # The beacon's live data stream uses HSModem frame type 8 (external data)
    assert {f.frame_type for f in frames} == {8}
