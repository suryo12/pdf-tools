import { PDFDocument } from 'pdf-lib'
import { prepareImage } from '../images'
import { loadPdf, yieldToUi } from '../pdf'

export interface MergeInput {
  name: string
  bytes: Uint8Array
  kind: 'pdf' | 'image'
  mime: string
}

const A4 = { w: 595.28, h: 841.89 }

/** Merges PDFs (and images, one page each) in order. Runs fully in memory. */
export async function mergeInputs(
  inputs: MergeInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i]
    if (inp.kind === 'pdf') {
      const src = await loadPdf(inp.bytes)
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach((p) => out.addPage(p))
    } else {
      const img = await prepareImage(inp.bytes, inp.mime)
      const emb = img.mime === 'image/png' ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes)
      // Fit inside A4 (portrait or landscape by aspect) without distortion; page = scaled image.
      const landscape = img.width > img.height
      const box = landscape ? { w: A4.h, h: A4.w } : A4
      const k = Math.min(box.w / img.width, box.h / img.height)
      const w = img.width * k
      const h = img.height * k
      const page = out.addPage([w, h])
      page.drawImage(emb, { x: 0, y: 0, width: w, height: h })
    }
    onProgress?.(i + 1, inputs.length)
    await yieldToUi()
  }
  return out.save()
}
