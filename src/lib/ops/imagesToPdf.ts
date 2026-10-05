import { PDFDocument } from 'pdf-lib'
import { prepareImage } from '../images'
import { yieldToUi } from '../pdf'

export type PageSizeMode = 'auto' | 'a4' | 'letter'

export interface ImagesToPdfOptions {
  pageSize: PageSizeMode
  /** Page margin in points (ignored for "auto"). */
  margin: number
  /** Downsize big photos and re-encode them so the PDF stays small. */
  optimize: boolean
}

export interface ImageInput {
  name: string
  bytes: Uint8Array
  mime: string
}

const SIZES = { a4: { w: 595.28, h: 841.89 }, letter: { w: 612, h: 792 } }

/** One image per page. Fixed sizes pick portrait/landscape per image and centre it inside the margins. */
export async function imagesToPdf(
  images: ImageInput[],
  opts: ImagesToPdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < images.length; i++) {
    const src = images[i]
    const img = await prepareImage(
      src.bytes,
      src.mime,
      opts.optimize ? { maxSide: 2200, quality: 0.8 } : { quality: 0.95 },
    )
    const emb = img.mime === 'image/png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes)
    const landscape = img.width > img.height

    let pw: number
    let ph: number
    let m = 0
    if (opts.pageSize === 'auto') {
      // Page matches the image, scaled so the long side is A4-sized.
      const k = SIZES.a4.h / Math.max(img.width, img.height)
      pw = img.width * k
      ph = img.height * k
    } else {
      const s = SIZES[opts.pageSize]
      pw = landscape ? s.h : s.w
      ph = landscape ? s.w : s.h
      m = opts.margin
    }
    const k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height)
    const w = img.width * k
    const h = img.height * k
    const page = doc.addPage([pw, ph])
    page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })

    onProgress?.(i + 1, images.length)
    await yieldToUi()
  }
  return doc.save()
}
