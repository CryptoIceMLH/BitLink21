import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

function SettingsPanel({ wsMetrics, onError, onSuccess }) {
  const [plutoIp, setPlutoIp] = useState('')
  const [plutoConnectionMode, setPlutoConnectionMode] = useState('ethernet')
  const [lnbOffset, setLnbOffset] = useState('0')
  const [rfOffset, setRfOffset] = useState('0')
  const [xoCorrection, setXoCorrection] = useState('0')
  const [rxPower, setRxPower] = useState('-20')
  const [txPower, setTxPower] = useState('-20')
  const [bandwidth, setBandwidth] = useState('2000000') // SDR RF bandwidth (Hz) — PlutoSDR min 520830
  const [beaconMode, setBeaconMode] = useState('auto')
  const [pttMode, setPttMode] = useState('ptt')
  const [apiUrl, setApiUrl] = useState('')
  const [testStatus, setTestStatus] = useState(null)
  const [testMessage, setTestMessage] = useState('')
  const [showBitcoin, setShowBitcoin] = useState(false)
  const [btcRpcUrl, setBtcRpcUrl] = useState('')
  const [btcRpcUser, setBtcRpcUser] = useState('')
  const [btcRpcPass, setBtcRpcPass] = useState('')
  const [btcPassSaved, setBtcPassSaved] = useState(false)
  const [showLightning, setShowLightning] = useState(false)
  const [lndUrl, setLndUrl] = useState('')
  const [lndMacaroon, setLndMacaroon] = useState('')
  const [lndMacaroonSaved, setLndMacaroonSaved] = useState(false)
  const [retentionDays, setRetentionDays] = useState('7')
  const [sdrConnecting, setSdrConnecting] = useState(false)
  const [sdrConnected, setSdrConnected] = useState(wsMetrics?.sdr_connected || false)
  const [sdrInfo, setSdrInfo] = useState({})

  const bandwidthOptions = [520830, 1000000, 2700000, 5000000, 10000000, 20000000, 30720000] // Hz — min=520830, max=30.72MHz

  useEffect(() => {
    console.debug('[SETTINGS] Component mounted')
    const saved_api = localStorage.getItem('bitlink21_api_url') || 'http://192.168.1.114:8021'
    console.debug('[SETTINGS] API URL loaded', { url: saved_api })
    setApiUrl(saved_api)

    const fetchSettings = async () => {
      console.debug('[SETTINGS] Fetching settings')
      try {
        const [pluto, lnb, rf, xo, bw, beacon, retention, sdrProbe, btcConfig, lndConfig] = await Promise.all([
          api.get('/api/v1/config/pluto_ip'),
          api.get('/api/v1/config/lnb_offset'),
          api.get('/api/v1/config/rf_offset'),
          api.get('/api/v1/config/xo_correction'),
          api.get('/api/v1/config/sdr_bandwidth_hz'),
          api.get('/api/v1/config/beacon_mode'),
          api.get('/api/v1/config/retention_days'),
          api.get('/api/v1/radio/probe'),
          api.get('/api/v1/bitcoin/config').catch(() => null),
          api.get('/api/v1/lightning/config').catch(() => null),
        ])

        console.debug('[SETTINGS] Settings fetched', { sdrProbeConnected: sdrProbe?.connected })

        if (pluto?.pluto_ip) setPlutoIp(pluto.pluto_ip)
        if (lnb?.lnb_offset != null) setLnbOffset(parseFloat(lnb.lnb_offset).toFixed(3))
        if (rf?.rf_offset) setRfOffset(rf.rf_offset.toString())
        if (xo?.xo_correction !== undefined) setXoCorrection(xo.xo_correction.toString())
        if (bw?.value) setBandwidth(bw.value.toString())
        // Backend returns "beacon_mode", not "value"
        if (beacon?.beacon_mode) setBeaconMode(beacon.beacon_mode.toLowerCase())
        // Backend returns "days", not "value"
        if (retention?.days) setRetentionDays(retention.days.toString())

        // Load SDR connection status
        if (sdrProbe && sdrProbe.connected) {
          console.debug('[SETTINGS] SDR connected', { model: sdrProbe.hw_model, fw: sdrProbe.fw_version })
          setSdrConnected(true)
          setSdrInfo(sdrProbe)
        }

        // Load Bitcoin config if available
        if (btcConfig && btcConfig.configured) {
          console.debug('[SETTINGS] Bitcoin config loaded', { rpc_url: btcConfig.rpc_url })
          setBtcRpcUrl(btcConfig.rpc_url || '')
          setBtcRpcUser(btcConfig.rpc_user || '')
          setBtcPassSaved(true)  // password was saved but not returned for security
          setShowBitcoin(true)  // auto-expand so user sees saved data
          // Note: password is not returned for security
        }

        // Load Lightning config if available
        if (lndConfig && lndConfig.configured) {
          console.debug('[SETTINGS] Lightning config loaded', { lnd_rest_url: lndConfig.lnd_rest_url })
          setLndUrl(lndConfig.lnd_rest_url || '')
          setLndMacaroonSaved(true)  // macaroon was saved but not returned for security
          setShowLightning(true)  // auto-expand
        }
      } catch (err) {
        console.error('[SETTINGS] Failed to load settings', { error: err.message })
        onError?.('Failed to load settings')
      }
    }

    fetchSettings()
  }, [])

  // Sync live SDR status from WS metrics (overrides stale probe cache)
  useEffect(() => {
    if (wsMetrics?.sdr_connected != null) {
      setSdrConnected(wsMetrics.sdr_connected)
    }
  }, [wsMetrics?.sdr_connected])

  const handleSave = async () => {
    console.debug('[SETTINGS] Save clicked', { pttMode, retentionDays, beaconMode })
    try {
      console.debug('[SETTINGS] Saving radio config')
      await Promise.all([
        api.post('/api/v1/config/pluto_ip', { value: plutoIp }),
        api.post('/api/v1/config/lnb_offset', { value: lnbOffset }),
        api.post('/api/v1/config/rf_offset', { value: rfOffset }),
        api.post('/api/v1/config/xo_correction', { value: xoCorrection }),
        api.post('/api/v1/config/sdr_bandwidth_hz', { value: parseInt(bandwidth) }),
        api.post('/api/v1/config/beacon_mode', { value: beaconMode.toUpperCase() }),
        api.post('/api/v1/config/retention_days', { days: parseInt(retentionDays) }),
        api.post('/api/v1/config/ptt_mode', { value: pttMode }),
      ])

      if (btcRpcUrl && btcRpcUser) {
        console.debug('[SETTINGS] Saving Bitcoin config')
        const btcPayload = { rpc_url: btcRpcUrl, rpc_user: btcRpcUser }
        // Only include rpc_pass if user entered a new password (don't wipe saved password by sending empty string)
        if (btcRpcPass) btcPayload.rpc_pass = btcRpcPass
        await api.post('/api/v1/bitcoin/config', btcPayload)
      }
      if (lndUrl) {
        console.debug('[SETTINGS] Saving Lightning config')
        const lndPayload = { lnd_rest_url: lndUrl }
        if (lndMacaroon) lndPayload.lnd_macaroon = lndMacaroon
        await api.post('/api/v1/lightning/config', lndPayload)
      }

      console.debug('[SETTINGS] All settings saved')
      onSuccess?.('Settings saved successfully')
    } catch (err) {
      console.error('[SETTINGS] Save failed', { error: err.message })
      onError?.('Failed to save settings: ' + err.message)
    }
  }

  const handleReset = async () => {
    if (window.confirm('Reset modem to factory defaults?')) {
      console.debug('[SETTINGS] Reset clicked')
      try {
        await api.post('/api/v1/radio/reset', {})
        console.debug('[SETTINGS] Modem reset successful')
        onSuccess?.('Modem reset!')
      } catch (err) {
        console.error('[SETTINGS] Reset failed', { error: err.message })
        onError?.('Reset failed: ' + err.message)
      }
    }
  }

  const handleShutdown = async () => {
    if (window.confirm('Shutdown BitLink21?')) {
      console.debug('[SETTINGS] Shutdown clicked')
      try {
        await api.post('/api/v1/radio/shutdown', {})
        console.debug('[SETTINGS] Shutdown initiated')
        onSuccess?.('Shutting down...')
      } catch (err) {
        console.error('[SETTINGS] Shutdown failed', { error: err.message })
        onError?.('Shutdown failed: ' + err.message)
      }
    }
  }

  const handleSdrConnect = async () => {
    console.debug('[SETTINGS] SDR connect clicked', { uri: plutoIp })
    setSdrConnecting(true)
    try {
      // Ensure URI has ip: prefix for libiio
      let uri = plutoIp || 'ip:192.168.1.200'
      if (uri && !uri.startsWith('ip:') && !uri.startsWith('usb:')) {
        uri = `ip:${uri}`
      }

      console.debug('[SETTINGS] Connecting to SDR', { uri, lnbOffsetMhz: lnbOffset, bandwidthHz: bandwidth })
      const response = await api.post('/api/v1/radio/connect', {
        uri: uri,
        lnb_offset_mhz: parseFloat(lnbOffset) || 9750.0, // Already in MHz from state
        bandwidth_hz: parseFloat(bandwidth) || 2000000, // SDR RF bandwidth (min 520830, default 2 MHz)
      })

      if (response.connected) {
        console.debug('[SETTINGS] SDR connected', { model: response.hw_model, fw: response.fw_version })
        setSdrConnected(true)
        setSdrInfo(response)
        onSuccess?.(`SDR connected: ${response.hw_model}`)
      } else {
        console.debug('[SETTINGS] SDR connection failed', { error: response.error })
        setSdrConnected(false)
        setSdrInfo({})
        onError?.(`Failed to connect SDR: ${response.error || 'unknown error'}`)
      }
    } catch (err) {
      console.error('[SETTINGS] SDR connection error', { error: err.message })
      setSdrConnected(false)
      setSdrInfo({})
      onError?.('SDR connection error: ' + err.message)
    } finally {
      setSdrConnecting(false)
    }
  }

  const handleSdrDisconnect = async () => {
    console.debug('[SETTINGS] SDR disconnect clicked')
    setSdrConnecting(true)
    try {
      await api.post('/api/v1/radio/disconnect', {})
      console.debug('[SETTINGS] SDR disconnected')
      setSdrConnected(false)
      setSdrInfo({})
      onSuccess?.('SDR disconnected')
    } catch (err) {
      console.error('[SETTINGS] SDR disconnect failed', { error: err.message })
      onError?.('Disconnect failed: ' + err.message)
    } finally {
      setSdrConnecting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto text-xs">
    <div className="max-w-lg mx-auto space-y-3 py-2">
      {/* Hardware Section */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <h3 className="text-cyan-400 font-bold mb-3">HARDWARE</h3>

        <div className="space-y-2">
          {!sdrConnected ? (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-300">Device Type</label>
                <select className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs">
                  <option value="pluto">PlutoSDR (ADALM-PLUTO)</option>
                  <option value="rtlsdr" disabled>RTL-SDR (coming soon)</option>
                  <option value="hackrf" disabled>HackRF (coming soon)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-300">Connect Via</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={plutoConnectionMode === 'ethernet'}
                      onChange={() => setPlutoConnectionMode('ethernet')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Ethernet</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={plutoConnectionMode === 'usb'}
                      onChange={() => {
                        setPlutoConnectionMode('usb');
                        setPlutoIp('');
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">USB</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-slate-400">URI</label>
                <input
                  type="text"
                  value={plutoIp}
                  onChange={(e) => setPlutoIp(e.target.value)}
                  disabled={plutoConnectionMode === 'usb'}
                  className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="ip:192.168.1.200"
                />
              </div>

              <button
                onClick={handleSdrConnect}
                disabled={sdrConnecting}
                className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded mt-3 transition"
              >
                {sdrConnecting ? 'Connecting...' : 'CONNECT'}
              </button>
            </>
          ) : (
            <>
              <div className="bg-green-900 border border-green-700 rounded p-3 mb-3">
                <div className="text-green-300 font-bold flex items-center gap-2">
                  <span>●</span>
                  {sdrInfo.hw_model || 'PlutoSDR'} Connected
                </div>
                <div className="text-slate-400 text-xs mt-2">
                  <div>FW: v{sdrInfo.fw_version}</div>
                  <div>Serial: {sdrInfo.serial}</div>
                  <div>Range: {sdrInfo.freq_min_mhz || '70'}–{sdrInfo.freq_max_mhz || '6000'} MHz</div>
                </div>
              </div>

              <button
                onClick={handleSdrDisconnect}
                disabled={sdrConnecting}
                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold rounded mt-3 transition"
              >
                {sdrConnecting ? 'Disconnecting...' : 'DISCONNECT'}
              </button>
            </>
          )}

          {/* LNB Offset — always visible regardless of SDR connection state */}
          <div className="mt-3 pt-3 border-t border-slate-700">
            <label className="text-slate-400 font-semibold">LNB Offset (MHz)</label>
            <input
              type="number"
              value={lnbOffset}
              onChange={(e) => setLnbOffset(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
              placeholder="9750"
              step="0.001"
            />
            <div className="text-slate-500 mt-1 text-xs">Standard: 9750.0 MHz for Ku-band LNB</div>
          </div>

          {/* Calibration shortcut */}
          <div className="mt-2">
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('bitlink21_nav', { detail: { tab: 'debug', subTab: 'calibration' } }))
              }}
              className="w-full px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-cyan-400 font-bold rounded text-xs transition"
            >
              CALIBRATION (TCXO / LNB)
            </button>
          </div>
        </div>
      </div>

      {/* RF Settings Section */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <h3 className="text-cyan-400 font-bold mb-3">RF SETTINGS</h3>

        <div className="space-y-2">
          <div>
            <label className="text-slate-400">Bandwidth</label>
            <select
              value={bandwidth}
              onChange={(e) => setBandwidth(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
            >
              {bandwidthOptions.map(bw => (
                <option key={bw} value={bw}>
                  {bw < 1000000 ? (bw / 1000).toFixed(1) + ' kHz' : (bw / 1000000).toFixed(1) + ' MHz'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-slate-400">Beacon Mode</label>
            <select
              value={beaconMode}
              onChange={(e) => setBeaconMode(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
            >
              <option value="auto">Auto</option>
              <option value="cw">CW Only</option>
              <option value="bpsk">BPSK Only</option>
              <option value="off">Off</option>
            </select>
          </div>

          <div>
            <label className="text-slate-400">PTT Mode</label>
            <select
              value={pttMode}
              onChange={(e) => setPttMode(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
            >
              <option value="ptt">PTT</option>
              <option value="toggle">Toggle</option>
            </select>
          </div>

          <div>
            <label className="text-slate-400">RF Offset (Hz)</label>
            <input
              type="number"
              value={rfOffset}
              onChange={(e) => setRfOffset(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
            />
          </div>

          <div>
            <label className="text-slate-400">XO Correction (PPB)</label>
            <input
              type="number"
              value={xoCorrection}
              onChange={(e) => setXoCorrection(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
            />
            <div className="text-slate-500 mt-1 text-xs">Crystal oscillator fine-tuning</div>
          </div>
        </div>
      </div>

      {/* Bitcoin Section */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <button
          onClick={() => setShowBitcoin(!showBitcoin)}
          className="text-cyan-400 font-bold flex items-center gap-2 mb-2"
        >
          {showBitcoin ? '▼' : '▶'} BITCOIN
        </button>

        {showBitcoin && (
          <div className="space-y-2 mt-2">
            <input
              type="text"
              value={btcRpcUrl}
              onChange={(e) => setBtcRpcUrl(e.target.value)}
              placeholder="RPC URL (http://...)"
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            />
            <input
              type="text"
              value={btcRpcUser}
              onChange={(e) => setBtcRpcUser(e.target.value)}
              placeholder="Username"
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            />
            <input
              type="password"
              value={btcRpcPass}
              onChange={(e) => setBtcRpcPass(e.target.value)}
              onFocus={() => setBtcPassSaved(false)}
              placeholder={btcPassSaved && !btcRpcPass ? "••••••• (saved — leave blank to keep)" : "Password"}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            />
          </div>
        )}
      </div>

      {/* Lightning Section */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <button
          onClick={() => setShowLightning(!showLightning)}
          className="text-cyan-400 font-bold flex items-center gap-2 mb-2"
        >
          {showLightning ? '▼' : '▶'} LIGHTNING
        </button>

        {showLightning && (
          <div className="space-y-2 mt-2">
            <input
              type="text"
              value={lndUrl}
              onChange={(e) => setLndUrl(e.target.value)}
              placeholder="LND REST URL"
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            />
            <input
              type="password"
              value={lndMacaroon}
              onChange={(e) => setLndMacaroon(e.target.value)}
              onFocus={() => setLndMacaroonSaved(false)}
              placeholder={lndMacaroonSaved && !lndMacaroon ? "••••••• (saved — leave blank to keep)" : "Macaroon (64 chars hex)"}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            />
          </div>
        )}
      </div>

      {/* System Section */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <h3 className="text-cyan-400 font-bold mb-3">SYSTEM</h3>

        <div className="space-y-2">
          <div>
            <label className="text-slate-400">Message Retention (days)</label>
            <input
              type="number"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs mt-1"
            />
          </div>

          {testStatus !== null && (
            <div className={`px-2 py-1 rounded text-xs ${testStatus ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
              {testMessage}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 px-3 py-1 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded transition"
            >
              SAVE
            </button>
            <button
              onClick={handleReset}
              className="flex-1 px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded transition"
            >
              RESET
            </button>
            <button
              onClick={handleShutdown}
              className="flex-1 px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded transition"
            >
              SHUTDOWN
            </button>
          </div>

          <button
            onClick={async () => {
              if (!confirm('Reset all radio settings to defaults? (Identity and Bitcoin/Lightning config will be preserved)')) return
              try {
                await api.post('/api/v1/config/reset_radio', {})
                onSuccess?.('Radio config reset to defaults')
                // Reload settings
                window.location.reload()
              } catch (err) {
                onError?.('Reset failed: ' + err.message)
              }
            }}
            className="w-full mt-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-yellow-400 font-bold rounded text-xs transition border border-yellow-700/30"
          >
            RESET RADIO CONFIG TO DEFAULTS
          </button>
        </div>
      </div>
    </div>
    </div>
  )
}

export default SettingsPanel
