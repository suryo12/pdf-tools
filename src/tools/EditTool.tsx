import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useI18n, type Key } from '../i18n'
import { baseName, downloadPdf, formatBytes } from '../lib/format'
import {
  LINE_HEIGHT,
  exportEdited,
  type Annot,
  type EditPage,
  type ImageAnnot,
  type PenAnnot,
  type RectAnnot,
  type TextAnnot,
} from '../lib/ops/edit'
import { DEFAULT_FONT, FONTS, baselineRatio, cssFamily, cssFont, effectiveItalic, fontDef, loadFont, type FontId } from '../lib/fonts'
import { getTextSegments, type TextSeg } from '../lib/textSegments'
import { normalizeImage } from '../lib/pdf'
import { isRenderCancelled, renderPage } from '../lib/pdfjs'
import { Dropzone } from '../components/Dropzone'
import { PdfThumb } from '../components/PdfThumb'
import { usePdfDoc, useSinglePdf } from '../components/pdfHooks'
import { Alert, Button, Card, Checkbox, ColorInput, inputCls, Label, ProgressBar, Slider } from '../components/ui'
import { errText } from '../components/errText'

type Tool = 'select' | 'edittext' | 'text' | 'whiteout' | 'highlight' | 'image' | 'pen'
interface Base {
  w: number
  h: number
  rot: number
}

let uid = 0
const newId = (p: string) => `${p}${++uid}`


// ---- history -----------------------------------------------------------------

function useHistory<T>(initial: T) {
  const ref = useRef(initial)
  const [state, setState] = useState(initial)
  const [, bump] = useState(0)
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const last = useRef<{ key: string; time: number } | null>(null)

  const commit = (n: T) => {
    ref.current = n
    setState(n)
  }
  /** mode: true = own undo step, false = no step (inside a gesture), string = coalesce edits of that key. */
  const set = useCallback((fn: (s: T) => T, mode: boolean | string = true) => {
    const cur = ref.current
    const next = fn(cur)
    if (next === cur) return
    if (mode !== false) {
      const key = typeof mode === 'string' ? mode : null
      const now = Date.now()
      const coalesce = key !== null && last.current?.key === key && now - last.current.time < 1000
      if (!coalesce) {
        past.current.push(cur)
        if (past.current.length > 100) past.current.shift()
        future.current = []
      }
      last.current = key ? { key, time: now } : null
    }
    commit(next)
  }, [])
  /** Starts a drag/draw gesture: one undo step for everything done until the gesture ends. */
  const begin = useCallback(() => {
    past.current.push(ref.current)
    future.current = []
    last.current = null
    bump((n) => n + 1)
  }, [])
  /** Drops the gesture's undo step and restores the state from before it. */
  const abort = useCallback(() => {
    const p = past.current.pop()
    if (p) commit(p)
  }, [])
  const undo = useCallback(() => {
    const p = past.current.pop()
    if (!p) return
    future.current.push(ref.current)
    last.current = null
    commit(p)
  }, [])
  const redo = useCallback(() => {
    const n = future.current.pop()
    if (!n) return
    past.current.push(ref.current)
    last.current = null
    commit(n)
  }, [])
  return { state, set, begin, abort, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }
}

// ---- geometry helpers --------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null
function textBox(a: TextAnnot): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = cssFont(a.font, a.size, a.bold, a.italic)
  const lines = a.text.split('\n')
  return { w: Math.max(...lines.map((l) => measureCtx!.measureText(l).width), 1), h: lines.length * a.size * LINE_HEIGHT }
}

/** Re-anchors an annotation after its page was rotated 90° (W×H = page size before rotating). */
function rotateAnnot(a: Annot, W: number, H: number, cw: boolean): Annot {
  const pt = (x: number, y: number): [number, number] => (cw ? [H - y, x] : [y, W - x])
  switch (a.type) {
    case 'pen':
      return { ...a, points: a.points.map(([x, y]) => pt(x, y)) }
    case 'rect': {
      const b = cw ? { x: H - (a.y + a.h), y: a.x } : { x: a.y, y: W - (a.x + a.w) }
      return { ...a, ...b, w: a.h, h: a.w }
    }
    default: {
      // text / image keep their size and stay upright; only their centre follows the page.
      const s = a.type === 'text' ? textBox(a) : { w: a.w, h: a.h }
      const [cx, cy] = pt(a.x + s.w / 2, a.y + s.h / 2)
      return { ...a, x: cx - s.w / 2, y: cy - s.h / 2 }
    }
  }
}

