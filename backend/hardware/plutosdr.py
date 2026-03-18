# Copyright (c) 2025 BitLink21 Contributors
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.


import logging
from typing import Any, Dict, List, Optional, TypedDict

logger = logging.getLogger("plutosdr-probe")

# AD9361 hardware specifications
AD9361_FREQ_MIN_HZ = 70e6
AD9361_FREQ_MAX_HZ = 6000e6
AD9361_RX_GAIN_MIN_DB = -1.0
AD9361_RX_GAIN_MAX_DB = 73.0
AD9361_TX_GAIN_MIN_DB = -89.75
AD9361_TX_GAIN_MAX_DB = 0.0
AD9361_SAMPLE_RATE_MIN_HZ = 520833
AD9361_SAMPLE_RATE_MAX_HZ = 61440000


class FrequencyRange(TypedDict):
    min: float
    max: float


class GainRange(TypedDict):
    min: float
    max: float
    step: Optional[float]


class PlutoSDRData(TypedDict):
    model: str
    serial: str
    firmware_version: str
    frequency_range: Dict[str, FrequencyRange]
    sample_rate_range: Dict[str, float]
    gain_range: Dict[str, GainRange]
    channels: Dict[str, int]
    rx_rf_bandwidth: int
    tx_rf_bandwidth: int
    sample_rate: int
    rx_lo: int
    tx_lo: int
    rx_gain: float
    tx_gain: float
    gain_control_modes: List[str]
    gain_control_mode: str
    xo_correction: Optional[int]
    temperature: Optional[str]
    capabilities: Dict[str, Any]


class ProbeReply(TypedDict):
    success: Optional[bool]
    data: Optional[PlutoSDRData]
    error: Optional[str]
    log: List[str]


