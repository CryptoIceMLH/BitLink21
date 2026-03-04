import React, { useState, useEffect, useRef } from 'react'
import { api } from './lib/api'
import { useWebSocket } from './lib/websocket'
import { useToast } from './lib/useToast'
import StatusBar from './components/StatusBar'
import Waterfall from './components/Waterfall'
import DiagnosticsStrip from './components/DiagnosticsStrip'
import TabBar from './components/TabBar'
import BottomStatusBar from './components/BottomStatusBar'
import SettingsPanel from './components/SettingsPanel'
import IdentityPanel from './components/IdentityPanel'
import MessagePanel from './components/MessagePanel'
import BerTestPanel from './components/BerTestPanel'
import DebugPanel from './components/DebugPanel'
import CalibrationPanel from './components/CalibrationPanel'
import Toast from './components/Toast'

const UI_VERSION = __APP_VERSION__

// QO-100 NB band — fixed 560 kHz span
const BAND_START_MHZ = 10489.470
const BAND_END_MHZ = 10490.030
const BAND_SPAN_HZ = 560000

function App() {
  const [coreVersion, setCoreVersion] = useState('...')
  const [activeTab, setActiveTab] = useState('radio')
  const [debugSubTab, setDebugSubTab] = useState('ber')
  const [wsConnected, setWsConnected] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const { toasts, removeToast, error: showError, success: showSuccess, info: showInfo } = useToast()

  // VFO offset tuning — offset in Hz from BAND_START (0–560000), persisted in localStorage
  const [rxOffsetHz, setRxOffsetHz] = useState(() => {
    const saved = localStorage.getItem('bl21_rxOffsetHz')
    return saved ? parseFloat(saved) : 80000
  })
  const [txOffsetHz, setTxOffsetHz] = useState(() => {
    const saved = localStorage.getItem('bl21_txOffsetHz')
    return saved ? parseFloat(saved) : 80000
  })
  // Modem channel bandwidth (Hz) — drives filter bars on spectrum/waterfall
  const [modemBwHz, setModemBwHz] = useState(() => {
    const saved = localStorage.getItem('bl21_modemBwHz')
    return saved ? parseInt(saved) : 2700
  })
  const [wsMetrics, setWsMetrics] = useState({
    rssi_db: 0,
    snr_db: 0,
    evm_db: 0,
    beacon_lock_state: 'UNLOCKED',
    beacon_phase_error_deg: 0,
    rx_frame_count: 0,
    rx_error_count: 0,
    tx_queue_depth: 0,
    ptt_state: false,
    sdr_connected: false,
    sdr_hw_model: '',
    sdr_fw_version: '',
    center_freq_mhz: 10489.55,
    tx_freq_mhz: 2400.0,
    pb_fifo: 0,
    cap_fifo: 0,
    rx_vu: 0,
    tx_vu: 0,
    ber: 0,
    speed_mode_str: '',
    signal_detected: false,
    frame_sync: false,
    rit_offset_hz: 0,
    xit_offset_hz: 0,
  })

  const ws = useWebSocket()

  // Fetch core version
  useEffect(() => {
    api.get('/api/v1/health').then(r => {
      setCoreVersion(r.version || '?')
    }).catch(() => setCoreVersion('offline'))
  }, [])

  // Listen for WebSocket status changes
  useEffect(() => {
    const handleWsStatus = (event) => setWsConnected(event.detail.connected)
    window.addEventListener('bitlink21_ws_status', handleWsStatus)
    return () => window.removeEventListener('bitlink21_ws_status', handleWsStatus)
  }, [])

  // Extract metrics from WebSocket
  useEffect(() => {
    if (!ws) return
    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (!wsConnected) {
          window.dispatchEvent(new CustomEvent('bitlink21_ws_status', { detail: { connected: true } }))
        }
        if (msg.type === 'metrics') {
          const { type, ...metricsData } = msg
          if (metricsData.tx_freq_hz != null) {
            metricsData.tx_freq_mhz = metricsData.tx_freq_hz / 1e6
          }
          setWsMetrics(prev => ({ ...prev, ...metricsData }))
        }
        if (msg.type === 'rx_frame') {
          setUnreadMessages(prev => prev + 1)
        }
      } catch (e) { /* ignore */ }
    }
    ws.addEventListener('message', handleMessage)
    return () => ws.removeEventListener('message', handleMessage)
  }, [ws, wsConnected])

  // Keyboard shortcuts: F1-F6 for tabs, Escape to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tabKeys = { F1: 'radio', F2: 'messages', F3: 'files', F4: 'identity', F5: 'settings', F6: 'debug' }
      if (tabKeys[e.key]) {
        e.preventDefault()
        setActiveTab(tabKeys[e.key])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Navigation events (e.g., calibration shortcut from SettingsPanel)
  useEffect(() => {
    const handleNav = (event) => {
      if (event.detail.tab) setActiveTab(event.detail.tab)
      if (event.detail.subTab) setDebugSubTab(event.detail.subTab)
    }
    window.addEventListener('bitlink21_nav', handleNav)
    return () => window.removeEventListener('bitlink21_nav', handleNav)
  }, [])

  // Clear unread when switching to messages tab
  useEffect(() => {
    if (activeTab === 'messages') setUnreadMessages(0)
  }, [activeTab])

  // Persist VFO offsets to localStorage
  useEffect(() => { localStorage.setItem('bl21_rxOffsetHz', rxOffsetHz) }, [rxOffsetHz])
  useEffect(() => { localStorage.setItem('bl21_txOffsetHz', txOffsetHz) }, [txOffsetHz])
  useEffect(() => { localStorage.setItem('bl21_modemBwHz', modemBwHz) }, [modemBwHz])

  // Spectrum/waterfall split height — persisted
  const [spectrumHeight, setSpectrumHeight] = useState(() => { const v = localStorage.getItem('bl21_specHeight'); return v ? parseInt(v) : 200 })

  // Waterfall controls state — persisted in localStorage
  const [wfPalette, setWfPalette] = useState(() => localStorage.getItem('bl21_palette') || 'blue')
  const [wfSpeed, setWfSpeed] = useState(() => localStorage.getItem('bl21_speed') || 'normal')
  const [wfDbMin, setWfDbMin] = useState(() => { const v = localStorage.getItem('bl21_dbMin'); return v ? parseInt(v) : -60 })
  const [wfDbMax, setWfDbMax] = useState(() => { const v = localStorage.getItem('bl21_dbMax'); return v ? parseInt(v) : -10 })
  const [dbAutoScale, setDbAutoScale] = useState(false)

  // Auto-scale dB: listen to waterfall frame min/max levels (dispatched from Waterfall component)
  const autoDbRef = useRef({ min: -80, max: 0 })
  useEffect(() => {
    if (!dbAutoScale) return
    const handleLevels = (event) => {
      const { min_level_db, max_level_db } = event.detail
      if (min_level_db == null || max_level_db == null) return
      // IIR smooth to avoid jitter (alpha = 0.05 — very slow, stable)
      autoDbRef.current.min = autoDbRef.current.min * 0.95 + (min_level_db - 5) * 0.05
      autoDbRef.current.max = autoDbRef.current.max * 0.95 + (max_level_db + 10) * 0.05
      setWfDbMin(Math.round(autoDbRef.current.min))
      setWfDbMax(Math.round(autoDbRef.current.max))
    }
    window.addEventListener('bitlink21_wf_levels', handleLevels)
    return () => window.removeEventListener('bitlink21_wf_levels', handleLevels)
  }, [dbAutoScale])
  const [freqZoom, setFreqZoom] = useState(() => { const v = localStorage.getItem('bl21_freqZoom'); return v ? parseFloat(v) : 1 })
  const [timeZoom, setTimeZoom] = useState(() => { const v = localStorage.getItem('bl21_timeZoom'); return v ? parseFloat(v) : 1 })

  // Persist waterfall settings
  useEffect(() => { localStorage.setItem('bl21_palette', wfPalette) }, [wfPalette])
  useEffect(() => { localStorage.setItem('bl21_speed', wfSpeed) }, [wfSpeed])
  useEffect(() => { localStorage.setItem('bl21_dbMin', wfDbMin) }, [wfDbMin])
  useEffect(() => { localStorage.setItem('bl21_dbMax', wfDbMax) }, [wfDbMax])
  useEffect(() => { localStorage.setItem('bl21_freqZoom', freqZoom) }, [freqZoom])
  useEffect(() => { localStorage.setItem('bl21_timeZoom', timeZoom) }, [timeZoom])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'radio':
        return <RadioTab wsMetrics={wsMetrics} onError={showError} onSuccess={showSuccess} rxOffsetHz={rxOffsetHz} txOffsetHz={txOffsetHz} onRxOffsetChange={setRxOffsetHz} onTxOffsetChange={setTxOffsetHz} modemBwHz={modemBwHz} onModemBwChange={setModemBwHz} />
      case 'messages':
        return <MessagePanel wsMetrics={wsMetrics} onError={showError} onSuccess={showSuccess} />
      case 'files':
        return <FilesPlaceholder />
      case 'identity':
        return <IdentityPanel wsMetrics={wsMetrics} onError={showError} onSuccess={showSuccess} />
      case 'settings':
        return <SettingsPanel wsMetrics={wsMetrics} onError={showError} onSuccess={showSuccess} />
      case 'debug':
        return <DebugTab wsMetrics={wsMetrics} onError={showError} onSuccess={showSuccess} defaultSubTab={debugSubTab} rxOffsetHz={rxOffsetHz} />
      default:
        return null
    }
  }

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {/* Top Status Bar */}
      <StatusBar wsMetrics={wsMetrics} wsConnected={wsConnected} onSettingsClick={() => setActiveTab('settings')} rxOffsetHz={rxOffsetHz} txOffsetHz={txOffsetHz} />

      {/* Full-Band Spectrum (resizable) */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-700 overflow-hidden relative" style={{ height: `${spectrumHeight}px` }}>
        <Waterfall wsMetrics={wsMetrics} specOnly={true} palette={wfPalette} dbMin={wfDbMin} dbMax={wfDbMax} freqZoom={freqZoom} rxOffsetHz={rxOffsetHz} txOffsetHz={txOffsetHz} onRxOffsetChange={setRxOffsetHz} onTxOffsetChange={setTxOffsetHz} modemBwHz={modemBwHz} />
        {/* SNR Overlay */}
        <div className="absolute top-2 right-3 pointer-events-none" style={{ zIndex: 20 }}>
          <span className={`text-xl font-bold font-mono ${(wsMetrics.snr_db || 0) > 15 ? 'text-green-400' : (wsMetrics.snr_db || 0) > 8 ? 'text-yellow-400' : 'text-red-400'}`}
            style={{ textShadow: '0 0 6px rgba(0,0,0,0.8)' }}>
            {(wsMetrics.snr_db || 0) > 0 ? '+' : ''}{(wsMetrics.snr_db || 0).toFixed(1)} dB
          </span>
        </div>
      </div>

      {/* Resize Handle */}
      <div
        className="flex-shrink-0 h-1.5 bg-slate-700 cursor-row-resize hover:bg-cyan-600 active:bg-cyan-500 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault()
          const startY = e.clientY
          const startH = spectrumHeight
          let lastH = startH
          const onMove = (me) => {
            lastH = Math.max(80, Math.min(500, startH + (me.clientY - startY)))
            setSpectrumHeight(lastH)
          }
          const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            localStorage.setItem('bl21_specHeight', lastH.toString())
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
      />

      {/* Band Plan Bar (24px) */}
      <BandPlanBar wsMetrics={wsMetrics} rxOffsetHz={rxOffsetHz} onRxOffsetChange={setRxOffsetHz} />

      {/* Waterfall Controls Toolbar */}
      <div className="flex-shrink-0 flex gap-2 items-center text-xs bg-slate-900 border-b border-slate-700 px-3 py-1 flex-wrap">
        <label className="text-slate-400">Palette:</label>
        <select value={wfPalette} onChange={(e) => setWfPalette(e.target.value)} className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-100 text-xs">
          <option value="blue">Blue</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="greyscale">Grey</option>
        </select>
        <label className="text-slate-400">Speed:</label>
        <select value={wfSpeed} onChange={(e) => setWfSpeed(e.target.value)} className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-100 text-xs">
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
        <label className="text-slate-400">dBm:</label>
        <input type="number" value={wfDbMin} onChange={(e) => { setWfDbMin(parseInt(e.target.value)); setDbAutoScale(false) }} className="w-12 px-1 py-0.5 bg-slate-700 rounded text-slate-100 text-xs" disabled={dbAutoScale} />
        <span className="text-slate-500">–</span>
        <input type="number" value={wfDbMax} onChange={(e) => { setWfDbMax(parseInt(e.target.value)); setDbAutoScale(false) }} className="w-12 px-1 py-0.5 bg-slate-700 rounded text-slate-100 text-xs" disabled={dbAutoScale} />
        <label className="text-slate-400 ml-1 flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={dbAutoScale} onChange={(e) => setDbAutoScale(e.target.checked)} className="rounded" />
          AUTO
        </label>
        <label className="text-slate-400 ml-1">Zoom:</label>
        <input type="range" min="1" max="8" step="0.5" value={freqZoom} onChange={(e) => setFreqZoom(parseFloat(e.target.value))} className="w-16" />
        <span className="text-cyan-400 font-mono text-xs">{freqZoom.toFixed(1)}x</span>
        <label className="text-slate-400 ml-1">Time:</label>
        <input type="range" min="1" max="4" step="0.5" value={timeZoom} onChange={(e) => setTimeZoom(parseFloat(e.target.value))} className="w-16" />
        <span className="text-cyan-400 font-mono text-xs">{timeZoom.toFixed(1)}x</span>
      </div>

      {/* Waterfall (flex, dominant) */}
      <div className="flex-1 min-h-0 bg-slate-900 overflow-hidden">
        <Waterfall wsMetrics={wsMetrics} wfOnly={true} zoomLevel={timeZoom} palette={wfPalette} speed={wfSpeed} dbMin={wfDbMin} dbMax={wfDbMax} freqZoom={freqZoom} rxOffsetHz={rxOffsetHz} txOffsetHz={txOffsetHz} onRxOffsetChange={setRxOffsetHz} onTxOffsetChange={setTxOffsetHz} modemBwHz={modemBwHz} />
      </div>

      {/* Diagnostics Strip */}
      <DiagnosticsStrip wsMetrics={wsMetrics} />

      {/* Tab Bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} unreadMessages={unreadMessages} />

      {/* Tab Content Area */}
      <div className="flex-shrink-0 bg-slate-900 overflow-y-auto" style={{ height: '30vh', minHeight: '200px' }}>
        <div className="p-3">
          {renderTabContent()}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <BottomStatusBar wsMetrics={wsMetrics} wsConnected={wsConnected} />

      {/* Toast Notifications */}
      <div className="fixed bottom-8 right-4 space-y-2 pointer-events-none z-50">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={() => removeToast(toast.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ========== Inline Components (will be extracted to separate files in Phase 3+) ==========

// Band Plan Bar — dedicated colored bar between spectrum and waterfall
function BandPlanBar({ wsMetrics, rxOffsetHz, onRxOffsetChange }) {
  const bands = [
    { start: 10489.500, end: 10489.505, color: '#ef4444', label: 'Beacon' },
    { start: 10489.505, end: 10489.540, color: '#fbbf24', label: 'CW' },
    { start: 10489.540, end: 10489.580, color: '#60a5fa', label: 'NB Digi' },
    { start: 10489.580, end: 10489.650, color: '#34d399', label: 'Digital' },
    { start: 10489.650, end: 10489.745, color: '#f97316', label: 'SSB' },
    { start: 10489.745, end: 10489.755, color: '#a78bfa', label: 'BPSK' },
    { start: 10489.755, end: 10489.850, color: '#f97316', label: 'SSB' },
    { start: 10489.850, end: 10489.870, color: '#9ca3af', label: 'MIX' },
    { start: 10489.870, end: 10489.990, color: '#2dd4bf', label: 'Contest' },
    { start: 10489.990, end: 10490.000, color: '#ef4444', label: 'Beacon' },
  ]

  const BAND_START = 10489.470
  const BAND_END = 10490.030
  const totalSpan = BAND_END - BAND_START

  const handleBandClick = (band) => {
    const centerFreq = (band.start + band.end) / 2
    const offsetHz = (centerFreq - BAND_START_MHZ) * 1e6
    onRxOffsetChange(Math.max(0, Math.min(BAND_SPAN_HZ, offsetHz)))
  }

  return (
    <div className="flex-shrink-0 bg-slate-950 relative overflow-hidden" style={{ height: '24px' }}>
      {bands.map((band, i) => {
        const leftPct = ((band.start - BAND_START) / totalSpan) * 100
        const widthPct = ((band.end - band.start) / totalSpan) * 100
        return (
          <div
            key={i}
            className="absolute cursor-pointer hover:brightness-125 transition-all flex items-center justify-center overflow-hidden"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              height: '24px',
              backgroundColor: band.color + '40',
              borderLeft: '1px solid ' + band.color + '60',
            }}
            onClick={() => handleBandClick(band)}
            title={`${band.label}: ${band.start.toFixed(3)}–${band.end.toFixed(3)} MHz`}
          >
            {widthPct > 3 && (
              <span className="text-white/70 font-bold" style={{ fontSize: '8px' }}>{band.label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// RadioTab — consolidates left+right sidebar controls into a single tab panel
function RadioTab({ wsMetrics, onError, onSuccess, rxOffsetHz, txOffsetHz, onRxOffsetChange, onTxOffsetChange, modemBwHz, onModemBwChange }) {
  const [rxFreq, setRxFreq] = useState(10489.55)
  const [txFreq, setTxFreq] = useState(10489.55)
  const [rxGain, setRxGain] = useState(50)
  const [txAtten, setTxAtten] = useState(45)
  const [modemScheme, setModemScheme] = useState('QPSK')
  const [bandwidth, setBandwidth] = useState(modemBwHz || 2700)
  const [beaconMode, setBeaconMode] = useState('AUTO')
  const [xoCorr, setXoCorr] = useState(0)
  const [ritEnabled, setRitEnabled] = useState(false)
  const [xitEnabled, setXitEnabled] = useState(false)
  const [ritOffset, setRitOffset] = useState(0)
  const [xitOffset, setXitOffset] = useState(0)
  const debounceRef = useRef(null)

  // Sync from VFO offset props
  useEffect(() => {
    setRxFreq(BAND_START_MHZ + (rxOffsetHz || 0) / 1e6)
  }, [rxOffsetHz])
  useEffect(() => {
    setTxFreq(BAND_START_MHZ + (txOffsetHz || 0) / 1e6)
  }, [txOffsetHz])

  // Sync from WS metrics (non-frequency fields)
  useEffect(() => {
    if (wsMetrics.rx_gain_db != null) setRxGain(wsMetrics.rx_gain_db)
    if (wsMetrics.tx_gain_db != null) setTxAtten(wsMetrics.tx_gain_db)
    if (wsMetrics.modem_scheme) setModemScheme(wsMetrics.modem_scheme)
    if (wsMetrics.bandwidth_hz) setBandwidth(wsMetrics.bandwidth_hz)
    if (wsMetrics.rit_offset_hz != null) setRitOffset(wsMetrics.rit_offset_hz)
    if (wsMetrics.xit_offset_hz != null) setXitOffset(wsMetrics.xit_offset_hz)
  }, [wsMetrics.rx_gain_db, wsMetrics.tx_gain_db, wsMetrics.modem_scheme, wsMetrics.bandwidth_hz, wsMetrics.rit_offset_hz, wsMetrics.xit_offset_hz])

  const debounceApi = (endpoint, value, delay = 300) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      api.post(endpoint, { value }).catch(err => onError(err.message))
    }, delay)
  }

  // Modem groups
  const modemGroups = {
    PSK: ['BPSK', 'QPSK', 'PSK8', 'PSK16', 'PSK32', 'PSK64', 'PSK128', 'PSK256'],
    DPSK: ['DPSK2', 'DPSK4', 'DPSK8', 'DPSK16', 'DPSK32', 'DPSK64', 'DPSK128', 'DPSK256'],
    APSK: ['APSK4', 'APSK8', 'APSK16', 'APSK32', 'APSK64', 'APSK128', 'APSK256'],
    QAM: ['QAM4', 'QAM8', 'QAM16', 'QAM32', 'QAM64', 'QAM128', 'QAM256'],
    ASK: ['ASK2', 'ASK4', 'ASK8', 'ASK16', 'ASK32', 'ASK64', 'ASK128', 'ASK256', 'OOK'],
  }

  const bwOptions = [
    { value: 2700, label: '2.7 kHz' },
    { value: 3600, label: '3.6 kHz' },
    { value: 5400, label: '5.4 kHz' },
    { value: 10800, label: '10.8 kHz' },
    { value: 21600, label: '21.6 kHz' },
    { value: 54000, label: '54 kHz' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
      {/* Frequency Controls */}
      <div className="bg-slate-800 rounded border border-slate-700 p-2">
        <div className="text-slate-400 font-bold mb-2">FREQUENCY</div>
        <div className="space-y-2">
          <div>
            <label className="text-slate-500">RX (MHz)</label>
            <input type="number" step="0.001" value={rxFreq.toFixed(3)} onChange={(e) => setRxFreq(parseFloat(e.target.value))}
              onBlur={(e) => {
                const newOffsetHz = (parseFloat(e.target.value) - BAND_START_MHZ) * 1e6
                onRxOffsetChange(Math.max(0, Math.min(BAND_SPAN_HZ, newOffsetHz)))
              }}
              className="w-full bg-slate-900 text-cyan-400 border border-slate-600 rounded px-2 py-1 font-mono" />
          </div>
          <div>
            <label className="text-slate-500">TX (MHz)</label>
            <input type="number" step="0.001" value={txFreq.toFixed(3)} onChange={(e) => setTxFreq(parseFloat(e.target.value))}
              onBlur={(e) => {
                const newOffsetHz = (parseFloat(e.target.value) - BAND_START_MHZ) * 1e6
                if (onTxOffsetChange) onTxOffsetChange(Math.max(0, Math.min(BAND_SPAN_HZ, newOffsetHz)))
              }}
              className="w-full bg-slate-900 text-orange-400 border border-slate-600 rounded px-2 py-1 font-mono" />
          </div>
          <div className="flex gap-1">
            <button onClick={() => {
              setTxFreq(rxFreq)
              const newTxOffset = (rxFreq - BAND_START_MHZ) * 1e6
              if (onTxOffsetChange) onTxOffsetChange(Math.max(0, Math.min(BAND_SPAN_HZ, newTxOffset)))
            }}
              className="flex-1 bg-slate-700 hover:bg-slate-600 rounded py-1 text-center">R→T</button>
            <button onClick={() => {
              setRxFreq(txFreq)
              const newRxOffset = (txFreq - BAND_START_MHZ) * 1e6
              onRxOffsetChange(Math.max(0, Math.min(BAND_SPAN_HZ, newRxOffset)))
            }}
              className="flex-1 bg-slate-700 hover:bg-slate-600 rounded py-1 text-center">T→R</button>
          </div>
          {/* RIT/XIT */}
          <div className="flex gap-1">
            <button onClick={() => {
              const next = !ritEnabled
              setRitEnabled(next)
              if (!next) { setRitOffset(0); api.post('/api/v1/config/rit_offset', { value_hz: 0 }).catch(() => {}) }
            }}
              className={`flex-1 rounded py-1 font-bold ${ritEnabled ? 'bg-green-700 text-green-100' : 'bg-slate-700 text-slate-400'}`}>
              RIT {ritEnabled ? `${ritOffset > 0 ? '+' : ''}${ritOffset}Hz` : ''}
            </button>
            <button onClick={() => {
              const next = !xitEnabled
              setXitEnabled(next)
              if (!next) { setXitOffset(0); api.post('/api/v1/config/xit_offset', { value_hz: 0 }).catch(() => {}) }
            }}
              className={`flex-1 rounded py-1 font-bold ${xitEnabled ? 'bg-red-700 text-red-100' : 'bg-slate-700 text-slate-400'}`}>
              XIT {xitEnabled ? `${xitOffset > 0 ? '+' : ''}${xitOffset}Hz` : ''}
            </button>
          </div>
          {/* RIT offset input with ± buttons */}
          {ritEnabled && (
            <div className="flex items-center gap-1">
              <button onClick={(e) => { const v = ritOffset - (e.shiftKey ? 100 : 10); setRitOffset(v); api.post('/api/v1/config/rit_offset', { value_hz: v }).catch(() => {}) }}
                className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-green-400 font-bold">−</button>
              <input type="number" value={ritOffset} onChange={(e) => setRitOffset(parseInt(e.target.value) || 0)}
                onBlur={() => api.post('/api/v1/config/rit_offset', { value_hz: ritOffset }).catch(() => {})}
                className="flex-1 bg-slate-900 text-green-400 border border-slate-600 rounded px-1 py-0.5 font-mono text-center w-16" />
              <button onClick={(e) => { const v = ritOffset + (e.shiftKey ? 100 : 10); setRitOffset(v); api.post('/api/v1/config/rit_offset', { value_hz: v }).catch(() => {}) }}
                className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-green-400 font-bold">+</button>
              <span className="text-slate-500">Hz</span>
            </div>
          )}
          {/* XIT offset input with ± buttons */}
          {xitEnabled && (
            <div className="flex items-center gap-1">
              <button onClick={(e) => { const v = xitOffset - (e.shiftKey ? 100 : 10); setXitOffset(v); api.post('/api/v1/config/xit_offset', { value_hz: v }).catch(() => {}) }}
                className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-red-400 font-bold">−</button>
              <input type="number" value={xitOffset} onChange={(e) => setXitOffset(parseInt(e.target.value) || 0)}
                onBlur={() => api.post('/api/v1/config/xit_offset', { value_hz: xitOffset }).catch(() => {})}
                className="flex-1 bg-slate-900 text-red-400 border border-slate-600 rounded px-1 py-0.5 font-mono text-center w-16" />
              <button onClick={(e) => { const v = xitOffset + (e.shiftKey ? 100 : 10); setXitOffset(v); api.post('/api/v1/config/xit_offset', { value_hz: v }).catch(() => {}) }}
                className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-red-400 font-bold">+</button>
              <span className="text-slate-500">Hz</span>
            </div>
          )}
        </div>
      </div>

      {/* Gain Controls */}
      <div className="bg-slate-800 rounded border border-slate-700 p-2">
        <div className="text-slate-400 font-bold mb-2">GAIN / POWER</div>
        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-slate-500">
              <span>RX Gain</span>
              <span className="text-cyan-400 font-mono">{rxGain.toFixed(0)} dB</span>
            </div>
            <input type="range" min="0" max="73" value={rxGain}
              onChange={(e) => { setRxGain(parseFloat(e.target.value)); debounceApi('/api/v1/config/rx_gain_db', parseFloat(e.target.value)) }}
              className="w-full" />
          </div>
          <div>
            <div className="flex justify-between text-slate-500">
              <span>TX Atten</span>
              <span className="text-orange-400 font-mono">{txAtten.toFixed(1)} dB</span>
            </div>
            <input type="range" min="0" max="89" step="0.25" value={txAtten}
              onChange={(e) => { setTxAtten(parseFloat(e.target.value)); debounceApi('/api/v1/config/tx_atten_db', parseFloat(e.target.value)) }}
              className="w-full" />
          </div>
          <div>
            <label className="text-slate-500">Beacon Mode</label>
            <select value={beaconMode} onChange={(e) => { setBeaconMode(e.target.value); api.post('/api/v1/config/beacon_mode', { value: e.target.value }).catch(err => onError(err.message)) }}
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1">
              <option>AUTO</option><option>CW</option><option>BPSK</option><option>OFF</option>
            </select>
          </div>
          <div>
            <label className="text-slate-500">XO Corr (ppm)</label>
            <input type="number" step="0.1" value={xoCorr} onChange={(e) => setXoCorr(parseFloat(e.target.value))}
              onBlur={(e) => api.post('/api/v1/config/xo_correction_ppm', { value: parseFloat(e.target.value) }).catch(err => onError(err.message))}
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 font-mono" />
          </div>
        </div>
      </div>

      {/* Modem Scheme */}
      <div className="bg-slate-800 rounded border border-slate-700 p-2 col-span-2 lg:col-span-2">
        <div className="flex justify-between items-center mb-2">
          <span className="text-slate-400 font-bold">MODEM</span>
          <span className="text-cyan-400 font-mono font-bold">{wsMetrics.speed_mode_str || modemScheme}</span>
        </div>
        {Object.entries(modemGroups).map(([group, schemes]) => (
          <div key={group} className="mb-1">
            <span className="text-slate-500 mr-1">{group}:</span>
            <div className="inline-flex flex-wrap gap-0.5">
              {schemes.map(scheme => (
                <button key={scheme}
                  onClick={() => { setModemScheme(scheme); api.post('/api/v1/config/modem_scheme', { value: scheme }).catch(err => onError(err.message)) }}
                  className={`px-1.5 py-0.5 rounded text-xs font-mono transition ${
                    modemScheme === scheme ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}>
                  {scheme.replace(/^(D?PSK|APSK|QAM|ASK|OOK)/, '')||scheme}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-2 flex gap-2 items-center flex-wrap">
          <label className="text-slate-500">BW:</label>
          <select value={bandwidth} onChange={(e) => { const v = parseInt(e.target.value); setBandwidth(v); onModemBwChange?.(v); api.post('/api/v1/config/bandwidth_hz', { value: v }).catch(err => onError(err.message)) }}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 font-mono">
            {bwOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <div className="flex gap-0.5">
            {[1600, 2200, 2400, 2700, 2800, 3000, 3200, 3400].map(bw => (
              <button key={bw} onClick={() => { setBandwidth(bw); onModemBwChange?.(bw); api.post('/api/v1/config/bandwidth_hz', { value: bw }).catch(() => {}) }}
                className={`px-1 py-0.5 rounded text-xs font-mono ${bandwidth === bw ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                {(bw / 1000).toFixed(1)}
              </button>
            ))}
          </div>
          <span className="text-slate-500">Throughput:</span>
          <span className="text-green-400 font-mono font-bold">
            {(() => {
              const bpsMap = { BPSK: 1, QPSK: 2, PSK8: 3, PSK16: 4, PSK32: 5, PSK64: 6, PSK128: 7, PSK256: 8, QAM4: 2, QAM8: 3, QAM16: 4, QAM32: 5, QAM64: 6, QAM128: 7, QAM256: 8 }
              const bps = bpsMap[modemScheme] || 2
              return ((bandwidth / 1.35) * bps / 1000).toFixed(1)
            })()
          } kbps</span>
        </div>
      </div>
    </div>
  )
}

// Files placeholder
function FilesPlaceholder() {
  return (
    <div className="text-center py-8 text-slate-500">
      <div className="text-2xl mb-2">FILES</div>
      <p>File/image transfer coming in Phase 4.</p>
      <p className="text-xs mt-1">SSP supports up to 52KB per fragmented message (255 fragments × 204 bytes)</p>
    </div>
  )
}

// Debug tab — combines BER test, debug panel, and calibration
function DebugTab({ wsMetrics, onError, onSuccess, defaultSubTab = 'ber', rxOffsetHz }) {
  const [subTab, setSubTab] = useState(defaultSubTab)

  // Sync when parent changes defaultSubTab (e.g., from nav event)
  useEffect(() => { setSubTab(defaultSubTab) }, [defaultSubTab])
  return (
    <div>
      <div className="flex gap-1 mb-2">
        {['ber', 'debug', 'calibration'].map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`px-3 py-1 rounded text-xs font-bold ${subTab === t ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {subTab === 'ber' && <BerTestPanel wsMetrics={wsMetrics} onError={onError} onSuccess={onSuccess} />}
      {subTab === 'debug' && <DebugPanel />}
      {subTab === 'calibration' && <CalibrationPanel wsMetrics={wsMetrics} onError={onError} onSuccess={onSuccess} rxOffsetHz={rxOffsetHz} />}
    </div>
  )
}

export default App
