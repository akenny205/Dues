'use client'

import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import type { ToastItem } from '@/hooks/useToast'

export default function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 w-full max-w-sm px-4 sm:px-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-in flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg"
          style={
            t.type === 'error'
              ? { background: 'var(--rust-soft)', borderColor: 'var(--rust)', color: 'var(--rust)' }
              : { background: 'var(--emerald-soft)', borderColor: 'var(--emerald)', color: 'var(--emerald)' }
          }
          role="status"
        >
          <span className="mt-0.5">
            {t.type === 'error' ? <TriangleAlert size={18} /> : <CircleCheck size={18} />}
          </span>
          <span className="flex-1 font-medium">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