// ---- component ---------------------------------------------------------------

export default function EditTool() {
  const { t } = useI18n()
  const { file, error, loading, load, reset } = useSinglePdf()
  const { doc, error: docError } = usePdfDoc(file?.bytes ?? null)

  if (!file) {
    return (
      <div className="space-y-4">
        <Dropzone accept="application/pdf,.pdf" onFiles={load} />
        {loading && <ProgressBar label={t('loading')} />}
        {error && <Alert>{error}</Alert>}
      </div>
    )
  }
  if (docError) return <Alert>{errText(t, docError)}</Alert>
  if (!doc) return <ProgressBar label={t('loading')} />
  return <Editor key={file.name + file.bytes.length} file={file} doc={doc} onClose={reset} />
}

function Editor({
  file,
  doc,
  onClose,
}: {
  file: { name: string; bytes: Uint8Array; pages: number }
  doc: PDFDocumentProxy
  onClose: () => void
}) {
  const { t } = useI18n()
  const initial = useMemo<EditPage[]>(
    () => Array.from({ length: doc.numPages }, (_, i) => ({ id: newId('p'), src: i, rotate: 0, annots: [] })),
    [doc],
  )
  const h = useHistory<EditPage[]>(initial)
  const pages = h.state
  const [cur, setCur] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [zoom, setZoom] = useState(1)
  const [base, setBase] = useState<Base[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLDivElement>(null)
  const [fitW, setFitW] = useState(700)

  // Page sizes (as authored) are needed to lay out annotations.
  useEffect(() => {
    let dead = false
    ;(async () => {
      const out: Base[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i)
        const v = p.getViewport({ scale: 1 })
        out.push({ w: v.width, h: v.height, rot: p.rotate })
      }
      if (!dead) setBase(out)
    })().catch((e) => !dead && setErr(errText(t, e)))
    return () => {
      dead = true
    }
  }, [doc, t])

  useEffect(() => {
    const el = main.current
    if (!el) return
    const ro = new ResizeObserver(() => setFitW(Math.max(240, Math.min(el.clientWidth - 32, 1000))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => setResult(null), [pages])
  useEffect(() => {
    if (cur > pages.length - 1) setCur(Math.max(0, pages.length - 1))
  }, [pages.length, cur])

  const dimsOf = useCallback(
    (ep: EditPage): { w: number; h: number } => {
      const b = ep.src === null ? { ...(ep.blank ?? { w: 595.28, h: 841.89 }) } : base?.[ep.src]
      if (!b) return { w: 595, h: 842 }
      return ep.rotate % 180 ? { w: b.h, h: b.w } : { w: b.w, h: b.h }
    },
    [base],
  )

  const page = pages[cur] as EditPage | undefined

  // ---- annotation mutations
  const patchPage = (id: string, fn: (p: EditPage) => EditPage, mode: boolean | string = true) =>
    h.set((ps) => ps.map((p) => (p.id === id ? fn(p) : p)), mode)
  const addAnnot = (a: Annot | Annot[], mode: boolean | string = true) =>
    page && patchPage(page.id, (p) => ({ ...p, annots: [...p.annots, ...(Array.isArray(a) ? a : [a])] }), mode)
  const patchAnnot = <T extends Annot>(id: string, patch: Partial<T>, mode: boolean | string = true) =>
    page &&
    patchPage(page.id, (p) => ({ ...p, annots: p.annots.map((a) => (a.id === id ? ({ ...a, ...patch } as Annot) : a)) }), mode)
  const removeAnnot = (id: string) => {
    if (!page) return
    patchPage(page.id, (p) => ({ ...p, annots: p.annots.filter((a) => a.id !== id) }))
    setSelected(null)
  }
  const selectedAnnot = page?.annots.find((a) => a.id === selected) ?? null

  // ---- page operations
  const rotatePage = (cw: boolean) => {
    if (!page) return
    const { w, h: ph } = dimsOf(page)
    patchPage(page.id, (p) => ({
      ...p,
      rotate: (p.rotate + (cw ? 90 : 270)) % 360,
      annots: p.annots.map((a) => rotateAnnot(a, w, ph, cw)),
    }))
  }
  const movePage = (dir: -1 | 1) => {
    const to = cur + dir
    if (to < 0 || to >= pages.length) return
    h.set((ps) => {
      const c = [...ps]
      ;[c[cur], c[to]] = [c[to], c[cur]]
      return c
    })
    setCur(to)
  }
  const deletePage = () => {
    if (!page) return
    h.set((ps) => ps.filter((p) => p.id !== page.id))
    setSelected(null)
  }
  const addBlank = () => {
    if (!page) return
    const d = dimsOf(page)
    const blank: EditPage = { id: newId('p'), src: null, blank: { w: d.w, h: d.h }, rotate: 0, annots: [] }
    h.set((ps) => [...ps.slice(0, cur + 1), blank, ...ps.slice(cur + 1)])
    setCur(cur + 1)
  }

  const pickImage = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !page) return
    try {
      const img = await normalizeImage(new Uint8Array(await f.arrayBuffer()), f.type)
      const blob = new Blob([img.bytes as BlobPart], { type: img.mime })
      const bmp = await createImageBitmap(blob)
      const d = dimsOf(page)
      const w = Math.min(d.w * 0.4, bmp.width)
      const a: ImageAnnot = {
        id: newId('a'),
        type: 'image',
        x: (d.w - w) / 2,
        y: (d.h - (w * bmp.height) / bmp.width) / 2,
        w,
        h: (w * bmp.height) / bmp.width,
        image: img,
        url: URL.createObjectURL(blob),
      }
      bmp.close()
      addAnnot(a)
      setSelected(a.id)
      setTool('select')
    } catch (e) {
      setErr(errText(t, e))
    } finally {
      if (imageInput.current) imageInput.current.value = ''
    }
  }

  const chooseTool = (next: Tool) => {
    if (next === 'image') {
      imageInput.current?.click()
      return
    }
    setTool(next)
    if (next !== 'select') setSelected(null)
  }

  const run = async () => {
    setErr(null)
    setBusy(true)
    try {
      setResult(await exportEdited(file.bytes, pages))
    } catch (e) {
      setErr(errText(t, e))
    } finally {
      setBusy(false)
    }
  }

  // ---- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) h.redo()
        else h.undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault()
        h.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected) {
        e.preventDefault()
        removeAnnot(selected)
      } else if (e.key === 'Escape' && !typing) {
        setTool('select')
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tools: { id: Tool; label: Key }[] = [
    { id: 'select', label: 'edit.select' },
    { id: 'edittext', label: 'edit.editText' },
    { id: 'text', label: 'edit.text' },
    { id: 'whiteout', label: 'edit.whiteout' },
    { id: 'highlight', label: 'edit.highlight' },
    { id: 'image', label: 'edit.image' },
    { id: 'pen', label: 'edit.pen' },
  ]
  const hint: Partial<Record<Tool, Key>> = { edittext: 'edit.hintEditText', text: 'edit.hintText', whiteout: 'edit.hintRect', highlight: 'edit.hintRect', pen: 'edit.hintPen' }

  return (
    <div className="space-y-4">
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 min-w-0 max-w-56 truncate text-sm font-medium" title={file.name}>
            {file.name}
          </div>
          <div className="flex flex-wrap gap-1">
            {tools.map((x) => (
              <Button
                key={x.id}
                size="sm"
                variant={tool === x.id ? 'primary' : 'secondary'}
                aria-pressed={tool === x.id}
                disabled={!page || (x.id !== 'select' && !base)}
                onClick={() => chooseTool(x.id)}
              >
                {t(x.label)}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" disabled={!h.canUndo} onClick={h.undo} title={`${t('edit.undo')} (Ctrl+Z)`}>
              ↶ {t('edit.undo')}
            </Button>
            <Button size="sm" variant="ghost" disabled={!h.canRedo} onClick={h.redo} title={`${t('edit.redo')} (Ctrl+Y)`}>
              ↷
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('changeFile')}
            </Button>
          </div>
        </div>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pickImage(e.target.files)} />
        {hint[tool] && <div className="mt-2 text-xs text-indigo-600 dark:text-indigo-300">{t(hint[tool]!)}</div>}
      </Card>

      {pages.length === 0 ? (
        <Alert kind="info">{t('edit.noPages')}</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[132px_minmax(0,1fr)_260px]">
          {/* page strip */}
          <div className="flex gap-2 overflow-auto rounded-2xl border border-zinc-200 bg-white p-2 lg:max-h-[78vh] lg:flex-col dark:border-zinc-800 dark:bg-zinc-900">
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setCur(i)
                  setSelected(null)
                }}
                aria-current={i === cur}
                aria-label={t('edit.pageN', { n: i + 1 })}
                className={`relative shrink-0 rounded-lg p-1 transition-colors ${
                  i === cur ? 'bg-indigo-100 ring-2 ring-indigo-500 dark:bg-indigo-950' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {p.src === null ? (
                  <div className="rounded bg-white ring-1 ring-zinc-200 dark:ring-zinc-700" style={{ width: 100, height: (100 * dimsOf(p).h) / dimsOf(p).w }} />
                ) : (
                  <PdfThumb doc={doc} index={p.src} rotation={p.rotate} width={100} />
                )}
                <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 text-[11px] text-white">{i + 1}</span>
                {p.annots.length > 0 && <span className="absolute left-2 top-2 size-2 rounded-full bg-indigo-500" />}
              </button>
            ))}
          </div>

          {/* page */}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="px-2 text-sm font-medium tabular-nums">
                {cur + 1} / {pages.length}
              </span>
              <Button size="sm" variant="ghost" onClick={() => rotatePage(false)} title={t('edit.rotateLeft')} aria-label={t('edit.rotateLeft')}>
                ⟲
              </Button>
              <Button size="sm" variant="ghost" onClick={() => rotatePage(true)} title={t('edit.rotateRight')} aria-label={t('edit.rotateRight')}>
                ⟳
              </Button>
              <Button size="sm" variant="ghost" disabled={cur === 0} onClick={() => movePage(-1)} title={t('edit.moveUp')} aria-label={t('edit.moveUp')}>
                ▲
              </Button>
              <Button size="sm" variant="ghost" disabled={cur === pages.length - 1} onClick={() => movePage(1)} title={t('edit.moveDown')} aria-label={t('edit.moveDown')}>
                ▼
              </Button>
              <Button size="sm" variant="ghost" onClick={addBlank} title={t('edit.addBlank')} aria-label={t('edit.addBlank')}>
                + ▫
              </Button>
              <Button size="sm" variant="danger" onClick={deletePage} title={t('edit.deletePage')} aria-label={t('edit.deletePage')}>
                ✕
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))} aria-label={t('edit.zoomOut')} title={t('edit.zoomOut')}>
                  −
                </Button>
                <button type="button" onClick={() => setZoom(1)} className="w-12 text-center text-xs tabular-nums text-zinc-600 dark:text-zinc-300" title={t('edit.fit')}>
                  {Math.round(zoom * 100)}%
                </button>
                <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))} aria-label={t('edit.zoomIn')} title={t('edit.zoomIn')}>
                  +
                </Button>
              </div>
            </div>

            <div ref={main} className="max-h-[78vh] overflow-auto rounded-2xl bg-zinc-200/70 p-4 dark:bg-zinc-800/60">
              {page && base ? (
                <PageView
                  key={page.id}
                  doc={doc}
                  ep={page}
                  base={page.src === null ? null : base[page.src]}
                  dims={dimsOf(page)}
                  width={fitW * zoom}
                  tool={tool}
                  selected={selected}
                  onSelect={setSelected}
                  onTool={setTool}
                  begin={h.begin}
                  abort={h.abort}
                  addAnnot={addAnnot}
                  patchAnnot={patchAnnot}
                />
              ) : (
                <ProgressBar label={t('loading')} />
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('edit.hintOverlay')}</p>
          </div>

          {/* properties */}
          <Card className="space-y-4 self-start !p-4">
            {selectedAnnot ? (
              <Properties annot={selectedAnnot} patch={(p, key) => patchAnnot(selectedAnnot.id, p, key)} onDelete={() => removeAnnot(selectedAnnot.id)} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('edit.nothingSelected')}</p>
            )}
          </Card>
        </div>
      )}

      {err && <Alert>{err}</Alert>}

      <Card>
        {busy ? (
          <ProgressBar label={t('working')} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" disabled={pages.length === 0} onClick={run}>
              {t('edit.export')}
            </Button>
            {result && (
              <Button size="lg" onClick={() => downloadPdf(result, `${baseName(file.name)}-edited.pdf`)}>
                {t('download')} · {formatBytes(result.length)}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---- page canvas + annotation layer ------------------------------------------

type Drag =
  | { kind: 'rect'; id: string; x0: number; y0: number }
  | { kind: 'pen'; id: string }
  | { kind: 'move'; id: string; sx: number; sy: number; orig: Annot }
  | { kind: 'resize'; id: string; sx: number; sy: number; orig: RectAnnot | ImageAnnot }

function PageView({
  doc,
  ep,
  base,
  dims,
  width,
  tool,
  selected,
  onSelect,
  onTool,
  begin,
  abort,
  addAnnot,
  patchAnnot,
}: {
  doc: PDFDocumentProxy
  ep: EditPage
  base: Base | null
  dims: { w: number; h: number }
  width: number
  tool: Tool
  selected: string | null
  onSelect: (id: string | null) => void
  onTool: (t: Tool) => void
  begin: () => void
  abort: () => void
  addAnnot: (a: Annot | Annot[], mode?: boolean | string) => void
  patchAnnot: <T extends Annot>(id: string, patch: Partial<T>, mode?: boolean | string) => void
}) {
  const { t } = useI18n()
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const scale = width / dims.w
  const height = dims.h * scale
  const [segs, setSegs] = useState<TextSeg[] | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [, setFontTick] = useState(0)

  // Load the web fonts used by this page's text so the preview matches the exported PDF.
  const fontKeys = ep.annots.flatMap((a) => (a.type === 'text' ? [`${a.font}:${a.bold}:${a.italic}`] : [])).join('|')
  useEffect(() => {
    let dead = false
    const jobs = ep.annots.flatMap((a) => (a.type === 'text' ? [loadFont(a.font, a.bold, a.italic)] : []))
    Promise.all(jobs)
      .then(() => !dead && setFontTick((n) => n + 1))
      .catch(() => {})
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKeys])

  // Existing text is only read while the "Edit text" tool is active.
  useEffect(() => {
    if (tool !== 'edittext' || ep.src === null || !base) return
    let dead = false
    setSegs(null)
    getTextSegments(doc, ep.src, (base.rot + ep.rotate) % 360)
      .then((r) => !dead && setSegs(r))
      .catch((e) => !dead && (console.error(e), setSegs([])))
    return () => {
      dead = true
    }
  }, [tool, doc, ep.src, ep.rotate, base])

  /** Finds the page background colour around a text box and the colour of its glyphs. */
  const sampleColors = (s: TextSeg): { bg: string; fg: string } => {
    const c = canvas.current
    const ctx = c?.getContext('2d', { willReadFrequently: true })
    if (!c || !ctx) return { bg: '#ffffff', fg: '#000000' }
    const k = c.width / dims.w // canvas pixels per point
    const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    try {
      const top = s.baseline - s.size * 0.9
      const mid = s.baseline - s.size * 0.3
      const points: [number, number][] = [
        [s.x - 2, mid],
        [s.x + s.width + 2, mid],
        [s.x + s.width / 2, top - 1.5],
        [s.x + s.width / 2, s.baseline + s.size * 0.3],
      ]
      const votes = new Map<string, { n: number; rgb: number[] }>()
      for (const [px, py] of points) {
        const x = Math.max(0, Math.min(c.width - 1, Math.round(px * k)))
        const y = Math.max(0, Math.min(c.height - 1, Math.round(py * k)))
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
        const key = `${r >> 4},${g >> 4},${b >> 4}`
        const v = votes.get(key) ?? { n: 0, rgb: [r, g, b] }
        v.n++
        votes.set(key, v)
      }
      const bg = [...votes.values()].sort((a, b) => b.n - a.n)[0].rgb
      // Glyph colour = the pixel inside the box that differs most from the background.
      const bx = Math.max(0, Math.floor(s.x * k))
      const by = Math.max(0, Math.floor(top * k))
      const bw = Math.max(1, Math.min(c.width - bx, Math.ceil(s.width * k)))
      const bh = Math.max(1, Math.min(c.height - by, Math.ceil(s.size * 1.1 * k)))
      const px = ctx.getImageData(bx, by, bw, bh).data
      let best = 0
      let fg = [0, 0, 0]
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2])
        if (d > best) {
          best = d
          fg = [px[i], px[i + 1], px[i + 2]]
        }
      }
      if (best < 120) {
        const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
        fg = lum < 128 ? [255, 255, 255] : [0, 0, 0]
      }
      return { bg: hex(bg[0], bg[1], bg[2]), fg: hex(fg[0], fg[1], fg[2]) }
    } catch {
      return { bg: '#ffffff', fg: '#000000' }
    }
  }

  /** Covers the original text with its own background colour and drops an editable copy on top. */
  const editSeg = async (s: TextSeg) => {
    const { bg, fg } = sampleColors(s)
    await loadFont(s.font, s.bold, s.italic)
    const cover: RectAnnot = {
      id: newId('a'),
      type: 'rect',
      x: s.x - 1.5,
      y: s.baseline - s.size * 0.92 - 1,
      w: s.width + 3,
      h: s.size * 1.15 + 2,
      color: bg,
      opacity: 1,
    }
    const text: TextAnnot = {
      id: newId('a'),
      type: 'text',
      x: s.x,
      y: s.baseline - s.size * baselineRatio(s.font, s.bold, s.italic, LINE_HEIGHT),
      text: s.str,
      size: Math.round(s.size * 10) / 10,
      color: fg,
      font: s.font,
      bold: s.bold,
      italic: s.italic,
    }
    addAnnot([cover, text])
    onSelect(text.id)
    onTool('select')
  }

  useEffect(() => {
    if (ep.src === null || !base || !canvas.current) return
    let dead = false
    let task: { cancel: () => void } | null = null
    renderPage(doc, ep.src, canvas.current, width, (base.rot + ep.rotate) % 360)
      .then((r) => {
        r.task.promise.catch((e) => !isRenderCancelled(e) && console.error(e))
        if (dead) r.task.cancel()
        else task = r.task
      })
      .catch((e) => !dead && console.error(e))
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, ep.src, ep.rotate, base, width])

  const toPt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = layer.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]
  }

  const onLayerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || tool === 'image' || tool === 'edittext') return
    if (tool === 'select') return onSelect(null)
    const [x, y] = toPt(e)
    if (tool === 'text') {
      const a: TextAnnot = {
        id: newId('a'),
        type: 'text',
        x,
        y,
        text: t('edit.defaultText'),
        size: 16,
        color: '#111827',
        font: DEFAULT_FONT,
        bold: false,
        italic: false,
      }
      addAnnot(a)
      onSelect(a.id)
      onTool('select')
      return
    }
    layer.current!.setPointerCapture(e.pointerId)
    begin()
    if (tool === 'pen') {
      const a: PenAnnot = { id: newId('a'), type: 'pen', points: [[x, y]], color: '#111827', width: 2 }
      addAnnot(a, false)
      drag.current = { kind: 'pen', id: a.id }
    } else {
      const hl = tool === 'highlight'
      const a: RectAnnot = {
        id: newId('a'),
        type: 'rect',
        x,
        y,
        w: 0,
        h: 0,
        color: hl ? '#facc15' : '#ffffff',
        opacity: hl ? 0.35 : 1,
      }
      addAnnot(a, false)
      drag.current = { kind: 'rect', id: a.id, x0: x, y0: y }
    }
  }

  const startMove = (e: React.PointerEvent, a: Annot) => {
    if (tool !== 'select' || e.button !== 0) return
    e.stopPropagation()
    onSelect(a.id)
    begin()
    const [sx, sy] = toPt(e)
    drag.current = { kind: 'move', id: a.id, sx, sy, orig: a }
    layer.current!.setPointerCapture(e.pointerId)
  }

  const startResize = (e: React.PointerEvent, a: RectAnnot | ImageAnnot) => {
    e.stopPropagation()
    begin()
    const [sx, sy] = toPt(e)
    drag.current = { kind: 'resize', id: a.id, sx, sy, orig: a }
    layer.current!.setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const [x, y] = toPt(e)
    if (d.kind === 'rect') {
      patchAnnot<RectAnnot>(d.id, { x: Math.min(x, d.x0), y: Math.min(y, d.y0), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) }, false)
    } else if (d.kind === 'pen') {
      const a = ep.annots.find((q) => q.id === d.id) as PenAnnot | undefined
      if (!a) return
      const lp = a.points[a.points.length - 1]
      if (Math.hypot(lp[0] - x, lp[1] - y) * scale > 1.5) patchAnnot<PenAnnot>(d.id, { points: [...a.points, [x, y]] }, false)
    } else if (d.kind === 'move') {
      const dx = x - d.sx
      const dy = y - d.sy
      const o = d.orig
      if (o.type === 'pen') patchAnnot<PenAnnot>(d.id, { points: o.points.map(([px, py]) => [px + dx, py + dy]) }, false)
      else patchAnnot<Annot>(d.id, { x: o.x + dx, y: o.y + dy }, false)
    } else {
      const o = d.orig
      const w = Math.max(8, o.w + (x - d.sx))
      if (o.type === 'image') patchAnnot<ImageAnnot>(d.id, { w, h: (w * o.h) / o.w }, false)
      else patchAnnot<RectAnnot>(d.id, { w, h: Math.max(8, o.h + (y - d.sy)) }, false)
    }
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'rect') {
      const a = ep.annots.find((q) => q.id === d.id) as RectAnnot | undefined
      if (!a || a.w < 3 || a.h < 3) return abort()
      onSelect(a.id)
      onTool('select')
    } else if (d.kind === 'pen') {
      const a = ep.annots.find((q) => q.id === d.id) as PenAnnot | undefined
      if (a && a.points.length === 1) patchAnnot<PenAnnot>(d.id, { points: [a.points[0], [a.points[0][0] + 0.01, a.points[0][1]]] }, false)
      onSelect(d.id)
    }
  }

  const sel = (id: string) => (id === selected ? { outline: '1.5px dashed #6366f1', outlineOffset: 2 } : undefined)

  return (
    <div className="mx-auto" style={{ width, height }}>
      <div className="relative bg-white shadow-lg" style={{ width, height }}>
        {ep.src !== null && <canvas ref={canvas} className="absolute inset-0 block" />}
        <div
          ref={layer}
          className="absolute inset-0 select-none overflow-hidden"
          style={{ cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair', touchAction: tool === 'select' ? 'auto' : 'none' }}
          onPointerDown={onLayerDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {tool === 'edittext' &&
            segs?.map((s, i) => (
              <div
                key={`seg${i}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  editSeg(s)
                }}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                className="absolute rounded-sm"
                style={{
                  left: (s.x - 1.5) * scale,
                  top: (s.baseline - s.size * 0.92 - 1) * scale,
                  width: (s.width + 3) * scale,
                  height: (s.size * 1.15 + 2) * scale,
                  cursor: 'text',
                  outline: hover === i ? '2px solid #6366f1' : '1px dashed rgba(99,102,241,0.45)',
                  background: hover === i ? 'rgba(99,102,241,0.12)' : 'transparent',
                }}
              />
            ))}
          {tool === 'edittext' && (ep.src === null || segs?.length === 0) && (
            <div className="absolute left-2 right-2 top-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">{t('edit.noText')}</div>
          )}
          {ep.annots.map((a) => {
            const pe = tool === 'select' ? 'auto' : 'none'
            if (a.type === 'text') {
              return (
                <div
                  key={a.id}
                  onPointerDown={(e) => startMove(e, a)}
                  className="absolute whitespace-pre"
                  style={{
                    left: a.x * scale,
                    top: a.y * scale,
                    fontSize: a.size * scale,
                    lineHeight: LINE_HEIGHT,
                    color: a.color,
                    fontFamily: cssFamily(a.font),
                    fontWeight: a.bold ? 700 : 400,
                    fontStyle: effectiveItalic(a.font, a.italic) ? 'italic' : 'normal',
                    cursor: tool === 'select' ? 'move' : undefined,
                    pointerEvents: pe,
                    touchAction: 'none',
                    ...sel(a.id),
                  }}
                >
                  {a.text}
                </div>
              )
            }
            if (a.type === 'rect' || a.type === 'image') {
              return (
                <div key={a.id}>
                  {a.type === 'rect' ? (
                    <div
                      onPointerDown={(e) => startMove(e, a)}
                      className="absolute"
                      style={{
                        left: a.x * scale,
                        top: a.y * scale,
                        width: a.w * scale,
                        height: a.h * scale,
                        background: a.color,
                        opacity: a.opacity,
                        cursor: tool === 'select' ? 'move' : undefined,
                        pointerEvents: pe,
                        touchAction: 'none',
                        ...sel(a.id),
                      }}
                    />
                  ) : (
                    <img
                      src={a.url}
                      alt=""
                      draggable={false}
                      onPointerDown={(e) => startMove(e, a)}
                      className="absolute"
                      style={{
                        left: a.x * scale,
                        top: a.y * scale,
                        width: a.w * scale,
                        height: a.h * scale,
                        cursor: tool === 'select' ? 'move' : undefined,
                        pointerEvents: pe,
                        touchAction: 'none',
                        ...sel(a.id),
                      }}
                    />
                  )}
                  {a.id === selected && tool === 'select' && (
                    <div
                      onPointerDown={(e) => startResize(e, a)}
                      className="absolute size-3 rounded-sm border-2 border-white bg-indigo-600"
                      style={{ left: (a.x + a.w) * scale - 6, top: (a.y + a.h) * scale - 6, cursor: 'nwse-resize', touchAction: 'none' }}
                    />
                  )}
                </div>
              )
            }
            const pts = a.points.map(([x, y]) => `${x * scale},${y * scale}`).join(' ')
            return (
              <svg key={a.id} className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
                {a.id === selected && (
                  <polyline points={pts} fill="none" stroke="#6366f1" strokeOpacity={0.35} strokeWidth={a.width * scale + 6} strokeLinecap="round" strokeLinejoin="round" />
                )}
                <polyline points={pts} fill="none" stroke={a.color} strokeWidth={a.width * scale} strokeLinecap="round" strokeLinejoin="round" />
                <polyline
                  points={pts}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(a.width * scale, 14)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ pointerEvents: tool === 'select' ? 'stroke' : 'none', cursor: 'move', touchAction: 'none' }}
                  onPointerDown={(e) => startMove(e, a)}
                />
              </svg>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---- properties panel ----------------------------------------------------------

function Properties({
  annot,
  patch,
  onDelete,
}: {
  annot: Annot
  patch: (p: Partial<Annot>, mode?: string) => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const ta = useRef<HTMLTextAreaElement>(null)
  const id = annot.id
  const isText = annot.type === 'text'
  useEffect(() => {
    if (isText) {
      ta.current?.focus()
      ta.current?.select()
    }
  }, [id, isText])
  const k = (f: string) => `${id}:${f}`

  return (
    <div className="space-y-4">
      {annot.type === 'text' && (
        <>
          <label className="block">
            <Label>{t('edit.textContent')}</Label>
            <textarea ref={ta} rows={3} className={inputCls} value={annot.text} onChange={(e) => patch({ text: e.target.value }, k('text'))} />
          </label>
          <label className="block">
            <Label>{t('edit.font')}</Label>
            <select className={inputCls} value={annot.font} onChange={(e) => patch({ font: e.target.value as FontId })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            {fontDef(annot.font).label !== fontDef(annot.font).note && (
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('edit.fontEmbedded', { name: fontDef(annot.font).note })}</div>
            )}
          </label>
          <Slider label={t('edit.fontSize')} value={annot.size} min={6} max={120} unit="pt" onChange={(v) => patch({ size: v }, k('size'))} />
          <div className="flex gap-4">
            <Checkbox checked={annot.bold} onChange={(v) => patch({ bold: v })}>
              {t('wm.bold')}
            </Checkbox>
            <Checkbox checked={effectiveItalic(annot.font, annot.italic)} disabled={!fontDef(annot.font).hasItalic} onChange={(v) => patch({ italic: v })}>
              {t('edit.italic')}
            </Checkbox>
          </div>
          <ColorInput label={t('edit.color')} value={annot.color} onChange={(v) => patch({ color: v }, k('color'))} />
        </>
      )}
      {annot.type === 'rect' && (
        <>
          <ColorInput label={t('edit.color')} value={annot.color} onChange={(v) => patch({ color: v }, k('color'))} />
          <Slider label={t('edit.opacity')} value={Math.round(annot.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => patch({ opacity: v / 100 }, k('opacity'))} />
        </>
      )}
      {annot.type === 'pen' && (
        <>
          <ColorInput label={t('edit.color')} value={annot.color} onChange={(v) => patch({ color: v }, k('color'))} />
          <Slider label={t('edit.penWidth')} value={annot.width} min={1} max={12} step={0.5} unit="pt" onChange={(v) => patch({ width: v }, k('width'))} />
        </>
      )}
      <Button variant="danger" className="w-full" onClick={onDelete}>
        {t('edit.delete')}
      </Button>
    </div>
  )
}
