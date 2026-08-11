'use client'

import { useEffect, useRef, useState } from 'react'
import { loadImageFromFile } from '@/lib/avatar'

interface BannerCropModalProps {
  file: File
  // Must match the target size the caller will actually save at (see
  // resizeImageToBannerDataUrl's defaults in avatar.ts) — this is what gets
  // baked into the output canvas below.
  targetWidth?: number
  targetHeight?: number
  quality?: number
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}

// The viewport is a fixed box, independent of both the photo's own aspect
// ratio and the banner's — sizing it to the photo made the window exactly as
// wide as the viewport for any normal, non-panoramic photo, leaving no room
// to drag it around. The photo covers this box (see computeBaseScale) and
// stays put; only the window moves and resizes on top of it.
const VIEWPORT_WIDTH = 440
const VIEWPORT_HEIGHT = 300
// Gap kept between the window and every viewport edge at its *starting*
// size, so there's obviously room to drag it around from the outset.
const DEFAULT_MARGIN = 50
// Gap kept at the window's *largest* allowed size — deliberately much
// smaller than DEFAULT_MARGIN. If these matched, the window would start out
// already at its own ceiling (which is exactly what happened before this
// comment existed) and there'd be nothing to grow into.
const MAX_MARGIN = 10
// Floor on the window's width (its height follows from the locked aspect
// ratio) — small enough to crop in tight, large enough that the resize
// handle stays easy to find and the window stays easy to see.
const MIN_WINDOW_WIDTH = 120

// The scale that makes the photo fully cover the viewport (both dimensions
// ≥ viewport, none of it letterboxed). The photo is shown at this size and
// centered, and never moves — repositioning the crop is done by moving and
// resizing the window instead.
function computeBaseScale(img: HTMLImageElement) {
  return Math.max(VIEWPORT_WIDTH / img.width, VIEWPORT_HEIGHT / img.height)
}

// The largest banner-shaped (targetRatio) rectangle that fits inside the
// viewport with `margin` of breathing room on every side.
function computeWindowSize(targetRatio: number, margin: number) {
  const maxW = VIEWPORT_WIDTH - margin * 2
  const maxH = VIEWPORT_HEIGHT - margin * 2
  if (maxW / maxH >= targetRatio) {
    const height = maxH
    return { width: height * targetRatio, height }
  }
  const width = maxW
  return { width, height: width / targetRatio }
}

