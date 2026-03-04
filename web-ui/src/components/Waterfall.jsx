import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../lib/websocket'

// Module-level state: persist across tab switches
const MODULE_STATE = {
  wfLines: [],
  spectrum: [],          // raw latest FFT bins
  spectrumSmooth: [],    // exponentially averaged spectrum (for smooth trace)
  offscreenCanvas: null, // offscreen buffer for scroll (avoids self-copy glitch)
  // SDR actual frequency coverage (from waterfall frame metadata)
  sdrCenterMhz: 10489.75,  // default — updated from each WS frame
  sdrBandwidthMhz: 1.6,    // default — updated from each WS frame
}

// QO-100 NB band constants (must match App.jsx)
const BAND_START_MHZ = 10489.470
const BAND_END_MHZ = 10490.030
const FULL_SPAN_MHZ = BAND_END_MHZ - BAND_START_MHZ

// SDR bin ↔ frequency helpers
// Bins cover: sdrCenter - sdrBW/2  ...  sdrCenter + sdrBW/2
const binToFreqMhz = (binIndex, numBins) => {
  const { sdrCenterMhz, sdrBandwidthMhz } = MODULE_STATE
  const sdrStart = sdrCenterMhz - sdrBandwidthMhz / 2
  return sdrStart + (binIndex / numBins) * sdrBandwidthMhz
}

const freqToBinIndex = (freqMhz, numBins) => {
  const { sdrCenterMhz, sdrBandwidthMhz } = MODULE_STATE
  const sdrStart = sdrCenterMhz - sdrBandwidthMhz / 2
  return ((freqMhz - sdrStart) / sdrBandwidthMhz) * numBins
}

// Map a frequency to pixel position on full-band canvas (BAND_START..BAND_END)
// This is the DISPLAY mapping — where things appear on screen
// freqToPixelFull is already defined below, so these helpers just convert bins

// One-shot flag to prevent WS status event spam
let wsStatusDispatched = false

