import fontkit from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'

/**
 * Fonts offered in Edit and Watermark. They are open-licence (OFL/Apache) files served from
 * /fonts, so the same file is used for the on-screen preview and for the embedded PDF font.
 * Tinos / Arimo / Cousine / Carlito are metric-compatible with Times New Roman / Arial /
 * Courier New / Calibri, so layouts match the originals.
 */
export interface FontDef {
  id: string
  label: string
  /** The actual open-source family that is embedded. */
  note: string
  /** File prefix under /fonts (matches the @fontsource package name). */
  file: string
  /** CSS fallback stack, used until the font file has loaded. */
  fallback: string
  hasItalic: boolean
}

export const FONTS = [
  { id: 'arimo', label: 'Arial', note: 'Arimo', file: 'arimo', fallback: 'Arial, Helvetica, sans-serif', hasItalic: true },
  { id: 'tinos', label: 'Times New Roman', note: 'Tinos', file: 'tinos', fallback: '"Times New Roman", Times, serif', hasItalic: true },
  { id: 'cousine', label: 'Courier New', note: 'Cousine', file: 'cousine', fallback: '"Courier New", monospace', hasItalic: true },
  { id: 'carlito', label: 'Calibri', note: 'Carlito', file: 'carlito', fallback: 'Calibri, sans-serif', hasItalic: true },
  { id: 'roboto', label: 'Roboto', note: 'Roboto', file: 'roboto', fallback: 'sans-serif', hasItalic: true },
  { id: 'opensans', label: 'Open Sans', note: 'Open Sans', file: 'open-sans', fallback: 'sans-serif', hasItalic: true },
  { id: 'lato', label: 'Lato', note: 'Lato', file: 'lato', fallback: 'sans-serif', hasItalic: true },
  { id: 'montserrat', label: 'Montserrat', note: 'Montserrat', file: 'montserrat', fallback: 'sans-serif', hasItalic: true },
  { id: 'merriweather', label: 'Merriweather', note: 'Merriweather', file: 'merriweather', fallback: 'serif', hasItalic: true },
  { id: 'dancing', label: 'Dancing Script', note: 'handwriting', file: 'dancing-script', fallback: 'cursive', hasItalic: false },
] as const satisfies readonly FontDef[]

export type FontId = (typeof FONTS)[number]['id']
export const DEFAULT_FONT: FontId = 'arimo'

const byId = new Map<string, FontDef>(FONTS.map((f) => [f.id, f]))
export const fontDef = (id: FontId): FontDef => byId.get(id)!

/** Italic only exists for fonts that ship an italic file (we never fake it). */
export const effectiveItalic = (id: FontId, italic: boolean) => italic && fontDef(id).hasItalic

const variantUrl = (d: FontDef, bold: boolean, italic: boolean) =>
  `${import.meta.env.BASE_URL}fonts/${d.file}-latin-${bold ? 700 : 400}-${italic ? 'italic' : 'normal'}.woff`

export const cssFamily = (id: FontId) => `"pdft-${id}", ${fontDef(id).fallback}`

export const cssFont = (id: FontId, sizePx: number, bold: boolean, italic: boolean) =>
  `${effectiveItalic(id, italic) ? 'italic ' : ''}${bold ? 700 : 400} ${sizePx}px ${cssFamily(id)}`

const loaded = new Map<string, Promise<void>>()

/** Makes a font variant available to the page (canvas + CSS). Safe to call repeatedly. */
export function loadFont(id: FontId, bold: boolean, italic: boolean): Promise<void> {
  const it = effectiveItalic(id, italic)
  const key = `${id}:${bold}:${it}`
  let p = loaded.get(key)
  if (!p) {
    const d = fontDef(id)
    const face = new FontFace(`pdft-${id}`, `url(${variantUrl(d, bold, it)})`, {
      weight: bold ? '700' : '400',
      style: it ? 'italic' : 'normal',
    })
    p = face.load().then((f) => {
      document.fonts.add(f)
    })
    p.catch(() => loaded.delete(key)) // allow a retry after a network hiccup
    loaded.set(key, p)
  }
  return p
}

const bytesCache = new Map<string, Promise<Uint8Array>>()
function fontBytes(id: FontId, bold: boolean, italic: boolean): Promise<Uint8Array> {
  const it = effectiveItalic(id, italic)
  const key = `${id}:${bold}:${it}`
  let p = bytesCache.get(key)
  if (!p) {
    p = fetch(variantUrl(fontDef(id), bold, it)).then(async (r) => {
      if (!r.ok) throw new Error(`Font ${id} failed to load (${r.status})`)
      return new Uint8Array(await r.arrayBuffer())
    })
    p.catch(() => bytesCache.delete(key))
    bytesCache.set(key, p)
  }
  return p
}

/** Embeds (a subset of) a font variant in a pdf-lib document. */
export async function embedFont(doc: PDFDocument, id: FontId, bold: boolean, italic: boolean): Promise<PDFFont> {
  doc.registerFontkit(fontkit)
  return doc.embedFont(await fontBytes(id, bold, italic), { subset: true })
}

let ctx: CanvasRenderingContext2D | null = null
const ratioCache = new Map<string, number>()

/**
 * Distance from the top of a CSS line box (line-height = `lineHeight` × size) to the text
 * baseline, as a fraction of the font size. Measured in the browser so that the PDF text lands
 * exactly where the on-screen preview shows it. The font must be loaded first.
 */
export function baselineRatio(id: FontId, bold: boolean, italic: boolean, lineHeight: number): number {
  const key = `${id}:${bold}:${effectiveItalic(id, italic)}:${lineHeight}`
  const hit = ratioCache.get(key)
  if (hit !== undefined) return hit
  ctx ??= document.createElement('canvas').getContext('2d')!
  ctx.font = cssFont(id, 100, bold, italic)
  const m = ctx.measureText('Hxg')
  const asc = (m.fontBoundingBoxAscent ?? 95) / 100
  const desc = (m.fontBoundingBoxDescent ?? 25) / 100
  const r = (lineHeight - (asc + desc)) / 2 + asc
  ratioCache.set(key, r)
  return r
}
