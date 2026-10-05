import type { PDFDocumentProxy } from 'pdfjs-dist'
import { yieldToUi } from '../pdf'

export type ImageFormat = 'png' | 'jpeg'

export interface PdfToImagesOptions {
  /** Render resolution; 72 dpi = 1 PDF point per pixel. */
  dpi: number
  format: ImageFormat
  /** JPEG quality 0..1. */
  quality: number
}

/** Browsers cap canvas size (~16k px per side, ~268M pixels); stay well inside that. */
const MAX_SIDE = 9000

export interface RenderedPage {
  index: number
  blob: Blob
  width: number
  height: number
}

/** Renders the given zero-based pages to images, one at a time to keep memory flat. */
export async function pdfToImages(
  doc: PDFDocumentProxy,
  pages: number[],
  opts: PdfToImagesOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedPage[]> {
  const out: RenderedPage[] = []
  const type = opts.format === 'png' ? 'image/png' : 'image/jpeg'
  for (let n = 0; n < pages.length; n++) {
    const page = await doc.getPage(pages[n] + 1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(opts.dpi / 72, MAX_SIDE / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    // White page background so JPEG (and PNG) do not come out transparent/black.
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, opts.quality),
    )
    out.push({ index: pages[n], blob, width: canvas.width, height: canvas.height })
    canvas.width = canvas.height = 0 // release the bitmap memory right away
    page.cleanup()
    onProgress?.(n + 1, pages.length)
    await yieldToUi()
  }
  return out
}
