import {
  LineCapStyle,
  PDFDocument,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib'
import { hexToRgb01 } from '../format'
import { baselineRatio, embedFont, loadFont, type FontId } from '../fonts'
import { PdfError, loadPdf, yieldToUi, type EmbeddableImage } from '../pdf'
import { normRot, pageGeom, toUser, visualDims, type PageGeom } from '../pageSpace'

// ---- Model ---------------------------------------------------------------
// Annotation coordinates are in *visual points*: origin at the top-left of the page as
// displayed (after the user's rotation), y pointing down, 1 unit = 1 PDF point.

export type FontFamily = FontId

interface Base {
  id: string
}
export interface TextAnnot extends Base {
  type: 'text'
  x: number
  y: number
  text: string
  size: number
  color: string
  font: FontFamily
  bold: boolean
  italic: boolean
}
export interface RectAnnot extends Base {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  color: string
  opacity: number
}
export interface ImageAnnot extends Base {
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  image: EmbeddableImage
  url: string
}
export interface PenAnnot extends Base {
  type: 'pen'
  points: [number, number][]
  color: string
  width: number
}
export type Annot = TextAnnot | RectAnnot | ImageAnnot | PenAnnot

export interface EditPage {
  id: string
  /** Index in the source PDF, or null for an inserted blank page. */
  src: number | null
  /** Blank page size in points (only when src is null). */
  blank?: { w: number; h: number }
  /** Extra clockwise rotation applied on top of the page's own, in degrees. */
  rotate: number
  annots: Annot[]
}

export const LINE_HEIGHT = 1.2

// ---- Export ----------------------------------------------------------------

export async function exportEdited(
  bytes: Uint8Array,
  pages: EditPage[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const src = await loadPdf(bytes)
  const out = await PDFDocument.create()
  const fonts = new Map<string, PDFFont>()
  const images = new Map<string, PDFImage>()
  const getFont = async (a: TextAnnot) => {
    const k = `${a.font}:${a.bold}:${a.italic}`
    let f = fonts.get(k)
    if (!f) fonts.set(k, (f = await embedFont(out, a.font, a.bold, a.italic)))
    return f
  }

  for (let n = 0; n < pages.length; n++) {
    const ep = pages[n]
    let page
    if (ep.src === null) {
      const { w, h } = ep.blank ?? { w: 595.28, h: 841.89 }
      page = out.addPage([w, h])
    } else {
      const [copied] = await out.copyPages(src, [ep.src])
      page = out.addPage(copied)
    }
    if (ep.rotate) page.setRotation(degrees(normRot(page.getRotation().angle + ep.rotate)))
    const geom: PageGeom = pageGeom(page)
    const { h: vh } = visualDims(geom)
    const rotate = degrees(geom.rot)
    // visual y-down -> y-up
    const up = (y: number) => vh - y

    for (const a of ep.annots) {
      if (a.type === 'text') {
        const font = await getFont(a)
        await loadFont(a.font, a.bold, a.italic)
        const ratio = baselineRatio(a.font, a.bold, a.italic, LINE_HEIGHT)
        const [r, g, b] = hexToRgb01(a.color)
        const lines = a.text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue
          const baseline = a.y + a.size * ratio + i * a.size * LINE_HEIGHT
          const p = toUser(geom, a.x, up(baseline))
          try {
            page.drawText(lines[i], { x: p.x, y: p.y, size: a.size, font, color: rgb(r, g, b), rotate })
          } catch (e) {
            throw new PdfError('unsupportedText', e)
          }
        }
      } else if (a.type === 'rect') {
        const [r, g, b] = hexToRgb01(a.color)
        const p = toUser(geom, a.x, up(a.y + a.h))
        page.drawRectangle({ x: p.x, y: p.y, width: a.w, height: a.h, color: rgb(r, g, b), opacity: a.opacity, rotate })
      } else if (a.type === 'image') {
        let img = images.get(a.id)
        if (!img) {
          img =
            a.image.mime === 'image/png' ? await out.embedPng(a.image.bytes) : await out.embedJpg(a.image.bytes)
          images.set(a.id, img)
        }
        const p = toUser(geom, a.x, up(a.y + a.h))
        page.drawImage(img, { x: p.x, y: p.y, width: a.w, height: a.h, rotate })
      } else {
        const [r, g, b] = hexToRgb01(a.color)
        for (let i = 1; i < a.points.length; i++) {
          const s = toUser(geom, a.points[i - 1][0], up(a.points[i - 1][1]))
          const e = toUser(geom, a.points[i][0], up(a.points[i][1]))
          page.drawLine({
            start: s,
            end: e,
            thickness: a.width,
            color: rgb(r, g, b),
            lineCap: LineCapStyle.Round,
          })
        }
      }
    }
    onProgress?.(n + 1, pages.length)
    if (n % 5 === 4) await yieldToUi()
  }
  return out.save()
}
