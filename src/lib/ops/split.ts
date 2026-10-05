import { PDFDocument } from 'pdf-lib'
import { loadPdf, yieldToUi } from '../pdf'

export const groupsEvery = (n: number, total: number): number[][] => {
  const groups: number[][] = []
  for (let i = 0; i < total; i += n) {
    groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k))
  }
  return groups
}

export const groupsEach = (total: number): number[][] => groupsEvery(1, total)

/** Builds one PDF per group of zero-based page indexes. */
export async function splitByGroups(
  bytes: Uint8Array,
  groups: number[][],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes)
  const results: Uint8Array[] = []
  for (let i = 0; i < groups.length; i++) {
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, groups[i])
    pages.forEach((p) => out.addPage(p))
    results.push(await out.save())
    onProgress?.(i + 1, groups.length)
    await yieldToUi()
  }
  return results
}
