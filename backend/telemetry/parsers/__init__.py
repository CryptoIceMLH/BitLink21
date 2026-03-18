#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Telemetry parser plugins package.

Contains satellite- or protocol-specific payload parsers that plug into
the generic TelemetryParser. Parsers should expose a class with a
`parse(payload: bytes, **kwargs) -> Dict[str, Any]` method.
"""
