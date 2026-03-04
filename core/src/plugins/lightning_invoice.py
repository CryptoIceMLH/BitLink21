"""
Lightning Invoice & Message Plugin

Handles Lightning invoice and message payloads:
1. Parse BOLT11 invoice format
2. Optional: Connect to LND REST endpoint
3. Store invoice in database (for tracking received payments)
4. Display in UI with optional QR code generation
"""

import logging
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime
import re
import aiohttp

from . import BasePlugin

logger = logging.getLogger(__name__)


class LightningInvoicePlugin(BasePlugin):
    """Handle Lightning invoice and message payloads"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize Lightning Invoice plugin

        Args:
            config: Dictionary with keys:
                - lnd_rest_url: LND REST endpoint (e.g., http://localhost:8080)
                - lnd_cert_path: Path to LND TLS certificate (optional)
                - lnd_macaroon_path: Path to LND macaroon file (optional)
                - store_invoices: Store invoices in database (default: True)
                - timeout: Request timeout in seconds (default: 30)
        """
        super().__init__(config)
        self.lnd_rest_url = self.config.get('lnd_rest_url', None)
        self.lnd_cert_path = self.config.get('lnd_cert_path', None)
        self.lnd_macaroon_path = self.config.get('lnd_macaroon_path', None)
        self.store_invoices = self.config.get('store_invoices', True)
        self.timeout = self.config.get('timeout', 30)
        self.invoices = {}  # payment_hash -> invoice data
        self.lnd_available = False

        # Check LND connectivity on init
        if self.lnd_rest_url:
            asyncio.create_task(self._check_lnd_connection())

    async def _check_lnd_connection(self):
        """Check if LND is reachable"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f'{self.lnd_rest_url}/v1/getinfo',
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status == 200:
                        self.lnd_available = True
                        self.logger.info("LND connection established")
                    else:
                        self.logger.warning(f"LND returned status {resp.status}")
        except Exception as e:
            self.logger.debug(f"LND not available: {e}")

    async def validate(self, payload: bytes) -> bool:
        """
        Validate Lightning payload

        Args:
            payload: Raw payload bytes (BOLT11 invoice string or binary message)

        Returns:
            True if valid format, False otherwise
        """
        try:
            logger.debug(f"[LIGHTNING] Validating payload: {len(payload)} bytes")
            # Try to decode as text (BOLT11 invoices are text)
            text = payload.decode('utf-8').strip()

            # BOLT11 invoice format: starts with 'ln' (mainnet) or 'lnbr' (testnet) or 'lnbc' (testnet)
            if text.lower().startswith(('ln', 'lnbc', 'lnbr')):
                logger.debug(f"[LIGHTNING] Valid BOLT11 invoice: {text[:20]}...")
                return True

            # Could also be binary Lightning message format (BOLT8)
            # For now, accept any payload that looks like it could be Lightning-related
            is_valid = len(text) > 0
            logger.debug(f"[LIGHTNING] Text payload validation: {is_valid}")
            return is_valid
        except UnicodeDecodeError:
            # Binary format - could be valid Lightning message
            is_valid = len(payload) > 0
            logger.debug(f"[LIGHTNING] Binary payload validation: {is_valid}")
            return is_valid

    async def process(self, payload: bytes) -> Dict[str, Any]:
        """
        Process Lightning invoice or message payload

        Args:
            payload: Raw invoice/message bytes

        Returns:
            {
                'status': 'success'|'error'|'pending',
                'message': str,
                'invoice_details': dict (if invoice),
                'plugin_type': 'LightningInvoicePlugin'
            }
        """
        try:
            logger.debug(f"[LIGHTNING] process() called: payload_len={len(payload)}")
            text = payload.decode('utf-8').strip()
            logger.debug(f"[LIGHTNING] Decoded invoice: {text[:30]}...")

            self.logger.info(f"Processing Lightning invoice: {text[:30]}...")

            # Parse BOLT11 invoice
            logger.debug(f"[LIGHTNING] Parsing BOLT11 invoice")
            invoice_data = self._parse_bolt11(text)

            if not invoice_data:
                logger.warning(f"[LIGHTNING] Invalid BOLT11 format")
                return {
                    'status': 'error',
                    'message': 'Invalid BOLT11 invoice format',
                    'plugin_type': 'LightningInvoicePlugin'
                }

            logger.debug(f"[LIGHTNING] Invoice parsed: amount={invoice_data.get('amount_msat')}, network={invoice_data.get('network')}")

            # Store invoice if enabled
            if self.store_invoices:
                payment_hash = invoice_data.get('payment_hash', 'unknown')
                logger.debug(f"[LIGHTNING] Storing invoice: payment_hash={payment_hash}")
                self.invoices[payment_hash] = {
                    'timestamp': datetime.utcnow().isoformat(),
                    'invoice': text,
                    'parsed': invoice_data
                }

            # Query LND for payment status if available
            if self.lnd_available:
                logger.debug(f"[LIGHTNING] Querying LND for invoice status")
                await self._query_lnd_invoice(invoice_data)

            return {
                'status': 'success',
                'message': f"Invoice received: {invoice_data.get('amount_msat', 'unknown')} msat",
                'invoice_details': invoice_data,
                'plugin_type': 'LightningInvoicePlugin'
            }

        except Exception as e:
            self.logger.error(f"Lightning invoice processing error: {e}", exc_info=True)
            return {
                'status': 'error',
                'message': f'Invoice processing failed: {str(e)}',
                'plugin_type': 'LightningInvoicePlugin'
            }

    def _parse_bolt11(self, invoice: str) -> Optional[Dict[str, Any]]:
        """
        Parse BOLT11 invoice format

        BOLT11 format: ln[mainnet|testnet|regtest][amount][timestamp][payee][...fields...]

        For detailed parsing, would use bolt11 library. This is a basic parser.

        Args:
            invoice: BOLT11 invoice string

        Returns:
            Dictionary with parsed fields or None if invalid
        """
        try:
            invoice_lower = invoice.lower()

            # Extract network
            if invoice_lower.startswith('lnbc'):
                network = 'testnet'
            elif invoice_lower.startswith('lnbr'):
                network = 'regtest'
            else:
                network = 'mainnet'

            # Basic extraction using regex
            # Full BOLT11 parsing would require proper library
            data = {
                'network': network,
                'raw': invoice,
                'payment_hash': self._extract_payment_hash(invoice),
                'amount_msat': self._extract_amount(invoice),
                'timestamp': datetime.utcnow().isoformat()
            }

            return data
        except Exception as e:
            self.logger.error(f"BOLT11 parse error: {e}")
            return None

    def _extract_payment_hash(self, invoice: str) -> Optional[str]:
        """Extract payment hash from BOLT11 invoice"""
        # BOLT11 invoices contain 'p' field with payment hash (52 chars for SHA256)
        match = re.search(r'p([a-z0-9]{52})', invoice.lower())
        return match.group(1) if match else None

    def _extract_amount(self, invoice: str) -> Optional[str]:
        """Extract amount from BOLT11 invoice"""
        # Amount follows ln prefix, could be in msat, sat, etc.
        # Example: lnbc1500n = 1500 nanosat = 150000 psat
        match = re.search(r'ln(?:bc|br)?(\d+)([munpf]?)', invoice.lower())
        if match:
            amount = match.group(1)
            multiplier = match.group(2) or ''
            return f"{amount}{multiplier}"
        return None

    async def _query_lnd_invoice(self, invoice_data: Dict[str, Any]):
        """
        Query LND for invoice status (optional)

        Args:
            invoice_data: Parsed invoice data
        """
        if not self.lnd_available or not self.lnd_rest_url:
            return

        try:
            payment_hash = invoice_data.get('payment_hash')
            if not payment_hash:
                return

            async with aiohttp.ClientSession() as session:
                url = f'{self.lnd_rest_url}/v1/invoice/{payment_hash}'
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as resp:
                    if resp.status == 200:
                        lnd_invoice = await resp.json()
                        invoice_data['lnd_status'] = lnd_invoice.get('state', 'unknown')
                        self.logger.info(f"LND invoice status: {lnd_invoice.get('state')}")

        except Exception as e:
            self.logger.debug(f"Could not query LND: {e}")

    def get_invoices(self) -> Dict[str, Any]:
        """Return all stored invoices"""
        return self.invoices

    def get_invoice(self, payment_hash: str) -> Optional[Dict[str, Any]]:
        """Get specific invoice by payment hash"""
        return self.invoices.get(payment_hash)

    def clear_invoices(self):
        """Clear stored invoices"""
        self.invoices.clear()

    async def generate_qr_code(self, invoice: str) -> Optional[str]:
        """
        Generate QR code for invoice (base64 data URI)

        Args:
            invoice: BOLT11 invoice string

        Returns:
            Base64 data URI string or None
        """
        try:
            import qrcode
            import base64
            from io import BytesIO

            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=2,
            )
            qr.add_data(invoice)
            qr.make(fit=True)

            img = qr.make_image(fill_color="black", back_color="white")

            # Convert to base64 PNG
            buffer = BytesIO()
            img.save(buffer, format='PNG')
            buffer.seek(0)
            img_base64 = base64.b64encode(buffer.getvalue()).decode()

            return f"data:image/png;base64,{img_base64}"

        except Exception as e:
            self.logger.error(f"QR code generation error: {e}")
            return None
