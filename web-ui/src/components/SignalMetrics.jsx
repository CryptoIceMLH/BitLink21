import React, { useEffect } from 'react'

const SignalMetrics = ({ wsMetrics, detailed = false }) => {
  useEffect(() => {
    // Log major metric changes (every 50 samples to avoid spam)
    if (wsMetrics?.rssi_db !== undefined && Math.random() < 0.02) {
      console.debug('[METRICS] Current signal status', {
        rssi_db: wsMetrics.rssi_db.toFixed(1),
        snr_db: wsMetrics.snr_db?.toFixed(1) || 'N/A',
        evm_db: wsMetrics.evm_db?.toFixed(1) || 'N/A',
        beacon: wsMetrics.beacon_lock_state || 'UNLOCKED',
        rx_frames: wsMetrics.rx_frame_count,
        tx_queue: wsMetrics.tx_queue_depth
      })
    }
  }, [wsMetrics])
  const getRxSignalColor = () => {
    if (wsMetrics.rssi_db > -70) return 'bg-green-900 text-green-300'
    if (wsMetrics.rssi_db > -85) return 'bg-yellow-900 text-yellow-300'
    return 'bg-red-900 text-red-300'
  }

  const getRxSyncColor = () => {
    if (wsMetrics.snr_db > 10) return 'bg-green-900 text-green-300'
    if (wsMetrics.snr_db > 5) return 'bg-yellow-900 text-yellow-300'
    return 'bg-red-900 text-red-300'
  }

  const getBeaconColor = () => {
    const state = wsMetrics.beacon_lock_state || 'UNLOCKED'
    if (state === 'FINE_LOCK') return 'bg-green-900 text-green-300'
    if (state === 'COARSE_LOCK') return 'bg-yellow-900 text-yellow-300'
    return 'bg-red-900 text-red-300'
  }

  const getVuBarColor = (value, max = 100) => {
    const pct = (value / max) * 100
    if (pct < 20 || pct > 85) return 'bg-red-600'
    if (pct > 70) return 'bg-yellow-600'
    return 'bg-green-600'
  }

  const getBerColor = () => {
    const ber = wsMetrics.ber || 0
    if (ber < 0.001) return 'text-green-400'
    if (ber < 0.01) return 'text-yellow-400'
    return 'text-red-400'
  }

  if (!detailed) {
    // Compact view for main grid
    return (
      <div className="space-y-2 text-xs">
        {/* Signal LEDs */}
        <div className="flex gap-2">
          <div className={`px-2 py-1 rounded font-bold ${getRxSignalColor()}`}>RX SIG</div>
          <div className={`px-2 py-1 rounded font-bold ${getRxSyncColor()}`}>RX SYNC</div>
        </div>

        {/* RSSI */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-slate-400">RSSI</span>
            <span className="text-cyan-400 font-mono">{wsMetrics.rssi_db.toFixed(1)} dBm</span>
          </div>
          <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
            <div
              className="bg-cyan-500 h-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, (wsMetrics.rssi_db + 120) / 1.2))}%` }}
            />
          </div>
        </div>

        {/* SNR */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-slate-400">SNR</span>
            <span className="text-green-400 font-mono">{wsMetrics.snr_db.toFixed(1)} dB</span>
          </div>
          <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
            <div
              className="bg-green-500 h-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, wsMetrics.snr_db / 40 * 100))}%` }}
            />
          </div>
        </div>

        {/* EVM */}
        <div className="flex justify-between">
          <span className="text-slate-400">EVM</span>
          <span className="text-purple-400 font-mono">{wsMetrics.evm_db?.toFixed(1) || 'N/A'} dB</span>
        </div>

        {/* Beacon Lock Badge */}
        <div className={`px-2 py-1 rounded text-center font-bold ${getBeaconColor()}`}>
          {wsMetrics.beacon_lock_state || 'UNLOCKED'} {wsMetrics.beacon_phase_error_deg?.toFixed(1) || '0'}°
        </div>

        {/* Buffers */}
        <div>
          <div className="flex justify-between mb-1 text-slate-400 text-xs">
            <span>RX VU</span>
            <span className="text-slate-300">0-100%</span>
          </div>
          <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
            <div
              className={`h-full transition-all ${getVuBarColor(wsMetrics.rx_buffer_pct || 0)}`}
              style={{ width: `${wsMetrics.rx_buffer_pct || 0}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1 text-slate-400 text-xs">
            <span>TX VU</span>
            <span className="text-slate-300">0-100%</span>
          </div>
          <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
            <div
              className={`h-full transition-all ${getVuBarColor(wsMetrics.tx_buffer_pct || 0)}`}
              style={{ width: `${wsMetrics.tx_buffer_pct || 0}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="text-slate-400 space-y-1 pt-2 border-t border-slate-700">
          <div className="flex justify-between">
            <span>Frames</span>
            <span className="text-cyan-300">{wsMetrics.rx_frame_count || 0}</span>
          </div>
          <div className="flex justify-between">
            <span>Errors</span>
            <span className="text-red-300">{wsMetrics.rx_error_count || 0}</span>
          </div>
        </div>
      </div>
    )
  }

  // Detailed view for Settings tab
  return (
    <div className="space-y-3 text-xs">
      <div className="border border-slate-700 rounded p-3">
        <h4 className="text-cyan-400 font-bold mb-2">SIGNAL QUALITY</h4>

        <div className="space-y-2">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-slate-400">RSSI</span>
              <span className="text-cyan-400 font-mono">{wsMetrics.rssi_db.toFixed(1)} dBm</span>
            </div>
            <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
              <div
                className="bg-cyan-500 h-full transition-all"
                style={{ width: `${Math.max(0, Math.min(100, (wsMetrics.rssi_db + 120) / 1.2))}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span className="text-slate-400">SNR</span>
              <span className="text-green-400 font-mono">{wsMetrics.snr_db.toFixed(1)} dB</span>
            </div>
            <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all"
                style={{ width: `${Math.max(0, Math.min(100, wsMetrics.snr_db / 40 * 100))}%` }}
              />
            </div>
          </div>

          <div className="flex justify-between">
            <span className="text-slate-400">EVM</span>
            <span className="text-purple-400 font-mono">{wsMetrics.evm_db?.toFixed(1) || 'N/A'} dB</span>
          </div>

          <div className={`px-2 py-1 rounded text-center font-bold ${getBeaconColor()}`}>
            BEACON: {wsMetrics.beacon_lock_state || 'UNLOCKED'} {wsMetrics.beacon_phase_error_deg?.toFixed(1) || '0'}°
          </div>
        </div>
      </div>

      <div className="border border-slate-700 rounded p-3">
        <h4 className="text-cyan-400 font-bold mb-2">BUFFERS</h4>

        <div className="space-y-2">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-slate-400">RX FIFO</span>
              <span className="text-slate-300">{wsMetrics.rx_buffer_pct || 0}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${getVuBarColor(wsMetrics.rx_buffer_pct || 0)}`}
                style={{ width: `${wsMetrics.rx_buffer_pct || 0}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span className="text-slate-400">TX FIFO</span>
              <span className="text-slate-300">{wsMetrics.tx_buffer_pct || 0}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${getVuBarColor(wsMetrics.tx_buffer_pct || 0)}`}
                style={{ width: `${wsMetrics.tx_buffer_pct || 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border border-slate-700 rounded p-3">
        <h4 className="text-cyan-400 font-bold mb-2">STATS</h4>

        <div className="grid grid-cols-2 gap-2 text-slate-400">
          <div>Frames RX: <span className="text-cyan-300">{wsMetrics.rx_frame_count || 0}</span></div>
          <div>Errors: <span className="text-red-300">{wsMetrics.rx_error_count || 0}</span></div>
          <div>TX Queue: <span className="text-yellow-300">{wsMetrics.tx_queue_depth || 0}</span></div>
          <div>BER: <span className={`${getBerColor()} font-mono`}>{((wsMetrics.ber || 0) * 100).toFixed(3)}%</span></div>
        </div>
      </div>
    </div>
  )
}

export default SignalMetrics
