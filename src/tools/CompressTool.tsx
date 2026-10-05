import { useCallback, useRef, useState } from 'react'
import { useI18n, type Key } from '../i18n'
import { baseName, downloadBlob, downloadPdf, formatBytes, isPdf, readBytes, zipFiles } from '../lib/format'
import { STRONGER, compressPdf, type CompressJob, type CompressLevel } from '../lib/compress'
import { isAbort } from '../lib/pdf'
import { Dropzone } from '../components/Dropzone'
import { Alert, Button, Card, Checkbox, Label, ProgressBar } from '../components/ui'
import { errText } from '../components/errText'

interface Item {
  id: number
  name: string
  bytes: Uint8Array
  status: 'idle' | 'running' | 'done' | 'error'
  progress?: { page: number; total: number }
  result?: { bytes: Uint8Array; level: CompressLevel; fellBack: boolean; kept: boolean }
  error?: string
}

const LEVELS: CompressLevel[] = ['light', 'recommended', 'extreme']
/** A result must be at least 3% smaller to count as a real gain. */
const MIN_GAIN = 0.97

let nextId = 1

export default function CompressTool() {
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>([])
  const [level, setLevel] = useState<CompressLevel>('recommended')
  const [gray, setGray] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const job = useRef<CompressJob | null>(null)
  const cancelled = useRef(false)

  const patch = useCallback((id: number, p: Partial<Item>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))
  }, [])

  const add = async (files: File[]) => {
    setNotice(null)
    const pdfs = files.filter(isPdf)
    if (pdfs.length < files.length) setNotice(t('err.notPdf'))
    const loaded = await Promise.all(
      pdfs.map(async (f) => ({
        id: nextId++,
        name: f.name,
        bytes: await readBytes(f),
        status: 'idle' as const,
      })),
    )
    setItems((list) => [...list, ...loaded])
  }

  const compressItem = async (it: Item) => {
    patch(it.id, { status: 'running', progress: undefined, error: undefined, result: undefined })
    let lv: CompressLevel | null = level
    let smallest: { bytes: Uint8Array; level: CompressLevel } | null = null
    try {
      while (lv) {
        const current: CompressLevel = lv
        job.current = compressPdf(it.bytes, { level: current, grayscale: gray }, (page, total) =>
          patch(it.id, { progress: total ? { page, total } : undefined }),
        )
        const out = await job.current.promise
        if (!smallest || out.length < smallest.bytes.length) smallest = { bytes: out, level: current }
        if (out.length < it.bytes.length * MIN_GAIN) break
        lv = STRONGER[current]
        patch(it.id, { progress: undefined })
      }
      if (smallest && smallest.bytes.length < it.bytes.length) {
        patch(it.id, {
          status: 'done',
          result: { bytes: smallest.bytes, level: smallest.level, fellBack: smallest.level !== level, kept: false },
        })
      } else {
        patch(it.id, { status: 'done', result: { bytes: it.bytes, level, fellBack: false, kept: true } })
      }
    } catch (e) {
      patch(it.id, { status: isAbort(e) ? 'idle' : 'error', error: isAbort(e) ? undefined : errText(t, e) })
      if (isAbort(e)) throw e
    } finally {
      job.current = null
    }
  }

  const run = async () => {
    setBusy(true)
    cancelled.current = false
    try {
      for (const it of items) {
        if (cancelled.current) break
        await compressItem(it)
      }
    } catch {
      /* cancelled */
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    cancelled.current = true
    job.current?.cancel()
  }

  const remove = (id: number) => setItems((l) => l.filter((x) => x.id !== id))
  const outName = (it: Item) => `${baseName(it.name)}-compressed.pdf`
  const done = items.filter((i) => i.status === 'done' && i.result && !i.result.kept)

  const downloadZip = async () => {
    const blob = await zipFiles(done.map((i) => ({ name: outName(i), data: i.result!.bytes })))
    downloadBlob(blob, 'compressed-pdfs.zip')
  }

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <Dropzone accept="application/pdf,.pdf" multiple onFiles={add} title={t('dropPdfs')} />
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((it) => (
              <li key={it.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.name}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(it.bytes.length)}</div>
                  </div>
                  {it.status === 'done' && it.result && !it.result.kept && (
                    <>
                      <div className="text-right text-sm">
                        <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {t('compress.saved', { pct: Math.round((1 - it.result.bytes.length / it.bytes.length) * 100) })}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {t('compress.result', {
                            from: formatBytes(it.bytes.length),
                            to: formatBytes(it.result.bytes.length),
                          })}
                        </div>
                      </div>
                      <Button variant="primary" size="sm" onClick={() => downloadPdf(it.result!.bytes, outName(it))}>
                        {t('download')}
                      </Button>
                    </>
                  )}
                  {it.status !== 'running' && !busy && (
                    <Button variant="ghost" size="sm" onClick={() => remove(it.id)} aria-label={t('remove')} title={t('remove')}>
                      ✕
                    </Button>
                  )}
                </div>
                {it.status === 'running' && (
                  <div className="mt-2">
                    <ProgressBar
                      value={it.progress ? it.progress.page / it.progress.total : undefined}
                      label={
                        it.progress
                          ? t('compress.progress', { page: it.progress.page, total: it.progress.total })
                          : t('compress.preparing')
                      }
                    />
                  </div>
                )}
                {it.status === 'error' && (
                  <div className="mt-2">
                    <Alert>{it.error}</Alert>
                  </div>
                )}
                {it.status === 'done' && it.result?.kept && (
                  <div className="mt-2">
                    <Alert kind="info">
                      {t('compress.noGain')}{' '}
                      <button className="font-medium underline" onClick={() => downloadPdf(it.bytes, it.name)}>
                        {t('compress.keepOriginal')}
                      </button>
                    </Alert>
                  </div>
                )}
                {it.status === 'done' && it.result?.fellBack && (
                  <div className="mt-2">
                    <Alert kind="info">
                      {t('compress.fallback', { level: t(`compress.${it.result.level}` as Key) })}
                    </Alert>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!busy && (
            <div className="mt-4">
              <Dropzone accept="application/pdf,.pdf" multiple onFiles={add} compact title={t('merge.add')} />
            </div>
          )}
        </Card>
      )}

      {notice && <Alert>{notice}</Alert>}

      {items.length > 0 && (
        <Card>
          <Label>{t('compress.level')}</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {LEVELS.map((lv) => (
              <label
                key={lv}
                className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                  level === lv
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                }`}
              >
                <input
                  type="radio"
                  name="level"
                  className="sr-only"
                  checked={level === lv}
                  disabled={busy}
                  onChange={() => setLevel(lv)}
                />
                <div className="text-sm font-semibold">{t(`compress.${lv}` as Key)}</div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t(`compress.${lv}.desc` as Key)}</div>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <Checkbox checked={gray} onChange={setGray}>
              {t('compress.gray')}
            </Checkbox>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {busy ? (
              <Button variant="secondary" size="lg" onClick={cancel}>
                {t('cancel')}
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={run}>
                {items.length > 1 ? t('compress.startN', { n: items.length }) : t('compress.start')}
              </Button>
            )}
            {done.length > 1 && !busy && (
              <Button size="lg" onClick={downloadZip}>
                {t('downloadAll')}
              </Button>
            )}
            {items.length > 0 && !busy && (
              <Button variant="ghost" onClick={() => setItems([])}>
                {t('clear')}
              </Button>
            )}
          </div>
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{t('compress.hint')}</p>
        </Card>
      )}
    </div>
  )
}
