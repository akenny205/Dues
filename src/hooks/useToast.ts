'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error'
}

let nextToastId = 0

// Auto-classifies a message as success/error by content, unless a type is passed
// explicitly. Meant as a drop-in replacement for alert(message) — same call shape,
// but renders as a dismissible in-app toast instead of a native browser dialog.
const looksLikeError = /fail|cannot|please enter|already added|pending approvals|must equal|invalid/i

export default function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback((message: string, explicitType?: 'success' | 'error') => {
    const type = explicitType ?? (looksLikeError.test(message) ? 'error' : 'success')
    const id = nextToastId++
    setToasts(prev => [...prev, { id, message, type }])
    const timer = setTimeout(() => dismiss(id), 4500)
    timers.current.set(id, timer)
  }, [dismiss])

  useEffect(() => {
    const timersMap = timers.current
    return () => {
      timersMap.forEach(timer => clearTimeout(timer))
    }
  }, [])

  return { toasts, showToast, dismiss }
}
