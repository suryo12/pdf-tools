import { useState } from 'react'
import { useI18n } from '../i18n'
import { downloadPdf, formatBytes, isPdf, readBytes } from '../lib/format'
import { mergeInputs } from '../lib/ops/merge'
import { pageCount } from '../lib/pdf'
import { Dropzone } from '../components/Dropzone'
import { Alert, Button, Card, ProgressBar } from '../components/ui'
import { errText } from '../components/errText'

interface Item {
  id: number
  name: string
  bytes: Uint8Array
  kind: 'pdf' | 'image'
  mime: string
  pages?: number
  error?: string
}

const IMAGE_RE = /^image\/(jpeg|png|webp|gif|bmp)$/
let nextId = 1

export default function MergeTool() {
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const add = async (files: File[]) => {
    setError(null)
    setResult(null)
    const next: Item[] = []
    for (const f of files) {
      const kind = isPdf(f) ? 'pdf' : IMAGE_RE.test(f.type) ? 'image' : null
      if (!kind) {
        setError(t('err.notPdf'))
        continue
      }
      const bytes = await readBytes(f)
      const it: Item = { id: nextId++, name: f.name, bytes, kind, mime: f.type }
      if (kind === 'pdf') {
        try {
          it.pages = await pageCount(bytes)
        } catch (e) {
          it.error = errText(t, e)
        }
      }
      next.push(it)
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
      const out = await mergeInputs(items, (done, total) => setBusy({ done, total }))
      setResult(out)
    } catch (e) {
      setError(errText(t, e))
    } finally {
      setBusy(null)
    }
  }

  const hasError = items.some((i) => i.error)
  const totalPages = items.reduce((n, i) => n + (i.kind === 'image' ? 1 : (i.pages ?? 0)), 0)

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <Dropzone
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          multiple
          onFiles={add}
          title={t('dropPdfs')}
          hint={t('merge.hint')}
        />
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
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                  it.error
                    ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                    : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50'
                } ${dragFrom === i ? 'opacity-50' : ''}`}
              >
                <span className="cursor-grab select-none text-zinc-400" aria-hidden>
                  ⠿
                </span>
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {it.error ?? (
                      <>
                        {it.kind === 'image' ? t('merge.image') : it.pages === 1 ? t('page1') : t('pages', { n: it.pages ?? '…' })}
                        {' · '}
                        {formatBytes(it.bytes.length)}
                      </>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" disabled={i === 0 || !!busy} onClick={() => move(i, i - 1)} title={t('merge.up')} aria-label={t('merge.up')}>
                  ▲
                </Button>
                <Button variant="ghost" size="sm" disabled={i === items.length - 1 || !!busy} onClick={() => move(i, i + 1)} title={t('merge.down')} aria-label={t('merge.down')}>
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
                  title={t('remove')}
                  aria-label={t('remove')}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Dropzone
              accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
              multiple
              onFiles={add}
              compact
              title={t('merge.add')}
              hint={t('merge.hint')}
            />
          </div>
        </Card>
      )}

      {error && <Alert>{error}</Alert>}
      {items.length === 1 && !error && <Alert kind="info">{t('merge.need2')}</Alert>}

      {items.length > 0 && (
        <Card>
          {busy ? (
            <ProgressBar value={busy.done / busy.total} label={t('working')} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" disabled={items.length < 2 || hasError} onClick={run}>
                {t('merge.start', { n: items.length })}
              </Button>
              {result && (
                <Button size="lg" onClick={() => downloadPdf(result, 'merged.pdf')}>
                  {t('download')} merged.pdf · {formatBytes(result.length)}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setItems([])
                  setResult(null)
                }}
              >
                {t('clear')}
              </Button>
              {totalPages > 0 && (
                <span className="ml-auto text-sm text-zinc-500 dark:text-zinc-400">{t('pages', { n: totalPages })}</span>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
