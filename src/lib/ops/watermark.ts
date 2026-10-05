import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import { embedFont, type FontId } from '../fonts'
import { hexToRgb01 } from '../format'
import { PdfError, loadPdf, yieldToUi, type EmbeddableImage } from '../pdf'
import { pageGeom, toUser, visualDims } from '../pageSpace'

export type WmPosition = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br' | 'tile'

export interface WatermarkOptions {
  kind: 'text' | 'image'
  text: string
  font: FontId
  fontSize: number
  bold: boolean
  color: string
  image: EmbeddableImage | null
  /** Image width as a percentage of the page width. */
  imageScale: number
  /** 0..1 */
  opacity: number
  /** Degrees, counter-clockwise as seen on the page. */
  rotation: number
  position: WmPosition
  /** Extra spacing between repeats when position is "tile", in points. */
  tileGap: number
  /** Zero-based page indexes, or every page. */
  pages: number[] | 'all'
}

const MARGIN = 28
const MAX_TILES = 1500

interface Assets {
  font?: PDFFont
  img?: PDFImage
}

export async function applyWatermark(
  bytes: Uint8Array,
  opts: WatermarkOptions,
  { firstPageOnly = false, onProgress }: { firstPageOnly?: boolean; onProgress?: (d: number, t: number) => void } = {},
): Promise<Uint8Array> {
  let doc = await loadPdf(bytes)
  if (firstPageOnly) {
    // Fast path for the live preview: only keep (and mark) page 1.
    const single = await PDFDocument.create()
    const [p] = await single.copyPages(doc, [0])
    single.addPage(p)
    doc = single
  }

  const assets: Assets = {}
  if (opts.kind === 'text') {
    assets.font = await embedFont(doc, opts.font, opts.bold, false)
  } else if (opts.image) {
    assets.img =
      opts.image.mime === 'image/png' ? await doc.embedPng(opts.image.bytes) : await doc.embedJpg(opts.image.bytes)
  }

  const pages = doc.getPages()
  const targets = firstPageOnly || opts.pages === 'all' ? pages.map((_, i) => i) : opts.pages
  for (let n = 0; n < targets.length; n++) {
    const page = pages[targets[n]]
    if (!page) continue
    drawMark(page, opts, assets)
    if (!firstPageOnly && n % 10 === 9) {
      onProgress?.(n + 1, targets.length)
      await yieldToUi()
    }
  }
  return doc.save()
}

function drawMark(page: ReturnType<PDFDocument['getPages']>[number], opts: WatermarkOptions, a: Assets) {
  const g = pageGeom(page)
  const { w: vw, h: vh } = visualDims(g)

  let mw: number
  let mh: number
  if (opts.kind === 'text') {
    try {
      mw = a.font!.widthOfTextAtSize(opts.text, opts.fontSize)
    } catch (e) {
      throw new PdfError('unsupportedText', e) // character outside WinAnsi (e.g. CJK, emoji)
    }
    mh = opts.fontSize * 0.72 // cap height, so the visual centre sits on the letters
  } else {
    if (!a.img) return
    mw = (vw * opts.imageScale) / 100
    mh = (mw * a.img.height) / a.img.width
  }

  const th = (opts.rotation * Math.PI) / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)

  const [r, gr, b] = hexToRgb01(opts.color)
  const draw = (cx: number, cy: number) => {
    // Bottom-left corner of the (unrotated) box, rotated about its centre.
    const ox = cx - (mw / 2) * cos + (mh / 2) * sin
    const oy = cy - (mw / 2) * sin - (mh / 2) * cos
    const p = toUser(g, ox, oy)
    const rotate = degrees(opts.rotation + g.rot)
    if (opts.kind === 'text') {
      page.drawText(opts.text, {
        x: p.x,
        y: p.y,
        size: opts.fontSize,
        font: a.font!,
        color: rgb(r, gr, b),
        opacity: opts.opacity,
        rotate,
      })
    } else {
      page.drawImage(a.img!, { x: p.x, y: p.y, width: mw, height: mh, opacity: opts.opacity, rotate })
    }
  }

  for (const { cx, cy } of layoutMarks(vw, vh, mw, mh, opts)) draw(cx, cy)
}

/**
 * Where to put the watermark: centres of every copy, in visual coordinates (origin bottom-left,
 * y up) of a `vw` x `vh` surface, for a mark of unrotated size `mw` x `mh`. Shared by the PDF
 * and the image (canvas) back-ends. `scale` converts the point-based margin to the surface unit.
 */
export function layoutMarks(
  vw: number,
  vh: number,
  mw: number,
  mh: number,
  o: Pick<WatermarkOptions, 'rotation' | 'position' | 'tileGap'>,
  scale = 1,
): { cx: number; cy: number }[] {
  const th = (o.rotation * Math.PI) / 180
  const bw = Math.abs(mw * Math.cos(th)) + Math.abs(mh * Math.sin(th))
  const bh = Math.abs(mw * Math.sin(th)) + Math.abs(mh * Math.cos(th))
  const margin = MARGIN * scale

  if (o.position === 'tile') {
    const sx = bw + o.tileGap * scale
    const sy = bh + o.tileGap * scale
    const rows = Math.ceil(vh / sy) + 1
    const cols = Math.ceil(vw / sx) + 1
    const out: { cx: number; cy: number }[] = []
    for (let i = -rows; i <= rows; i++) {
      for (let j = -cols; j <= cols; j++) {
        const cx = vw / 2 + j * sx + (Math.abs(i) % 2) * (sx / 2)
        const cy = vh / 2 + i * sy
        if (cx + bw / 2 < 0 || cx - bw / 2 > vw || cy + bh / 2 < 0 || cy - bh / 2 > vh) continue
        if (out.length >= MAX_TILES) return out
        out.push({ cx, cy })
      }
    }
    return out
  }

  // Two-letter codes: row (t/m/b) + column (l/c/r); a lone "c" is the centre.
  const single = o.position.length === 1
  const row = single ? 'm' : o.position[0]
  const hx = single ? 'c' : o.position[1]
  const cx = hx === 'l' ? margin + bw / 2 : hx === 'r' ? vw - margin - bw / 2 : vw / 2
  const cy = row === 't' ? vh - margin - bh / 2 : row === 'b' ? margin + bh / 2 : vh / 2
  return [{ cx, cy }]
}
