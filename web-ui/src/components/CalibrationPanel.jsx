import React, { useState } from 'react'
import { api } from '../lib/api'

const BAND_START_MHZ = 10489.470

const CalibrationPanel = ({ wsMetrics, onError, onSuccess, rxOffsetHz = 80000 }) => {
  const [calibMode, setCalibMode] = useState(null) // null, 'tcxo', 'lnb'
  const [calibResult, setCalibResult] = useState('')
  const [loading, setLoading] = useState(false)

  // Current RX frequency derived from VFO offset
  const rxFreqMhz = BAND_START_MHZ + rxOffsetHz / 1e6

  const handleTcxoCalibStart = async () => {
    setLoading(true)
    try {
      // Set RX to 439 MHz for TCXO calibration
      await api.post('/api/v1/config/center_freq_mhz', { value: 439.0 })
      setCalibMode('tcxo')
      setCalibResult('')
    } catch (err) {
      onError?.('Calibration error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleTcxoCalibFinish = async () => {
    try {
      // Calculate correction: difference between where signal IS vs where it SHOULD be
      const correctionHz = (rxFreqMhz - 439.0) * 1e6
      const result = await api.post('/api/v1/radio/tcxo_calibrate', { xo_correction_hz: correctionHz })
      const correction = result.xo_correction_hz || correctionHz
      setCalibResult(`TCXO Calibration Saved: ${correction > 0 ? '+' : ''}${correction.toFixed(0)} Hz correction`)
      setCalibMode(null)
      onSuccess?.('TCXO calibration saved')
    } catch (err) {
      setCalibResult('Error: ' + err.message)
    }
  }

  const handleLnbCalibStart = async () => {
    setLoading(true)
    try {
      // Set RX to BPSK beacon (10489.750 MHz)
      await api.post('/api/v1/config/center_freq_mhz', { value: 10489.750 })
      setCalibMode('lnb')
      setCalibResult('')
    } catch (err) {
      onError?.('Calibration error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLnbCalibFinish = async () => {
    try {
      // Calculate offset: difference between where beacon IS vs where it SHOULD be (10489.750 MHz)
      const offsetHz = (rxFreqMhz - 10489.750) * 1e6
      const result = await api.post('/api/v1/radio/lnb_calibrate', { lnb_offset_hz: offsetHz })
      const offset = result.lnb_offset_hz || offsetHz
      setCalibResult(`LNB Calibration Saved: ${offset > 0 ? '+' : ''}${offset.toFixed(0)} Hz offset`)
      setCalibMode(null)
      onSuccess?.('LNB calibration saved')
    } catch (err) {
      setCalibResult('Error: ' + err.message)
    }
  }

  const handleCancel = () => {
    setCalibMode(null)
    setCalibResult('')
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto text-xs">
      {/* TCXO Calibration */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <h3 className="text-cyan-400 font-bold mb-3">TCXO CALIBRATION (439 MHz)</h3>

        <div className="bg-slate-800 rounded p-3 mb-3 text-slate-300 text-xs leading-relaxed">
          <p className="mb-2">Steps:</p>
          <ol className="space-y-1 list-decimal list-inside">
            <li>Tune another radio to 439.000 MHz</li>
            <li>Set it to USB mode, transmit CW carrier</li>
            <li>Press START to center 439 MHz in Waterfall</li>
            <li>Click the signal peak in the spectrum/waterfall to set RX marker on it</li>
            <li>Press FINISHED to calculate and store correction</li>
          </ol>
        </div>

        {calibMode === 'tcxo' ? (
          <div className="space-y-2">
            <div className="bg-slate-700 p-2 rounded text-slate-300">
              <span className="font-mono">RX: {rxFreqMhz.toFixed(6)} MHz</span><br />
              <span className="text-cyan-400 text-xs font-bold">
                Correction: {((rxFreqMhz - 439.0) * 1e6) > 0 ? '+' : ''}{((rxFreqMhz - 439.0) * 1e6).toFixed(0)} Hz
              </span><br />
              <span className="text-slate-400 text-xs">Click signal peak in spectrum, then press FINISHED</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleTcxoCalibFinish}
                className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded"
              >
                FINISHED
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded"
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleTcxoCalibStart}
            disabled={loading}
            className="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 text-white font-bold rounded transition"
          >
            {loading ? 'STARTING...' : 'START CALIB'}
          </button>
        )}

        {calibResult && calibResult.includes('TCXO') && (
          <div className={`mt-3 p-2 rounded text-xs ${calibResult.includes('Error') ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
            {calibResult}
          </div>
        )}
      </div>

      {/* LNB Calibration */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900">
        <h3 className="text-cyan-400 font-bold mb-3">LNB CALIBRATION (BPSK BEACON)</h3>

        <div className="bg-slate-800 rounded p-3 mb-3 text-slate-300 text-xs leading-relaxed">
          <p className="mb-2">Steps:</p>
          <ol className="space-y-1 list-decimal list-inside">
            <li>Press START to center 10489.750 MHz (BPSK Beacon)</li>
            <li>Observe beacon in the spectrum/waterfall</li>
            <li>Click beacon center to move RX marker onto it</li>
            <li>Press FINISHED to calculate and store LNB offset</li>
          </ol>
          <p className="mt-2 text-slate-400">
            Beacon should appear as narrow peak. RX marker shows measured offset.
          </p>
        </div>

        {calibMode === 'lnb' ? (
          <div className="space-y-2">
            <div className="bg-slate-700 p-2 rounded text-slate-300">
              <span className="font-mono">RX: {rxFreqMhz.toFixed(6)} MHz</span><br />
              <span className="text-cyan-400 text-xs font-bold">
                LNB Offset: {((rxFreqMhz - 10489.750) * 1e6) > 0 ? '+' : ''}{((rxFreqMhz - 10489.750) * 1e6).toFixed(0)} Hz
              </span><br />
              <span className="text-slate-400 text-xs">Click beacon center in spectrum, then press FINISHED</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleLnbCalibFinish}
                className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded"
              >
                FINISHED
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded"
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleLnbCalibStart}
            disabled={loading}
            className="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 text-white font-bold rounded transition"
          >
            {loading ? 'STARTING...' : 'START CALIB'}
          </button>
        )}

        {calibResult && calibResult.includes('LNB') && (
          <div className={`mt-3 p-2 rounded text-xs ${calibResult.includes('Error') ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
            {calibResult}
          </div>
        )}
      </div>

      {/* Reference Info */}
      <div className="border border-slate-700 rounded p-4 bg-slate-900 text-slate-400 text-xs">
        <h4 className="font-bold mb-2 text-cyan-400">REFERENCE</h4>
        <div className="space-y-1 font-mono">
          <div>QO-100 NB TX: 10.489–10.490 GHz</div>
          <div>BPSK Beacon: 10489.750 MHz</div>
          <div>CW Beacon: 10489.505 MHz</div>
          <div>Required: External 439 MHz source</div>
        </div>
      </div>
    </div>
  )
}

export default CalibrationPanel