// Lets the group owner pick which part of their photo fills the banner
// strip, instead of always taking a blind center crop
// (resizeImageToBannerDataUrl): drag the window to reposition it, drag its
// corner handle to resize it (aspect ratio stays locked to the banner's).
// The photo itself is static — shown covering the whole viewport at a fixed
// scale — so there's nothing to lose track of while you work the window.
export default function BannerCropModal({
  file,
  targetWidth = 1200,
  targetHeight = 300,
  quality = 0.8,
  onCancel,
  onConfirm,
}: BannerCropModalProps) {
  const targetRatio = targetWidth / targetHeight
  const defaultSize = computeWindowSize(targetRatio, DEFAULT_MARGIN)
  const maxSize = computeWindowSize(targetRatio, MAX_MARGIN)

  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState('')
  const [win, setWin] = useState({
    x: (VIEWPORT_WIDTH - defaultSize.width) / 2,
    y: (VIEWPORT_HEIGHT - defaultSize.height) / 2,
    width: defaultSize.width,
    height: defaultSize.height,
  })
  const moveRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startWidth: number; winX: number; winY: number } | null>(null)

  const baseScale = img ? computeBaseScale(img) : 1
  const dispW = img ? img.width * baseScale : 0
  const dispH = img ? img.height * baseScale : 0
  const imgOffsetX = (VIEWPORT_WIDTH - dispW) / 2
  const imgOffsetY = (VIEWPORT_HEIGHT - dispH) / 2

  useEffect(() => {
    let cancelled = false
    loadImageFromFile(file)
      .then((loaded) => {
        if (cancelled) return
        setImg(loaded)
        setWin({
          x: (VIEWPORT_WIDTH - defaultSize.width) / 2,
          y: (VIEWPORT_HEIGHT - defaultSize.height) / 2,
          width: defaultSize.width,
          height: defaultSize.height,
        })
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read that image'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultSize is derived from the (stable) target* props, not worth re-running the load for
  }, [file])

  if (error) {
    return (
      <div className="modal-overlay">
        <div className="modal-panel">
          <h3 className="font-display text-xl font-semibold mb-2">Couldn&apos;t load that photo</h3>
          <p className="text-sm mb-6" style={{ color: 'var(--negative)' }}>{error}</p>
          <button onClick={onCancel} className="btn-secondary w-full">Close</button>
        </div>
      </div>
    )
  }

  // Keeps the window fully inside the viewport — it can be dragged right up
  // to an edge, never past it. The photo always covers the whole viewport
  // (see computeBaseScale), so this alone is enough to guarantee the window
  // is always over actual photo, too.
  const clampPosition = (next: { x: number; y: number }, width: number, height: number) => ({
    x: Math.min(Math.max(next.x, 0), Math.max(0, VIEWPORT_WIDTH - width)),
    y: Math.min(Math.max(next.y, 0), Math.max(0, VIEWPORT_HEIGHT - height)),
  })

  const handleMovePointerDown = (e: React.PointerEvent) => {
    if (!img) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    moveRef.current = { startX: e.clientX, startY: e.clientY, winX: win.x, winY: win.y }
  }

  const handleMovePointerMove = (e: React.PointerEvent) => {
    if (!moveRef.current) return
    const dx = e.clientX - moveRef.current.startX
    const dy = e.clientY - moveRef.current.startY
    setWin((prev) => ({ ...prev, ...clampPosition({ x: moveRef.current!.winX + dx, y: moveRef.current!.winY + dy }, prev.width, prev.height) }))
  }

  const handleMovePointerUp = () => {
    moveRef.current = null
  }

  // The corner handle keeps the window's top-left corner fixed and grows/
  // shrinks it from there, clamped so it can't overflow the viewport (by
  // capping how wide it's allowed to get from that corner) or shrink past
  // MIN_WINDOW_WIDTH — the aspect ratio stays locked throughout.
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (!img) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resizeRef.current = { startX: e.clientX, startWidth: win.width, winX: win.x, winY: win.y }
  }

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return
    const { startX, startWidth, winX, winY } = resizeRef.current
    const dx = e.clientX - startX
    const maxAllowedWidth = Math.min(maxSize.width, VIEWPORT_WIDTH - winX, (VIEWPORT_HEIGHT - winY) * targetRatio)
    const nextWidth = Math.min(maxAllowedWidth, Math.max(Math.min(MIN_WINDOW_WIDTH, maxAllowedWidth), startWidth + dx))
    setWin((prev) => ({ ...prev, width: nextWidth, height: nextWidth / targetRatio }))
  }

  const handleResizePointerUp = () => {
    resizeRef.current = null
  }

  const handleConfirm = () => {
    if (!img) return
    // Map the window back to source-image pixels, then render straight to
    // the real output size — same last step resizeImageToBannerDataUrl
    // uses, just with a hand-picked source rect instead of an automatic
    // center crop.
    const sx = (win.x - imgOffsetX) / baseScale
    const sy = (win.y - imgOffsetY) / baseScale
    const sw = win.width / baseScale
    const sh = win.height / baseScale

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('Image editing is not supported in this browser')
      return
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
    try {
      onConfirm(canvas.toDataURL('image/jpeg', quality))
    } catch {
      setError('Could not process that image')
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-lg">
        <h3 className="font-display text-xl font-semibold mb-2">Position your banner</h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Drag the window to reposition it, or drag its corner to resize.
        </p>

        <div
          className="relative mx-auto mb-4 rounded-lg overflow-hidden"
          style={{ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, background: 'var(--accent-soft)' }}
        >
          {img ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- an in-memory preview, not a rendered asset */}
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{ position: 'absolute', left: imgOffsetX, top: imgOffsetY, width: dispW, height: dispH, maxWidth: 'none' }}
              />
              {/* The crop window — draggable to move, with a resize handle
                  at its corner. Its box-shadow spreads out to fill the rest
                  of the (overflow: hidden) viewport, which is what dims
                  everything outside the window without needing separate
                  overlay pieces. */}
              <div
                onPointerDown={handleMovePointerDown}
                onPointerMove={handleMovePointerMove}
                onPointerUp={handleMovePointerUp}
                onPointerCancel={handleMovePointerUp}
                className="absolute touch-none"
                style={{
                  left: win.x,
                  top: win.y,
                  width: win.width,
                  height: win.height,
                  border: '2px solid #fff',
                  borderRadius: 4,
                  boxShadow: '0 0 0 2000px rgba(0, 0, 0, 0.55)',
                  cursor: 'grab',
                }}
              >
                {/* The visible dot is 14px, but the draggable hit area
                    around it is a full 28px — a dot alone is a hard target
                    to land a drag on. */}
                <div
                  onPointerDown={handleResizePointerDown}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerUp}
                  className="absolute touch-none flex items-center justify-center"
                  style={{ right: -14, bottom: -14, width: 28, height: 28, cursor: 'nwse-resize' }}
                >
                  <div
                    style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '2px solid var(--accent)' }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading photo…
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={handleConfirm} className="btn-primary flex-1" disabled={!img}>
            Use this photo
          </button>
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
