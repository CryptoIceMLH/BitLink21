import { useState, useCallback } from 'react'

/**
 * Hook for managing toast notifications
 */
export function useToast() {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'error', duration = 4000) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type, duration }])
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  const error = useCallback((message, duration = 4000) => showToast(message, 'error', duration), [showToast])
  const success = useCallback((message, duration = 3000) => showToast(message, 'success', duration), [showToast])
  const info = useCallback((message, duration = 3000) => showToast(message, 'info', duration), [showToast])
  const warning = useCallback((message, duration = 3000) => showToast(message, 'warning', duration), [showToast])

  return { toasts, showToast, removeToast, error, success, info, warning }
}
