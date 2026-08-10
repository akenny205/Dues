// Client-side avatar processing — center-crops whatever image the user
// picks to a square and downsizes it, so a profile picture never costs more
// than a few KB. No Supabase Storage bucket needed: the result is a small
// data: URL that goes straight into User.avatar_url as plain text (see
// db/policies/add_avatar_url.sql).

const MAX_SOURCE_BYTES = 10 * 1024 * 1024 // 10MB — guards against hanging on a huge photo

export function resizeImageToDataUrl(file: File, size = 160, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file'))
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error('That image is too large — please choose one under 10MB'))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not read that image'))
      img.onload = () => {
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2

        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Image editing is not supported in this browser'))
          return
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
