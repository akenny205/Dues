import type { CSSProperties } from 'react'

// A single shimmering placeholder block. Compose these into layouts that
// mirror the real content's shape (see the loading branches in page.tsx and
// groups/[id]/page.tsx) so the page doesn't jump around once data arrives.
export default function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return <div className={`skeleton ${className}`} style={style} />
}
