import numpy as np
import pytest

from bitlink21.radio import envelope, filetransfer, framing


def test_crc16_mcrf4xx_check_value():
    assert framing.crc16(b"123456789") == 0x6F91


@pytest.mark.parametrize(
    "modulation,expected",
    [
        # From the comments in hsmodem's frame_packer.cpp
        ("qpsk", [1, 1, 0, 3, 3, 2, 0, 1, 2, 2, 1, 2]),
        ("8apsk", [2, 4, 7, 6, 0, 6, 4, 6]),
    ],
)
def test_header_symbols_match_hsmodem(modulation, expected):
    assert list(framing.bytes_to_symbols(framing.HEADER, modulation)) == expected


def test_8apsk_rotation_matches_hsmodem_table():
    # hsmodem rotate8APSKsyms(): 1->4, 2->3, 3->1, 4->5, 5->7, 6->2, 7->6
    pts = framing.CONSTELLATIONS["8apsk"]
    rotated = framing.decide(pts * np.exp(-2j * np.pi / 7), "8apsk")
    assert {v: int(rotated[v]) for v in range(1, 8)} == {1: 4, 2: 3, 3: 1, 4: 5, 5: 7, 6: 2, 7: 6}


def test_frame_roundtrip_corrects_16_byte_errors():
    blk = bytearray(framing.pack_frame(b"payload", framing.TYPE_BINARY_FILE, framing.STATUS_SINGLE, 7))
    assert len(blk) == framing.BLOCK_LEN and bytes(blk[:3]) == framing.HEADER
    rng = np.random.default_rng(0)
    for i in rng.choice(np.arange(3, 258), 16, replace=False):
        blk[i] ^= 0xA5
    frame = framing.unpack_block(bytes(blk))
    assert frame is not None
    assert (frame.frame_type, frame.status, frame.counter) == (framing.TYPE_BINARY_FILE, framing.STATUS_SINGLE, 7)
    assert frame.payload.startswith(b"payload")


@pytest.mark.parametrize("modulation", ["bpsk", "qpsk", "8apsk"])
def test_symbol_packing_roundtrip(modulation):
    blk = framing.pack_frame(b"x" * 219, 5, 1, 1023)
    syms = framing.bytes_to_symbols(blk, modulation)
    assert len(syms) == framing.symbols_per_block(modulation)
    assert framing.symbols_to_bytes(syms, modulation) == blk


def test_file_transfer_roundtrip_with_repeats_and_zip():
    data = bytes(range(256)) * 9
    blocks = filetransfer.build_file_frames("test.bin", data, repeat_first=3, repeat_last=2)
    rx = filetransfer.FileReceiver()
    results = [rx.push(framing.unpack_block(b)) for b in blocks]
    files = [r for r in results if r is not None]
    assert len(files) == 1
    assert files[0].name == "test.bin" and files[0].data == data


def test_file_transfer_single_frame_with_nonzero_counter():
    # hsmodem increments the counter even for single-frame files
    name_bytes = b"note.txt".ljust(50, b"\x00")
    raw = b"hi"
    tx = filetransfer.zip_bytes("note.txt", raw)
    assert len(tx) <= filetransfer.FIRST_CHUNK_DATA
    fid = framing.crc16(tx)
    payload = name_bytes + bytes([fid >> 8, fid & 0xFF, 0, 0, len(tx)]) + tx
    blk = framing.pack_frame(payload, framing.TYPE_ASCII_FILE, framing.STATUS_SINGLE, 42)
    got = filetransfer.FileReceiver().push(framing.unpack_block(blk))
    assert got is not None and got.data == raw


def test_envelope_clear_and_encrypted():
    name, data = envelope.encode(envelope.TYPE_LIGHTNING_INVOICE, b"lnbc1...", callsign="dl1abc")
    msg = envelope.decode(data)
    assert name.endswith(".ln") and msg.callsign == "DL1ABC" and not msg.encrypted

    _, enc = envelope.encode(envelope.TYPE_TEXT, b"secret", passphrase="pw")
    with pytest.raises(envelope.EnvelopeError) as e:
        envelope.decode(enc)
    assert e.value.encrypted
    with pytest.raises(envelope.EnvelopeError):
        envelope.decode(enc, "wrong")
    assert envelope.decode(enc, "pw").body == b"secret"
