'use client'

import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

interface InfoTooltipProps {
  children: React.ReactNode
  label?: string
}

// A small "(i)" icon that reveals an explanation on click — not hover, so it
// works the same on touch as it does with a mouse. Closes on an outside
// click, same pattern as the member-add dropdown elsewhere in this app.
export default function InfoTooltip({ children, label = 'More info' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <span className="relative inline-flex" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-full hover:opacity-70 transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        <Info size={15} />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-2 w-64 rounded-lg border p-3 text-xs leading-relaxed"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)', boxShadow: 'var(--shadow)' }}
        >
          {children}
        </div>
      )}
    </span>
  )
}
