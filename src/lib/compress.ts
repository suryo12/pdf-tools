export type CompressLevel = 'light' | 'recommended' | 'extreme'

export interface CompressOptions {
  level: CompressLevel
  grayscale: boolean
}

/** Next stronger level, used as an automatic fallback when a level does not shrink the file. */
export const STRONGER: Record<CompressLevel, CompressLevel | null> = {
  light: 'recommended',
  recommended: 'extreme',
  extreme: null,
}

const PRESET: Record<CompressLevel, string> = {
  light: '/printer',
  recommended: '/ebook',
  extreme: '/screen',
}

export function buildArgs({ level, grayscale }: CompressOptions): string[] {
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    `-dPDFSETTINGS=${PRESET[level]}`,
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    // Do not rotate pages based on text orientation; keep the original layout.
    '-dAutoRotatePages=/None',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
  ]
  if (level !== 'light') {
    // Also downsample images that are only slightly above the target resolution.
    args.push(
      '-dColorImageDownsampleThreshold=1.0',
      '-dGrayImageDownsampleThreshold=1.0',
      '-dMonoImageDownsampleThreshold=1.0',
    )
  }
  if (grayscale) {
    args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray')
  }
  args.push('-sOutputFile=output.pdf', 'input.pdf')
  return args
}

export interface CompressJob {
  promise: Promise<Uint8Array>
  cancel: () => void
}

/**
 * Runs Ghostscript (WASM) in a throw-away Web Worker. A fresh worker per job means all
 * wasm memory is released afterwards and a cancel is just `worker.terminate()`.
 */
export function compressPdf(
  bytes: Uint8Array,
  opts: CompressOptions,
  onProgress?: (page: number, total: number) => void,
): CompressJob {
  const worker = new Worker(`${import.meta.env.BASE_URL}workers/gs-worker.js`)
  let rejectJob: (e: Error) => void = () => {}
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    rejectJob = reject
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') onProgress?.(m.page, m.total)
      else if (m.type === 'done') {
        resolve(new Uint8Array(m.output))
        worker.terminate()
      } else if (m.type === 'error') {
        reject(new Error(m.message))
        worker.terminate()
      }
    }
    worker.onerror = (e) => {
      reject(new Error(e.message || 'Worker error'))
      worker.terminate()
    }
    // Copy so the caller keeps its own bytes (the copy is transferred, not cloned).
    const input = bytes.slice().buffer
    worker.postMessage({ id: 1, input, args: buildArgs(opts) }, [input])
  })
  return {
    promise,
    cancel: () => {
      worker.terminate()
      rejectJob(new DOMException('Cancelled', 'AbortError'))
    },
  }
}
