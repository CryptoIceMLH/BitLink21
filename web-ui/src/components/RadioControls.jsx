import React, { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'

const MODEM_SCHEME_MAP = {
  'BPSK': 0, 'QPSK': 11, 'PSK8': 12, 'PSK16': 13, 'PSK32': 14, 'PSK64': 15, 'PSK128': 16, 'PSK256': 17,
  'DPSK2': 18, 'DPSK4': 19, 'DPSK8': 20, 'DPSK16': 21, 'DPSK32': 22, 'DPSK64': 23, 'DPSK128': 24, 'DPSK256': 25, 'PI4DQPSK': 26,
  'APSK4': 27, 'APSK8': 28, 'APSK16': 29, 'APSK32': 30, 'APSK64': 31, 'APSK128': 32, 'APSK256': 33,
  'QAM4': 34, 'QAM8': 35, 'QAM16': 36, 'QAM32': 37, 'QAM64': 38, 'QAM128': 39, 'QAM256': 40,
  'ASK2': 41, 'ASK4': 42, 'ASK8': 43, 'ASK16': 44, 'ASK32': 45, 'ASK64': 46, 'ASK128': 47, 'ASK256': 48, 'OOK': 49,
  'ARB16OPT': 50, 'ARB32OPT': 51, 'ARB64OPT': 52, 'ARB128OPT': 53, 'ARB256OPT': 54, 'ARB64VT': 55,
}

const MODULATION_SCHEMES = [
  { group: 'PSK', schemes: ['BPSK', 'QPSK', 'PSK8', 'PSK16', 'PSK32', 'PSK64', 'PSK128', 'PSK256'] },
  { group: 'DPSK', schemes: ['DPSK2', 'DPSK4', 'DPSK8', 'DPSK16', 'DPSK32', 'DPSK64', 'DPSK128', 'DPSK256', 'PI4DQPSK'] },
  { group: 'APSK', schemes: ['APSK4', 'APSK8', 'APSK16', 'APSK32', 'APSK64', 'APSK128', 'APSK256'] },
  { group: 'QAM', schemes: ['QAM4', 'QAM8', 'QAM16', 'QAM32', 'QAM64', 'QAM128', 'QAM256'] },
  { group: 'ASK', schemes: ['ASK2', 'ASK4', 'ASK8', 'ASK16', 'ASK32', 'ASK64', 'ASK128', 'ASK256', 'OOK'] },
  { group: 'ARB', schemes: ['ARB16OPT', 'ARB32OPT', 'ARB64OPT', 'ARB128OPT', 'ARB256OPT', 'ARB64VT'] },
]

const RadioControls = ({ wsMetrics, onError, onSuccess }) => {
  const [rxFreq, setRxFreq] = useState(10489.55)
  const [txFreq, setTxFreq] = useState(10489.55)
  const [ritOn, setRitOn] = useState(false)
  const [ritOffset, setRitOffset] = useState(0)
  const [xitOn, setXitOn] = useState(false)
  const [xitOffset, setXitOffset] = useState(0)
  const [modem, setModem] = useState('QPSK')
  const [bandwidth, setBandwidth] = useState(2700)
  const [rxGain, setRxGain] = useState(60)
  const [txAtten, setTxAtten] = useState(10)
  const [txPower, setTxPower] = useState(-20)
  const [beaconMode, setBeaconMode] = useState('auto')
  const [xoCorrection, setXoCorrection] = useState(0)
  const [lnbOffset, setLnbOffset] = useState(0)
  const [rfOffset, setRfOffset] = useState(0)
  const [toneMode, setToneMode] = useState('off')
  const [rfLoop, setRfLoop] = useState(false)

  const rxGainTimeoutRef = useRef(null)
  const txAttenTimeoutRef = useRef(null)

  const bandwidthOptions = [2700, 10000, 25000, 100000, 500000, 1000000, 5000000]

  // Load config from API on mount
  useEffect(() => {
    console.debug('[RADIO] Component mounted, loading config')
    const loadConfig = async () => {
      console.debug('[RADIO] Fetching config endpoints')
      try {
        const [freqRes, txRes, modemRes, bwRes, rxRes, txARes, beaconRes, xoRes, lnbRes, rfRes] = await Promise.all([
          api.get('/api/v1/config/center_freq_mhz').catch(() => ({})),
          api.get('/api/v1/config/tx_freq_mhz').catch(() => ({})),
          api.get('/api/v1/config/modem_scheme').catch(() => ({})),
          api.get('/api/v1/config/bandwidth_hz').catch(() => ({})),
          api.get('/api/v1/config/rx_gain_db').catch(() => ({})),
          api.get('/api/v1/config/tx_atten_db').catch(() => ({})),
          api.get('/api/v1/config/beacon_mode').catch(() => ({})),
          api.get('/api/v1/config/xo_correction').catch(() => ({})),
          api.get('/api/v1/config/lnb_offset').catch(() => ({})),
          api.get('/api/v1/config/rf_offset').catch(() => ({})),
        ])

        // Backend returns named keys, not generic "value" — use correct field names
        if (freqRes?.center_freq_mhz != null) {
          console.debug('[RADIO] RX freq loaded', { freq: freqRes.center_freq_mhz })
          setRxFreq(parseFloat(freqRes.center_freq_mhz))
        }
        if (txRes?.tx_freq_mhz != null) {
          console.debug('[RADIO] TX freq loaded', { freq: txRes.tx_freq_mhz })
          setTxFreq(parseFloat(txRes.tx_freq_mhz))
        }
        if (modemRes?.modem_scheme != null) {
          const schemeNum = modemRes.modem_scheme
          const name = Object.entries(MODEM_SCHEME_MAP).find(([, v]) => v === schemeNum)?.[0] || 'QPSK'
          console.debug('[RADIO] Modem loaded', { scheme: name, schemeNum })
          setModem(name)
        }
        if (bwRes?.value != null) {
          console.debug('[RADIO] Bandwidth loaded', { bwHz: bwRes.value })
          setBandwidth(parseInt(bwRes.value))
        }
        if (rxRes?.rx_gain_db != null) {
          console.debug('[RADIO] RX gain loaded', { gainDb: rxRes.rx_gain_db })
          setRxGain(parseFloat(rxRes.rx_gain_db))
        }
        if (txARes?.tx_atten_db != null) {
          console.debug('[RADIO] TX atten loaded', { attenDb: txARes.tx_atten_db })
          setTxAtten(parseFloat(txARes.tx_atten_db))
        }
        if (beaconRes?.beacon_mode != null) {
          console.debug('[RADIO] Beacon mode loaded', { mode: beaconRes.beacon_mode })
          setBeaconMode(beaconRes.beacon_mode.toLowerCase())
        }
        if (xoRes?.xo_correction != null) {
          console.debug('[RADIO] XO correction loaded', { ppb: xoRes.xo_correction })
          setXoCorrection(parseFloat(xoRes.xo_correction))
        }
        if (lnbRes?.lnb_offset != null) {
          console.debug('[RADIO] LNB offset loaded', { offsetMhz: lnbRes.lnb_offset })
          setLnbOffset(parseFloat(lnbRes.lnb_offset))
        }
        if (rfRes?.rf_offset != null) {
          console.debug('[RADIO] RF offset loaded', { offsetHz: rfRes.rf_offset })
          setRfOffset(parseFloat(rfRes.rf_offset))
        }
        // Load TX power separately
        try {
          const txPRes = await api.get('/api/v1/config/tx_power_db').catch(() => ({}))
          if (txPRes?.tx_power_db != null) {
            console.debug('[RADIO] TX power loaded', { powerDb: txPRes.tx_power_db })
            setTxPower(parseFloat(txPRes.tx_power_db))
          }
        } catch (e) {
          console.debug('[RADIO] TX power load failed (optional)', { error: e.message })
        }

        console.debug('[RADIO] Config load complete')
      } catch (error) {
        console.error('[RADIO] Error loading radio config', { error })
        onError?.('Failed to load radio configuration')
      }
    }

    loadConfig()
  }, [onError])

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      if (rxGainTimeoutRef.current) clearTimeout(rxGainTimeoutRef.current)
      if (txAttenTimeoutRef.current) clearTimeout(txAttenTimeoutRef.current)
    }
  }, [])

  const calculateThroughput = () => {
    const baseRate = (bandwidth / 1.35)
    // Calculate bits per symbol correctly (BPSK=1, QPSK=2, etc.)
    let bitsPerSymbol = 1
    if (modem.includes('256')) bitsPerSymbol = 8
    else if (modem.includes('128')) bitsPerSymbol = 7
    else if (modem.includes('64')) bitsPerSymbol = 6
    else if (modem.includes('32')) bitsPerSymbol = 5
    else if (modem.includes('16')) bitsPerSymbol = 4
    else if (modem.includes('8')) bitsPerSymbol = 3
    else if (modem.includes('4')) bitsPerSymbol = 2
    // else BPSK = 1
    return (baseRate * bitsPerSymbol / 1000).toFixed(1)
  }

  const handleRxFreqChange = async (e) => {
    const val = parseFloat(e.target.value).toFixed(3)
    console.debug('[RADIO] RX frequency changed', { freqMhz: val })
    setRxFreq(parseFloat(val))
    try {
      await api.post('/api/v1/config/center_freq_mhz', { value: val })
      console.debug('[RADIO] RX frequency saved', { freqMhz: val })
    } catch (error) {
      console.error('[RADIO] RX freq error', { error })
      onError?.('Failed to set RX frequency')
    }
  }

  const handleTxFreqChange = async (e) => {
    const val = parseFloat(e.target.value).toFixed(3)
    console.debug('[RADIO] TX frequency changed', { freqMhz: val })
    setTxFreq(parseFloat(val))
    try {
      await api.post('/api/v1/config/tx_freq_mhz', { value: val })
      console.debug('[RADIO] TX frequency saved', { freqMhz: val })
    } catch (error) {
      console.error('[RADIO] TX freq error', { error })
      onError?.('Failed to set TX frequency')
    }
  }

  const handleRitOffsetChange = async (e) => {
    const val = parseFloat(e.target.value)
    console.debug('[RADIO] RIT offset changed', { offsetHz: val, ritOn })
    setRitOffset(val)
    if (ritOn) {
      try {
        await api.post('/api/v1/config/rit_offset', { value: val })
        console.debug('[RADIO] RIT offset saved', { offsetHz: val })
      } catch (error) {
        console.error('[RADIO] RIT offset error', { error })
      }
    }
  }

  const handleXitOffsetChange = async (e) => {
    const val = parseFloat(e.target.value)
    console.debug('[RADIO] XIT offset changed', { offsetHz: val, xitOn })
    setXitOffset(val)
    if (xitOn) {
      try {
        await api.post('/api/v1/config/xit_offset', { value: val })
        console.debug('[RADIO] XIT offset saved', { offsetHz: val })
      } catch (error) {
        console.error('[RADIO] XIT offset error', { error })
      }
    }
  }

  const handleRitToggle = async () => {
    const newState = !ritOn
    console.debug('[RADIO] RIT toggled', { enabled: newState })
    setRitOn(newState)
    try {
      await api.post('/api/v1/config/rit_enabled', { value: newState })
      console.debug('[RADIO] RIT state saved', { enabled: newState })
    } catch (error) {
      console.error('[RADIO] RIT toggle error', { error })
    }
  }

  const handleXitToggle = async () => {
    const newState = !xitOn
    console.debug('[RADIO] XIT toggled', { enabled: newState })
    setXitOn(newState)
    try {
      await api.post('/api/v1/config/xit_enabled', { value: newState })
      console.debug('[RADIO] XIT state saved', { enabled: newState })
    } catch (error) {
      console.error('[RADIO] XIT toggle error', { error })
    }
  }

  const handleCopyRxToTx = async () => {
    console.debug('[RADIO] Copy RX to TX', { freqMhz: rxFreq })
    setTxFreq(rxFreq)
    try {
      await api.post('/api/v1/config/tx_freq_mhz', { value: rxFreq })
      console.debug('[RADIO] RX copied to TX', { freqMhz: rxFreq })
    } catch (error) {
      console.error('[RADIO] Copy RX to TX error', { error })
    }
  }

  const handleCopyTxToRx = async () => {
    console.debug('[RADIO] Copy TX to RX', { freqMhz: txFreq })
    setRxFreq(txFreq)
    try {
      await api.post('/api/v1/config/center_freq_mhz', { value: txFreq })
      console.debug('[RADIO] TX copied to RX', { freqMhz: txFreq })
    } catch (error) {
      console.error('[RADIO] Copy TX to RX error', { error })
    }
  }

  const handleModemChange = async (e) => {
    const val = e.target.value
    console.debug('[RADIO] Modem changed', { scheme: val })
    setModem(val)
    try {
      const modemEnum = MODEM_SCHEME_MAP[val] || 11
      await api.post('/api/v1/config/modem_scheme', { value: modemEnum })
      console.debug('[RADIO] Modem saved', { scheme: val, enum: modemEnum })
      onSuccess?.('Modulation scheme updated')
    } catch (error) {
      console.error('[RADIO] Modem change error', { error })
      onError?.('Failed to change modulation scheme')
    }
  }

  const handleBandwidthChange = async (e) => {
    const val = parseInt(e.target.value)
    console.debug('[RADIO] Bandwidth changed', { bwHz: val })
    setBandwidth(val)
    try {
      // Send as integer, not string
      await api.post('/api/v1/config/bandwidth_hz', { value: val })
      console.debug('[RADIO] Bandwidth saved', { bwHz: val })
    } catch (error) {
      console.error('[RADIO] Bandwidth error', { error })
    }
  }

  const handleBeaconModeChange = async (e) => {
    const val = e.target.value
    console.debug('[RADIO] Beacon mode changed', { mode: val })
    setBeaconMode(val)
    try {
      await api.post('/api/v1/config/beacon_mode', { value: val.toUpperCase() })
      console.debug('[RADIO] Beacon mode saved', { mode: val })
    } catch (error) {
      console.error('[RADIO] Beacon mode error', { error })
    }
  }

  const handleXoCorrectionChange = async (e) => {
    const val = parseFloat(e.target.value)
    console.debug('[RADIO] XO correction changed', { ppb: val })
    setXoCorrection(val)
    try {
      await api.post('/api/v1/config/xo_correction', { value: val })
      console.debug('[RADIO] XO correction saved', { ppb: val })
    } catch (error) {
      console.error('[RADIO] XO correction error', { error })
    }
  }

  const handleRxGainChange = (e) => {
    const val = parseFloat(e.target.value)
    console.debug('[RADIO] RX gain changed', { gainDb: val })
    setRxGain(val)
    if (rxGainTimeoutRef.current) clearTimeout(rxGainTimeoutRef.current)
    rxGainTimeoutRef.current = setTimeout(() => {
      console.debug('[RADIO] RX gain persisting', { gainDb: val })
      api.post('/api/v1/config/rx_gain_db', { value: val })
        .catch(err => console.error('[RADIO] RX gain persist error', { error: err.message }))
    }, 300)
  }

  const handleTxAttenChange = (e) => {
    const val = parseFloat(e.target.value)
    console.debug('[RADIO] TX atten changed', { attenDb: val })
    setTxAtten(val)
    if (txAttenTimeoutRef.current) clearTimeout(txAttenTimeoutRef.current)
    txAttenTimeoutRef.current = setTimeout(() => {
      console.debug('[RADIO] TX atten persisting', { attenDb: val })
      api.post('/api/v1/config/tx_atten_db', { value: val })
        .catch(err => console.error('[RADIO] TX atten persist error', { error: err.message }))
    }, 300)
  }

  return (
    <div className="text-xs space-y-2 flex-shrink-0">
      {/* Frequency Bar */}
      <div className="flex flex-wrap gap-2 gap-y-2 items-end">
        {/* RX Freq */}
        <div className="flex-1">
          <label className="text-slate-400 text-xs">RX (MHz)</label>
          <input
            type="number"
            min="70"
            max="6000"
            step="0.001"
            value={rxFreq}
            onChange={handleRxFreqChange}
            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-cyan-400 font-mono text-sm"
          />
        </div>

        {/* RIT Toggle + Offset */}
        <button
          onClick={handleRitToggle}
          className={`px-2 py-1 rounded font-bold transition ${ritOn ? 'bg-yellow-700 text-yellow-300' : 'bg-slate-700 text-slate-300'}`}
        >
          RIT
        </button>
        {ritOn && (
          <input
            type="number"
            value={ritOffset}
            onChange={handleRitOffsetChange}
            className="w-16 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            placeholder="Hz"
          />
        )}

        {/* TX Freq */}
        <div className="flex-1">
          <label className="text-slate-400 text-xs">TX (MHz)</label>
          <input
            type="number"
            min="70"
            max="6000"
            step="0.001"
            value={txFreq}
            onChange={handleTxFreqChange}
            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-orange-400 font-mono text-sm"
          />
        </div>

        {/* XIT Toggle + Offset */}
        <button
          onClick={handleXitToggle}
          className={`px-2 py-1 rounded font-bold transition ${xitOn ? 'bg-yellow-700 text-yellow-300' : 'bg-slate-700 text-slate-300'}`}
        >
          XIT
        </button>
        {xitOn && (
          <input
            type="number"
            value={xitOffset}
            onChange={handleXitOffsetChange}
            className="w-16 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
            placeholder="Hz"
          />
        )}

        {/* Copy Buttons */}
        <button
          onClick={handleCopyRxToTx}
          className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold"
          title="Copy RX to TX"
        >
          R→T
        </button>
        <button
          onClick={handleCopyTxToRx}
          className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold"
          title="Copy TX to RX"
        >
          T→R
        </button>

        {/* BW Dropdown */}
        <select
          value={bandwidth}
          onChange={handleBandwidthChange}
          className="px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
        >
          {bandwidthOptions.map(bw => (
            <option key={bw} value={bw}>
              {bw < 1000000 ? (bw / 1000).toFixed(1) + 'k' : (bw / 1000000).toFixed(1) + 'M'} Hz
            </option>
          ))}
        </select>

        {/* MOD Dropdown */}
        <select
          value={modem}
          onChange={handleModemChange}
          className="px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
        >
          {MODULATION_SCHEMES.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.schemes.map(scheme => (
                <option key={scheme} value={scheme}>{scheme}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* TONE Dropdown */}
        <select
          value={toneMode}
          onChange={(e) => {
            const val = e.target.value
            setToneMode(val)
            api.post('/api/v1/config/test_tone', { mode: val })
              .catch(err => console.error('Test tone error:', err))
          }}
          className="px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
        >
          <option value="off">OFF</option>
          <option value="700">700 Hz</option>
          <option value="1500">1500 Hz</option>
          <option value="2100">2100 Hz</option>
        </select>

        {/* RF LOOP Toggle */}
        <button
          onClick={async () => {
            const newState = !rfLoop
            setRfLoop(newState)
            try {
              await api.post('/api/v1/config/rf_loopback', { value: newState })
            } catch (err) {
              console.error('RF loop error:', err)
            }
          }}
          className={`px-2 py-1 rounded font-bold transition ${rfLoop ? 'bg-green-700 text-green-300' : 'bg-slate-700 text-slate-300'}`}
        >
          RF LOOP
        </button>

        {/* Throughput Display */}
        <div className="text-slate-400 font-mono">
          {calculateThroughput()} kbps
        </div>
      </div>

      {/* Second Row: Gains and Advanced */}
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <label className="text-slate-400">RX Gain</label>
          <div className="flex gap-1 items-center">
            <input
              type="range"
              min="0"
              max="73"
              step="1"
              value={rxGain}
              onChange={handleRxGainChange}
              className="flex-1"
            />
            <span className="text-cyan-400 font-mono w-8">{rxGain.toFixed(0)}</span>
          </div>
        </div>

        <div className="flex-1">
          <label className="text-slate-400">TX Atten</label>
          <div className="flex gap-1 items-center">
            <input
              type="range"
              min="0"
              max="89.75"
              step="0.25"
              value={txAtten}
              onChange={handleTxAttenChange}
              className="flex-1"
            />
            <span className="text-orange-400 font-mono w-8">{txAtten.toFixed(1)}</span>
          </div>
        </div>

        <div className="flex-1">
          <label className="text-slate-400">TX PWR</label>
          <input
            type="number"
            min="-60"
            max="0"
            step="1"
            value={txPower}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              setTxPower(val)
              api.post('/api/v1/config/tx_power_dbm', { value: val })
                .catch(err => console.error('TX power error:', err))
            }}
            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-orange-400 font-mono text-xs"
          />
        </div>

        <div className="flex-1">
          <label className="text-slate-400">Beacon</label>
          <select
            value={beaconMode}
            onChange={handleBeaconModeChange}
            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
          >
            <option value="auto">Auto</option>
            <option value="cw">CW</option>
            <option value="bpsk">BPSK</option>
            <option value="off">Off</option>
          </select>
        </div>

        <div className="flex-1">
          <label className="text-slate-400">XO (PPB)</label>
          <input
            type="number"
            value={xoCorrection}
            onChange={handleXoCorrectionChange}
            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 text-xs"
          />
        </div>
      </div>
    </div>
  )
}

export default RadioControls
