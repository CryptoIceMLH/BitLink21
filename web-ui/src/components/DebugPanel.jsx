import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

const DebugPanel = ({ wsMetrics }) => {
  const [logs, setLogs] = useState([])
  const [logLevel, setLogLevel] = useState(1)
  const [filter, setFilter] = useState("") // component filter
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Fetch logs on mount and every 5s
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const endpoint = filter
          ? `/api/v1/debug/logs?limit=100&component=${encodeURIComponent(filter)}`
          : '/api/v1/debug/logs?limit=100'
        const data = await api.get(endpoint)
        // Response is {status, total_available, returned, logs: [...]}
        setLogs(data?.logs || [])
      } catch (e) {
        // Silently ignore 403 (debug disabled) — just show empty logs
        if (e.message && e.message.includes('403')) {
          setLogs([])
        } else {
          console.error("Failed to fetch logs:", e)
        }
      }
    }

    if (autoRefresh) {
      fetchLogs()
      const interval = setInterval(fetchLogs, 5000)
      return () => clearInterval(interval)
    }
  }, [filter, autoRefresh])

  const handleLogLevelChange = async (newLevel) => {
    setLoading(true)
    try {
      await api.post(`/api/v1/debug/log-level?level=${newLevel}`, {})
      setLogLevel(newLevel)
      alert(`Log level set to ${levelLabels[newLevel]}`)
    } catch (e) {
      if (e.message && e.message.includes('403')) {
        alert("Debug endpoints disabled (set LOG_DEBUG=1)")
      } else {
        alert("Failed to set log level: " + e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    try {
      const host = window.location.hostname
      const response = await fetch(`http://${host}:8021/api/v1/debug/logs/download`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bitlink21-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (e) {
      alert("Failed to download logs: " + e.message)
    }
  }

  const handleClose = () => {
    const url = new URL(window.location)
    url.searchParams.delete('debug')
    window.history.replaceState({}, '', url)
    // Trigger a re-render by reloading or updating app state
    window.location.href = url.toString()
  }

  const levelLabels = { 0: 'ERROR', 1: 'INFO', 2: 'DEBUG', 3: 'TRACE' }
  const levelColors = {
    ERROR: 'text-red-400',
    INFO: 'text-green-400',
    DEBUG: 'text-yellow-400',
    TRACE: 'text-blue-400',
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 text-slate-100 p-6 z-50 overflow-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-cyan-400">Debug Panel</h1>
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-semibold"
          >
            Close
          </button>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {/* Log Level */}
          <div>
            <label className="block text-sm font-semibold mb-2">Log Level</label>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(lvl => (
                <button
                  key={lvl}
                  onClick={() => handleLogLevelChange(lvl)}
                  disabled={loading}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${
                    logLevel === lvl
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-700 hover:bg-slate-600'
                  } disabled:opacity-50`}
                >
                  {levelLabels[lvl]}
                </button>
              ))}
            </div>
          </div>

          {/* Component Filter */}
          <div>
            <label className="block text-sm font-semibold mb-2">Filter Component</label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="api, radio, dsp..."
              className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-slate-100"
            />
          </div>

          {/* Auto-refresh toggle */}
          <div>
            <label className="block text-sm font-semibold mb-2">Auto-refresh</label>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`w-full px-3 py-1 rounded text-sm font-semibold transition ${
                autoRefresh
                  ? 'bg-blue-700 hover:bg-blue-800 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              {autoRefresh ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Download */}
          <div>
            <label className="block text-sm font-semibold mb-2">&nbsp;</label>
            <button
              onClick={handleDownload}
              className="w-full px-3 py-1 bg-green-700 hover:bg-green-800 rounded text-sm font-semibold text-white transition"
            >
              Download Logs
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-slate-800 border border-slate-700 rounded p-3 mb-4 text-sm">
          <span className="text-slate-300">
            Total logs: <span className="font-bold text-cyan-400">{logs.length}</span>
            {filter && <span className="ml-4 text-slate-400">Filter: {filter}</span>}
          </span>
        </div>

        {/* Log Viewer */}
        <div className="bg-slate-900 border border-slate-700 rounded p-4 h-96 overflow-y-auto font-mono text-xs space-y-1">
          {logs.length === 0 ? (
            <div className="text-slate-500">No logs available. Waiting for data...</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`${levelColors[log.level] || 'text-slate-300'}`}>
                <span className="text-slate-500">[{log.ts}]</span>
                <span className="ml-2 font-bold">{log.level}</span>
                <span className="ml-2 text-slate-400">{log.component}</span>
                <span className="ml-2">{log.msg}</span>
                {log.data && Object.keys(log.data).length > 0 && (
                  <span className="ml-2 text-slate-500">
                    {JSON.stringify(log.data)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer Info */}
        <div className="mt-4 text-xs text-slate-500">
          <p>Logs refresh every 5 seconds when auto-refresh is enabled. Append &quot;?debug=1&quot; to URL to access this panel.</p>
        </div>
      </div>
    </div>
  )
}

export default DebugPanel
