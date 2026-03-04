import React, { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useWebSocket } from '../lib/websocket'

const BerTestPanel = ({ wsMetrics, onError, onSuccess }) => {
  const [testing, setTesting] = useState(false)
  const [results, setResults] = useState('')
  const [testMode, setTestMode] = useState(null) // null, 'single', 'sweep'
  const [frequency, setFrequency] = useState('1500')
  const resultsRef = useRef(null)
  const ws = useWebSocket()

  useEffect(() => {
    if (!ws) return

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'ber_test_result') {
          setResults(prev => prev + msg.data + '\n')
          if (resultsRef.current) {
            resultsRef.current.scrollTop = resultsRef.current.scrollHeight
          }
        }
      } catch (e) {
        // ignore
      }
    }

    ws.addEventListener('message', handleMessage)
    return () => ws.removeEventListener('message', handleMessage)
  }, [ws])

  const handleSingleFreq = async () => {
    if (!frequency.trim()) {
      alert('Enter frequency in Hz')
      return
    }

    setTesting(true)
    setResults(`Starting BER test at ${frequency} Hz...\n`)
    setTestMode('single')

    try {
      await api.post('/api/v1/radio/ber_test', {
        action: 'start',
        mode: 'single',
        frequency: parseInt(frequency),
      })
    } catch (err) {
      onError?.('BER test start failed: ' + err.message)
      setTesting(false)
    }
  }

  const handleSweep = async () => {
    setTesting(true)
    setResults('Starting BER sweep (100 Hz - 2900 Hz)...\n')
    setTestMode('sweep')

    try {
      await api.post('/api/v1/radio/ber_test', {
        action: 'start',
        mode: 'sweep',
        start_freq: 100,
        end_freq: 2900,
        step: 100,
      })
    } catch (err) {
      onError?.('BER sweep failed: ' + err.message)
      setTesting(false)
    }
  }

  const handleStop = async () => {
    try {
      await api.post('/api/v1/radio/ber_test', { action: 'stop' })
      setTesting(false)
      setTestMode(null)
      onSuccess?.('BER test stopped')
    } catch (err) {
      onError?.('Stop failed: ' + err.message)
    }
  }

  const handleClear = () => {
    setResults('')
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden text-xs">
      {/* Controls */}
      <div className="border border-slate-700 rounded p-3 bg-slate-900 space-y-2">
        <h3 className="text-cyan-400 font-bold">BER TEST CONTROLS</h3>

        <div className="space-y-2">
          {/* Single Frequency Test */}
          <div>
            <label className="text-slate-400">Single Frequency (Hz)</label>
            <div className="flex gap-2 mt-1">
              <input
                type="number"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                placeholder="1500"
                min="100"
                max="2900"
                disabled={testing}
                className="flex-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-slate-100 disabled:bg-slate-700"
              />
              <button
                onClick={handleSingleFreq}
                disabled={testing}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 text-white font-bold rounded transition"
              >
                TEST {frequency} HZ
              </button>
            </div>
          </div>

          {/* Sweep Test */}
          <div>
            <button
              onClick={handleSweep}
              disabled={testing}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white font-bold rounded transition"
            >
              SWEEP 100–2900 Hz
            </button>
          </div>

          {/* Stop Button */}
          {testing && (
            <button
              onClick={handleStop}
              className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded transition"
            >
              STOP TEST
            </button>
          )}

          {/* Clear Results */}
          <button
            onClick={handleClear}
            disabled={testing}
            className="w-full px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-slate-300 font-bold rounded transition text-xs"
          >
            CLEAR
          </button>
        </div>

        {testing && (
          <div className="text-yellow-400 font-bold">TEST IN PROGRESS...</div>
        )}
      </div>

      {/* Results Display */}
      <div className="flex-1 flex flex-col border border-slate-700 rounded bg-slate-900 overflow-hidden">
        <div className="bg-slate-800 px-3 py-1 border-b border-slate-700 text-slate-400 font-bold">
          RESULTS
        </div>
        <textarea
          ref={resultsRef}
          readOnly
          value={results}
          className="flex-1 p-2 bg-slate-950 text-slate-300 font-mono text-xs resize-none overflow-y-auto"
          placeholder="Test results will appear here..."
        />
      </div>

      {/* Info Box */}
      <div className="border border-slate-700 rounded p-3 bg-slate-900 text-slate-400 text-xs">
        <h4 className="font-bold text-cyan-400 mb-2">TEST MODES</h4>
        <div className="space-y-1">
          <div><strong>Single Freq:</strong> Run test at one frequency</div>
          <div><strong>Sweep:</strong> Test 100 Hz - 2.9 kHz in 100 Hz steps</div>
          <div><strong>Output:</strong> Freq, BER, block count, error count</div>
        </div>
      </div>
    </div>
  )
}

export default BerTestPanel
