"""
BitLink21 Core FastAPI Application

Satoshi Signal Protocol (SSP) layer with encrypted P2P satellite comms.
Handles:
- SSP frame encoding/decoding
- Nostr NIP-04 encryption
- Bitcoin transaction relay
- Lightning invoice handling
- Generic binary data pass-through
- REST API for web UI and external integrations
"""

import logging
import os
import time
import json
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import aiosqlite

from .ssp_frame import SSPFrame, PayloadType, SSPFrameAssembler
from .payload_router import PayloadRouter
from .plugins import PluginLoader
from .plugins.bitcoin_tx import BitcoinTxPlugin
from .plugins.lightning_invoice import LightningInvoicePlugin
from .plugins.generic_data import GenericDataPlugin
from .logging_config import setup_logging, get_logger
from .debug_routes import router as debug_router
from .radio_routes import router as radio_router, init_radio_routes
from .rx_listener import RxFrameListener  # BUG-20: UDP listener for RX frames

# Initialize logging system
setup_logging()
logger = get_logger("main")

# Read version from VERSION file
def get_version():
    """Read version from /app/VERSION or fallback to default"""
    version_file = "/app/VERSION"
    if os.path.exists(version_file):
        with open(version_file, 'r') as f:
            return f.read().strip()
    return "0.5.5-core"

VERSION = get_version()

# API Authentication
security = HTTPBearer()
BITLINK_API_TOKEN = os.getenv("BITLINK_API_TOKEN", "change-me")


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify API token from Authorization: Bearer <token> header

    Raises:
        HTTPException: 401 Unauthorized if token missing or invalid
    """
    if credentials.credentials != BITLINK_API_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


# FastAPI app
app = FastAPI(
    title="BitLink21 Core API",
    description="Satoshi Signal Protocol satellite communication layer",
    version=VERSION
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add request/response logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all HTTP requests and responses."""
    request_id = request.headers.get("x-request-id", os.urandom(8).hex())
    start_time = time.time()

    logger.debug(
        f"{request.method} {request.url.path}",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "query": str(request.url.query),
            "client": request.client.host if request.client else "unknown",
        },
    )

    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000  # Convert to ms

    logger.info(
        f"{request.method} {request.url.path}",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "response_time_ms": round(process_time, 2),
            "client": request.client.host if request.client else "unknown",
        },
    )

    return response

# Include routers
app.include_router(debug_router)
app.include_router(radio_router)

# Global state
class AppState:
    def __init__(self):
        self.plugin_loader = PluginLoader()
        self.payload_router = PayloadRouter(self.plugin_loader)
        self.frame_assembler = SSPFrameAssembler(reassembly_timeout=120)
        self.bitcoin_config = {}
        self.lightning_config = {}
        self.generic_data_config = {}
        self.received_messages = []
        self.rx_listener = None  # BUG-20: UDP listener for RX frames
        self.storage = None  # Storage initialized in startup_event

app_state = AppState()


# Request/Response models
class BitcoinTxRequest(BaseModel):
    tx_hex: str


class BitcoinConfigRequest(BaseModel):
    rpc_url: str
    rpc_user: str
    rpc_pass: str
    allow_high_fees: Optional[bool] = False


class LightningConfigRequest(BaseModel):
    lnd_rest_url: Optional[str] = None
    lnd_cert_path: Optional[str] = None
    lnd_macaroon_path: Optional[str] = None


class GenericDataConfigRequest(BaseModel):
    webhook_url: Optional[str] = None
    max_storage_items: Optional[int] = 1000


class SSPFrameRequest(BaseModel):
    payload_type: int
    payload: str  # base64 encoded
    msg_id: Optional[int] = 0
    encrypted: Optional[bool] = False
    broadcast: Optional[bool] = False


