import { EncryptedPDFError, PDFDocument } from 'pdf-lib'

export type PdfErrorCode = 'encrypted' | 'invalid' | 'unsupportedText'

export class PdfError extends Error {
  code: PdfErrorCode
  constructor(code: PdfErrorCode, cause?: unknown) {
    super(code, { cause })
    this.code = code
  }
}

/** Loads a PDF with pdf-lib and maps failures to a small set of user-facing codes. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    if (e instanceof EncryptedPDFError) throw new PdfError('encrypted', e)
    throw new PdfError('invalid', e)
  }
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount()
}

export const errorCode = (e: unknown): PdfErrorCode | null => (e instanceof PdfError ? e.code : null)

/** pdf.js signals an encrypted file with a PasswordException (checked by name to avoid importing pdf.js). */
export const isPasswordError = (e: unknown) => e instanceof Error && e.name === 'PasswordException'

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** Lets the UI repaint (progress bars) between heavy synchronous steps. */
export const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))

/** Decodes any browser-supported image (webp, gif, bmp...) to PNG bytes via canvas. */
async function imageToPng(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const blob = await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

export type EmbeddableImage = { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' }

/** Normalises an image to something pdf-lib can embed: jpeg or png. */
export async function normalizeImage(bytes: Uint8Array, mime: string): Promise<EmbeddableImage> {
  if (mime === 'image/jpeg' || mime === 'image/png') return { bytes, mime }
  return { bytes: await imageToPng(bytes, mime), mime: 'image/png' }
}
