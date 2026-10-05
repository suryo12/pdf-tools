import JSZip from 'jszip'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

export async function readBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer())
}

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export function toBlob(data: Uint8Array, type = 'application/pdf'): Blob {
  return new Blob([data as BlobPart], { type })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const downloadPdf = (data: Uint8Array, filename: string) =>
  downloadBlob(toBlob(data), filename)

export async function zipFiles(files: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.data)
  // PDFs are already compressed; STORE keeps zipping instant even for big files.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

export type RangeErrorCode = 'empty' | 'invalid' | 'outOfRange'

/**
 * Parses "1-3, 5, 8-" into groups of zero-based page indexes.
 * "7-" means 7..max, "-3" means 1..3.
 */
export function parseRanges(
  input: string,
  max: number,
): { groups: number[][]; error?: undefined } | { groups?: undefined; error: RangeErrorCode } {
  const tokens = input.split(/[,;\s]+/).filter(Boolean)
  if (!tokens.length) return { error: 'empty' }
  const groups: number[][] = []
  for (const tok of tokens) {
    const m = /^(\d*)(?:(-)(\d*))?$/.exec(tok)
    if (!m || (!m[1] && !m[3])) return { error: 'invalid' }
    const from = m[1] ? Number(m[1]) : 1
    const to = m[2] ? (m[3] ? Number(m[3]) : max) : from
    if (from < 1 || to > max) return { error: 'outOfRange' }
    if (from > to) return { error: 'invalid' }
    const g: number[] = []
    for (let p = from; p <= to; p++) g.push(p - 1)
    groups.push(g)
  }
  return { groups }
}

/** Compact "1-3, 5" label for a list of zero-based indexes. */
export function describeIndexes(idx: number[]): string {
  const s = [...idx].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; ) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i] + 1}-${s[j] + 1}` : `${s[i] + 1}`)
    i = j + 1
  }
  return out.join(', ')
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
