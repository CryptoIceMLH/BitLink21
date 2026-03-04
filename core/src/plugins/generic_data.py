"""
Generic Data Pass-Through Plugin

Handles binary payload pass-through:
1. Store binary data in database
2. Optional: webhook to external app on receipt
3. Allow user to export/download
"""

import logging
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime
import base64
import aiohttp

from . import BasePlugin

logger = logging.getLogger(__name__)


class GenericDataPlugin(BasePlugin):
    """Handle generic binary data payloads"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize Generic Data plugin

        Args:
            config: Dictionary with keys:
                - webhook_url: URL to POST data to on receipt (optional)
                - webhook_timeout: Webhook request timeout in seconds (default: 10)
                - max_storage_items: Maximum items to store (default: 1000)
                - enable_export: Allow exporting data (default: True)
        """
        super().__init__(config)
        self.webhook_url = self.config.get('webhook_url', None)
        self.webhook_timeout = self.config.get('webhook_timeout', 10)
        self.max_storage_items = self.config.get('max_storage_items', 1000)
        self.enable_export = self.config.get('enable_export', True)
        self.data_storage = []  # List of {id, timestamp, data_base64, size}

    async def validate(self, payload: bytes) -> bool:
        """
        Validate generic data payload

        Any non-empty payload is valid.

        Args:
            payload: Raw payload bytes

        Returns:
            True if payload is not empty, False otherwise
        """
        is_valid = len(payload) > 0
        logger.debug(f"[GENERIC_DATA] Validating payload: {len(payload)} bytes, valid={is_valid}")
        return is_valid

    async def process(self, payload: bytes) -> Dict[str, Any]:
        """
        Process generic data payload

        Steps:
        1. Store payload in memory/database
        2. Call webhook if configured
        3. Return storage info

        Args:
            payload: Raw binary data

        Returns:
            {
                'status': 'success'|'error'|'webhook_pending',
                'message': str,
                'data_id': str,
                'size_bytes': int,
                'plugin_type': 'GenericDataPlugin'
            }
        """
        try:
            logger.debug(f"[GENERIC_DATA] process() called: payload_len={len(payload)}")
            # Generate unique ID for this data item
            data_id = f"data_{datetime.utcnow().isoformat()}_{len(self.data_storage)}"
            logger.debug(f"[GENERIC_DATA] Generated data_id: {data_id}")

            # Store data
            data_item = {
                'id': data_id,
                'timestamp': datetime.utcnow().isoformat(),
                'data_base64': base64.b64encode(payload).decode('utf-8'),
                'size_bytes': len(payload)
            }

            logger.debug(f"[GENERIC_DATA] Storing data item: {data_id}, size={len(payload)} bytes")
            self.logger.info(f"Storing generic data: {data_id} ({len(payload)} bytes)")

            # Enforce max storage
            if len(self.data_storage) >= self.max_storage_items:
                logger.debug(f"[GENERIC_DATA] Storage limit reached ({self.max_storage_items}), removing oldest")
                self.data_storage.pop(0)  # Remove oldest

            self.data_storage.append(data_item)
            logger.debug(f"[GENERIC_DATA] Data item added, total_items={len(self.data_storage)}")

            # Call webhook if configured
            webhook_status = 'none'
            if self.webhook_url:
                logger.debug(f"[GENERIC_DATA] Calling webhook: {self.webhook_url}")
                webhook_status = await self._call_webhook(data_item)

            return {
                'status': 'success' if webhook_status != 'error' else 'webhook_pending',
                'message': f'Data stored: {data_id} ({len(payload)} bytes)',
                'data_id': data_id,
                'size_bytes': len(payload),
                'webhook_status': webhook_status,
                'plugin_type': 'GenericDataPlugin'
            }

        except Exception as e:
            logger.error(f"[GENERIC_DATA] Generic data processing error: {e}", exc_info=True)
            self.logger.error(f"Generic data processing error: {e}", exc_info=True)
            return {
                'status': 'error',
                'message': f'Data processing failed: {str(e)}',
                'plugin_type': 'GenericDataPlugin'
            }

    async def _call_webhook(self, data_item: Dict[str, Any]) -> str:
        """
        POST data to external webhook URL

        Args:
            data_item: Data item to send

        Returns:
            'success', 'error', or 'pending'
        """
        if not self.webhook_url:
            return 'none'

        try:
            logger.debug(f"[GENERIC_DATA] Calling webhook: {self.webhook_url}, data_id={data_item['id']}, size={data_item['size_bytes']}")
            payload = {
                'data_id': data_item['id'],
                'timestamp': data_item['timestamp'],
                'size_bytes': data_item['size_bytes'],
                'data_base64': data_item['data_base64']
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.webhook_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=self.webhook_timeout)
                ) as resp:
                    logger.debug(f"[GENERIC_DATA] Webhook response: status={resp.status}")
                    if resp.status in (200, 201, 202):
                        logger.debug(f"[GENERIC_DATA] Webhook success")
                        self.logger.info(f"Webhook called successfully: {self.webhook_url}")
                        return 'success'
                    else:
                        logger.warning(f"[GENERIC_DATA] Webhook returned {resp.status}")
                        self.logger.warning(f"Webhook returned {resp.status}")
                        return 'error'

        except asyncio.TimeoutError:
            logger.warning(f"[GENERIC_DATA] Webhook timeout after {self.webhook_timeout}s")
            self.logger.warning(f"Webhook timeout after {self.webhook_timeout}s")
            return 'pending'
        except Exception as e:
            logger.error(f"[GENERIC_DATA] Webhook error: {e}")
            self.logger.error(f"Webhook error: {e}")
            return 'error'

    def get_data(self, data_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve stored data by ID

        Args:
            data_id: Data item ID

        Returns:
            Data item dict or None if not found
        """
        for item in self.data_storage:
            if item['id'] == data_id:
                return item
        return None

    def get_data_raw(self, data_id: str) -> Optional[bytes]:
        """
        Get raw binary data for download

        Args:
            data_id: Data item ID

        Returns:
            Raw bytes or None
        """
        item = self.get_data(data_id)
        if item:
            return base64.b64decode(item['data_base64'])
        return None

    def list_data(self, limit: int = 100) -> list:
        """
        List stored data items (newest first)

        Args:
            limit: Maximum number of items to return

        Returns:
            List of data item summaries (without base64 content)
        """
        result = []
        for item in reversed(self.data_storage[-limit:]):
            result.append({
                'id': item['id'],
                'timestamp': item['timestamp'],
                'size_bytes': item['size_bytes']
            })
        return result

    def delete_data(self, data_id: str) -> bool:
        """
        Delete stored data item

        Args:
            data_id: Data item ID

        Returns:
            True if deleted, False if not found
        """
        for i, item in enumerate(self.data_storage):
            if item['id'] == data_id:
                self.data_storage.pop(i)
                self.logger.info(f"Deleted data item: {data_id}")
                return True
        return False

    def clear_storage(self):
        """Clear all stored data"""
        count = len(self.data_storage)
        self.data_storage.clear()
        self.logger.info(f"Cleared {count} data items from storage")

    def get_storage_stats(self) -> Dict[str, Any]:
        """Get storage statistics"""
        total_bytes = sum(item['size_bytes'] for item in self.data_storage)
        return {
            'total_items': len(self.data_storage),
            'total_bytes': total_bytes,
            'max_items': self.max_storage_items,
            'webhook_enabled': self.webhook_url is not None,
            'export_enabled': self.enable_export
        }
