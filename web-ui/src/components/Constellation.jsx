import React, { useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../lib/websocket'

function Constellation() {
  const canvasRef = useRef(null)
  const pointsRef = useRef([])
  const ws = useWebSocket()
  const [sampleCount, setSampleCount] = useState(0)
  const maxPointsRef = useRef(512) // Keep last 512 IQ points

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const width = canvas.offsetWidth
    const height = canvas.offsetHeight

    canvas.width = width
    canvas.height = height

    // Draw initial grid
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)

    // Draw constellation grid (I/Q axes)
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 2])

    // Vertical line (Q axis)
    ctx.beginPath()
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.stroke()

    // Horizontal line (I axis)
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()

    ctx.setLineDash([])
    ctx.fillStyle = '#64748b'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('Waiting for constellation data...', width / 2, height / 2)

    if (!ws) return

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'constellation' && msg.iq_points && Array.isArray(msg.iq_points)) {
          // Add new points (iq_points is [[i, q], ...] format)
          msg.iq_points.forEach(point => {
            if (pointsRef.current.length >= maxPointsRef.current) {
              pointsRef.current.shift() // Remove oldest
            }
            const i = Array.isArray(point) ? point[0] : point.i || 0
            const q = Array.isArray(point) ? point[1] : point.q || 0
            pointsRef.current.push({ i, q })
          })

          setSampleCount(pointsRef.current.length)
          redrawConstellation(ctx, width, height)
        }
      } catch (e) {
        console.error('Error parsing constellation:', e)
      }
    }

    ws.addEventListener('message', handleMessage)
    return () => ws.removeEventListener('message', handleMessage)
  }, [ws])

  const redrawConstellation = (ctx, width, height) => {
    // Clear
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)

    // Draw axes
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
    ctx.setLineDash([])

    // Normalize and plot points
    const centerX = width / 2
    const centerY = height / 2
    const scale = Math.min(centerX, centerY) * 0.8 // Leave 20% margin

    ctx.fillStyle = '#06b6d4'
    ctx.globalAlpha = 0.7
    const radius = 2

    pointsRef.current.forEach(point => {
      const x = centerX + point.i * scale
      const y = centerY - point.q * scale // Invert Y (canvas coords)

      // Check if point is within bounds
      if (x >= 0 && x < width && y >= 0 && y < height) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, 2 * Math.PI)
        ctx.fill()
      }
    })

    ctx.globalAlpha = 1.0

    // Draw labels
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px monospace'
    ctx.textAlign = 'right'
    ctx.fillText('Q', width - 5, 10)
    ctx.textAlign = 'left'
    ctx.fillText('I', 5, height - 5)
  }

  return (
    <div className="w-full h-full flex flex-col">
      <canvas
        ref={canvasRef}
        className="flex-1 bg-slate-800"
      />
      <div className="bg-slate-800 border-t border-slate-700 px-4 py-2 text-xs text-slate-400">
        <span>IQ Constellation ({sampleCount} samples)</span>
      </div>
    </div>
  )
}

export default Constellation
