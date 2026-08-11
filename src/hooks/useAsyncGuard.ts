'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Prevents an accidental double-click (or a double Enter-key submit that
 * fires before React re-renders a button as disabled) from firing the same
 * network action twice.
 *
 * Each in-flight action is tracked by a `key` — a fixed string for a
 * singleton action (e.g. 'deleteGroup'), or a key derived from the
 * handler's own arguments for a per-row action (e.g. approving one specific
 * request among several) — so unrelated buttons stay usable while one
 * action is in flight.
 *
 * The check-and-set happens synchronously against a ref before anything
 * async runs, so it's safe even when two clicks land in the same tick,
 * ahead of any state-driven `disabled` re-render.
 */
export default function useAsyncGuard() {
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set())
  const busyRef = useRef<Set<string>>(new Set())

  const isBusy = useCallback((key: string) => busyKeys.has(key), [busyKeys])

  const guard = useCallback(
    <Args extends unknown[]>(
      keyOf: string | ((...args: Args) => string),
      action: (...args: Args) => Promise<void> | void
    ) => {
      return async (...args: Args) => {
        const key = typeof keyOf === 'string' ? keyOf : keyOf(...args)
        if (busyRef.current.has(key)) return
        busyRef.current.add(key)
        setBusyKeys(new Set(busyRef.current))
        try {
          await action(...args)
        } finally {
          busyRef.current.delete(key)
          setBusyKeys(new Set(busyRef.current))
        }
      }
    },
    []
  )

  return { isBusy, guard } as const
}
