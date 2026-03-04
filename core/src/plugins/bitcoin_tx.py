"""
Bitcoin Transaction Relay Plugin

Handles Bitcoin transaction payloads:
1. Parse raw Bitcoin tx hex from SSP payload
2. Connect to user's Bitcoin Core RPC endpoint (config-provided)
3. Submit via sendrawtransaction RPC call
4. Track tx hash, status, confirmations
5. Handle errors gracefully
"""

import logging
import asyncio
import json
from typing import Dict, Any, Optional
from datetime import datetime
import aiohttp

from . import BasePlugin

logger = logging.getLogger(__name__)


class BitcoinTxPlugin(BasePlugin):
    """Handle Bitcoin transaction payloads"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize Bitcoin TX plugin

        Args:
            config: Dictionary with keys:
                - rpc_url: Bitcoin Core RPC endpoint (e.g., http://localhost:8332)
                - rpc_user: RPC username
                - rpc_pass: RPC password
                - allow_high_fees: Allow high-fee transactions (default: False)
                - tx_timeout: RPC timeout in seconds (default: 30)
        """
        super().__init__(config)
        self.rpc_url = self.config.get('rpc_url', 'http://localhost:8332')
        self.rpc_user = self.config.get('rpc_user', 'bitcoin')
        self.rpc_pass = self.config.get('rpc_pass', 'password')
        self.allow_high_fees = self.config.get('allow_high_fees', False)
        self.tx_timeout = self.config.get('tx_timeout', 30)
        self.tx_history = {}  # txid -> {timestamp, status, confirmations}

    async def validate(self, payload: bytes) -> bool:
        """
        Validate Bitcoin transaction payload

        Args:
            payload: Raw hex transaction bytes (as text)

        Returns:
            True if valid hex, False otherwise
        """
        try:
            logger.debug(f"[BITCOIN_TX] Validating payload: {len(payload)} bytes")
            # Payload should be hex-encoded transaction string
            tx_hex = payload.decode('utf-8').strip()
            # Check if valid hex (even number of chars, all valid hex digits)
            if len(tx_hex) % 2 != 0:
                logger.debug(f"[BITCOIN_TX] Invalid: odd number of hex chars")
                return False
            int(tx_hex, 16)  # Try to parse as hex
            logger.debug(f"[BITCOIN_TX] Valid Bitcoin TX: {len(tx_hex)} chars")
            return True
        except (ValueError, UnicodeDecodeError) as e:
            logger.debug(f"[BITCOIN_TX] Validation error: {e}")
            return False

    async def process(self, payload: bytes) -> Dict[str, Any]:
        """
        Process Bitcoin transaction payload

        Steps:
        1. Decode payload to hex string
        2. Validate transaction format
        3. Submit to Bitcoin Core RPC
        4. Return tx hash and status

        Args:
            payload: Raw transaction hex bytes

        Returns:
            {
                'status': 'success'|'error'|'pending',
                'message': str,
                'txid': str (if successful),
                'plugin_type': 'BitcoinTxPlugin'
            }
        """
        try:
            logger.debug(f"[BITCOIN_TX] process() called: payload_len={len(payload)}")
            tx_hex = payload.decode('utf-8').strip()
            logger.debug(f"[BITCOIN_TX] Decoded TX: {len(tx_hex)} chars, prefix={tx_hex[:20]}...")

            self.logger.info(f"Processing Bitcoin TX: {tx_hex[:20]}...")

            # Attempt to send via RPC
            logger.debug(f"[BITCOIN_TX] Sending to RPC: {self.rpc_url}")
            result = await self._send_raw_transaction(tx_hex)

            if result['success']:
                txid = result['txid']
                logger.debug(f"[BITCOIN_TX] Transaction accepted: {txid}")
                self.tx_history[txid] = {
                    'timestamp': datetime.utcnow().isoformat(),
                    'status': 'broadcasted',
                    'confirmations': 0
                }

                return {
                    'status': 'success',
                    'message': f'Transaction broadcast: {txid}',
                    'txid': txid,
                    'plugin_type': 'BitcoinTxPlugin'
                }
            else:
                logger.warning(f"[BITCOIN_TX] RPC error: {result['error']}")
                return {
                    'status': 'error',
                    'message': result['error'],
                    'plugin_type': 'BitcoinTxPlugin'
                }

        except Exception as e:
            logger.error(f"[BITCOIN_TX] Bitcoin TX processing error: {e}", exc_info=True)
            self.logger.error(f"Bitcoin TX processing error: {e}", exc_info=True)
            return {
                'status': 'error',
                'message': f'Transaction processing failed: {str(e)}',
                'plugin_type': 'BitcoinTxPlugin'
            }

    async def _send_raw_transaction(self, tx_hex: str) -> Dict[str, Any]:
        """
        Send raw transaction to Bitcoin Core RPC

        Args:
            tx_hex: Transaction hex string

        Returns:
            {
                'success': bool,
                'txid': str (if success),
                'error': str (if error)
            }
        """
        logger.debug(f"[BITCOIN_TX] _send_raw_transaction called: tx_len={len(tx_hex)}, rpc_url={self.rpc_url}")
        rpc_payload = {
            'jsonrpc': '2.0',
            'id': 'bitlink21',
            'method': 'sendrawtransaction',
            'params': [tx_hex]
        }

        try:
            async with aiohttp.ClientSession() as session:
                auth = aiohttp.BasicAuth(self.rpc_user, self.rpc_pass)
                logger.debug(f"[BITCOIN_TX] Sending RPC request to {self.rpc_url}")

                async with session.post(
                    self.rpc_url,
                    json=rpc_payload,
                    auth=auth,
                    timeout=aiohttp.ClientTimeout(total=self.tx_timeout)
                ) as resp:
                    logger.debug(f"[BITCOIN_TX] RPC response: status={resp.status}")
                    response = await resp.json()

                    if 'error' in response and response['error'] is not None:
                        error_msg = response['error'].get('message', 'Unknown RPC error')
                        self.logger.warning(f"RPC error: {error_msg}")
                        return {'success': False, 'error': f'RPC error: {error_msg}'}

                    if 'result' in response:
                        txid = response['result']
                        self.logger.info(f"Transaction accepted: {txid}")
                        return {'success': True, 'txid': txid}

                    return {'success': False, 'error': 'Invalid RPC response'}

        except asyncio.TimeoutError:
            msg = f'RPC timeout after {self.tx_timeout}s'
            self.logger.error(msg)
            return {'success': False, 'error': msg}
        except aiohttp.ClientError as e:
            msg = f'RPC connection error: {str(e)}'
            self.logger.error(msg)
            return {'success': False, 'error': msg}
        except json.JSONDecodeError as e:
            msg = f'RPC response parse error: {str(e)}'
            self.logger.error(msg)
            return {'success': False, 'error': msg}

    async def get_tx_status(self, txid: str) -> Dict[str, Any]:
        """
        Get transaction status from Bitcoin Core

        Args:
            txid: Transaction ID to query

        Returns:
            {
                'txid': str,
                'status': 'broadcasted'|'in_mempool'|'confirmed'|'not_found',
                'confirmations': int,
                'timestamp': str (ISO format)
            }
        """
        try:
            rpc_payload = {
                'jsonrpc': '2.0',
                'id': 'bitlink21',
                'method': 'gettransaction',
                'params': [txid]
            }

            async with aiohttp.ClientSession() as session:
                auth = aiohttp.BasicAuth(self.rpc_user, self.rpc_pass)

                async with session.post(
                    self.rpc_url,
                    json=rpc_payload,
                    auth=auth,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    response = await resp.json()

                    if response.get('error'):
                        return {
                            'txid': txid,
                            'status': 'not_found',
                            'confirmations': 0
                        }

                    tx_info = response.get('result', {})
                    confirmations = tx_info.get('confirmations', 0)
                    status = 'confirmed' if confirmations > 0 else 'in_mempool'

                    return {
                        'txid': txid,
                        'status': status,
                        'confirmations': confirmations,
                        'timestamp': tx_info.get('time', '')
                    }

        except Exception as e:
            self.logger.error(f"Failed to get TX status: {e}")
            return {
                'txid': txid,
                'status': 'error',
                'error': str(e)
            }

    def get_history(self) -> Dict[str, Dict[str, Any]]:
        """Return transaction history"""
        return self.tx_history

    def clear_history(self):
        """Clear transaction history"""
        self.tx_history.clear()
