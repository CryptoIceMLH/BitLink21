import React from 'react'

const UI_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.5.4'

const BottomStatusBar = ({ wsMetrics, wsConnected }) => {
  const sdrInfo = wsMetrics.sdr_connected
    ? `${wsMetrics.sdr_hw_model || 'PlutoSDR'} ${wsMetrics.sdr_fw_version ? 'v' + wsMetrics.sdr_fw_version : ''}`
    : 'SDR Disconnected'
  const sdrColor = wsMetrics.sdr_connected ? 'text-green-400' : 'text-red-400'

  const ber = wsMetrics.ber || 0
  const berStr = ber < 0.0001 ? '<0.01%' : (ber * 100).toFixed(2) + '%'
  const berColor = ber < 0.001 ? 'text-green-400' : ber < 0.01 ? 'text-yellow-400' : 'text-red-400'

  const speed = wsMetrics.speed_mode_str || `${wsMetrics.modem_scheme || 'QPSK'}`
  const bw = wsMetrics.bandwidth_hz ? (wsMetrics.bandwidth_hz / 1000).toFixed(1) + 'kHz' : '2.7kHz'

  const beaconState = wsMetrics.beacon_lock_state || 'UNLOCKED'
  const beaconPhase = wsMetrics.beacon_phase_error_deg || 0
  const beaconColor = beaconState === 'FINE_LOCK' ? 'text-green-400' : beaconState === 'COARSE_LOCK' ? 'text-yellow-400' : 'text-slate-500'
  const beaconLabel = beaconState === 'FINE_LOCK' ? 'LOCKED' : beaconState === 'COARSE_LOCK' ? 'COARSE' : 'UNLOCKED'

  const wsColor = wsConnected ? 'text-green-400' : 'text-red-400'

  return (
    <footer className="flex-shrink-0 bg-slate-950 border-t border-slate-700 px-3 py-1 flex items-center gap-4 text-xs font-mono">
      <span className={sdrColor}>SDR: {sdrInfo}</span>
      <span className="text-slate-600">|</span>
      <span className={berColor}>BER: {berStr}</span>
      <span className="text-slate-600">|</span>
      <span className="text-cyan-400">{speed} {bw}</span>
      <span className="text-slate-600">|</span>
      <span className={beaconColor}>Beacon: {beaconLabel} ({beaconPhase.toFixed(1)}°)</span>
      <span className="text-slate-600">|</span>
      <span className="text-slate-400">RX: {wsMetrics.rx_frame_count || 0} / Err: {wsMetrics.rx_error_count || 0}</span>
      <div className="flex-1"></div>
      <span className={wsColor}>{wsConnected ? 'WS●' : 'WS○'}</span>
      <span className="text-slate-600">|</span>
      <span className="text-slate-500">BitLink21 v{UI_VERSION}</span>
    </footer>
  )
}

export default BottomStatusBar
