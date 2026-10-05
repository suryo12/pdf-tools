import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n, type Key } from './i18n'
import { Button, ProgressBar } from './components/ui'

const CompressTool = lazy(() => import('./tools/CompressTool'))
const MergeTool = lazy(() => import('./tools/MergeTool'))
const SplitTool = lazy(() => import('./tools/SplitTool'))
const WatermarkTool = lazy(() => import('./tools/WatermarkTool'))
const EditTool = lazy(() => import('./tools/EditTool'))
const ConvertTool = lazy(() => import('./tools/ConvertTool'))

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) ?? 'https://github.com/suryo12/pdf-tools'

type ToolId = 'compress' | 'merge' | 'split' | 'watermark' | 'edit' | 'convert'

const icon = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

const TOOLS: { id: ToolId; icon: ReactNode; Comp: React.LazyExoticComponent<() => ReactNode> }[] = [
  { id: 'compress', icon: icon('M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'), Comp: CompressTool },
  { id: 'merge', icon: icon('M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'), Comp: MergeTool },
  { id: 'split', icon: icon('M12 21v-7M12 14 5 5M12 14l7-9M5 5h5M5 5v5M19 5h-5M19 5v5'), Comp: SplitTool },
  { id: 'watermark', icon: icon('M12 2.7c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z'), Comp: WatermarkTool },
  { id: 'edit', icon: icon('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'), Comp: EditTool },
  { id: 'convert', icon: icon('M17 3l4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13'), Comp: ConvertTool },
]

const fromHash = (): ToolId => {
  const h = location.hash.replace('#', '')
  return TOOLS.some((x) => x.id === h) ? (h as ToolId) : 'compress'
}

export default function App() {
  const { t, lang, setLang } = useI18n()
  const [active, setActive] = useState<ToolId>(fromHash)
  // Tools stay mounted after first use so switching tabs never loses your work.
  const [visited, setVisited] = useState<Set<ToolId>>(() => new Set([fromHash()]))
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const onHash = () => select(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const select = (id: ToolId) => {
    setActive(id)
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)))
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`)
  }

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight">{t('appName')}</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowPrivacy(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {t('privacyBadge')}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'en' ? 'id' : 'en')} aria-label={t('language')} title={t('language')}>
            {lang === 'en' ? 'EN' : 'ID'}
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleTheme} aria-label={t('theme')} title={t('theme')}>
            {dark ? '☀' : '☾'}
          </Button>
          {REPO_URL && (
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t('openSource')} ↗
            </a>
          )}
        </div>
      </header>

      <p className="mt-4 text-zinc-600 dark:text-zinc-400">{t('tagline')}</p>

      <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label="Tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            role="tab"
            type="button"
            aria-selected={active === tool.id}
            onClick={() => select(tool.id)}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              active === tool.id
                ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                : 'border-zinc-200 bg-white hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700'
            }`}
          >
            <span className={active === tool.id ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}>{tool.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t(`tool.${tool.id}` as Key)}</span>
              <span className={`block text-xs leading-tight ${active === tool.id ? 'text-indigo-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {t(`tool.${tool.id}.desc` as Key)}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <main className="mt-6 flex-1">
        {TOOLS.filter((x) => visited.has(x.id)).map(({ id, Comp }) => (
          <section key={id} hidden={active !== id} role="tabpanel" aria-label={t(`tool.${id}` as Key)}>
            <Suspense fallback={<ProgressBar label={t('loading')} />}>
              <Comp />
            </Suspense>
          </section>
        ))}
      </main>

      <footer className="mt-10 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <p>{t('footer')}</p>
        {REPO_URL && (
          <p className="mt-1">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
              {t('sourceCode')}
            </a>{' '}
            · AGPL-3.0
          </p>
        )}
      </footer>

      {showPrivacy && <PrivacyDialog onClose={() => setShowPrivacy(false)} />}
    </div>
  )
}

function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="space-y-3 p-6">
        <h2 className="text-lg font-bold">{t('privacyTitle')}</h2>
        <p className="text-sm leading-relaxed">{t('privacyBody')}</p>
        <p className="rounded-lg bg-zinc-100 p-3 text-sm leading-relaxed dark:bg-zinc-800">{t('privacyVerify')}</p>
        {REPO_URL && (
          <p className="text-sm">
            {t('privacySource')}{' '}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
              {REPO_URL.replace('https://', '')}
            </a>
          </p>
        )}
        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={() => ref.current?.close()}>
            {t('close')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
