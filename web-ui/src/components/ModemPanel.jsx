import React, { useState, useEffect, useRef } from 'react'
import { useWebSocket } from '../lib/websocket'

const ModemPanel = ({ wsMetrics }) => {
  const [modemScheme, setModemScheme] = useState('QPSK')
  const [bandwidth, setBandwidth] = useState(2700)
  const [ber, setBer] = useState(0)
  const [constellationData, setConstellationData] = useState([])
  const [txSpectrum, setTxSpectrum] = useState([])
  const canvasRef = useRef(null)
  const spectrumCanvasRef = useRef(null)
  const ws = useWebSocket()

  // Listen for constellation and modem data from WebSocket
  useEffect(() => {
    if (!ws) return

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'constellation' && msg.iq_points) {
          setConstellationData(msg.iq_points)
        }
        if (msg.type === 'tx_spectrum' && msg.bins) {
          setTxSpectrum(msg.bins)
        }
        if (msg.modem_scheme) {
          setModemScheme(msg.modem_scheme)
        }
        if (msg.bandwidth_hz) {
          setBandwidth(msg.bandwidth_hz)
        }
        if (msg.ber !== undefined) {
          setBer(msg.ber)
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    ws.addEventListener('message', handleMessage)
    return () => ws.removeEventListener('message', handleMessage)
  }, [ws])

  // Draw constellation on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || constellationData.length === 0) return

    const ctx = canvas.getContext('2d')
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight

    canvas.width = w
    canvas.height = h

    // Clear background
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, w, h)

    // Draw grid
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * w
      const y = (i / 4) * h
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // Draw axes
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w / 2, h)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    // Draw constellation points
    ctx.fillStyle = '#06b6d4'
    const maxRadius = Math.max(2, Math.min(w, h) / 8)

    constellationData.forEach(([i, q]) => {
      const x = w / 2 + (i / 2) * (w / 2)
      const y = h / 2 - (q / 2) * (h / 2)

      if (x >= 0 && x <= w && y >= 0 && y <= h) {
        ctx.beginPath()
        ctx.arc(x, y, 2, 0, 2 * Math.PI)
        ctx.fill()
      }
    })
  }, [constellationData])

  // Draw TX spectrum on second canvas
  useEffect(() => {
    const canvas = spectrumCanvasRef.current
    if (!canvas || txSpectrum.length === 0) return

    const ctx = canvas.getContext('2d')
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight

    canvas.width = w
    canvas.height = h

    // Clear background
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, w, h)

    // Draw spectrum line
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 1.5
    ctx.beginPath()

    txSpectrum.forEach((db, i) => {
      const x = (i / txSpectrum.length) * w
      const normalized = Math.max(0, Math.min(1, (db + 100) / 140))
      const y = h - (normalized * h)

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })

    ctx.stroke()

    // Draw baseline
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(w, h)
    ctx.stroke()
  }, [txSpectrum])

  const getBerColor = () => {
    if (ber < 0.001) return 'text-green-400'
    if (ber < 0.01) return 'text-green-300'
    if (ber < 0.1) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getBerBgColor = () => {
    if (ber < 0.001) return 'bg-green-900'
    if (ber < 0.01) return 'bg-green-800'
    if (ber < 0.1) return 'bg-yellow-900'
    return 'bg-red-900'
  }

  return (
    <div className="h-full flex flex-col gap-2 text-xs">
      {/* Speed Mode */}
      <div className="bg-slate-800 p-2 rounded border border-slate-700">
        <div className="text-slate-400">Speed Mode</div>
        <div className="font-mono text-cyan-400 font-bold">{modemScheme} {(bandwidth / 1000).toFixed(1)} kHz</div>
      </div>

      {/* BER */}
      <div className={`p-2 rounded border border-slate-700 ${getBerBgColor()}`}>
        <div className={`${getBerColor()} font-bold`}>BER: {(ber * 100).toFixed(3)}%</div>
      </div>

      {/* IQ Constellation */}
      <div className="flex-1 bg-slate-800 rounded border border-slate-700 overflow-hidden">
        <div className="text-slate-400 px-2 py-1 text-xs bg-slate-900 border-b border-slate-700">IQ</div>
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      {/* TX Spectrum */}
      <div className="flex-1 bg-slate-800 rounded border border-slate-700 overflow-hidden">
        <div className="text-slate-400 px-2 py-1 text-xs bg-slate-900 border-b border-slate-700">TX Spectrum</div>
        <canvas ref={spectrumCanvasRef} className="w-full h-full" />
      </div>

      {/* Data Type Badge */}
      <div className="bg-slate-800 p-2 rounded border border-slate-700 text-center">
        <span className="bg-cyan-600 text-white px-2 py-1 rounded text-xs font-bold">TEXT</span>
      </div>
    </div>
  )
}

export default ModemPanel
