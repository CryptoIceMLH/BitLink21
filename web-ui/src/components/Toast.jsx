import React, { useEffect, useState } from 'react'

/**
 * Simple Toast notification component
 * Usage: Show error/info/success messages
 */
const Toast = ({ message, type = 'error', duration = 4000, onClose }) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (duration <= 0) return
    const timer = setTimeout(() => {
      setIsVisible(false)
      onClose?.()
    }, duration)
    return () => clearTimeout(timer)
  }, [duration])

  if (!isVisible) return null

  const baseClass = 'px-4 py-3 rounded shadow-lg text-sm font-medium transition-opacity duration-300 max-w-xs z-50'
  const typeClass = {
    error: 'bg-red-900 text-red-100 border border-red-700',
    success: 'bg-green-900 text-green-100 border border-green-700',
    info: 'bg-blue-900 text-blue-100 border border-blue-700',
    warning: 'bg-yellow-900 text-yellow-100 border border-yellow-700',
  }[type] || 'bg-red-900 text-red-100 border border-red-700'

  return (
    <div className={`${baseClass} ${typeClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span>{message}</span>
        <button
          onClick={() => {
            setIsVisible(false)
            onClose?.()
          }}
          className="text-lg leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default Toast
