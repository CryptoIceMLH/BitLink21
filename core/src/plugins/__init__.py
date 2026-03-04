"""
BitLink21 Plugin System

Plugin interface for handling different payload types:
- Bitcoin transaction relay
- Lightning invoice/message handling
- Generic binary data pass-through
"""

import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from enum import Enum

logger = logging.getLogger(__name__)


class PluginType(Enum):
    """Supported plugin types"""
    BITCOIN_TX = 1
    LIGHTNING = 2
    GENERIC_DATA = 3


class BasePlugin(ABC):
    """Abstract base class for all plugins"""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize plugin with optional configuration

        Args:
            config: Configuration dictionary (e.g., RPC endpoints, API keys)
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)

    @abstractmethod
    async def process(self, payload: bytes) -> Dict[str, Any]:
        """
        Process an inbound payload

        Args:
            payload: Raw payload bytes from SSP frame

        Returns:
            Dictionary with processing result:
            {
                'status': 'success'|'error'|'pending',
                'message': str,
                'data': any,
                'plugin_type': str
            }
        """
        pass

    async def validate(self, payload: bytes) -> bool:
        """
        Validate payload format before processing

        Args:
            payload: Raw payload bytes

        Returns:
            True if valid, False otherwise
        """
        return True


class PluginLoader:
    """Load and manage plugins"""

    def __init__(self):
        self.plugins: Dict[int, BasePlugin] = {}

    def register_plugin(self, plugin_type: int, plugin: BasePlugin):
        """Register a plugin for a specific payload type"""
        self.plugins[plugin_type] = plugin
        logging.info(f"Registered plugin for type {plugin_type}: {plugin.__class__.__name__}")

    async def dispatch(self, payload_type: int, payload: bytes) -> Dict[str, Any]:
        """
        Dispatch payload to appropriate plugin

        Args:
            payload_type: Type of payload (0=text, 1=bitcoin_tx, 2=lightning, 3=binary)
            payload: Raw payload bytes

        Returns:
            Processing result from plugin or error dict
        """
        if payload_type not in self.plugins:
            logging.warning(f"No plugin registered for payload type {payload_type}")
            return {
                'status': 'error',
                'message': f'No plugin for payload type {payload_type}',
                'plugin_type': 'unknown'
            }

        try:
            plugin = self.plugins[payload_type]
            if not await plugin.validate(payload):
                return {
                    'status': 'error',
                    'message': 'Invalid payload format',
                    'plugin_type': plugin.__class__.__name__
                }

            result = await plugin.process(payload)
            return result
        except Exception as e:
            logging.error(f"Plugin error: {e}", exc_info=True)
            return {
                'status': 'error',
                'message': str(e),
                'plugin_type': self.plugins[payload_type].__class__.__name__
            }

    def list_plugins(self) -> Dict[int, str]:
        """Return dict of registered plugins"""
        return {pt: p.__class__.__name__ for pt, p in self.plugins.items()}
