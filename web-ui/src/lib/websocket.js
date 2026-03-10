import { useEffect, useState } from 'react'

// Module-level singleton — prevents 4 separate WS connections
let globalWs = null
let wsListeners = []
let reconnectTimeout = null
let backoff = 200
let initialConnect = true  // First connect attempt — use fast retry on refresh race

function connect() {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    console.debug('[WS] Already connected')
    return
  }

  try {
    // Use relative /ws path — nginx proxies to bitlink21-radio:40134
    // In dev mode, Vite proxy handles ws:// forwarding
    // Can be overridden via localStorage for direct SDR access
    const stored = localStorage.getItem('bitlink21_ws_url')
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = stored || `${wsProtocol}//${window.location.host}/ws`
    console.debug('[WS] Creating singleton connection', { url: wsUrl })
    globalWs = new WebSocket(wsUrl)

    globalWs.onopen = () => {
      console.debug('[WS] Singleton connected', { url: wsUrl })
      backoff = 200
      initialConnect = false  // Connected — future disconnects use normal backoff
      wsListeners.forEach(cb => cb({ type: 'open' }))
    }

    globalWs.onmessage = (event) => {
      wsListeners.forEach(cb => cb({ type: 'message', event }))
    }

    globalWs.onclose = () => {
      console.debug('[WS] Singleton closed, will reconnect')
      globalWs = null
      wsListeners.forEach(cb => cb({ type: 'close' }))
      // Fast retry (200ms) on initial connect (page refresh race condition)
      // Normal exponential backoff (1s→2s→4s→16s max) for sustained failures
      const delay = initialConnect ? 200 : backoff
      reconnectTimeout = setTimeout(() => {
        if (!initialConnect) backoff = Math.min(backoff * 2, 16000)
        console.debug('[WS] Reconnecting', { backoffMs: delay, initial: initialConnect })
        connect()
      }, delay)
    }

    globalWs.onerror = (error) => {
      console.error('[WS] Singleton error', { error, readyState: globalWs?.readyState })
    }
  } catch (error) {
    console.error('[WS] Failed to create singleton', { error })
  }
}

export const useWebSocket = () => {
  const [ws, setWs] = useState(globalWs && globalWs.readyState === WebSocket.OPEN ? globalWs : null)

  useEffect(() => {
    console.debug('[WS] Hook mounted')

    const listener = ({ type }) => {
      if (type === 'open') {
        console.debug('[WS] Hook notified: open')
        setWs(globalWs)
      } else if (type === 'close') {
        console.debug('[WS] Hook notified: close')
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
      console.debug('[WS] Hook cleanup')
      wsListeners = wsListeners.filter(l => l !== listener)
      // Don't close the socket on unmount — other components may still use it
    }
  }, [])

  return ws
}
