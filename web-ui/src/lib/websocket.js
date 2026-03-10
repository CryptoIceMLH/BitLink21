import { useEffect, useState } from 'react'

// Module-level singleton — prevents 4 separate WS connections
let globalWs = null
let wsListeners = []
let reconnectTimeout = null
let connectTimeout = null
let backoff = 200

function connect() {
  // Already open — nothing to do
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    console.debug('[WS] Already connected')
    return
  }

  // Already connecting — don't create a second socket
  if (globalWs && globalWs.readyState === WebSocket.CONNECTING) {
    console.debug('[WS] Already connecting, waiting...')
    return
  }

  // Clean up any stale socket
  if (globalWs) {
    try { globalWs.close() } catch (e) {}
    globalWs = null
  }

  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }

  try {
    const stored = localStorage.getItem('bitlink21_ws_url')
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = stored || `${wsProtocol}//${window.location.host}/ws`
    console.debug('[WS] Connecting...', { url: wsUrl })
    globalWs = new WebSocket(wsUrl)

    // Timeout: if not open within 5s, abort and retry
    connectTimeout = setTimeout(() => {
      if (globalWs && globalWs.readyState === WebSocket.CONNECTING) {
        console.debug('[WS] Connect timeout (5s), aborting')
        try { globalWs.close() } catch (e) {}
        // onclose will fire and trigger reconnect
      }
    }, 5000)

    globalWs.onopen = () => {
      console.debug('[WS] Connected', { url: wsUrl })
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null }
      backoff = 200
      wsListeners.forEach(cb => cb({ type: 'open' }))
    }

    globalWs.onmessage = (event) => {
      wsListeners.forEach(cb => cb({ type: 'message', event }))
    }

    globalWs.onclose = () => {
      console.debug('[WS] Closed, will reconnect')
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null }
      globalWs = null
      wsListeners.forEach(cb => cb({ type: 'close' }))
      // Reconnect with backoff: 200ms → 400ms → 800ms → ... → 5s max
      reconnectTimeout = setTimeout(() => {
        backoff = Math.min(backoff * 2, 5000)
        console.debug('[WS] Reconnecting', { backoffMs: backoff })
        connect()
      }, backoff)
    }

    globalWs.onerror = (error) => {
      console.error('[WS] Error', { readyState: globalWs?.readyState })
    }
  } catch (error) {
    console.error('[WS] Failed to create connection', { error })
  }
}

export const useWebSocket = () => {
  const [ws, setWs] = useState(globalWs && globalWs.readyState === WebSocket.OPEN ? globalWs : null)

  useEffect(() => {
    const listener = ({ type }) => {
      if (type === 'open') {
        setWs(globalWs)
      } else if (type === 'close') {
        setWs(null)
      }
    }

    wsListeners.push(listener)

    // Ensure singleton is connecting
    if (!globalWs || globalWs.readyState === WebSocket.CLOSED) {
      connect()
    } else if (globalWs.readyState === WebSocket.OPEN) {
      setWs(globalWs)
    }

    return () => {
      wsListeners = wsListeners.filter(l => l !== listener)
    }
  }, [])

  return ws
}