const Waterfall = ({ wsMetrics, specOnly = false, wfOnly = false, zoomLevel = 1, palette: paletteProp = null, speed: speedProp = null, dbMin: dbMinProp = null, dbMax: dbMaxProp = null, freqZoom: freqZoomProp = 1, rxOffsetHz = 80000, txOffsetHz = 80000, onRxOffsetChange, onTxOffsetChange, modemBwHz = 2700 }) => {
  const wfCanvasRef = useRef(null)
  const specCanvasRef = useRef(null)
  const containerRef = useRef(null)
  const ws = useWebSocket()
  const wsMetricsRef = useRef(wsMetrics)

  const maxLinesRef = useRef(200)
  const frameCounterRef = useRef(0)
  const rxOffsetRef = useRef(rxOffsetHz)
  const txOffsetRef = useRef(txOffsetHz)
  const onRxOffsetChangeRef = useRef(onRxOffsetChange)
  const onTxOffsetChangeRef = useRef(onTxOffsetChange)
  const modemBwHzRef = useRef(modemBwHz)
  const mouseXRef = useRef(-1)  // cursor crosshair position

  // Refs for display settings — avoids WS handler re-registration on every slider change
  const paletteRef = useRef(paletteProp || 'blue')
  const speedRef = useRef(speedProp || 'normal')
  const dbMinRef = useRef(dbMinProp !== null ? dbMinProp : -60)
  const dbMaxRef = useRef(dbMaxProp !== null ? dbMaxProp : -10)
  const freqZoomRef = useRef(freqZoomProp || 1)
  const zoomLevelRef = useRef(zoomLevel)

  const [palette, setPalette] = useState(paletteProp || 'blue')
  const [speed, setSpeed] = useState(speedProp || 'normal')
  const [dbMin, setDbMin] = useState(dbMinProp !== null ? dbMinProp : -60)
  const [dbMax, setDbMax] = useState(dbMaxProp !== null ? dbMaxProp : -10)

  // Sync props to refs and local state when they change (parent controls)
  useEffect(() => {
    if (paletteProp) { setPalette(paletteProp); paletteRef.current = paletteProp }
    if (speedProp) { setSpeed(speedProp); speedRef.current = speedProp }
    if (dbMinProp !== null) { setDbMin(dbMinProp); dbMinRef.current = dbMinProp }
    if (dbMaxProp !== null) { setDbMax(dbMaxProp); dbMaxRef.current = dbMaxProp }
    if (freqZoomProp) { freqZoomRef.current = freqZoomProp }
    zoomLevelRef.current = zoomLevel
    wsMetricsRef.current = wsMetrics
    rxOffsetRef.current = rxOffsetHz
    txOffsetRef.current = txOffsetHz
    onRxOffsetChangeRef.current = onRxOffsetChange
    onTxOffsetChangeRef.current = onTxOffsetChange
    modemBwHzRef.current = modemBwHz
  }, [paletteProp, speedProp, dbMinProp, dbMaxProp, freqZoomProp, zoomLevel, wsMetrics, rxOffsetHz, txOffsetHz, onRxOffsetChange, onTxOffsetChange, modemBwHz])

  const [cursorFreq, setCursorFreq] = useState(null)
  const [cursorDb, setCursorDb] = useState(null)

  // QO-100 Band Plan (10 segments)
  const bandPlan = [
    { start: 10489.500, end: 10489.505, color: 'rgba(239, 68, 68, 0.25)', name: 'Beacon' },
    { start: 10489.505, end: 10489.540, color: 'rgba(147, 197, 253, 0.2)', name: 'CW' },
    { start: 10489.540, end: 10489.580, color: 'rgba(168, 85, 247, 0.2)', name: 'NB Digital' },
    { start: 10489.580, end: 10489.650, color: 'rgba(249, 115, 22, 0.2)', name: 'Digital' },
    { start: 10489.650, end: 10489.745, color: 'rgba(34, 197, 94, 0.15)', name: 'SSB' },
    { start: 10489.745, end: 10489.755, color: 'rgba(239, 68, 68, 0.25)', name: 'BPSK' },
    { start: 10489.755, end: 10489.850, color: 'rgba(34, 197, 94, 0.15)', name: 'SSB' },
    { start: 10489.850, end: 10489.870, color: 'rgba(180, 83, 9, 0.2)', name: 'MIX' },
    { start: 10489.870, end: 10489.990, color: 'rgba(234, 179, 8, 0.15)', name: 'Contest' },
    { start: 10489.990, end: 10490.000, color: 'rgba(239, 68, 68, 0.25)', name: 'Beacon' },
  ]

  const colorScale = (db, pal = 'blue', min, max) => {
    const normalized = Math.max(0, Math.min(1, (db - min) / (max - min)))
    switch (pal) {
      case 'red':
        return `hsl(0, ${normalized * 100}%, ${30 + normalized * 40}%)`
      case 'green':
        return `hsl(120, ${normalized * 100}%, ${30 + normalized * 40}%)`
      case 'greyscale':
        const grey = Math.floor(normalized * 255)
        return `rgb(${grey}, ${grey}, ${grey})`
      default:
        // Thermal palette: black → blue → cyan → yellow → white
        if (normalized < 0.25) return `hsl(240, 100%, ${normalized * 240}%)`
        if (normalized < 0.5)  return `hsl(${240 - (normalized - 0.25) * 480}, 100%, ${Math.min(50, 12 + normalized * 200)}%)`
        if (normalized < 0.75) return `hsl(${120 - (normalized - 0.5) * 480}, 100%, ${40 + (normalized - 0.5) * 40}%)`
        return `hsl(60, ${100 - (normalized - 0.75) * 100}%, ${60 + (normalized - 0.75) * 40}%)`
    }
  }

  // Convert offset (Hz from BAND_START) to frequency in MHz
  const offsetToFreqMhz = (offsetHz) => BAND_START_MHZ + offsetHz / 1e6

  // Map frequency to canvas pixel — full band (specOnly mode)
  const freqToPixelFull = (freq_mhz, canvasW) => {
    return ((freq_mhz - BAND_START_MHZ) / FULL_SPAN_MHZ) * canvasW
  }

  // Compute zoomed visible window params
  const getZoomedWindow = (centerFreqMhz, zoom) => {
    const zoomedSpan = FULL_SPAN_MHZ / zoom
    const visibleStart = Math.max(BAND_START_MHZ, centerFreqMhz - zoomedSpan / 2)
    const visibleEnd = Math.min(BAND_END_MHZ, visibleStart + zoomedSpan)
    return { visibleStart, visibleEnd, zoomedSpan }
  }

  // Map frequency to pixel in zoomed view
  const freqToPixelZoomed = (freq_mhz, canvasW, centerFreqMhz, zoom) => {
    const { visibleStart, visibleEnd } = getZoomedWindow(centerFreqMhz, zoom)
    return ((freq_mhz - visibleStart) / (visibleEnd - visibleStart)) * canvasW
  }

  // Draw waterfall line: maps bins (SDR freq range) onto canvas (display freq range)
  const drawWaterfallLine = (ctx, bins, y, width, lineHeight, pal, min, max, displayStart, displayEnd) => {
    if (!ctx || !bins || bins.length === 0) return
    const dStart = displayStart || BAND_START_MHZ
    const dEnd = displayEnd || BAND_END_MHZ
    const dSpan = dEnd - dStart
    const { sdrCenterMhz, sdrBandwidthMhz } = MODULE_STATE
    const sdrStart = sdrCenterMhz - sdrBandwidthMhz / 2
    const sdrEnd = sdrCenterMhz + sdrBandwidthMhz / 2

    // Pixel range covered by SDR data on this display window
    const pxStart = ((sdrStart - dStart) / dSpan) * width
    const pxEnd = ((sdrEnd - dStart) / dSpan) * width
    const pxSpan = pxEnd - pxStart
    const binWidth = pxSpan / bins.length

    for (let i = 0; i < bins.length; i++) {
      const x = pxStart + i * binWidth
      if (x + binWidth < 0 || x > width) continue  // off-screen
      ctx.fillStyle = colorScale(bins[i], pal, min, max)
      ctx.fillRect(x, y, Math.ceil(binWidth) + 1, lineHeight)
    }
  }

  const drawWaterfallLineZoomed = (ctx, bins, y, width, lineHeight, centerFreqMhz, zoom, pal, min, max) => {
    if (!ctx || !bins || bins.length === 0) return
    if (zoom <= 1) {
      drawWaterfallLine(ctx, bins, y, width, lineHeight, pal, min, max)
      return
    }
    const { visibleStart, visibleEnd } = getZoomedWindow(centerFreqMhz, zoom)
    drawWaterfallLine(ctx, bins, y, width, lineHeight, pal, min, max, visibleStart, visibleEnd)
  }

  const drawBandPlan = (ctx, width, height, isZoomed, centerFreq, zoom) => {
    bandPlan.forEach(band => {
      let x1, x2
      if (isZoomed) {
        x1 = freqToPixelZoomed(band.start, width, centerFreq, zoom)
        x2 = freqToPixelZoomed(band.end, width, centerFreq, zoom)
      } else {
        x1 = freqToPixelFull(band.start, width)
        x2 = freqToPixelFull(band.end, width)
      }
      const w = Math.max(1, x2 - x1)

      // Skip if entirely off-screen
      if (x2 < 0 || x1 > width) return

      ctx.fillStyle = band.color
      ctx.fillRect(x1, 0, w, height)

      if (w > 30) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
        ctx.font = '9px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(band.name, Math.max(x1 + 3, 3), 12)
      }
    })
  }

  // Draw dB grid lines (horizontal) — SDR Console style
  const drawDbGrid = (ctx, width, height, min, max) => {
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([3, 5])
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
    ctx.font = '9px monospace'
    ctx.textAlign = 'left'

    // Grid lines every 10 dB
    const step = 10
    const startDb = Math.ceil(min / step) * step
    for (let db = startDb; db <= max; db += step) {
      const normalized = (db - min) / (max - min)
      const y = height - normalized * height
      if (y < 5 || y > height - 5) continue

      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()

      // dB label on left
      ctx.fillText(`${db}`, 3, y - 2)
    }
    ctx.setLineDash([])
    ctx.restore()
  }

  // Draw frequency grid lines (vertical) — thin dashed at band boundaries
  const drawFreqGrid = (ctx, width, height, isZoomed, centerFreq, zoom) => {
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([2, 6])

    if (!isZoomed) {
      // Full band: grid at each band boundary
      bandPlan.forEach(band => {
        const x = freqToPixelFull(band.start, width)
        if (x > 2 && x < width - 2) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, height)
          ctx.stroke()
        }
      })
    } else {
      // Zoomed: grid at regular intervals — adaptive tick spacing (SDR++ findBestRange pattern)
      const { visibleStart, visibleEnd } = getZoomedWindow(centerFreq, zoom)
      const span = visibleEnd - visibleStart
      // Pre-defined tick spacings in MHz — select so ~8-10 labels fit
      const tickOptions = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05]
      const targetTicks = 8
      let step = tickOptions[tickOptions.length - 1]
      for (const t of tickOptions) {
        if (span / t <= targetTicks * 1.5) { step = t; break }
      }
      for (let freq = Math.ceil(visibleStart / step) * step; freq <= visibleEnd; freq += step) {
        const x = ((freq - visibleStart) / span) * width
        if (x > 2 && x < width - 2) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, height)
          ctx.stroke()
        }
      }
    }
    ctx.setLineDash([])
    ctx.restore()
  }

  // Draw filter bandwidth rectangle + tuning line for RX or TX
  const drawFilterBar = (ctx, width, height, freqMhz, bwHz, isRx, isZoomed, centerFreq, zoom) => {
    if (!ctx || !freqMhz) return
    const bwMhz = bwHz / 1e6

    let centerX, bwPixels
    if (isZoomed) {
      const { visibleStart, visibleEnd } = getZoomedWindow(centerFreq, zoom)
      const span = visibleEnd - visibleStart
      centerX = ((freqMhz - visibleStart) / span) * width
      bwPixels = (bwMhz / span) * width
    } else {
      centerX = freqToPixelFull(freqMhz, width)
      bwPixels = (bwMhz / FULL_SPAN_MHZ) * width
    }

    // Minimum visible width (at full span, 2.7kHz bar is only ~6px — too small)
    bwPixels = Math.max(8, bwPixels)

    // Don't draw if off-screen
    if (centerX + bwPixels / 2 < 0 || centerX - bwPixels / 2 > width) return

    const color = isRx ? { fill: 'rgba(0, 255, 255, 0.25)', stroke: '#00ffff', line: '#00ffff', label: 'RX' }
                       : { fill: 'rgba(255, 140, 0, 0.25)', stroke: '#ff8c00', line: '#ff8c00', label: 'TX' }

    // Filter bandwidth rectangle
    ctx.fillStyle = color.fill
    ctx.fillRect(centerX - bwPixels / 2, 0, bwPixels, height)

    // Edge markers
    ctx.strokeStyle = color.stroke
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(centerX - bwPixels / 2, 0); ctx.lineTo(centerX - bwPixels / 2, height)
    ctx.moveTo(centerX + bwPixels / 2, 0); ctx.lineTo(centerX + bwPixels / 2, height)
    ctx.stroke()

    // Center tuning line (solid, 3px)
    ctx.strokeStyle = color.line
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(centerX, 0)
    ctx.lineTo(centerX, height)
    ctx.stroke()

    // Label at top
    ctx.fillStyle = color.line
    ctx.font = 'bold 10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(color.label, centerX, 12)
  }

  // Draw spectrum trace — sharp 1px cyan line with filled polygon below (SDR Console style)
  const drawSpectrumTrace = (ctx, width, height, min, max, isZoomed, centerFreq, zoom) => {
    if (!ctx || MODULE_STATE.spectrumSmooth.length === 0) return
    const bins = MODULE_STATE.spectrumSmooth
    const numBins = bins.length

    // Determine display frequency window
    let dStart, dEnd
    if (isZoomed) {
      const w = getZoomedWindow(centerFreq, zoom)
      dStart = w.visibleStart
      dEnd = w.visibleEnd
    } else {
      dStart = BAND_START_MHZ
      dEnd = BAND_END_MHZ
    }
    const dSpan = dEnd - dStart

    // Map each bin to its actual frequency, then to pixel position
    const { sdrCenterMhz, sdrBandwidthMhz } = MODULE_STATE
    const sdrStart = sdrCenterMhz - sdrBandwidthMhz / 2

    const points = []
    for (let i = 0; i < numBins; i++) {
      const freq = sdrStart + (i / numBins) * sdrBandwidthMhz
      const x = ((freq - dStart) / dSpan) * width
      if (x < -10 || x > width + 10) continue  // skip off-screen
      const normalized = Math.max(0, Math.min(1, (bins[i] - min) / (max - min)))
      const y = height - normalized * height
      points.push({ x, y })
    }

    if (points.length < 2) return

    // Filled polygon below trace (semi-transparent)
    ctx.beginPath()
    ctx.moveTo(points[0].x, height)
    points.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[points.length - 1].x, height)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0, 255, 255, 0.08)'
    ctx.fill()

    // Sharp 1px trace line
    ctx.beginPath()
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.strokeStyle = '#00ffff'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Draw cursor crosshair (vertical line following mouse)
  const drawCursorLine = (ctx, width, height, mouseX) => {
    if (mouseX < 0 || mouseX > width) return
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(mouseX, 0)
    ctx.lineTo(mouseX, height)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  const drawFreqAxis = (ctx, width, height) => {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'

    const step = 0.050
    for (let i = 0; i <= 11; i++) {
      const freq = BAND_START_MHZ + (i * step)
      if (freq <= BAND_END_MHZ) {
        const x = freqToPixelFull(freq, width)
        ctx.fillText(freq.toFixed(3), x, height - 2)

        // Tick mark
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(x, height - 14)
        ctx.lineTo(x, height - 10)
        ctx.stroke()
      }
    }
  }

  const drawFreqAxisZoomed = (ctx, width, height, centerFreq, zoom) => {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'

    const { visibleStart, visibleEnd } = getZoomedWindow(centerFreq, zoom)
    const span = visibleEnd - visibleStart

    // Adaptive tick spacing — select so ~8-10 labels fit without overlap
    const tickOptions = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05]
    const targetTicks = 8
    let step = tickOptions[tickOptions.length - 1]
    for (const t of tickOptions) {
      if (span / t <= targetTicks * 1.5) { step = t; break }
    }
    // Use enough decimal places to distinguish labels
    const decimals = step < 0.001 ? 4 : 3

    for (let freq = Math.ceil(visibleStart / step) * step; freq <= visibleEnd; freq += step) {
      const xRatio = (freq - visibleStart) / (visibleEnd - visibleStart)
      const x = xRatio * width
      if (x >= 10 && x <= width - 10) {
        ctx.fillText(freq.toFixed(decimals), x, height - 2)

        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(x, height - 14)
        ctx.lineTo(x, height - 10)
        ctx.stroke()
      }
    }
  }

  // Click handler: left=RX, right/shift=TX
  const resolveClickOffset = (e, isZoomed) => {
    const canvas = e.target
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const xRatio = x / rect.width

    let offsetHz
    if (isZoomed) {
      const rxFreqMhz = offsetToFreqMhz(rxOffsetRef.current)
      const { visibleStart, visibleEnd } = getZoomedWindow(rxFreqMhz, freqZoomRef.current)
      const clickedFreq = visibleStart + xRatio * (visibleEnd - visibleStart)
      offsetHz = (clickedFreq - BAND_START_MHZ) * 1e6
    } else {
      offsetHz = xRatio * 560000
    }
    return Math.max(0, Math.min(560000, offsetHz))
  }

  const handleSpecClick = (e) => {
    const offset = resolveClickOffset(e, false)
    if (e.shiftKey || e.button === 2) {
      if (onTxOffsetChangeRef.current) onTxOffsetChangeRef.current(offset)
    } else {
      if (onRxOffsetChangeRef.current) onRxOffsetChangeRef.current(offset)
    }
  }

  const handleWfClick = (e) => {
    const offset = resolveClickOffset(e, true)
    if (e.shiftKey || e.button === 2) {
      if (onTxOffsetChangeRef.current) onTxOffsetChangeRef.current(offset)
    } else {
      if (onRxOffsetChangeRef.current) onRxOffsetChangeRef.current(offset)
    }
  }

  // Right-click handler (prevent context menu, move TX)
  const handleContextMenu = (e) => {
    e.preventDefault()
    // The click handler with e.button===2 won't fire on contextmenu, so handle TX here
    const isZoomed = wfOnly && freqZoomRef.current > 1
    const offset = resolveClickOffset(e, isZoomed || !specOnly)
    if (onTxOffsetChangeRef.current) onTxOffsetChangeRef.current(offset)
  }

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const stepHz = e.altKey ? 1000 : e.ctrlKey ? 10000 : 100
    const delta = e.deltaY < 0 ? stepHz : -stepHz

    if (e.shiftKey) {
      // Shift+scroll moves TX
      const current = txOffsetRef.current
      const next = Math.max(0, Math.min(560000, current + delta))
      if (onTxOffsetChangeRef.current) onTxOffsetChangeRef.current(next)
    } else {
      // Default scroll moves RX
      const current = rxOffsetRef.current
      const next = Math.max(0, Math.min(560000, current + delta))
      if (onRxOffsetChangeRef.current) onRxOffsetChangeRef.current(next)
    }
  }, [])

  const handleMouseMove = (e, isZoomed) => {
    const canvas = e.target
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const xRatio = x / rect.width

    // Store mouse X for crosshair
    mouseXRef.current = x

    let freq
    if (isZoomed) {
      const rxFreqMhz = offsetToFreqMhz(rxOffsetRef.current)
      const { visibleStart, visibleEnd } = getZoomedWindow(rxFreqMhz, freqZoomRef.current)
      freq = visibleStart + xRatio * (visibleEnd - visibleStart)
    } else {
      freq = BAND_START_MHZ + xRatio * FULL_SPAN_MHZ
    }

    const binIndex = Math.floor(freqToBinIndex(freq, MODULE_STATE.spectrumSmooth.length || 2048))
    const db = (binIndex >= 0 && binIndex < MODULE_STATE.spectrumSmooth.length)
      ? MODULE_STATE.spectrumSmooth[binIndex] : dbMinRef.current

    setCursorFreq(freq.toFixed(6))
    setCursorDb(db?.toFixed(1) || '-inf')
  }

  const handleSpecMouseMove = (e) => handleMouseMove(e, false)
  const handleWfMouseMove = (e) => handleMouseMove(e, true)

  const handleMouseLeave = () => {
    mouseXRef.current = -1
    setCursorFreq(null)
    setCursorDb(null)
  }

  // Wheel event listener (passive:false to allow preventDefault)
  useEffect(() => {
    const specCanvas = specCanvasRef.current
    const wfCanvas = wfCanvasRef.current
    const canvas = specOnly ? specCanvas : wfCanvas
    if (!canvas) return

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [specOnly, wfOnly, handleWheel])

  // Initialize canvases
  useEffect(() => {
    const animFrameId = requestAnimationFrame(() => {
      const wfCanvas = wfCanvasRef.current
      const specCanvas = specCanvasRef.current
      const container = containerRef.current
      if ((!specOnly && !wfCanvas) || (!wfOnly && !specCanvas) || !container) return

      const wfCtx = specOnly ? null : wfCanvas.getContext('2d')
      const specCtx = wfOnly ? null : specCanvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1

      const width = container.offsetWidth
      const height = container.offsetHeight

      if (!specOnly && wfCanvas) {
        wfCanvas.width = width * dpr
        wfCanvas.height = height * dpr
        wfCanvas.style.width = width + 'px'
        wfCanvas.style.height = height + 'px'
      }

      if (!wfOnly && specCanvas) {
        specCanvas.width = width * dpr
        specCanvas.height = height * dpr
        specCanvas.style.width = width + 'px'
        specCanvas.style.height = height + 'px'
      }

      if (wfCtx) wfCtx.scale(dpr, dpr)
      if (specCtx) specCtx.scale(dpr, dpr)

      // Black background
      if (wfCtx) {
        wfCtx.fillStyle = '#000000'
        wfCtx.fillRect(0, 0, width, height)
        wfCtx.fillStyle = '#555'
        wfCtx.font = '12px monospace'
        wfCtx.fillText('Waiting for SDR data...', 20, height / 2)
      }

      if (specCtx) {
        specCtx.fillStyle = '#000000'
        specCtx.fillRect(0, 0, width, height)
        specCtx.fillStyle = '#555'
        specCtx.font = '12px monospace'
        specCtx.fillText('Waiting for SDR data...', 20, height / 2)
      }
    })

    return () => cancelAnimationFrame(animFrameId)
  }, [specOnly, wfOnly])

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      const wfCanvas = wfCanvasRef.current
      const specCanvas = specCanvasRef.current
      if (entries[0]) {
        const dpr = window.devicePixelRatio || 1
        const { width, height } = entries[0].contentRect

        if (!specOnly && wfCanvas) {
          wfCanvas.width = Math.floor(width * dpr)
          wfCanvas.height = Math.floor(height * dpr)
          wfCanvas.style.width = Math.floor(width) + 'px'
          wfCanvas.style.height = Math.floor(height) + 'px'
        }

        if (!wfOnly && specCanvas) {
          specCanvas.width = Math.floor(width * dpr)
          specCanvas.height = Math.floor(height * dpr)
          specCanvas.style.width = Math.floor(width) + 'px'
          specCanvas.style.height = Math.floor(height) + 'px'
        }

        const wfCtx = !specOnly && wfCanvas ? wfCanvas.getContext('2d') : null
        const specCtx = !wfOnly && specCanvas ? specCanvas.getContext('2d') : null
        if (wfCtx) wfCtx.scale(dpr, dpr)
        if (specCtx) specCtx.scale(dpr, dpr)

        if (wfCtx && MODULE_STATE.wfLines.length === 0) {
          wfCtx.fillStyle = '#000000'
          wfCtx.fillRect(0, 0, width, height)
          wfCtx.fillStyle = '#555'
          wfCtx.font = '12px monospace'
          wfCtx.fillText('Waiting for SDR data...', 20, height / 2)
        }
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [specOnly, wfOnly])

  // WebSocket handler — deps reduced to [ws, specOnly, wfOnly] to avoid churn
  useEffect(() => {
    if (!ws) return

    let frameCount = 0
    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'waterfall' && msg.bins) {
          frameCount++
          const wfCanvas = wfCanvasRef.current
          const specCanvas = specCanvasRef.current

          if ((!specOnly && !wfCanvas) || (!wfOnly && !specCanvas)) return

          // Fresh reads of canvas ctx and dimensions INSIDE handler
          const wfCtx = specOnly ? null : wfCanvas.getContext('2d')
          const specCtx = wfOnly ? null : specCanvas.getContext('2d')
          const wfWidth = wfCanvas?.offsetWidth || 0
          const wfHeight = wfCanvas?.offsetHeight || 0
          const specWidth = specCanvas?.offsetWidth || 0
          const specHeight = specCanvas?.offsetHeight || 0

          // Read display settings from refs (no stale closures)
          const pal = paletteRef.current
          const spd = speedRef.current
          const min = dbMinRef.current
          const max = dbMaxRef.current
          const zl = zoomLevelRef.current
          const fz = freqZoomRef.current

          const skipRate = spd === 'slow' ? 1 : 0
          if (skipRate > 0 && frameCounterRef.current % (skipRate + 1) !== 0) {
            frameCounterRef.current++
            return
          }
          frameCounterRef.current++

          if (frameCount % 100 === 0) {
            console.debug('[WATERFALL] FFT data received', { frameNum: frameCount, bins: msg.bins?.length || 0 })
          }

          // Update SDR frequency coverage from frame metadata
          if (msg.center_freq_mhz) MODULE_STATE.sdrCenterMhz = msg.center_freq_mhz
          if (msg.bandwidth_mhz) MODULE_STATE.sdrBandwidthMhz = msg.bandwidth_mhz

          MODULE_STATE.wfLines.push(msg.bins)
          MODULE_STATE.spectrum = msg.bins

          // Exponential smoothing for spectrum trace (alpha=0.3 → smooth, stable line)
          const alpha = 0.3
          if (MODULE_STATE.spectrumSmooth.length !== msg.bins.length) {
            MODULE_STATE.spectrumSmooth = msg.bins.slice()
          } else {
            for (let i = 0; i < msg.bins.length; i++) {
              MODULE_STATE.spectrumSmooth[i] = MODULE_STATE.spectrumSmooth[i] * (1 - alpha) + msg.bins[i] * alpha
            }
          }

          // Dispatch min/max dB levels for auto-scale (from waterfall frame data)
          if (msg.min_level_db != null && msg.max_level_db != null) {
            window.dispatchEvent(new CustomEvent('bitlink21_wf_levels', {
              detail: { min_level_db: msg.min_level_db, max_level_db: msg.max_level_db }
            }))
          }

          if (MODULE_STATE.wfLines.length > maxLinesRef.current) {
            MODULE_STATE.wfLines.shift()
          }

          // VFO offset frequencies for drawing
          const rxFreqMhz = offsetToFreqMhz(rxOffsetRef.current)
          const txFreqMhz = offsetToFreqMhz(txOffsetRef.current)
          const bwHz = modemBwHzRef.current || 2700
          const isZoomed = fz > 1
          const specAreaHeight = specOnly ? specHeight - 18 : specHeight - 18  // leave room for freq axis

          // ===== Waterfall rendering =====
          if (wfCtx && wfWidth > 0 && wfHeight > 0) {
            const baseLineHeight = Math.max(1, Math.floor(wfHeight / (MODULE_STATE.wfLines.length || 1)))
            const lineHeight = Math.max(1, Math.floor(baseLineHeight * zl))

            const drawLine = isZoomed
              ? (ctx, bins, y, w, lh) => drawWaterfallLineZoomed(ctx, bins, y, w, lh, rxFreqMhz, fz, pal, min, max)
              : (ctx, bins, y, w, lh) => drawWaterfallLine(ctx, bins, y, w, lh, pal, min, max)

            if (MODULE_STATE.wfLines.length > 1) {
              if (!MODULE_STATE.offscreenCanvas || MODULE_STATE.offscreenCanvas.width !== wfWidth || MODULE_STATE.offscreenCanvas.height !== wfHeight) {
                MODULE_STATE.offscreenCanvas = new OffscreenCanvas(wfWidth, wfHeight)
              }
              const offCtx = MODULE_STATE.offscreenCanvas.getContext('2d')
              offCtx.clearRect(0, 0, wfWidth, wfHeight)
              offCtx.drawImage(wfCanvas, 0, 0)
              wfCtx.drawImage(MODULE_STATE.offscreenCanvas, 0, 0, wfWidth, wfHeight - lineHeight, 0, lineHeight, wfWidth, wfHeight - lineHeight)
              drawLine(wfCtx, MODULE_STATE.wfLines[MODULE_STATE.wfLines.length - 1], 0, wfWidth, lineHeight)
            } else if (MODULE_STATE.wfLines.length === 1) {
              drawLine(wfCtx, MODULE_STATE.wfLines[0], Math.max(0, wfHeight - lineHeight), wfWidth, lineHeight)
            }

            // RX tuning line on waterfall (dashed cyan)
            {
              let rxX, txX
              if (isZoomed) {
                rxX = freqToPixelZoomed(rxFreqMhz, wfWidth, rxFreqMhz, fz)
                txX = freqToPixelZoomed(txFreqMhz, wfWidth, rxFreqMhz, fz)
              } else {
                rxX = freqToPixelFull(rxFreqMhz, wfWidth)
                txX = freqToPixelFull(txFreqMhz, wfWidth)
              }

              // RX line on waterfall
              if (rxX >= 0 && rxX <= wfWidth) {
                wfCtx.strokeStyle = '#00ffff'
                wfCtx.lineWidth = 2
                wfCtx.setLineDash([5, 5])
                wfCtx.beginPath()
                wfCtx.moveTo(rxX, 0)
                wfCtx.lineTo(rxX, wfHeight)
                wfCtx.stroke()
                wfCtx.setLineDash([])
              }
              // TX line on waterfall
              if (txX >= 0 && txX <= wfWidth && Math.abs(txX - rxX) > 3) {
                wfCtx.strokeStyle = '#ff8c00'
                wfCtx.lineWidth = 1.5
                wfCtx.setLineDash([4, 4])
                wfCtx.beginPath()
                wfCtx.moveTo(txX, 0)
                wfCtx.lineTo(txX, wfHeight)
                wfCtx.stroke()
                wfCtx.setLineDash([])
              }
            }
          }

          // ===== Spectrum rendering (overlay canvas) =====
          if (specCtx && specWidth > 0 && specHeight > 0) {
            // Black background (opaque for specOnly, transparent for wfOnly overlay)
            if (specOnly) {
              specCtx.fillStyle = '#000000'
              specCtx.fillRect(0, 0, specWidth, specHeight)
            } else {
              specCtx.clearRect(0, 0, specWidth, specHeight)
            }

            // Band plan (behind everything)
            drawBandPlan(specCtx, specWidth, specAreaHeight, isZoomed, rxFreqMhz, fz)

            // dB grid lines
            drawDbGrid(specCtx, specWidth, specAreaHeight, min, max)

            // Frequency grid lines
            drawFreqGrid(specCtx, specWidth, specAreaHeight, isZoomed, rxFreqMhz, fz)

            // Spectrum trace (sharp 1px cyan with fill)
            drawSpectrumTrace(specCtx, specWidth, specAreaHeight, min, max, isZoomed, rxFreqMhz, fz)

            // RX filter bar (cyan) + TX filter bar (orange)
            drawFilterBar(specCtx, specWidth, specAreaHeight, rxFreqMhz, bwHz, true, isZoomed, rxFreqMhz, fz)
            if (Math.abs(txFreqMhz - rxFreqMhz) > 0.0001) {
              drawFilterBar(specCtx, specWidth, specAreaHeight, txFreqMhz, bwHz, false, isZoomed, rxFreqMhz, fz)
            }

            // Cursor crosshair
            drawCursorLine(specCtx, specWidth, specAreaHeight, mouseXRef.current)

            // Frequency axis
            if (isZoomed) {
              drawFreqAxisZoomed(specCtx, specWidth, specHeight, rxFreqMhz, fz)
            } else {
              drawFreqAxis(specCtx, specWidth, specHeight)
            }
          }

          if (!wsStatusDispatched) {
            wsStatusDispatched = true
            localStorage.setItem('bitlink21_ws_connected', 'true')
            window.dispatchEvent(new CustomEvent('bitlink21_ws_status', { detail: { connected: true } }))
          }
        }
      } catch (e) {
        console.error('[WATERFALL] Error parsing WS message', { error: e.message })
      }
    }

    ws.addEventListener('message', handleMessage)
    return () => {
      ws.removeEventListener('message', handleMessage)
    }
  }, [ws, specOnly, wfOnly])

  // Spectrum-only mode (full band, clickable)
  if (specOnly) {
    return (
      <div ref={containerRef} className="w-full h-full flex flex-col overflow-hidden relative" style={{ background: '#000' }}>
        <canvas
          ref={specCanvasRef}
          className="absolute inset-0 cursor-crosshair"
          style={{ zIndex: 1, width: '100%', height: '100%', background: '#000' }}
          onMouseMove={handleSpecMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleSpecClick}
          onContextMenu={handleContextMenu}
        />
        {cursorFreq && (
          <div className="absolute bottom-5 right-2 text-xs font-mono text-cyan-400 bg-black/80 px-2 py-0.5 rounded pointer-events-none" style={{ zIndex: 10 }}>
            {cursorFreq} MHz | {cursorDb} dB
          </div>
        )}
      </div>
    )
  }

  // Waterfall-only mode (zoomed, RX centered) with overlaid spectrum
  if (wfOnly) {
    return (
      <div ref={containerRef} className="w-full h-full flex flex-col overflow-hidden relative" style={{ background: '#000' }}>
        <canvas
          ref={wfCanvasRef}
          className="absolute inset-0"
          style={{ zIndex: 0, width: '100%', height: '100%', background: '#000' }}
        />
        <canvas
          ref={specCanvasRef}
          className="absolute inset-0 cursor-crosshair"
          style={{ zIndex: 1, width: '100%', height: '100%', background: 'transparent' }}
          onMouseMove={handleWfMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleWfClick}
          onContextMenu={handleContextMenu}
        />
      </div>
    )
  }

  // Full mode (deprecated, kept for backward compatibility)
  return (
    <div ref={containerRef} className="w-full h-full flex flex-col gap-2 p-2" style={{ background: '#000' }}>
      <div className="flex gap-2 items-center text-xs bg-slate-800 p-2 rounded border border-slate-700">
        <label className="text-slate-400">Palette:</label>
        <select value={palette} onChange={(e) => setPalette(e.target.value)} className="px-2 py-1 bg-slate-700 rounded text-slate-100">
          <option value="blue">Blue</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="greyscale">Greyscale</option>
        </select>
        <label className="text-slate-400 ml-4">Speed:</label>
        <select value={speed} onChange={(e) => setSpeed(e.target.value)} className="px-2 py-1 bg-slate-700 rounded text-slate-100">
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
        <label className="text-slate-400 ml-4">dB Min:</label>
        <input type="number" value={dbMin} onChange={(e) => setDbMin(parseInt(e.target.value))} className="w-16 px-2 py-1 bg-slate-700 rounded text-slate-100" />
        <label className="text-slate-400 ml-2">Max:</label>
        <input type="number" value={dbMax} onChange={(e) => setDbMax(parseInt(e.target.value))} className="w-16 px-2 py-1 bg-slate-700 rounded text-slate-100" />
        {cursorFreq && cursorDb && (
          <span className="ml-auto text-slate-400 font-mono">
            {cursorFreq} MHz @ {cursorDb} dB
          </span>
        )}
      </div>
      <div className="flex-1 flex flex-col border border-slate-700 rounded overflow-hidden relative" style={{ background: '#000' }}>
        <canvas
          ref={wfCanvasRef}
          className="absolute inset-0"
          style={{ zIndex: 0, width: '100%', height: '100%', background: '#000' }}
        />
        <canvas
          ref={specCanvasRef}
          className="absolute inset-0 bg-transparent cursor-crosshair"
          style={{ zIndex: 1, width: '100%', height: '100%' }}
          onMouseMove={handleSpecMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleSpecClick}
          onContextMenu={handleContextMenu}
        />
      </div>
    </div>
  )
}

export default Waterfall
