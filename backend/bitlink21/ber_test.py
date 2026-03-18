"""
BitLink21 BER Test Framework.

TX: Send known PRBS (pseudo-random bit sequence) pattern.
RX: Compare received bits to expected pattern.
Calculate BER = errors / total_bits.
"""

import asyncio
import logging
import time
from typing import Optional, Dict, Any

import numpy as np

logger = logging.getLogger("bitlink21")


class PRBSGenerator:
    """
    Pseudo-Random Bit Sequence generator (PRBS-15).
    Polynomial: x^15 + x^14 + 1 (ITU-T O.150)
    """

    def __init__(self, seed: int = 0x7FFF):
        self.register = seed & 0x7FFF
        if self.register == 0:
            self.register = 1

    def next_bit(self) -> int:
        """Generate next PRBS bit."""
        feedback = ((self.register >> 14) ^ (self.register >> 13)) & 1
        self.register = ((self.register << 1) | feedback) & 0x7FFF
        return feedback

    def generate(self, num_bits: int) -> bytes:
        """Generate num_bits of PRBS data, returned as bytes."""
        bits = []
        for _ in range(num_bits):
            bits.append(self.next_bit())

        # Pad to full bytes
        while len(bits) % 8 != 0:
            bits.append(0)

        # Pack to bytes
        result = bytearray()
        for i in range(0, len(bits), 8):
            byte = 0
            for b in range(8):
                byte = (byte << 1) | bits[i + b]
            result.append(byte)

        return bytes(result)

    def reset(self, seed: int = 0x7FFF):
        self.register = seed & 0x7FFF
        if self.register == 0:
            self.register = 1


def count_bit_errors(expected: bytes, received: bytes) -> int:
    """Count the number of bit errors between two byte sequences."""
    errors = 0
    min_len = min(len(expected), len(received))

    for i in range(min_len):
        xor = expected[i] ^ received[i]
        errors += bin(xor).count('1')

    # Count remaining bytes as all errors
    if len(expected) > len(received):
        errors += (len(expected) - len(received)) * 8
    elif len(received) > len(expected):
        errors += (len(received) - len(expected)) * 8

    return errors


class BERTest:
    """
    BER test controller.

    TX mode: Generate PRBS pattern, queue for transmission.
    RX mode: Compare received data against expected PRBS.
    """

    def __init__(self):
        self.running: bool = False
        self.mode: str = "idle"  # idle, tx, rx, complete

        # Test parameters
        self.test_bits: int = 10000  # Total bits to test
        self.prbs_seed: int = 0x7FFF

        # Results
        self.total_bits: int = 0
        self.error_bits: int = 0
        self.ber: float = 0.0
        self.start_time: float = 0
        self.elapsed_sec: float = 0

        # Internal
        self._prbs_tx = PRBSGenerator()
        self._prbs_rx = PRBSGenerator()
        self._tx_data: Optional[bytes] = None
        self._sio = None

    def configure(self, config: Dict[str, Any]):
        """Update test parameters."""
        if "test_bits" in config:
            self.test_bits = int(config["test_bits"])
        if "prbs_seed" in config:
            self.prbs_seed = int(config["prbs_seed"])

    def set_sio(self, sio):
        self._sio = sio

    def start_tx(self) -> bytes:
        """
        Start BER test in TX mode.
        Returns PRBS data to be transmitted.
        """
        self.running = True
        self.mode = "tx"
        self.start_time = time.time()
        self.total_bits = self.test_bits
        self.error_bits = 0
        self.ber = 0.0

        self._prbs_tx.reset(self.prbs_seed)
        self._tx_data = self._prbs_tx.generate(self.test_bits)

        logger.info(f"BER test TX started: {self.test_bits} bits, seed=0x{self.prbs_seed:04X}")
        return self._tx_data

    def process_rx(self, received_data: bytes) -> Dict[str, Any]:
        """
        Process received data against expected PRBS.
        Returns test results.
        """
        self.mode = "rx"
        self._prbs_rx.reset(self.prbs_seed)
        expected = self._prbs_rx.generate(self.test_bits)

        self.error_bits = count_bit_errors(expected, received_data)
        self.total_bits = min(len(expected), len(received_data)) * 8

        if self.total_bits > 0:
            self.ber = self.error_bits / self.total_bits
        else:
            self.ber = 1.0

        self.elapsed_sec = time.time() - self.start_time if self.start_time > 0 else 0
        self.mode = "complete"
        self.running = False

        result = self.get_results()
        logger.info(
            f"BER test complete: {self.error_bits}/{self.total_bits} errors, "
            f"BER={self.ber:.6e}, elapsed={self.elapsed_sec:.1f}s"
        )
        return result

    def stop(self):
        """Stop the test."""
        self.running = False
        self.mode = "idle"
        logger.info("BER test stopped")

    def get_results(self) -> Dict[str, Any]:
        """Get current test results."""
        return {
            "running": self.running,
            "mode": self.mode,
            "total_bits": self.total_bits,
            "error_bits": self.error_bits,
            "ber": self.ber,
            "ber_formatted": f"{self.ber:.2e}" if self.ber > 0 else "0",
            "elapsed_sec": round(self.elapsed_sec, 1),
            "test_bits": self.test_bits,
        }


# Singleton
ber_test = BERTest()
