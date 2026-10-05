import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const assets = `${import.meta.env.BASE_URL}pdfjs/`

/** Opens a PDF for rendering. All pdf.js assets are served same-origin from /pdfjs. */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer to its worker
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  })
  return task.promise
}

/** Frees the document and terminates its pdf.js worker. */
export const destroyPdf = (doc: PDFDocumentProxy) => doc.loadingTask.destroy()

// pdf.js's exception classes do not all extend Error, so match on the name only.
export const isRenderCancelled = (e: unknown) =>
  (e as { name?: string } | null)?.name === 'RenderingCancelledException'

/** Page size in points for a given (absolute) rotation; omit rotation to use the page's own. */
export async function pageSize(doc: PDFDocumentProxy, index: number, rotation?: number) {
  const page = await doc.getPage(index + 1)
  const v = page.getViewport({ scale: 1, rotation })
  return { w: v.width, h: v.height }
}

/**
 * Renders a page into `canvas` so it is `cssWidth` CSS pixels wide
 * (backing store scaled by devicePixelRatio). `rotation` is absolute (replaces the page's own).
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  rotation?: number,
): Promise<{ task: RenderTask; cssHeight: number }> {
  const page = await doc.getPage(index + 1)
  const base = page.getViewport({ scale: 1, rotation })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const scale = (cssWidth / base.width) * dpr
  const viewport = page.getViewport({ scale, rotation })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const cssHeight = (base.height / base.width) * cssWidth
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  const task = page.render({ canvas, viewport })
  return { task, cssHeight }
}
