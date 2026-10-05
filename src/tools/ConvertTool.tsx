import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, type Key } from '../i18n'
import { baseName, downloadBlob, downloadPdf, formatBytes, parseRanges, readBytes, zipFiles } from '../lib/format'
import { imageMime, isImage } from '../lib/images'
import { imagesToPdf, type PageSizeMode } from '../lib/ops/imagesToPdf'
import { pdfToImages, type ImageFormat, type RenderedPage } from '../lib/ops/pdfToImages'
import { Dropzone } from '../components/Dropzone'
import { usePdfDoc, useSinglePdf } from '../components/pdfHooks'
import { Alert, Button, Card, Checkbox, inputCls, Label, ProgressBar, Segmented, Slider } from '../components/ui'
import { errText } from '../components/errText'

type Mode = 'img2pdf' | 'pdf2img'

export default function ConvertTool() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('img2pdf')
  return (
    <div className="space-y-5">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'img2pdf', label: t('convert.imgToPdf') },
          { value: 'pdf2img', label: t('convert.pdfToImg') },
        ]}
      />
      {/* Both stay mounted so switching direction keeps your files. */}
      <div hidden={mode !== 'img2pdf'}>
        <ImagesToPdf />
      </div>
      <div hidden={mode !== 'pdf2img'}>
        <PdfToImages />
      </div>
    </div>
  )
}

// ---- Image -> PDF ------------------------------------------------------------

interface Img {
  id: number
  name: string
  bytes: Uint8Array
  mime: string
  url: string
}
let nextId = 1

function ImagesToPdf() {
  const { t } = useI18n()
  const [items, setItems] = useState<Img[]>([])
  const [pageSize, setPageSize] = useState<PageSizeMode>('auto')
  const [margin, setMargin] = useState(24)
  const [optimize, setOptimize] = useState(true)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const urls = useRef<string[]>([])

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const add = async (files: File[]) => {
    setError(null)
    setResult(null)
    const next: Img[] = []
    for (const f of files) {
      if (!isImage(f)) {
        setError(t('convert.notImage'))
        continue
      }
      const bytes = await readBytes(f)
      const mime = imageMime(f)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
      urls.current.push(url)
      next.push({ id: nextId++, name: f.name, bytes, mime, url })
    }
    setItems((l) => [...l, ...next])
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    setResult(null)
    setItems((l) => {
      const c = [...l]
      const [x] = c.splice(from, 1)
      c.splice(to, 0, x)
      return c
    })
  }

  const run = async () => {
    setError(null)
    setBusy({ done: 0, total: items.length })
    try {
      setResult(await imagesToPdf(items, { pageSize, margin, optimize }, (done, total) => setBusy({ done, total })))
    } catch (e) {
      setError(errText(t, e))
    } finally {
      setBusy(null)
    }
  }

  const name = items.length ? `${baseName(items[0].name)}.pdf` : 'images.pdf'

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <Dropzone accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" multiple onFiles={add} title={t('convert.dropImages')} hint={t('convert.dropImagesHint')} />
      ) : (
        <Card>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li
                key={it.id}
                draggable={!busy}
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null) move(dragFrom, i)
                  setDragFrom(null)
                }}
                className={`flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/50 ${dragFrom === i ? 'opacity-50' : ''}`}
              >
                <span className="cursor-grab select-none text-zinc-400" aria-hidden>
                  ⠿
                </span>
                <img src={it.url} alt="" className="size-12 shrink-0 rounded-md object-cover ring-1 ring-zinc-200 dark:ring-zinc-700" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {i + 1}. {it.name}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(it.bytes.length)}</div>
                </div>
                <Button variant="ghost" size="sm" disabled={i === 0 || !!busy} onClick={() => move(i, i - 1)} aria-label={t('merge.up')} title={t('merge.up')}>
                  ▲
                </Button>
                <Button variant="ghost" size="sm" disabled={i === items.length - 1 || !!busy} onClick={() => move(i, i + 1)} aria-label={t('merge.down')} title={t('merge.down')}>
                  ▼
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => {
                    setResult(null)
                    setItems((l) => l.filter((x) => x.id !== it.id))
                  }}
                  aria-label={t('remove')}
                  title={t('remove')}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Dropzone accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" multiple onFiles={add} compact title={t('merge.add')} hint={t('convert.dropImagesHint')} />
          </div>
        </Card>
      )}

      {items.length > 0 && (
        <Card className="space-y-5">
          <div>
            <Label>{t('convert.pageSize')}</Label>
            <Segmented
              value={pageSize}
              onChange={(v) => {
                setPageSize(v)
                setResult(null)
              }}
              options={[
                { value: 'auto', label: t('convert.sizeAuto') },
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'Letter' },
              ]}
            />
          </div>
          {pageSize !== 'auto' && (
            <Slider label={t('convert.margin')} value={margin} min={0} max={72} unit="pt" onChange={(v) => { setMargin(v); setResult(null) }} />
          )}
          <Checkbox checked={optimize} onChange={(v) => { setOptimize(v); setResult(null) }}>
            {t('convert.optimize')}
          </Checkbox>

          {error && <Alert>{error}</Alert>}
          {busy ? (
            <ProgressBar value={busy.done / busy.total} label={t('working')} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={run}>
                {t('convert.createPdf', { n: items.length })}
              </Button>
              {result && (
                <Button size="lg" onClick={() => downloadPdf(result, name)}>
                  {t('download')} · {formatBytes(result.length)}
                </Button>
              )}
              <Button variant="ghost" onClick={() => { setItems([]); setResult(null) }}>
                {t('clear')}
              </Button>
            </div>
          )}
        </Card>
      )}
      {items.length === 0 && error && <Alert>{error}</Alert>}
    </div>
  )
}

