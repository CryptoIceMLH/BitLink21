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

from bitlink21.plugins import BasePlugin

logger = logging.getLogger(__name__)


class GenericDataPlugin(BasePlugin):
    """Handle generic binary data payloads"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.webhook_url = self.config.get('webhook_url', None)
        self.webhook_timeout = self.config.get('webhook_timeout', 10)
        self.max_storage_items = self.config.get('max_storage_items', 1000)
        self.enable_export = self.config.get('enable_export', True)
        self.data_storage = []

    async def validate(self, payload: bytes) -> bool:
        return len(payload) > 0

    async def process(self, payload: bytes) -> Dict[str, Any]:
        try:
            data_id = f"data_{datetime.utcnow().isoformat()}_{len(self.data_storage)}"
            data_item = {
                'id': data_id,
                'timestamp': datetime.utcnow().isoformat(),
                'data_base64': base64.b64encode(payload).decode('utf-8'),
                'size_bytes': len(payload)
            }
            self.logger.info(f"Storing generic data: {data_id} ({len(payload)} bytes)")
            if len(self.data_storage) >= self.max_storage_items:
                self.data_storage.pop(0)
            self.data_storage.append(data_item)

            webhook_status = 'none'
            if self.webhook_url:
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
            return {'status': 'error', 'message': f'Data processing failed: {str(e)}', 'plugin_type': 'GenericDataPlugin'}

    async def _call_webhook(self, data_item: Dict[str, Any]) -> str:
        if not self.webhook_url:
            return 'none'
        try:
            payload = {'data_id': data_item['id'], 'timestamp': data_item['timestamp'], 'size_bytes': data_item['size_bytes'], 'data_base64': data_item['data_base64']}
            async with aiohttp.ClientSession() as session:
                async with session.post(self.webhook_url, json=payload, timeout=aiohttp.ClientTimeout(total=self.webhook_timeout)) as resp:
                    if resp.status in (200, 201, 202):
                        return 'success'
                    return 'error'
        except asyncio.TimeoutError:
            return 'pending'
        except Exception:
            return 'error'

    def get_data(self, data_id: str) -> Optional[Dict[str, Any]]:
        for item in self.data_storage:
            if item['id'] == data_id:
                return item
        return None

    def get_data_raw(self, data_id: str) -> Optional[bytes]:
        item = self.get_data(data_id)
        if item:
            return base64.b64decode(item['data_base64'])
        return None

    def list_data(self, limit: int = 100) -> list:
        return [{'id': item['id'], 'timestamp': item['timestamp'], 'size_bytes': item['size_bytes']} for item in reversed(self.data_storage[-limit:])]

    def delete_data(self, data_id: str) -> bool:
        for i, item in enumerate(self.data_storage):
            if item['id'] == data_id:
                self.data_storage.pop(i)
                return True
        return False

    def clear_storage(self):
        self.data_storage.clear()

    def get_storage_stats(self) -> Dict[str, Any]:
        total_bytes = sum(item['size_bytes'] for item in self.data_storage)
        return {'total_items': len(self.data_storage), 'total_bytes': total_bytes, 'max_items': self.max_storage_items, 'webhook_enabled': self.webhook_url is not None, 'export_enabled': self.enable_export}
