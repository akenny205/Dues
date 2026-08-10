'use client'

interface AvatarProps {
  url?: string | null
  name: string
  size?: number
  className?: string
}

// A photo if one's set, otherwise the same initial-in-a-circle treatment the
// home page already uses for group icons — kept consistent rather than
// inventing a second "no avatar" look.
export default function Avatar({ url, name, size = 36, className = '' }: AvatarProps) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data: URLs / arbitrary sizes, not worth next/image's optimizer here
      <img
        src={url}
        alt={name}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-display font-semibold shrink-0 ${className}`}
      style={{ width: size, height: size, background: 'var(--accent)', color: 'var(--on-accent)', fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  )
}