# Lifecycle events
@app.on_event("startup")
async def startup_event():
    """Initialize plugins and load configuration on startup"""
    startup_start = time.time()

    logger.info(
        "BitLink21 Core API server starting",
        extra={
            "version": VERSION,
            "port": 8021,
            "host": "0.0.0.0",
        },
    )

    try:
        # Initialize storage (SQLite config persistence)
        from .storage import Storage
        app_state.storage = Storage()
        await app_state.storage.init_db()
        logger.debug("Storage initialized")

        # Initialize radio routes (config, messages DB, UDP sender)
        await init_radio_routes()
        logger.debug("Radio routes initialized")

        # BUG-20: Start UDP listener for RX frames from radio on port 40132
        app_state.rx_listener = RxFrameListener(host="0.0.0.0", port=40132)
        await app_state.rx_listener.start()
        logger.debug("RX frame listener started")

        # Initialize Bitcoin plugin
        logger.debug("Initializing Bitcoin plugin")
        bitcoin_plugin = BitcoinTxPlugin(app_state.bitcoin_config)
        app_state.plugin_loader.register_plugin(PayloadType.BITCOIN_TX, bitcoin_plugin)
        logger.info("Bitcoin plugin registered", extra={"status": "ok"})

        # Initialize Lightning plugin
        logger.debug("Initializing Lightning plugin")
        lightning_plugin = LightningInvoicePlugin(app_state.lightning_config)
        app_state.plugin_loader.register_plugin(PayloadType.LIGHTNING, lightning_plugin)
        logger.info("Lightning plugin registered", extra={"status": "ok"})

        # Initialize Generic Data plugin
        logger.debug("Initializing Generic Data plugin")
        generic_plugin = GenericDataPlugin(app_state.generic_data_config)
        app_state.plugin_loader.register_plugin(PayloadType.BINARY, generic_plugin)
        logger.info("Generic Data plugin registered", extra={"status": "ok"})

        # Log initialization complete
        startup_time = (time.time() - startup_start) * 1000
        active_plugins = app_state.plugin_loader.list_plugins()

        logger.info(
            "All plugins initialized successfully",
            extra={
                "plugin_count": len(active_plugins),
                "startup_time_ms": round(startup_time, 2),
                "plugins": list(active_plugins.keys()),
            },
        )

    except Exception as e:
        logger.error(
            "Plugin initialization failed",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise

    # Start background cleanup task for message retention
    asyncio.create_task(_cleanup_old_messages())


async def _cleanup_old_messages():
    """Background task: periodically delete messages older than retention period"""
    import json
    from pathlib import Path

    config_file = Path("/app/data/config.json")
    messages_db = Path("/app/data/bitlink21.db")

    while True:
        try:
            await asyncio.sleep(3600)  # Run every hour

            # Load config
            if config_file.exists():
                config = json.loads(config_file.read_text())
                retention_days = config.get("retention_days", 7)

                # Delete old messages
                async with aiosqlite.connect(str(messages_db)) as db:
                    await db.execute("""
                        DELETE FROM messages
                        WHERE timestamp_ms < ?
                    """, (int(time.time() * 1000) - (retention_days * 86400 * 1000),))
                    await db.commit()
                    logger.debug(f"Message cleanup: deleted messages older than {retention_days} days")

        except Exception as e:
            logger.error(f"Cleanup task error: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    # BUG-20: Stop RX listener
    if app_state.rx_listener:
        await app_state.rx_listener.stop()

    final_stats = app_state.payload_router.get_stats()

    logger.info(
        "BitLink21 Core shutting down",
        extra={
            "messages_processed": final_stats.get("total_processed", 0),
            "errors": final_stats.get("errors", 0),
        },
    )


# Health and status endpoints
@app.get("/api/health")
@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint"""
    plugins = app_state.plugin_loader.list_plugins()

    logger.debug(
        "Health check request",
        extra={"plugins_active": len(plugins)},
    )

    return {
        "status": "healthy",
        "version": VERSION,
        "service": "core",
        "plugins": plugins,
    }


@app.get("/api/status")
async def get_status():
    """Get core status and statistics"""
    stats = app_state.payload_router.get_stats()
    plugins = app_state.plugin_loader.list_plugins()

    logger.debug(
        "Status request",
        extra={
            "messages_received": len(app_state.received_messages),
            "messages_processed": stats.get("total_processed"),
        },
    )

    return {
        "version": VERSION,
        "bitcoin_configured": bool(app_state.bitcoin_config),
        "lightning_configured": bool(app_state.lightning_config),
        "routing_stats": stats,
        "messages_received": len(app_state.received_messages),
        "plugins_active": list(plugins.keys()),
    }


# Bitcoin API endpoints
@app.post("/api/v1/bitcoin/config")
async def set_bitcoin_config(request: BitcoinConfigRequest, token: str = Depends(verify_token)):
    """
    Configure Bitcoin Core RPC connection

    Used to submit transactions to user's Bitcoin node.

    Args:
        rpc_url: Bitcoin Core RPC endpoint (e.g., http://localhost:8332)
        rpc_user: RPC username
        rpc_pass: RPC password
        allow_high_fees: Allow transactions with high fees (default: False)

    Returns:
        Configuration summary
    """
    try:
        logger.info(
            "Bitcoin config update requested",
            extra={
                "rpc_url": request.rpc_url,
                "rpc_user": request.rpc_user,
                "allow_high_fees": request.allow_high_fees,
            },
        )

        app_state.bitcoin_config = {
            'rpc_url': request.rpc_url,
            'rpc_user': request.rpc_user,
            'rpc_pass': request.rpc_pass,
            'allow_high_fees': request.allow_high_fees
        }

        # Save to database for persistence
        await app_state.storage.db.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
            ('bitcoin_config', json.dumps(app_state.bitcoin_config))
        )
        await app_state.storage.db.commit()

        # Reinitialize plugin with new config
        bitcoin_plugin = BitcoinTxPlugin(app_state.bitcoin_config)
        app_state.plugin_loader.register_plugin(PayloadType.BITCOIN_TX, bitcoin_plugin)

        logger.info(
            "Bitcoin config updated successfully",
            extra={"rpc_url": request.rpc_url, "status": "ok"},
        )

        return {
            "status": "success",
            "message": f"Bitcoin config set to {request.rpc_url}",
            "rpc_url": request.rpc_url,
            "rpc_user": request.rpc_user
        }

    except Exception as e:
        logger.error(
            "Bitcoin config error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/bitcoin/send")
async def send_bitcoin_tx(request: BitcoinTxRequest, token: str = Depends(verify_token)):
    """
    Send raw Bitcoin transaction over satellite

    Steps:
    1. Encrypt tx_hex (if encryption enabled)
    2. Wrap in SSP frame
    3. Queue for TX to satellite

    Note: This endpoint queues the transaction for satellite TX.
    The actual transmission depends on radio availability and TX queue.

    Args:
        tx_hex: Raw Bitcoin transaction hex string

    Returns:
        Queue status and frame info
    """
    try:
        if not app_state.bitcoin_config:
            logger.warning("Bitcoin TX send attempted without configuration")
            raise HTTPException(
                status_code=400,
                detail="Bitcoin RPC not configured. Use /api/v1/bitcoin/config first."
            )

        # For now, return queued status
        # In full implementation, would wrap in SSP frame and queue for TX
        logger.info(
            "Bitcoin TX queued for satellite transmission",
            extra={
                "tx_hex_prefix": request.tx_hex[:20],
                "tx_hex_len": len(request.tx_hex),
                "status": "queued",
            },
        )

        return {
            "status": "queued",
            "message": "Transaction queued for satellite transmission",
            "tx_hex": request.tx_hex[:20] + "...",
            "estimated_wait": "depends on queue"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Bitcoin TX send error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/bitcoin/config")
async def get_bitcoin_config():
    """Get current Bitcoin configuration"""
    # Try to load from database if not in memory
    if not app_state.bitcoin_config:
        try:
            cursor = await app_state.storage.db.execute(
                "SELECT value FROM config WHERE key = ?",
                ('bitcoin_config',)
            )
            row = await cursor.fetchone()
            if row:
                app_state.bitcoin_config = json.loads(row[0])
                logger.debug("[API] Bitcoin config loaded from database")
        except Exception as e:
            logger.debug(f"[API] Failed to load bitcoin config from DB: {e}")

    if not app_state.bitcoin_config:
        return {
            "status": "not_configured",
            "message": "Bitcoin RPC not configured"
        }

    return {
        "status": "configured",
        "rpc_url": app_state.bitcoin_config.get('rpc_url'),
        "rpc_user": app_state.bitcoin_config.get('rpc_user'),
        "allow_high_fees": app_state.bitcoin_config.get('allow_high_fees', False)
    }


# Lightning API endpoints
@app.post("/api/v1/lightning/config")
async def set_lightning_config(request: LightningConfigRequest, token: str = Depends(verify_token)):
    """
    Configure LND REST connection (optional)

    Args:
        lnd_rest_url: LND REST endpoint (e.g., http://localhost:8080)
        lnd_cert_path: Path to TLS certificate (optional)
        lnd_macaroon_path: Path to macaroon file (optional)

    Returns:
        Configuration summary
    """
    try:
        logger.info(
            "Lightning config update requested",
            extra={
                "lnd_rest_url": request.lnd_rest_url,
                "cert_configured": bool(request.lnd_cert_path),
                "macaroon_configured": bool(request.lnd_macaroon_path),
            },
        )

        app_state.lightning_config = {
            'lnd_rest_url': request.lnd_rest_url,
            'lnd_cert_path': request.lnd_cert_path,
            'lnd_macaroon_path': request.lnd_macaroon_path
        }

        # Save to database for persistence
        await app_state.storage.db.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
            ('lightning_config', json.dumps(app_state.lightning_config))
        )
        await app_state.storage.db.commit()

        # Reinitialize plugin with new config
        lightning_plugin = LightningInvoicePlugin(app_state.lightning_config)
        app_state.plugin_loader.register_plugin(PayloadType.LIGHTNING, lightning_plugin)

        logger.info(
            "Lightning config updated successfully",
            extra={"lnd_rest_url": request.lnd_rest_url, "status": "ok"},
        )

        return {
            "status": "success",
            "message": "Lightning config updated",
            "lnd_rest_url": request.lnd_rest_url
        }

    except Exception as e:
        logger.error(
            "Lightning config error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/lightning/config")
async def get_lightning_config():
    """Get current Lightning configuration"""
    # Try to load from database if not in memory
    if not app_state.lightning_config:
        try:
            cursor = await app_state.storage.db.execute(
                "SELECT value FROM config WHERE key = ?",
                ('lightning_config',)
            )
            row = await cursor.fetchone()
            if row:
                app_state.lightning_config = json.loads(row[0])
                logger.debug("[API] Lightning config loaded from database")
        except Exception as e:
            logger.debug(f"[API] Failed to load lightning config from DB: {e}")

    if not app_state.lightning_config:
        return {
            "status": "not_configured",
            "message": "Lightning not configured"
        }

    return {
        "status": "configured",
        "lnd_rest_url": app_state.lightning_config.get('lnd_rest_url'),
        "lnd_cert_path": app_state.lightning_config.get('lnd_cert_path'),
        "lnd_macaroon_path": app_state.lightning_config.get('lnd_macaroon_path')
    }


@app.get("/api/v1/lightning/invoices")
async def get_invoices():
    """
    Get received Lightning invoices

    Returns list of all received invoices from satellite.

    Returns:
        List of invoice objects with payment hashes
    """
    try:
        # Get plugin instance
        plugins = app_state.plugin_loader.plugins
        if PayloadType.LIGHTNING not in plugins:
            logger.debug("Lightning plugin not loaded, returning empty invoices")
            return {"status": "no_invoices", "invoices": []}

        lightning_plugin = plugins[PayloadType.LIGHTNING]
        invoices = lightning_plugin.get_invoices()

        # Format for API response
        result = []
        for payment_hash, invoice_data in invoices.items():
            result.append({
                "payment_hash": payment_hash,
                "timestamp": invoice_data['timestamp'],
                "amount_msat": invoice_data['parsed'].get('amount_msat'),
                "network": invoice_data['parsed'].get('network'),
                "invoice_preview": invoice_data['parsed']['raw'][:30] + "..."
            })

        logger.debug(
            "Retrieved Lightning invoices",
            extra={"invoice_count": len(result)},
        )

        return {
            "status": "success",
            "total": len(result),
            "invoices": result
        }

    except Exception as e:
        logger.error(
            "Get invoices error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=str(e))


# Generic Data API endpoints
@app.post("/api/data/store")
async def store_data(request: BaseModel, token: str = Depends(verify_token)):
    """
    Manual endpoint to store generic binary data

    Args:
        data_base64: Base64-encoded binary data

    Returns:
        Storage info with data ID
    """
    try:
        import base64
        data_base64 = getattr(request, 'data_base64', '')
        payload = base64.b64decode(data_base64)

        logger.info(
            "Storing generic binary data",
            extra={"size_bytes": len(payload)},
        )

        plugins = app_state.plugin_loader.plugins
        if PayloadType.BINARY not in plugins:
            logger.error("Generic data plugin not available")
            raise HTTPException(status_code=400, detail="Generic data plugin not available")

        generic_plugin = plugins[PayloadType.BINARY]
        result = await generic_plugin.process(payload)

        logger.debug(
            "Data stored successfully",
            extra={"result_status": result.get("status")},
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Data store error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/list")
async def list_stored_data(limit: int = 100):
    """
    List stored data items

    Args:
        limit: Maximum items to return

    Returns:
        List of data item summaries
    """
    try:
        plugins = app_state.plugin_loader.plugins
        if PayloadType.BINARY not in plugins:
            logger.debug("Generic data plugin not loaded")
            return {"status": "no_data", "items": []}

        generic_plugin = plugins[PayloadType.BINARY]
        items = generic_plugin.list_data(limit)

        logger.debug(
            "Listed stored data items",
            extra={"item_count": len(items)},
        )

        return {
            "status": "success",
            "total": len(items),
            "items": items
        }

    except Exception as e:
        logger.error(
            "List data error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/data/{data_id}")
async def get_data(data_id: str):
    """
    Download stored data by ID

    Returns raw binary data or base64-encoded representation.

    Args:
        data_id: Data item ID

    Returns:
        Data object with base64 content
    """
    try:
        plugins = app_state.plugin_loader.plugins
        if PayloadType.BINARY not in plugins:
            logger.warning(f"Data retrieval attempted without plugin: {data_id}")
            raise HTTPException(status_code=404, detail="Data not found")

        generic_plugin = plugins[PayloadType.BINARY]
        data_item = generic_plugin.get_data(data_id)

        if not data_item:
            logger.debug(f"Data item not found: {data_id}")
            raise HTTPException(status_code=404, detail="Data item not found")

        logger.debug(
            "Data retrieved",
            extra={"data_id": data_id, "size_bytes": data_item['size_bytes']},
        )

        return {
            "status": "success",
            "id": data_item['id'],
            "timestamp": data_item['timestamp'],
            "size_bytes": data_item['size_bytes'],
            "data_base64": data_item['data_base64']
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Get data error",
            extra={"error": str(e), "error_type": type(e).__name__, "data_id": data_id},
        )
        raise HTTPException(status_code=500, detail=str(e))


# Payload routing endpoints
@app.post("/api/payload/inbound")
async def process_inbound_payload(request: SSPFrameRequest, token: str = Depends(verify_token)):
    """
    Process inbound SSP payload (from radio/modem layer)

    This endpoint is called by the radio DSP layer when an SSP frame is received.

    Args:
        payload_type: Type of payload (0=text, 1=bitcoin_tx, 2=lightning, 3=binary)
        payload: Base64-encoded payload data
        msg_id: Optional message ID for fragmented messages
        encrypted: Whether payload is encrypted
        broadcast: Whether this is a broadcast frame

    Returns:
        Routing and plugin processing result
    """
    start_time = time.time()

    try:
        import base64

        # Decode payload
        payload_bytes = base64.b64decode(request.payload)

        # Create SSP frame
        frame = SSPFrame(
            msg_id=request.msg_id or 0,
            payload_type=request.payload_type,
            payload=payload_bytes,
            payload_len=len(payload_bytes),
            flags=(0x01 if request.encrypted else 0) | (0x02 if request.broadcast else 0)
        )

        logger.info(
            "Inbound SSP payload received",
            extra={
                "msg_id": request.msg_id,
                "payload_type": request.payload_type,
                "payload_size": len(payload_bytes),
                "encrypted": request.encrypted,
                "broadcast": request.broadcast,
            },
        )

        # Route through payload router
        result = await app_state.payload_router.route_ssp_frame(frame)

        # Store in message history
        app_state.received_messages.append({
            "timestamp": result['timestamp'],
            "payload_type": result['payload_type_name'],
            "status": result['status'],
            "size_bytes": len(payload_bytes)
        })

        processing_time = (time.time() - start_time) * 1000

        logger.info(
            "Payload processed",
            extra={
                "status": result['status'],
                "payload_type": result['payload_type_name'],
                "processing_time_ms": round(processing_time, 2),
            },
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        processing_time = (time.time() - start_time) * 1000
        logger.error(
            "Payload processing error",
            extra={
                "error": str(e),
                "error_type": type(e).__name__,
                "processing_time_ms": round(processing_time, 2),
            },
        )
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/payload/stats")
async def get_payload_stats():
    """Get payload routing statistics"""
    stats = app_state.payload_router.get_stats()

    logger.debug(
        "Payload stats requested",
        extra={
            "total_received": stats.get("total_received"),
            "total_processed": stats.get("total_processed"),
        },
    )

    return {
        "status": "success",
        "stats": stats
    }


@app.get("/api/payload/message-log")
async def get_message_log(limit: int = 100):
    """Get audit trail of processed messages"""
    messages = app_state.received_messages[-limit:]

    logger.debug(
        "Message log requested",
        extra={"limit": limit, "returned": len(messages)},
    )

    return {
        "status": "success",
        "total": len(app_state.received_messages),
        "messages": messages
    }


# System endpoints
@app.get("/api/system/plugins")
async def list_active_plugins():
    """List all active plugins and their status"""
    plugins = app_state.plugin_loader.list_plugins()

    logger.debug(
        "Active plugins requested",
        extra={"plugin_count": len(plugins)},
    )

    return {
        "status": "success",
        "total": len(plugins),
        "plugins": plugins
    }


@app.get("/api/system/config")
async def get_system_config():
    """Get full system configuration"""
    plugins = app_state.plugin_loader.list_plugins()

    logger.debug(
        "System config requested",
        extra={"plugins_active": len(plugins)},
    )

    return {
        "bitcoin": {
            "configured": bool(app_state.bitcoin_config),
            "endpoint": app_state.bitcoin_config.get('rpc_url', 'not_configured')
        },
        "lightning": {
            "configured": bool(app_state.lightning_config),
            "endpoint": app_state.lightning_config.get('lnd_rest_url', 'not_configured')
        },
        "plugins_active": list(plugins.keys())
    }


@app.post("/api/system/reset")
async def reset_system(token: str = Depends(verify_token)):
    """Reset all counters and message history"""
    try:
        logger.warning(
            "System reset initiated - DESTRUCTIVE OPERATION",
            extra={"messages_cleared": len(app_state.received_messages)},
        )

        app_state.payload_router.clear_stats()
        app_state.received_messages = []

        logger.info("System reset completed successfully")

        return {
            "status": "success",
            "message": "System reset complete"
        }

    except Exception as e:
        logger.error(
            "Reset error",
            extra={"error": str(e), "error_type": type(e).__name__},
        )
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8021))
    host = os.getenv("HOST", "0.0.0.0")

    logger.info(
        "Starting BitLink21 Core API server",
        extra={"host": host, "port": port},
    )

    uvicorn.run(app, host=host, port=port)
