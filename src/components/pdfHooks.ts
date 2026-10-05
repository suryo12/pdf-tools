import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useI18n } from '../i18n'
import { isPdf, readBytes } from '../lib/format'
import { pageCount } from '../lib/pdf'
import { destroyPdf, openPdf } from '../lib/pdfjs'
import { errText } from './errText'

export interface LoadedPdf {
  name: string
  bytes: Uint8Array
  pages: number
}

/** Loads one PDF chosen by the user; validates it with pdf-lib and counts its pages. */
export function useSinglePdf() {
  const { t } = useI18n()
  const [file, setFile] = useState<LoadedPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (files: File[]) => {
      const f = files[0]
      if (!f) return
      setError(null)
      if (!isPdf(f)) {
        setError(t('err.notPdf'))
        return
      }
      setLoading(true)
      try {
        const bytes = await readBytes(f)
        const pages = await pageCount(bytes)
        setFile({ name: f.name, bytes, pages })
      } catch (e) {
        setError(errText(t, e))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  const reset = useCallback(() => {
    setFile(null)
    setError(null)
  }, [])

  return { file, error, loading, load, reset, setError }
}

/** pdf.js document for rendering; destroyed automatically when bytes change/unmount. */
export function usePdfDoc(bytes: Uint8Array | null) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<unknown>(null)
  const current = useRef<PDFDocumentProxy | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    if (!bytes) return
    openPdf(bytes).then(
      (d) => {
        if (cancelled) {
          void destroyPdf(d)
          return
        }
        current.current = d
        setDoc(d)
      },
      (e) => !cancelled && setError(e),
    )
    return () => {
      cancelled = true
      const d = current.current
      current.current = null
      if (d) void destroyPdf(d)
    }
  }, [bytes])

  return { doc, error }
}