def probe_plutosdr(uri: str = "ip:192.168.1.200") -> ProbeReply:
    """Connect to a PlutoSDR via pyadi-iio and retrieve device information.

    Probes the ADALM-PLUTO (AD9361) device at the given URI and returns
    comprehensive hardware information including model, serial, firmware,
    frequency/gain/sample-rate ranges, current configuration, and capabilities.

    Args:
        uri: IIO context URI for the PlutoSDR device.
             Examples: "ip:192.168.1.200", "ip:pluto.local", "usb:1.2.3"

    Returns:
        ProbeReply dictionary containing:
            - success: True if probe succeeded, False otherwise
            - data: PlutoSDRData with device details (or None on failure)
            - error: Error message string (or None on success)
            - log: List of log messages generated during probe
    """
    reply: ProbeReply = {
        "success": None,
        "data": None,
        "error": None,
        "log": [],
    }

    reply["log"].append(f"INFO: Probing PlutoSDR at {uri}")

    try:
        import adi
    except ImportError as e:
        error_msg = (
            f"pyadi-iio is not installed. Install with: pip install pyadi-iio. Error: {e}"
        )
        reply["log"].append(f"ERROR: {error_msg}")
        reply["success"] = False
        reply["error"] = error_msg
        return reply

    sdr = None
    try:
        sdr = adi.Pluto(uri=uri)
        reply["log"].append(f"INFO: Connected to PlutoSDR at {uri}")

        # ----------------------------------------------------------------
        # Device identification via IIO context attributes
        # ----------------------------------------------------------------
        model = ""
        serial = ""
        firmware_version = ""

        try:
            ctx = sdr._ctx
            # IIO context attributes contain hardware info
            ctx_attrs = {}
            for attr_name in ctx.attrs:
                try:
                    ctx_attrs[attr_name] = ctx.attrs[attr_name].value
                except Exception:
                    pass

            model = ctx_attrs.get("hw_model", "ADALM-PLUTO")
            serial = ctx_attrs.get("hw_serial", ctx_attrs.get("serial", ""))
            firmware_version = ctx_attrs.get(
                "fw_version", ctx_attrs.get("ad9361-phy,fw_version", "")
            )

            reply["log"].append(f"INFO: Model: {model}")
            reply["log"].append(f"INFO: Serial: {serial}")
            reply["log"].append(f"INFO: Firmware: {firmware_version}")
            reply["log"].append(f"INFO: IIO context attrs: {list(ctx_attrs.keys())}")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read IIO context attributes: {e}")
            model = "ADALM-PLUTO"

        # ----------------------------------------------------------------
        # Current configuration readback
        # ----------------------------------------------------------------
        current_sample_rate = 0
        current_rx_lo = 0
        current_tx_lo = 0
        current_rx_gain = 0.0
        current_tx_gain = 0.0
        current_rx_bw = 0
        current_tx_bw = 0
        gain_control_mode = "manual"

        try:
            current_sample_rate = int(sdr.sample_rate)
            reply["log"].append(f"INFO: Current sample rate: {current_sample_rate / 1e6:.3f} MHz")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read sample rate: {e}")

        try:
            current_rx_lo = int(sdr.rx_lo)
            reply["log"].append(f"INFO: Current RX LO: {current_rx_lo / 1e6:.3f} MHz")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read RX LO: {e}")

        try:
            current_tx_lo = int(sdr.tx_lo)
            reply["log"].append(f"INFO: Current TX LO: {current_tx_lo / 1e6:.3f} MHz")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read TX LO: {e}")

        try:
            current_rx_gain = float(sdr.rx_hardwaregain_chan0)
            reply["log"].append(f"INFO: Current RX gain: {current_rx_gain} dB")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read RX gain: {e}")

        try:
            current_tx_gain = float(sdr.tx_hardwaregain_chan0)
            reply["log"].append(f"INFO: Current TX gain: {current_tx_gain} dB")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read TX gain: {e}")

        try:
            current_rx_bw = int(sdr.rx_rf_bandwidth)
            reply["log"].append(f"INFO: Current RX RF bandwidth: {current_rx_bw / 1e3:.1f} kHz")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read RX RF bandwidth: {e}")

        try:
            current_tx_bw = int(sdr.tx_rf_bandwidth)
            reply["log"].append(f"INFO: Current TX RF bandwidth: {current_tx_bw / 1e3:.1f} kHz")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read TX RF bandwidth: {e}")

        try:
            gain_control_mode = str(sdr.gain_control_mode_chan0)
            reply["log"].append(f"INFO: Gain control mode: {gain_control_mode}")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not read gain control mode: {e}")

        # ----------------------------------------------------------------
        # Available gain control modes
        # ----------------------------------------------------------------
        gain_control_modes = ["manual", "slow_attack", "fast_attack", "hybrid"]
        reply["log"].append(f"INFO: Available gain control modes: {gain_control_modes}")

        # ----------------------------------------------------------------
        # XO correction
        # ----------------------------------------------------------------
        xo_correction = None
        try:
            xo_correction = int(sdr._ctrl.attrs["xo_correction"].value)
            reply["log"].append(f"INFO: XO correction: {xo_correction} Hz")
        except Exception as e:
            reply["log"].append(f"INFO: Could not read XO correction: {e}")

        # ----------------------------------------------------------------
        # Temperature sensor
        # ----------------------------------------------------------------
        temperature = None
        try:
            # AD9361 has an internal temperature sensor accessible via IIO
            temp_channel = sdr._ctrl.find_channel("temp0")
            if temp_channel is not None:
                raw = int(temp_channel.attrs["raw"].value)
                scale = float(temp_channel.attrs["scale"].value)
                offset = float(temp_channel.attrs["offset"].value)
                temp_c = (raw + offset) * scale / 1000.0
                temperature = f"{temp_c:.1f} C"
                reply["log"].append(f"INFO: Die temperature: {temperature}")
        except Exception as e:
            reply["log"].append(f"INFO: Could not read temperature: {e}")

        # ----------------------------------------------------------------
        # Channel count (AD9361 is 1T1R on Pluto, 2T2R with firmware hack)
        # ----------------------------------------------------------------
        rx_channels = 1
        tx_channels = 1
        try:
            # Check if 2T2R is enabled (F5OEO tezuka firmware)
            if hasattr(sdr, "rx_enabled_channels"):
                rx_channels = len(sdr.rx_enabled_channels)
            if hasattr(sdr, "tx_enabled_channels"):
                tx_channels = len(sdr.tx_enabled_channels)
        except Exception:
            pass
        reply["log"].append(f"INFO: Channels: {rx_channels}RX / {tx_channels}TX")

        # ----------------------------------------------------------------
        # Extended capabilities
        # ----------------------------------------------------------------
        capabilities: Dict[str, Any] = {
            "fdd_mode": True,  # AD9361 supports FDD
            "duplex": "full",
            "iq_format": "complex64",
            "has_tx": True,
            "has_rx": True,
            "rx_channels": rx_channels,
            "tx_channels": tx_channels,
            "iio_context_attrs": {},
        }

        try:
            ctx = sdr._ctx
            for attr_name in ctx.attrs:
                try:
                    capabilities["iio_context_attrs"][attr_name] = ctx.attrs[attr_name].value
                except Exception:
                    pass
        except Exception:
            pass

        # ----------------------------------------------------------------
        # Assemble probe result
        # ----------------------------------------------------------------
        reply["success"] = True
        reply["data"] = {
            "model": model,
            "serial": serial,
            "firmware_version": firmware_version,
            "frequency_range": {
                "rx": {
                    "min": AD9361_FREQ_MIN_HZ / 1e6,
                    "max": AD9361_FREQ_MAX_HZ / 1e6,
                },
                "tx": {
                    "min": AD9361_FREQ_MIN_HZ / 1e6,
                    "max": AD9361_FREQ_MAX_HZ / 1e6,
                },
            },
            "sample_rate_range": {
                "min": AD9361_SAMPLE_RATE_MIN_HZ,
                "max": AD9361_SAMPLE_RATE_MAX_HZ,
            },
            "gain_range": {
                "rx": {
                    "min": AD9361_RX_GAIN_MIN_DB,
                    "max": AD9361_RX_GAIN_MAX_DB,
                    "step": 0.25,
                },
                "tx": {
                    "min": AD9361_TX_GAIN_MIN_DB,
                    "max": AD9361_TX_GAIN_MAX_DB,
                    "step": 0.25,
                },
            },
            "channels": {
                "rx": rx_channels,
                "tx": tx_channels,
            },
            "rx_rf_bandwidth": current_rx_bw,
            "tx_rf_bandwidth": current_tx_bw,
            "sample_rate": current_sample_rate,
            "rx_lo": current_rx_lo,
            "tx_lo": current_tx_lo,
            "rx_gain": current_rx_gain,
            "tx_gain": current_tx_gain,
            "gain_control_modes": gain_control_modes,
            "gain_control_mode": gain_control_mode,
            "xo_correction": xo_correction,
            "temperature": temperature,
            "capabilities": capabilities,
        }

    except Exception as e:
        error_msg = f"Error probing PlutoSDR at {uri}: {e}"
        reply["log"].append(f"ERROR: {error_msg}")
        reply["success"] = False
        reply["error"] = str(e)

    finally:
        if sdr is not None:
            try:
                del sdr
            except Exception:
                pass

    return reply
