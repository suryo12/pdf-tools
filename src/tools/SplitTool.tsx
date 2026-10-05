import { useMemo, useState } from 'react'
import { useI18n, type Key } from '../i18n'
import { baseName, describeIndexes, downloadBlob, downloadPdf, formatBytes, parseRanges, zipFiles } from '../lib/format'
import { groupsEach, groupsEvery, splitByGroups } from '../lib/ops/split'
import { Dropzone } from '../components/Dropzone'
import { PdfThumb } from '../components/PdfThumb'
import { usePdfDoc, useSinglePdf } from '../components/pdfHooks'
import { Alert, Button, Card, Checkbox, inputCls, Label, ProgressBar, Segmented } from '../components/ui'
import { errText } from '../components/errText'

type Mode = 'ranges' | 'every' | 'each' | 'pick'

export default function SplitTool() {
  const { t } = useI18n()
  const { file, error, loading, load, reset, setError } = useSinglePdf()
  const { doc } = usePdfDoc(file?.bytes ?? null)

  const [mode, setMode] = useState<Mode>('ranges')
  const [rangeText, setRangeText] = useState('')
  const [oneFile, setOneFile] = useState(false)
  const [every, setEvery] = useState(1)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [outputs, setOutputs] = useState<{ name: string; data: Uint8Array }[] | null>(null)

  const total = file?.pages ?? 0

  // Resolve the current settings into groups of page indexes (or an error key).
  const plan = useMemo<{ groups: number[][] } | { error: string }>(() => {
    if (!total) return { groups: [] }
    if (mode === 'each') return { groups: groupsEach(total) }
    if (mode === 'every') return { groups: groupsEvery(Math.max(1, Math.floor(every) || 1), total) }
    if (mode === 'pick') {
      return picked.size ? { groups: [[...picked].sort((a, b) => a - b)] } : { error: t('err.pickNone') }
    }
    const r = parseRanges(rangeText, total)
    if (r.error) return { error: t(`err.range.${r.error}` as Key, { n: total }) }
    return { groups: oneFile ? [r.groups.flat()] : r.groups }
  }, [mode, every, picked, rangeText, oneFile, total, t])

  const covered = useMemo(() => {
    const s = new Set<number>()
    if ('groups' in plan) plan.groups.forEach((g) => g.forEach((i) => s.add(i)))
    return s
  }, [plan])

  const nameFor = (g: number[], n: number, count: number) =>
    count === 1 ? `${baseName(file!.name)}-${describeIndexes(g).replace(/, /g, '_')}.pdf` : `${baseName(file!.name)}-part${n + 1}-p${describeIndexes(g).replace(/, /g, '_')}.pdf`

  const run = async () => {
    if (!file || !('groups' in plan) || !plan.groups.length) return
    setError(null)
    setOutputs(null)
    setBusy({ done: 0, total: plan.groups.length })
    try {
      const datas = await splitByGroups(file.bytes, plan.groups, (done, total) => setBusy({ done, total }))
      setOutputs(datas.map((data, i) => ({ name: nameFor(plan.groups[i], i, datas.length), data })))
    } catch (e) {
      setError(errText(t, e))
    } finally {
      setBusy(null)
    }
  }

  const togglePage = (i: number) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  const downloadZip = async () => {
    if (outputs) downloadBlob(await zipFiles(outputs), `${baseName(file!.name)}-split.zip`)
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

  const modes: { value: Mode; label: string; title: string }[] = [
    { value: 'ranges', label: t('split.ranges'), title: t('split.ranges.desc') },
    { value: 'every', label: t('split.every'), title: t('split.every') },
    { value: 'each', label: t('split.each'), title: t('split.each') },
    { value: 'pick', label: t('split.pick'), title: t('split.pick.desc') },
  ]

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
          <Button variant="ghost" onClick={() => { reset(); setOutputs(null); setPicked(new Set()) }}>
            {t('changeFile')}
          </Button>
        </div>
      </Card>

      <Card>
        <Label>{t('split.mode')}</Label>
        <Segmented
          value={mode}
          options={modes}
          onChange={(m) => {
            setMode(m)
            setOutputs(null)
          }}
          className="flex-wrap"
        />

        <div className="mt-4 space-y-3">
          {mode === 'ranges' && (
            <>
              <label className="block">
                <Label>{t('split.rangesLabel')}</Label>
                <input
                  className={inputCls}
                  value={rangeText}
                  onChange={(e) => setRangeText(e.target.value)}
                  placeholder="1-3, 5, 8-"
                  inputMode="text"
                />
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('split.rangesHelp')}</p>
              <Checkbox checked={oneFile} onChange={setOneFile}>
                {t('split.mergeRanges')}
              </Checkbox>
            </>
          )}
          {mode === 'every' && (
            <label className="block max-w-40">
              <Label>{t('split.everyLabel')}</Label>
              <input
                type="number"
                min={1}
                max={total}
                className={inputCls}
                value={every}
                onChange={(e) => setEvery(Number(e.target.value))}
              />
            </label>
          )}
          {mode === 'pick' && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">{t('split.selected', { n: picked.size })}</span>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(Array.from({ length: total }, (_, i) => i)))}>
                {t('split.selectAll')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                {t('split.selectNone')}
              </Button>
            </div>
          )}
        </div>

        {doc && (
          <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
            {Array.from({ length: total }, (_, i) => {
              const on = covered.has(i)
              const cls = on
                ? 'ring-2 ring-indigo-500'
                : mode === 'ranges' || mode === 'pick'
                  ? 'opacity-50'
                  : ''
              const thumb = (
                <div className={`relative rounded ${cls}`}>
                  <PdfThumb doc={doc} index={i} width={110} />
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[11px] text-white">{i + 1}</span>
                  {mode === 'pick' && on && (
                    <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-indigo-600 text-xs text-white">✓</span>
                  )}
                </div>
              )
              return mode === 'pick' ? (
                <button key={i} type="button" onClick={() => togglePage(i)} aria-pressed={on} className="justify-self-center">
                  {thumb}
                </button>
              ) : (
                <div key={i} className="justify-self-center">
                  {thumb}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {error && <Alert>{error}</Alert>}
      {'error' in plan && mode !== 'ranges' && <Alert kind="info">{plan.error}</Alert>}
      {'error' in plan && mode === 'ranges' && rangeText.trim() !== '' && <Alert>{plan.error}</Alert>}

      <Card>
        {busy ? (
          <ProgressBar value={busy.done / busy.total} label={t('working')} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" disabled={!('groups' in plan) || !plan.groups.length} onClick={run}>
              {t('split.start')}
              {'groups' in plan && plan.groups.length > 0 && (
                <span className="font-normal opacity-80">{plan.groups.length === 1 ? t('split.fileOut') : t('split.filesOut', { n: plan.groups.length })}</span>
              )}
            </Button>
          </div>
        )}

        {outputs && (
          <div className="mt-5 space-y-2">
            {outputs.length > 1 && (
              <Button variant="primary" onClick={downloadZip}>
                {t('downloadAll')}
              </Button>
            )}
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {outputs.map((o) => (
                <li key={o.name} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(o.data.length)}</div>
                  </div>
                  <Button size="sm" variant={outputs.length === 1 ? 'primary' : 'secondary'} onClick={() => downloadPdf(o.data, o.name)}>
                    {t('download')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}
