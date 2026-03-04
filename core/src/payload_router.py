"""
Payload Router — Route inbound SSP payloads to plugins

Responsibilities:
1. Detect payload_type from SSP frame
2. Dispatch to appropriate plugin handler
3. Handle plugin errors without crashing core
4. Log all transactions
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime

from .ssp_frame import SSPFrame, PayloadType
from .plugins import PluginLoader
from .logging_config import get_logger

logger = get_logger("payload_router")


class PayloadRouter:
    """Route inbound SSP payloads to appropriate plugins"""

    def __init__(self, plugin_loader: PluginLoader):
        """
        Initialize router with plugin system

        Args:
            plugin_loader: PluginLoader instance with registered plugins
        """
        logger.debug(f"[PAYLOAD_ROUTER] Initializing PayloadRouter")
        self.plugin_loader = plugin_loader
        self.payload_stats = {
            'total_received': 0,
            'total_processed': 0,
            'errors': 0,
            'by_type': {}
        }
        self.processed_messages = []  # For audit trail
        logger.debug(f"[PAYLOAD_ROUTER] Initialization complete")

    async def route_ssp_frame(self, frame: SSPFrame) -> Dict[str, Any]:
        """
        Route a received SSP frame to appropriate plugin

        Args:
            frame: SSPFrame object to route

        Returns:
            {
                'status': 'success'|'error'|'pending'|'unhandled',
                'payload_type': int,
                'plugin_result': dict (from plugin),
                'timestamp': str,
                'error': str (if error)
            }
        """
        try:
            logger.debug(f"[PAYLOAD_ROUTER] route_ssp_frame called: msg_id={frame.msg_id}, payload_len={frame.payload_len}")
            self.payload_stats['total_received'] += 1

            # Get payload type
            payload_type = frame.payload_type
            payload_type_name = self._get_type_name(payload_type)
            logger.debug(f"[PAYLOAD_ROUTER] Payload type: {payload_type_name} ({payload_type})")

            # Initialize stats for this type if needed
            if payload_type not in self.payload_stats['by_type']:
                logger.debug(f"[PAYLOAD_ROUTER] First occurrence of payload type {payload_type_name}, initializing stats")
                self.payload_stats['by_type'][payload_type] = {
                    'count': 0,
                    'name': payload_type_name
                }

            self.payload_stats['by_type'][payload_type]['count'] += 1

            logger.info(
                f"Routing SSP frame - Type: {payload_type_name} ({payload_type}), "
                f"Size: {frame.payload_len} bytes, "
                f"MsgID: {frame.msg_id}, Seq: {frame.seq_num}/{frame.total_frags}"
            )

            # Handle different payload types
            logger.debug(f"[PAYLOAD_ROUTER] Dispatching to handler for type {payload_type_name}")
            if payload_type == PayloadType.TEXT:
                result = await self._handle_text_payload(frame.payload)
            elif payload_type == PayloadType.BITCOIN_TX:
                result = await self._handle_bitcoin_tx(frame.payload)
            elif payload_type == PayloadType.LIGHTNING:
                result = await self._handle_lightning_payload(frame.payload)
            elif payload_type == PayloadType.BINARY:
                result = await self._handle_binary_payload(frame.payload)
            else:
                logger.warning(f"[PAYLOAD_ROUTER] Unknown payload type: {payload_type}")
                result = {
                    'status': 'unhandled',
                    'message': f'No handler for payload type {payload_type}'
                }

            logger.debug(f"[PAYLOAD_ROUTER] Handler completed: status={result.get('status')}")
            self.payload_stats['total_processed'] += 1

            # Log audit trail
            self.processed_messages.append({
                'timestamp': datetime.utcnow().isoformat(),
                'payload_type': payload_type_name,
                'msg_id': frame.msg_id,
                'status': result.get('status', 'unknown'),
                'size_bytes': frame.payload_len
            })

            return {
                'status': result.get('status', 'error'),
                'payload_type': payload_type,
                'payload_type_name': payload_type_name,
                'plugin_result': result,
                'timestamp': datetime.utcnow().isoformat()
            }

        except Exception as e:
            self.payload_stats['errors'] += 1
            logger.error(f"[PAYLOAD_ROUTER] Payload routing error: {e}", exc_info=True)
            return {
                'status': 'error',
                'payload_type': frame.payload_type,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    async def _handle_text_payload(self, payload: bytes) -> Dict[str, Any]:
        """
        Handle text message payload

        Args:
            payload: Raw payload bytes (UTF-8 encoded text)

        Returns:
            Processing result dict
        """
        try:
            logger.debug(f"[PAYLOAD_ROUTER] Handling text payload: {len(payload)} bytes")
            text = payload.decode('utf-8', errors='replace')
            logger.debug(f"[PAYLOAD_ROUTER] Decoded text: {text[:50]}...")
            logger.info(f"Received text message: {text[:50]}...")

            return {
                'status': 'success',
                'message_type': 'text',
                'text': text,
                'length': len(text)
            }
        except Exception as e:
            logger.error(f"[PAYLOAD_ROUTER] Text payload error: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }

    async def _handle_bitcoin_tx(self, payload: bytes) -> Dict[str, Any]:
        """
        Handle Bitcoin transaction payload via plugin

        Args:
            payload: Raw Bitcoin transaction hex

        Returns:
            Plugin result dict
        """
        logger.debug(f"[PAYLOAD_ROUTER] Dispatching Bitcoin TX payload: {len(payload)} bytes")
        logger.info(f"Bitcoin TX payload received ({len(payload)} bytes)")
        result = await self.plugin_loader.dispatch(PayloadType.BITCOIN_TX, payload)
        logger.debug(f"[PAYLOAD_ROUTER] Bitcoin TX handler returned: status={result.get('status')}")
        return result

    async def _handle_lightning_payload(self, payload: bytes) -> Dict[str, Any]:
        """
        Handle Lightning invoice/message payload via plugin

        Args:
            payload: Raw Lightning payload

        Returns:
            Plugin result dict
        """
        logger.debug(f"[PAYLOAD_ROUTER] Dispatching Lightning payload: {len(payload)} bytes")
        logger.info(f"Lightning payload received ({len(payload)} bytes)")
        result = await self.plugin_loader.dispatch(PayloadType.LIGHTNING, payload)
        logger.debug(f"[PAYLOAD_ROUTER] Lightning handler returned: status={result.get('status')}")
        return result

    async def _handle_binary_payload(self, payload: bytes) -> Dict[str, Any]:
        """
        Handle generic binary data payload via plugin

        Args:
            payload: Raw binary data

        Returns:
            Plugin result dict
        """
        logger.debug(f"[PAYLOAD_ROUTER] Dispatching binary payload: {len(payload)} bytes")
        logger.info(f"Binary payload received ({len(payload)} bytes)")
        result = await self.plugin_loader.dispatch(PayloadType.BINARY, payload)
        logger.debug(f"[PAYLOAD_ROUTER] Binary handler returned: status={result.get('status')}")
        return result

    def _get_type_name(self, payload_type: int) -> str:
        """Get human-readable name for payload type"""
        names = {
            PayloadType.TEXT: 'TEXT',
            PayloadType.BITCOIN_TX: 'BITCOIN_TX',
            PayloadType.LIGHTNING: 'LIGHTNING',
            PayloadType.BINARY: 'BINARY'
        }
        return names.get(payload_type, f'UNKNOWN({payload_type})')

    def get_stats(self) -> Dict[str, Any]:
        """Get routing statistics"""
        return {
            'total_received': self.payload_stats['total_received'],
            'total_processed': self.payload_stats['total_processed'],
            'errors': self.payload_stats['errors'],
            'by_type': self.payload_stats['by_type']
        }

    def get_message_log(self, limit: int = 100) -> list:
        """
        Get audit trail of processed messages

        Args:
            limit: Maximum messages to return

        Returns:
            List of message records (newest first)
        """
        return self.processed_messages[-limit:]

    def clear_stats(self):
        """Clear routing statistics"""
        self.payload_stats['total_received'] = 0
        self.payload_stats['total_processed'] = 0
        self.payload_stats['errors'] = 0
        self.payload_stats['by_type'] = {}
