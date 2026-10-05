import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700',
  secondary:
    'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  ghost: 'text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800',
  danger: 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
}
const sizes = { sm: 'h-8 px-2.5 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button type="button" className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </div>
  )
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${className}`}>
      {children}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums normal-case text-zinc-700 dark:text-zinc-200">
          {value}
          {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800 ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            o.value === value
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, label }: { value?: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1.5 text-sm text-zinc-600 dark:text-zinc-300">{label}</div>}
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        {value === undefined ? (
          <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-indigo-500" />
        ) : (
          <div
            className="h-full rounded-full bg-indigo-500 transition-[width] duration-200"
            style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
          />
        )}
      </div>
    </div>
  )
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  }
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${styles[kind]}`}>
      {children}
    </div>
  )
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-800"
      />
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'

export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded accent-indigo-600"
      />
      {children}
    </label>
  )
}
