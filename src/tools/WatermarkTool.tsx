import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, type Key } from '../i18n'
import { DEFAULT_FONT, FONTS, type FontId } from '../lib/fonts'
import { baseName, downloadBlob, downloadPdf, formatBytes, isPdf, parseRanges, readBytes, zipFiles } from '../lib/format'
import { imageMime, isImage } from '../lib/images'
import { renderWatermarkedImage, watermarkImage } from '../lib/ops/watermarkImage'
import { applyWatermark, type WatermarkOptions, type WmPosition } from '../lib/ops/watermark'
import { isAbort, normalizeImage, type EmbeddableImage } from '../lib/pdf'
import { destroyPdf, openPdf, renderPage } from '../lib/pdfjs'
import { Dropzone } from '../components/Dropzone'
import { useSinglePdf } from '../components/pdfHooks'
import { Alert, Button, Card, Checkbox, ColorInput, inputCls, Label, ProgressBar, Segmented, Slider } from '../components/ui'
import { errText } from '../components/errText'

const GRID: WmPosition[] = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br']

export default function WatermarkTool() {
  const { t, lang } = useI18n()
  const { file, error, loading, load, reset, setError } = useSinglePdf()

  const [kind, setKind] = useState<'text' | 'image'>('text')
  const [text, setText] = useState(() => t('wm.textDefault'))
  const [font, setFont] = useState<FontId>(DEFAULT_FONT)
  const [fontSize, setFontSize] = useState(64)
  const [bold, setBold] = useState(true)
  const [color, setColor] = useState('#6b7280')
  const [image, setImage] = useState<(EmbeddableImage & { url: string }) | null>(null)
  const [imageScale, setImageScale] = useState(40)
  const [opacity, setOpacity] = useState(30)
  const [rotation, setRotation] = useState(45)
  const [position, setPosition] = useState<WmPosition>('c')
  const [tile, setTile] = useState(false)
  const [gap, setGap] = useState(40)
  const [pagesMode, setPagesMode] = useState<'all' | 'custom'>('all')
  const [pagesText, setPagesText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const imgCanvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)

  // Image mode: one or more JPG/PNG/WebP files instead of a PDF.
  const [images, setImages] = useState<{ name: string; bytes: Uint8Array; mime: string }[]>([])
  const [imgResults, setImgResults] = useState<{ name: string; blob: Blob }[] | null>(null)
  const imageMode = !file && images.length > 0

  const pickSource = async (files: File[]) => {
    const pdf = files.find(isPdf)
    if (pdf) return load([pdf])
    const imgs = files.filter(isImage)
    if (!imgs.length) return setError(t('err.notPdf'))
    setError(null)
    setImages(await Promise.all(imgs.map(async (f) => ({ name: f.name, bytes: await readBytes(f), mime: imageMime(f) }))))
  }
  const resetSource = () => {
    reset()
    setImages([])
    setImgResults(null)
  }

  // Default text follows the UI language until the user edits it.
  const edited = useRef(false)
  useEffect(() => {
    if (!edited.current) setText(t('wm.textDefault'))
  }, [lang, t])

  const pages = useMemo<{ value: number[] | 'all' } | { error: string }>(() => {
    if (pagesMode === 'all' || !file) return { value: 'all' }
    const r = parseRanges(pagesText, file.pages)
    return r.error ? { error: t(`err.range.${r.error}` as Key, { n: file.pages }) } : { value: [...new Set(r.groups.flat())] }
  }, [pagesMode, pagesText, file, t])

  const opts: WatermarkOptions = {
    kind,
    text,
    font,
    fontSize,
    bold,
    color,
    image,
    imageScale,
    opacity: opacity / 100,
    rotation,
    position: tile ? 'tile' : position,
    tileGap: gap,
    pages: 'value' in pages ? pages.value : 'all',
  }
  const ready = kind === 'text' ? text.trim() !== '' : !!image
  const optsKey = JSON.stringify({ ...opts, image: image?.url })

  // Live preview: watermark page 1 only, then render it with pdf.js. Debounced.
  useEffect(() => {
    if ((!file && !images.length) || !ready) return
    let dead = false
    const timer = setTimeout(async () => {
      try {
        if (!file) {
          const c = await renderWatermarkedImage(images[0], opts, 760)
          const dst = imgCanvas.current
          if (dead || !dst) return
          dst.width = c.width
          dst.height = c.height
          dst.getContext('2d')!.drawImage(c, 0, 0)
          setPreviewErr(null)
          return
        }
        const bytes = await applyWatermark(file.bytes, opts, { firstPageOnly: true })
        const doc = await openPdf(bytes)
        try {
          if (dead || !canvas.current) return
          const { task } = await renderPage(doc, 0, canvas.current, Math.max(160, Math.min(380, (wrap.current?.clientWidth ?? 380) - 24)))
          await task.promise
          if (!dead) setPreviewErr(null)
        } finally {
          void destroyPdf(doc)
        }
      } catch (e) {
        if (!dead && !isAbort(e)) setPreviewErr(errText(t, e))
      }
    }, 250)
    return () => {
      dead = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, images, optsKey, ready])

  useEffect(() => {
    setResult(null)
    setImgResults(null)
  }, [optsKey, file, images])

  const pickImage = async (files: File[]) => {
    const f = files[0]
    if (!f) return
    try {
      const raw = new Uint8Array(await f.arrayBuffer())
      const img = await normalizeImage(raw, f.type)
      if (image) URL.revokeObjectURL(image.url)
      setImage({ ...img, url: URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime })) })
    } catch (e) {
      setError(errText(t, e))
    }
  }

  const run = async () => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      setResult(await applyWatermark(file.bytes, opts))
    } catch (e) {
      setError(errText(t, e))
    } finally {
      setBusy(false)
    }
  }

  const runImages = async () => {
    setError(null)
    setBusy(true)
    try {
      const out: { name: string; blob: Blob }[] = []
      for (const img of images) {
        const r = await watermarkImage(img, opts)
        out.push({ name: `${baseName(img.name)}-watermarked.${r.ext}`, blob: r.blob })
      }
      setImgResults(out)
    } catch (e) {
      setError(errText(t, e))
    } finally {
      setBusy(false)
    }
  }

  const downloadImagesZip = async () => {
    if (!imgResults) return
    const files = await Promise.all(imgResults.map(async (o) => ({ name: o.name, data: new Uint8Array(await o.blob.arrayBuffer()) })))
    downloadBlob(await zipFiles(files), 'watermarked-images.zip')
  }

  if (!file && !imageMode) {
    return (
      <div className="space-y-4">
        <Dropzone accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" multiple onFiles={pickSource} title={t('wm.dropAny')} hint={t('wm.dropAnyHint')} />
        {loading && <ProgressBar label={t('loading')} />}
        {error && <Alert>{error}</Alert>}
      </div>
    )
  }

  const invalid = !ready || 'error' in pages

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <div className="space-y-5">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{file ? file.name : images.length === 1 ? images[0].name : t('wm.imagesCount', { n: images.length })}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {file
                  ? `${file.pages === 1 ? t('page1') : t('pages', { n: file.pages })} · ${formatBytes(file.bytes.length)}`
                  : formatBytes(images.reduce((n, i) => n + i.bytes.length, 0))}
              </div>
            </div>
            <Button variant="ghost" onClick={resetSource}>
              {t('changeFile')}
            </Button>
          </div>
        </Card>

        <Card className="space-y-5">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'text', label: t('wm.text') },
              { value: 'image', label: t('wm.image') },
            ]}
          />

          {kind === 'text' ? (
            <>
              <label className="block">
                <Label>{t('wm.textLabel')}</Label>
                <input
                  className={inputCls}
                  value={text}
                  onChange={(e) => {
                    edited.current = true
                    setText(e.target.value)
                  }}
                />
              </label>
              <label className="block">
                <Label>{t('edit.font')}</Label>
                <select className={inputCls} value={font} onChange={(e) => setFont(e.target.value as FontId)}>
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 items-end gap-4">
                <Slider label={t('wm.size')} value={fontSize} min={12} max={200} unit="pt" onChange={setFontSize} />
                <ColorInput label={t('wm.color')} value={color} onChange={setColor} />
              </div>
              <Checkbox checked={bold} onChange={setBold}>
                {t('wm.bold')}
              </Checkbox>
            </>
          ) : (
            <>
              {image ? (
                <div className="flex items-center gap-3">
                  <div className="checker grid size-16 place-items-center overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <img src={image.url} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                  <Button variant="ghost" onClick={() => setImage(null)}>
                    {t('remove')}
                  </Button>
                </div>
              ) : (
                <Dropzone accept="image/png,image/jpeg,image/webp" onFiles={pickImage} compact title={t('wm.chooseImage')} />
              )}
              <Slider label={t('wm.imageScale')} value={imageScale} min={5} max={100} unit="%" onChange={setImageScale} />
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Slider label={t('wm.opacity')} value={opacity} min={5} max={100} unit="%" onChange={setOpacity} />
            <Slider label={t('wm.rotation')} value={rotation} min={-180} max={180} unit="°" onChange={setRotation} />
          </div>

          <div className="flex flex-wrap gap-6">
            <div>
              <Label>{t('wm.position')}</Label>
              <div className={`grid w-28 grid-cols-3 gap-1 ${tile ? 'pointer-events-none opacity-40' : ''}`}>
                {GRID.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-label={p}
                    aria-pressed={!tile && position === p}
                    onClick={() => setPosition(p)}
                    className={`h-8 rounded-md border transition-colors ${
                      !tile && position === p
                        ? 'border-indigo-500 bg-indigo-500'
                        : 'border-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="min-w-48 flex-1 space-y-3 self-end">
              <Checkbox checked={tile} onChange={setTile}>
                {t('wm.tile')}
              </Checkbox>
              {tile && <Slider label={t('wm.gap')} value={gap} min={0} max={200} unit="pt" onChange={setGap} />}
            </div>
          </div>

          <div className={imageMode ? 'hidden' : ''}>
            <Label>{t('wm.applyTo')}</Label>
            <Segmented
              value={pagesMode}
              onChange={setPagesMode}
              options={[
                { value: 'all', label: t('wm.pagesAll') },
                { value: 'custom', label: t('wm.pagesCustom') },
              ]}
            />
            {pagesMode === 'custom' && (
              <input
                className={`${inputCls} mt-3`}
                value={pagesText}
                onChange={(e) => setPagesText(e.target.value)}
                placeholder={t('wm.pagesPlaceholder')}
              />
            )}
          </div>
        </Card>

        {error && <Alert>{error}</Alert>}
        {'error' in pages && pagesText.trim() !== '' && <Alert>{pages.error}</Alert>}
        {!ready && <Alert kind="info">{kind === 'text' ? t('wm.needText') : t('wm.needImage')}</Alert>}

        <Card>
          {busy ? (
            <ProgressBar label={t('working')} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" disabled={invalid} onClick={file ? run : runImages}>
                {file || images.length < 2 ? t('wm.start') : t('wm.startImages', { n: images.length })}
              </Button>
              {file && result && (
                <Button size="lg" onClick={() => downloadPdf(result, `${baseName(file.name)}-watermarked.pdf`)}>
                  {t('download')} · {formatBytes(result.length)}
                </Button>
              )}
              {imgResults && imgResults.length > 1 && (
                <Button size="lg" onClick={downloadImagesZip}>
                  {t('downloadAll')}
                </Button>
              )}
            </div>
          )}
          {imgResults && (
            <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
              {imgResults.map((o) => (
                <li key={o.name} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(o.blob.size)}</div>
                  </div>
                  <Button size="sm" variant={imgResults.length === 1 ? 'primary' : 'secondary'} onClick={() => downloadBlob(o.blob, o.name)}>
                    {t('download')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <Label>{imageMode ? t('wm.previewImage') : t('wm.preview')}</Label>
          <div ref={wrap} className="flex justify-center rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
            {imageMode ? (
              <canvas ref={imgCanvas} className="h-auto max-h-[70vh] max-w-full rounded bg-white shadow" />
            ) : (
              <canvas ref={canvas} className="max-w-full rounded bg-white shadow" />
            )}
          </div>
          {previewErr && (
            <div className="mt-3">
              <Alert>{previewErr}</Alert>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
