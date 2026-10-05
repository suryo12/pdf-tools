import { Util } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { FontId } from './fonts'

/** A run of existing page text, in visual points (origin top-left, y down) at the page's displayed rotation. */
export interface TextSeg {
  str: string
  x: number
  baseline: number
  size: number
  width: number
  font: FontId
  bold: boolean
  italic: boolean
}

function guessFont(family: string, name: string): FontId {
  const s = `${family} ${name}`
  if (/courier|mono/i.test(s)) return 'cousine'
  if (/times|georgia|garamond|palatino|serif/i.test(s) && !/sans/i.test(s)) return 'tinos'
  if (/calibri|carlito/i.test(s)) return 'carlito'
  return 'arimo'
}

/**
 * Reads the page's text with pdf.js and merges neighbouring items on the same line into
 * editable segments. Rotated (non-upright) text is skipped.
 */
export async function getTextSegments(doc: PDFDocumentProxy, index: number, rotation: number): Promise<TextSeg[]> {
  const page = await doc.getPage(index + 1)
  const viewport = page.getViewport({ scale: 1, rotation })
  const content = await page.getTextContent()
  const raw: TextSeg[] = []

  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue
    const tx = Util.transform(viewport.transform, it.transform)
    const size = Math.hypot(tx[2], tx[3])
    if (size < 1 || tx[0] <= 0 || Math.abs(tx[1]) > 0.1 * Math.abs(tx[0])) continue
    const family: string = content.styles[it.fontName]?.fontFamily ?? ''
    let name = ''
    try {
      // Only resolved once the page has been rendered; fall back to the generic family otherwise.
      name = (page.commonObjs as unknown as { get: (id: string) => { name?: string } | undefined }).get(it.fontName)?.name ?? ''
    } catch {
      /* font not loaded yet */
    }
    raw.push({
      str: it.str,
      x: tx[4],
      baseline: tx[5],
      size,
      width: it.width,
      font: guessFont(family, name),
      bold: /bold|black|heavy|semibold/i.test(name),
      italic: /italic|oblique/i.test(name),
    })
  }

  const out: TextSeg[] = []
  for (const cur of raw) {
    const prev = out[out.length - 1]
    if (prev) {
      const gap = cur.x - (prev.x + prev.width)
      const sameLine =
        Math.abs(prev.baseline - cur.baseline) < 0.25 * prev.size &&
        Math.abs(prev.size - cur.size) < 0.12 * prev.size &&
        prev.bold === cur.bold &&
        gap > -0.3 * prev.size &&
        gap < 0.6 * prev.size
      if (sameLine) {
        const space = gap > 0.12 * prev.size && !/\s$/.test(prev.str) && !/^\s/.test(cur.str) ? ' ' : ''
        prev.str += space + cur.str
        prev.width = cur.x + cur.width - prev.x
        continue
      }
    }
    out.push({ ...cur })
  }
  return out
}
