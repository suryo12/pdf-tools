import { useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'

export function Dropzone({
  accept,
  multiple = false,
  onFiles,
  title,
  hint,
  compact = false,
  icon,
}: {
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  title?: string
  hint?: string
  compact?: boolean
  icon?: ReactNode
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const take = (list: FileList | null) => {
    if (!list || !list.length) return
    onFiles(multiple ? Array.from(list) : [list[0]])
    if (input.current) input.current.value = '' // allow choosing the same file again
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors ${
        compact ? 'gap-1 px-4 py-4' : 'gap-3 px-6 py-14'
      } ${
        over
          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
          : 'border-zinc-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-500'
      }`}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => take(e.target.files)}
      />
      {!compact && (
        <div className="grid size-14 place-items-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
          {icon ?? <UploadIcon />}
        </div>
      )}
      <div className={compact ? 'text-sm font-medium' : 'text-lg font-semibold'}>{title ?? t('dropPdf')}</div>
      <div className="text-sm text-zinc-500 dark:text-zinc-400">{hint ?? t('orClick')}</div>
    </label>
  )
}

export function UploadIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}
