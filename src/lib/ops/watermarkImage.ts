import { cssFont, loadFont } from '../fonts'
import { layoutMarks, type WatermarkOptions } from './watermark'

/** Watermark sizes are authored in points for an A4-width page (595pt); images scale from that. */
const REF_WIDTH = 595

/**
 * Draws `source` with the watermark onto a new canvas. `maxSide` optionally downsizes (used for
 * the live preview). Uses the same layout maths as the PDF watermark.
 */
export async function renderWatermarkedImage(
  source: { bytes: Uint8Array; mime: string },
  opts: WatermarkOptions,
  maxSide = Infinity,
): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([source.bytes as BlobPart], { type: source.mime }))
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const W = Math.max(1, Math.round(bmp.width * k))
  const H = Math.max(1, Math.round(bmp.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, W, H)
  bmp.close()

  const unit = W / REF_WIDTH // pixels per "reference point"
  let mw: number
  let mh: number
  let draw: (cx: number, cy: number) => void

  if (opts.kind === 'text') {
    await loadFont(opts.font, opts.bold, false)
    const size = opts.fontSize * unit
    ctx.font = cssFont(opts.font, size, opts.bold, false)
    mw = ctx.measureText(opts.text).width
    mh = size * 0.72 // cap height, matches the PDF back-end
    draw = () => ctx.fillText(opts.text, -mw / 2, mh / 2)
  } else {
    if (!opts.image) return canvas
    const logo = await createImageBitmap(new Blob([opts.image.bytes as BlobPart], { type: opts.image.mime }))
    mw = (W * opts.imageScale) / 100
    mh = (mw * logo.height) / logo.width
    draw = () => ctx.drawImage(logo, -mw / 2, -mh / 2, mw, mh)
  }

  ctx.fillStyle = opts.color
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = opts.opacity
  for (const { cx, cy } of layoutMarks(W, H, mw, mh, opts, unit)) {
    ctx.save()
    ctx.translate(cx, H - cy) // layout is y-up, canvas is y-down
    ctx.rotate((-opts.rotation * Math.PI) / 180) // positive rotation = counter-clockwise
    draw(cx, cy)
    ctx.restore()
  }
  return canvas
}

/** Watermarked image encoded as PNG (for PNG/other) or JPEG (for JPEG sources). */
export async function watermarkImage(
  source: { bytes: Uint8Array; mime: string },
  opts: WatermarkOptions,
): Promise<{ blob: Blob; ext: 'png' | 'jpg' }> {
  const canvas = await renderWatermarkedImage(source, opts)
  const jpeg = source.mime === 'image/jpeg'
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), jpeg ? 'image/jpeg' : 'image/png', 0.93),
  )
  return { blob, ext: jpeg ? 'jpg' : 'png' }
}
