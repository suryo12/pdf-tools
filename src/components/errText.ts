import { errorCode, isPasswordError } from '../lib/pdf'
import type { Key } from '../i18n'

type T = (key: Key, vars?: Record<string, string | number>) => string

/** Maps any thrown value to a friendly, translated message. */
export function errText(t: T, e: unknown): string {
  const code = errorCode(e)
  if (code) return t(`err.${code}`)
  if (isPasswordError(e)) return t('err.encrypted')
  return t('err.generic', { msg: e instanceof Error ? e.message : String(e) })
}
