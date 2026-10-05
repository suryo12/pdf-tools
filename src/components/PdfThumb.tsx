import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { isRenderCancelled, pageSize, renderPage } from '../lib/pdfjs'

/**
 * Lazily rendered page thumbnail. `rotation` is the *extra* clockwise rotation on top of
 * the page's own (so 0 shows the page as authored).
 */
export function PdfThumb({
  doc,
  index,
  rotation = 0,
  width = 120,
  className = '',
}: {
  doc: PDFDocumentProxy
  index: number
  rotation?: number
  width?: number
  className?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [ratio, setRatio] = useState(1.414)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setVisible(true),
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvas.current) return
    let task: { cancel: () => void } | null = null
    let dead = false
    ;(async () => {
      const page = await doc.getPage(index + 1)
      const abs = (page.rotate + rotation) % 360
      const sz = await pageSize(doc, index, abs)
      if (dead) return
      setRatio(sz.h / sz.w)
      const r = await renderPage(doc, index, canvas.current!, width, abs)
      task = r.task
      try {
        await r.task.promise
      } catch (e) {
        if (!isRenderCancelled(e)) console.error(e)
      }
    })().catch((e) => !dead && console.error(e))
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, index, rotation, width, visible])

  return (
    <div
      ref={box}
      className={`overflow-hidden rounded bg-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700 ${className}`}
      style={{ width, height: width * ratio }}
    >
      <canvas ref={canvas} className="block" />
    </div>
  )
}
