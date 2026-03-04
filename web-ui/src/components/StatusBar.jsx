import React, { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'

// Format frequency with dot separators: 10489.750000 → "10.489.750.000"
function formatFreqDots(freqMhz) {
  const hz = Math.round(freqMhz * 1e6)
  const str = hz.toString().padStart(10, '0')
  // Group: X.XXX.XXX.XXX (10 digits)
  return str.slice(0, -9) + '.' + str.slice(-9, -6) + '.' + str.slice(-6, -3) + '.' + str.slice(-3)
}

const BAND_START_MHZ = 10489.470

function StatusBar({ wsMetrics, wsConnected, onSettingsClick, rxOffsetHz, txOffsetHz }) {
  const [apiStatus, setApiStatus] = useState('idle')
  const [pttOn, setPttOn] = useState(false)
  const pttButtonRef = useRef(null)
  const [btcStatus, setBtcStatus] = useState('idle')
  const [lnStatus, setLnStatus] = useState('idle')

  // Check API health periodically
  useEffect(() => {
    const checkHealth = async () => {
      try { await api.get('/api/v1/health'); setApiStatus('ok') }
      catch { setApiStatus('fail') }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 5000)
    return () => clearInterval(interval)
  }, [])

  // Poll BTC/LN every 30s
  useEffect(() => {
    const check = async () => {
      try { const r = await api.get('/api/v1/bitcoin/status'); setBtcStatus(r.connected ? 'ok' : 'fail') }
      catch { setBtcStatus('fail') }
      try { const r = await api.get('/api/v1/lightning/status'); setLnStatus(r.connected ? 'ok' : 'fail') }
      catch { setLnStatus('fail') }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  const radioStatus = wsConnected ? 'ok' : 'idle'
  const plutoStatus = !wsConnected ? 'idle' : (wsMetrics.sdr_connected ? 'ok' : 'fail')

  useEffect(() => { setPttOn(wsMetrics.ptt_state || false) }, [wsMetrics.ptt_state])

  const handlePTT = async () => {
    const newState = !pttOn
    setPttOn(newState)
    try { await api.post('/api/v1/ptt', { state: newState }) }
    catch { setPttOn(!newState) }
  }

  const pillColor = (status) => {
    if (status === 'ok') return 'bg-green-900/80 text-green-300 border-green-700/50'
    if (status === 'fail') return 'bg-red-900/80 text-red-300 border-red-700/50'
    return 'bg-slate-800 text-slate-500 border-slate-700/50'
  }

  const dot = (status) => status === 'ok' ? '●' : status === 'fail' ? '●' : '○'

  const rxFreq = BAND_START_MHZ + (rxOffsetHz || 80000) / 1e6
  const txFreq = BAND_START_MHZ + (txOffsetHz || 80000) / 1e6
  const ritHz = wsMetrics.rit_offset_hz || 0
  const xitHz = wsMetrics.xit_offset_hz || 0
  const speedStr = wsMetrics.speed_mode_str || ''

  return (
    <header className="flex-shrink-0 bg-slate-900 border-b border-slate-700 px-3 py-1.5 flex items-center gap-3">
      {/* Left: Branding + Pills */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-orange-500 font-black text-2xl leading-none" style={{ textShadow: '0 0 8px rgba(249, 115, 22, 0.6)' }}>₿</span>
          <div className="flex flex-col">
            <span className="text-slate-100 font-black text-lg tracking-widest leading-tight">BITLINK21</span>
            <span className="text-slate-500 text-[8px] tracking-wider leading-none">SOVEREIGN BITCOIN COMMUNICATIONS</span>
          </div>
        </div>
        <div className="flex gap-1">
          {[
            { status: radioStatus, label: 'MODEM' },
            { status: apiStatus, label: 'API' },
            { status: plutoStatus, label: 'SDR', click: true },
            { status: btcStatus, label: 'BTC' },
            { status: lnStatus, label: 'LN' },
          ].map(p => (
            <div key={p.label}
              onClick={p.click ? onSettingsClick : undefined}
              className={`px-1.5 py-0.5 rounded text-xs font-bold border ${pillColor(p.status)} ${p.click ? 'cursor-pointer hover:opacity-80' : ''}`}>
              {dot(p.status)} {p.label}
            </div>
          ))}
        </div>
      </div>

      {/* Center: Large Frequency Display */}
      <div className="flex-1 flex flex-col items-center">
        {wsMetrics.sdr_connected && wsMetrics.sdr_hw_model && (
          <div className="text-slate-500 text-xs">{wsMetrics.sdr_hw_model} ({wsMetrics.sdr_fw_version ? 'v' + wsMetrics.sdr_fw_version : ''})</div>
        )}
        <div className="flex items-baseline gap-6">
          <div className="font-mono">
            <span className="text-slate-500 text-xs mr-1">RX:</span>
            <span className="text-cyan-400 font-bold tracking-wide" style={{ fontSize: '28px' }}>
              {formatFreqDots(rxFreq)}
            </span>
            {ritHz !== 0 && <span className="text-green-400 text-xs ml-1">RIT {ritHz > 0 ? '+' : ''}{ritHz}Hz</span>}
          </div>
          <div className="font-mono">
            <span className="text-slate-500 text-xs mr-1">TX:</span>
            <span className="text-orange-400 font-bold tracking-wide" style={{ fontSize: '22px' }}>
              {formatFreqDots(txFreq)}
            </span>
            {xitHz !== 0 && <span className="text-red-400 text-xs ml-1">XIT {xitHz > 0 ? '+' : ''}{xitHz}Hz</span>}
          </div>
        </div>
        {speedStr && <div className="text-slate-400 text-xs font-mono mt-0.5">{speedStr}</div>}
      </div>

      {/* Right: PTT */}
      <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
        <span className="text-xs text-slate-500">PTT</span>
        <button
          ref={pttButtonRef}
          onClick={handlePTT}
          onKeyDown={(e) => { if (e.code === 'Space') { e.preventDefault(); handlePTT() } }}
          className={`px-8 py-3 rounded font-black text-lg transition-all ${
            pttOn
              ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/40'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
          title="Space key toggles PTT"
        >
          {pttOn ? 'TX' : 'RX'}
        </button>
      </div>
    </header>
  )
}

export default StatusBar
