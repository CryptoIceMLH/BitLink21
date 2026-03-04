import React, { useEffect, useRef } from 'react'
import { useWebSocket } from '../lib/websocket'

const DiagnosticsStrip = ({ wsMetrics }) => {
  const constCanvasRef = useRef(null)
  const txSpecCanvasRef = useRef(null)
  const ws = useWebSocket()
  const iqPointsRef = useRef([])

  // Listen for constellation and TX spectrum data
  useEffect(() => {
    if (!ws) return

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        // Constellation: C++ sends {type:"constellation", points:[{i,q},...]}
        if (msg.type === 'constellation' && msg.points) {
          iqPointsRef.current = msg.points.slice(-512).map(p => [p.i, p.q])
          drawConstellation()
        }
        // TX spectrum can come as standalone or embedded in metrics
        if (msg.type === 'tx_spectrum' && msg.bins) {
          drawTxSpectrum(msg.bins)
        }
        if (msg.type === 'metrics' && msg.tx_spectrum && msg.tx_spectrum.length > 0) {
          drawTxSpectrum(msg.tx_spectrum)
        }
      } catch (e) { /* ignore */ }
    }

    ws.addEventListener('message', handleMessage)
    return () => ws.removeEventListener('message', handleMessage)
  }, [ws])

  const drawConstellation = () => {
    const canvas = constCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 0.5
    for (let i = 1; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo((i / 4) * w, 0); ctx.lineTo((i / 4) * w, h)
      ctx.moveTo(0, (i / 4) * h); ctx.lineTo(w, (i / 4) * h)
      ctx.stroke()
    }

    // Axes
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h)
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2)
    ctx.stroke()

    // Modulation reference points (dim markers for QPSK: ±1, ±1)
    ctx.fillStyle = 'rgba(100, 100, 100, 0.4)'
    const refPoints = [[1,1],[-1,1],[-1,-1],[1,-1]]
    refPoints.forEach(([ri, rq]) => {
      const rx = w / 2 + (ri / 2) * (w / 2)
      const ry = h / 2 - (rq / 2) * (h / 2)
      ctx.beginPath()
      ctx.arc(rx, ry, 3, 0, 2 * Math.PI)
      ctx.fill()
    })

    // Connected polyline trace (phase continuity)
    const points = iqPointsRef.current
    if (points.length > 1) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      points.forEach(([i, q], idx) => {
        const x = w / 2 + (i / 2) * (w / 2)
        const y = h / 2 - (q / 2) * (h / 2)
        if (idx === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // IQ scatter points (brighter, on top)
    ctx.fillStyle = '#06b6d4'
    points.forEach(([i, q]) => {
      const x = w / 2 + (i / 2) * (w / 2)
      const y = h / 2 - (q / 2) * (h / 2)
      if (x >= 0 && x <= w && y >= 0 && y <= h) {
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, 2 * Math.PI)
        ctx.fill()
      }
    })
  }

  const drawTxSpectrum = (bins) => {
    const canvas = txSpecCanvasRef.current
    if (!canvas || bins.length === 0) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 1
    ctx.beginPath()
    bins.forEach((db, i) => {
      const x = (i / bins.length) * w
      const normalized = Math.max(0, Math.min(1, (db + 100) / 140))
      const y = h - normalized * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  const snr = wsMetrics.snr_db || 0
  const snrColor = snr > 15 ? 'text-green-400' : snr > 8 ? 'text-yellow-400' : 'text-red-400'
  const snrBgColor = snr > 15 ? 'bg-green-500' : snr > 8 ? 'bg-yellow-500' : 'bg-red-500'

  const rssi = wsMetrics.rssi_db || -100
  const rssiPct = Math.max(0, Math.min(100, ((rssi + 120) / 120) * 100))

  const evm = wsMetrics.evm_db || 0

  const rxFifo = (wsMetrics.pb_fifo || 0) * 100
  const txFifo = (wsMetrics.cap_fifo || 0) * 100
  const rxVu = (wsMetrics.rx_vu || 0) * 100
  const txVu = (wsMetrics.tx_vu || 0) * 100

  const fifoColor = (pct) => pct > 85 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'
  const vuColor = (pct) => pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'

  const sigDetected = wsMetrics.signal_detected
  const frameSync = wsMetrics.frame_sync

  return (
    <div className="flex-shrink-0 bg-slate-900 border-y border-slate-700 px-3 py-1.5 flex items-center gap-3 text-xs">
      {/* Constellation */}
      <div className="flex-shrink-0">
        <canvas ref={constCanvasRef} width={80} height={80} className="rounded border border-slate-700" />
        <div className="text-center text-slate-500 mt-0.5">IQ</div>
      </div>

      {/* TX Spectrum */}
      <div className="flex-shrink-0">
        <canvas ref={txSpecCanvasRef} width={160} height={50} className="rounded border border-slate-700" />
        <div className="text-center text-slate-500 mt-0.5">TX Spec</div>
      </div>

      {/* Divider */}
      <div className="w-px h-16 bg-slate-700"></div>

      {/* Signal LEDs */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <div className={`w-2.5 h-2.5 rounded-full ${sigDetected ? 'bg-green-500' : 'bg-red-800'}`}></div>
          <span className="text-slate-400">RX SIG</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2.5 h-2.5 rounded-full ${frameSync ? 'bg-green-500' : 'bg-red-800'}`}></div>
          <span className="text-slate-400">SYNC</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2.5 h-2.5 rounded-full ${wsMetrics.beacon_lock_state === 'FINE_LOCK' ? 'bg-green-500' : wsMetrics.beacon_lock_state === 'COARSE_LOCK' ? 'bg-yellow-500' : 'bg-red-800'}`}></div>
          <span className="text-slate-400">LOCK</span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-16 bg-slate-700"></div>

      {/* SNR large readout */}
      <div className="flex flex-col items-center">
        <span className="text-slate-500">SNR</span>
        <span className={`text-2xl font-bold font-mono ${snrColor}`}>
          {snr > 0 ? '+' : ''}{snr.toFixed(1)}
        </span>
        <span className="text-slate-500">dB</span>
      </div>

      {/* RSSI */}
      <div className="flex flex-col gap-0.5 min-w-[80px]">
        <div className="flex justify-between">
          <span className="text-slate-500">RSSI</span>
          <span className="text-cyan-400 font-mono">{rssi.toFixed(0)}</span>
        </div>
        <div className="w-full h-2 bg-slate-700 rounded overflow-hidden">
          <div className="h-full bg-cyan-500 transition-all" style={{ width: `${rssiPct}%` }}></div>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">EVM</span>
          <span className="text-amber-400 font-mono">{evm.toFixed(1)}</span>
        </div>
        <div className="w-full h-2 bg-slate-700 rounded overflow-hidden">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, 100 + evm * 2))}%` }}></div>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-16 bg-slate-700"></div>

      {/* FIFO Bars */}
      <div className="flex flex-col gap-1 min-w-[90px]">
        <div className="flex justify-between items-center">
          <span className="text-slate-500">RX FIFO</span>
          <span className="text-slate-400 font-mono">{rxFifo.toFixed(0)}%</span>
        </div>
        <div className="w-full h-2 bg-slate-700 rounded overflow-hidden">
          <div className={`h-full transition-all ${fifoColor(rxFifo)}`} style={{ width: `${rxFifo}%` }}></div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-500">TX FIFO</span>
          <span className="text-slate-400 font-mono">{txFifo.toFixed(0)}%</span>
        </div>
        <div className="w-full h-2 bg-slate-700 rounded overflow-hidden">
          <div className={`h-full transition-all ${fifoColor(txFifo)}`} style={{ width: `${txFifo}%` }}></div>
        </div>
      </div>

      {/* VU Meters */}
      <div className="flex gap-1 items-end h-16">
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-3 h-14 bg-slate-700 rounded overflow-hidden flex flex-col-reverse">
            <div className={`w-full transition-all ${vuColor(rxVu)}`} style={{ height: `${rxVu}%` }}></div>
          </div>
          <span className="text-slate-500" style={{ fontSize: '9px' }}>RX</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <div className="w-3 h-14 bg-slate-700 rounded overflow-hidden flex flex-col-reverse">
            <div className={`w-full transition-all ${vuColor(txVu)}`} style={{ height: `${txVu}%` }}></div>
          </div>
          <span className="text-slate-500" style={{ fontSize: '9px' }}>TX</span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1"></div>

      {/* Frame Stats */}
      <div className="flex flex-col gap-0.5 text-right">
        <div><span className="text-slate-500">Frames:</span> <span className="text-slate-300 font-mono">{wsMetrics.rx_frame_count || 0}</span></div>
        <div><span className="text-slate-500">Errors:</span> <span className="text-red-400 font-mono">{wsMetrics.rx_error_count || 0}</span></div>
        <div><span className="text-slate-500">TX Queue:</span> <span className="text-slate-300 font-mono">{wsMetrics.tx_queue_depth || 0}</span></div>
      </div>
    </div>
  )
}

export default DiagnosticsStrip