// ---- PDF -> Image ------------------------------------------------------------

interface Out extends RenderedPage {
  name: string
  url: string
}

function PdfToImages() {
  const { t } = useI18n()
  const { file, error, loading, load, reset, setError } = useSinglePdf()
  const { doc } = usePdfDoc(file?.bytes ?? null)
  const [format, setFormat] = useState<ImageFormat>('png')
  const [dpi, setDpi] = useState(150)
  const [quality, setQuality] = useState(90)
  const [pagesMode, setPagesMode] = useState<'all' | 'custom'>('all')
  const [pagesText, setPagesText] = useState('')
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [outputs, setOutputs] = useState<Out[] | null>(null)

  const pages = useMemo<{ value: number[] } | { error: string }>(() => {
    if (!file) return { value: [] }
    if (pagesMode === 'all') return { value: Array.from({ length: file.pages }, (_, i) => i) }
    const r = parseRanges(pagesText, file.pages)
    return r.error ? { error: t(`err.range.${r.error}` as Key, { n: file.pages }) } : { value: [...new Set(r.groups.flat())].sort((a, b) => a - b) }
  }, [file, pagesMode, pagesText, t])

  const clearOutputs = () =>
    setOutputs((o) => {
      o?.forEach((x) => URL.revokeObjectURL(x.url))
      return null
    })
  useEffect(() => () => outputs?.forEach((x) => URL.revokeObjectURL(x.url)), [outputs])

  const run = async () => {
    if (!file || !doc || !('value' in pages)) return
    setError(null)
    clearOutputs()
    setBusy({ done: 0, total: pages.value.length })
    try {
      const ext = format === 'png' ? 'png' : 'jpg'
      const pad = String(file.pages).length
      const rendered = await pdfToImages(
        doc,
        pages.value,
        { dpi, format, quality: quality / 100 },
        (done, total) => setBusy({ done, total }),
      )
      setOutputs(
        rendered.map((r) => ({
          ...r,
          name: `${baseName(file.name)}-page-${String(r.index + 1).padStart(pad, '0')}.${ext}`,
          url: URL.createObjectURL(r.blob),
        })),
      )
    } catch (e) {
      setError(errText(t, e))
    } finally {
      setBusy(null)
    }
  }

  const downloadZip = async () => {
    if (!outputs || !file) return
    const files = await Promise.all(outputs.map(async (o) => ({ name: o.name, data: new Uint8Array(await o.blob.arrayBuffer()) })))
    downloadBlob(await zipFiles(files), `${baseName(file.name)}-images.zip`)
  }

  if (!file) {
    return (
      <div className="space-y-4">
        <Dropzone accept="application/pdf,.pdf" onFiles={load} />
        {loading && <ProgressBar label={t('loading')} />}
        {error && <Alert>{error}</Alert>}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {file.pages === 1 ? t('page1') : t('pages', { n: file.pages })} · {formatBytes(file.bytes.length)}
            </div>
          </div>
          <Button variant="ghost" onClick={() => { clearOutputs(); reset() }}>
            {t('changeFile')}
          </Button>
        </div>
      </Card>

      <Card className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label>{t('convert.format')}</Label>
            <Segmented
              value={format}
              onChange={(v) => { setFormat(v); clearOutputs() }}
              options={[
                { value: 'png', label: 'PNG', title: t('convert.pngHint') },
                { value: 'jpeg', label: 'JPG', title: t('convert.jpgHint') },
              ]}
            />
          </div>
          <label className="block">
            <Label>{t('convert.resolution')}</Label>
            <select className={inputCls} value={dpi} onChange={(e) => { setDpi(Number(e.target.value)); clearOutputs() }}>
              <option value={72}>72 dpi ({t('convert.dpiScreen')})</option>
              <option value={150}>150 dpi ({t('convert.dpiGood')})</option>
              <option value={200}>200 dpi</option>
              <option value={300}>300 dpi ({t('convert.dpiPrint')})</option>
            </select>
          </label>
        </div>
        {format === 'jpeg' && <Slider label={t('convert.quality')} value={quality} min={40} max={100} unit="%" onChange={(v) => { setQuality(v); clearOutputs() }} />}

        <div>
          <Label>{t('wm.applyTo')}</Label>
          <Segmented
            value={pagesMode}
            onChange={(v) => { setPagesMode(v); clearOutputs() }}
            options={[
              { value: 'all', label: t('wm.pagesAll') },
              { value: 'custom', label: t('wm.pagesCustom') },
            ]}
          />
          {pagesMode === 'custom' && (
            <input className={`${inputCls} mt-3`} value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder={t('wm.pagesPlaceholder')} />
          )}
        </div>

        {error && <Alert>{error}</Alert>}
        {'error' in pages && pagesText.trim() !== '' && <Alert>{pages.error}</Alert>}

        {busy ? (
          <ProgressBar value={busy.total ? busy.done / busy.total : undefined} label={t('compress.progress', { page: busy.done, total: busy.total })} />
        ) : (
          <Button variant="primary" size="lg" disabled={!doc || !('value' in pages) || pages.value.length === 0} onClick={run}>
            {t('convert.start')}
            {'value' in pages && pages.value.length > 0 && <span className="font-normal opacity-80">→ {t('convert.imagesOut', { n: pages.value.length })}</span>}
          </Button>
        )}
      </Card>

      {outputs && (
        <Card>
          {outputs.length > 1 && (
            <div className="mb-3">
              <Button variant="primary" onClick={downloadZip}>
                {t('downloadAll')}
              </Button>
            </div>
          )}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {outputs.map((o) => (
              <li key={o.name} className="flex items-center gap-3 py-2">
                <img src={o.url} alt="" className="h-14 w-11 shrink-0 rounded bg-white object-contain ring-1 ring-zinc-200 dark:ring-zinc-700" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{o.name}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {o.width}×{o.height}px · {formatBytes(o.blob.size)}
                  </div>
                </div>
                <Button size="sm" variant={outputs.length === 1 ? 'primary' : 'secondary'} onClick={() => downloadBlob(o.blob, o.name)}>
                  {t('download')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
