import type { EmbeddableImage } from './pdf'

export interface PreparedImage extends EmbeddableImage {
  width: number
  height: number
}

export const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|bmp)$/
export const isImage = (f: File) => IMAGE_MIME.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)

/** Best-effort mime for files whose type the browser left empty. */
export function imageMime(f: File): string {
  if (IMAGE_MIME.test(f.type)) return f.type
  const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1].toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext ? `image/${ext}` : 'image/png'
}

const canvasToBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality))

function hasTransparency(c: HTMLCanvasElement): boolean {
  const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
  return false
}

/**
 * Decodes an image through the browser (so EXIF rotation from phone photos is applied) and
 * re-encodes it for embedding in a PDF. JPEGs stay JPEG; images with transparency stay PNG;
 * other opaque images become JPEG. `maxSide` optionally downsizes large photos.
 */
export async function prepareImage(
  bytes: Uint8Array,
  mime: string,
  { maxSide = Infinity, quality = 0.92 }: { maxSide?: number; quality?: number } = {},
): Promise<PreparedImage> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k))
  c.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()

  const keepPng = mime !== 'image/jpeg' && hasTransparency(c)
  if (!keepPng && mime !== 'image/jpeg') {
    // Opaque non-JPEG: composite on white so JPEG does not turn transparent pixels black.
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  const out = keepPng ? 'image/png' : 'image/jpeg'
  const blob = await canvasToBlob(c, out, quality)
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: out, width: c.width, height: c.height }
}
