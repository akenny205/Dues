// Client-side image processing — center-crops whatever image the user picks
// and downsizes it, so a photo never costs more than a few KB. No Supabase
// Storage bucket needed: the result is a small data: URL that goes straight
// into a text column as plain text (User.avatar_url — see
// db/policies/add_avatar_url.sql; Group.banner_url — see
// supabase/migrations/20260811000008_add_group_banner.sql).
//
// Two shapes share the same pipeline: resizeImageToDataUrl crops to a square
// for profile photos, resizeImageToBannerDataUrl crops to a wide strip for
// group banners.

const MAX_SOURCE_BYTES = 10 * 1024 * 1024 // 10MB — guards against hanging on a huge photo

// Validates and decodes the picked file into an <img>. Shared by both crop
// shapes below, and by BannerCropModal (src/components/BannerCropModal.tsx),
// which needs the decoded image itself rather than an already-cropped
// data: URL so the user can choose the crop by hand.
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // SVG is excluded even though it matches "image/*": browsers can decode
    // it into an <img>, so it would otherwise sail through this check, and
    // an SVG can carry a <script> or external references. Redrawing it onto
    // the canvas below strips that either way (scripting is disabled for
    // images used as a raster source), but there's no reason to feed a
    // vector/markup format into a pipeline whose whole job is producing a
    // small raster photo — reject it up front instead of relying on that as
    // the only line of defense.
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      reject(new Error('Please choose a photo (JPEG, PNG, etc.) — SVG is not supported'))
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error('That image is too large. please choose one under 10MB'))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not read that image'))
      img.onload = () => {
        if (!img.width || !img.height) {
          reject(new Error('Could not read that image'))
          return
        }
        resolve(img)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  try {
    // Wrapped because a handful of edge-case sources (e.g. a
    // cross-origin-tainted canvas) make toDataURL throw synchronously rather
    // than reject/return — without this the caller's "uploading…" state
    // would just hang instead of surfacing an error.
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    throw new Error('Could not process that image')
  }
}

export async function resizeImageToDataUrl(file: File, size = 160, quality = 0.85): Promise<string> {
  const img = await loadImageFromFile(file)
  const side = Math.min(img.width, img.height)
  const sx = (img.width - side) / 2
  const sy = (img.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image editing is not supported in this browser')
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvasToJpegDataUrl(canvas, quality)
}

// Same idea as resizeImageToDataUrl, but crops to a wide, short banner strip
// instead of a square, for Group.banner_url. The strip is intentionally
// short relative to its width — displayed at a fixed height (see the group
// page's hero), a taller crop would just get more of itself cropped away by
// object-cover on a wide screen anyway.
//
// This is a blind center crop — the group page itself doesn't call it
// anymore, it uses BannerCropModal so the owner can drag/zoom to pick which
// part of the photo lands in the strip. Left here as the plain, no-UI
// version of the same crop (same default target size), for anywhere that
// wants a banner without asking the user to position it.
export async function resizeImageToBannerDataUrl(file: File, width = 1200, height = 300, quality = 0.8): Promise<string> {
  const img = await loadImageFromFile(file)
  const targetRatio = width / height
  const sourceRatio = img.width / img.height

  let sx = 0, sy = 0, sw = img.width, sh = img.height
  if (sourceRatio > targetRatio) {
    // Source is relatively wider than the target — crop the left/right edges.
    sw = img.height * targetRatio
    sx = (img.width - sw) / 2
  } else {
    // Source is relatively taller than the target — crop the top/bottom.
    sh = img.width / targetRatio
    sy = (img.height - sh) / 2
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image editing is not supported in this browser')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
  return canvasToJpegDataUrl(canvas, quality)
}
