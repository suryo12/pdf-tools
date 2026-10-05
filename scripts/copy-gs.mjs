// Copies runtime assets into public/ so everything is served same-origin
// (no CDN, nothing leaves the user's device):
//   - Ghostscript WASM (compress)      -> public/gs
//   - pdf.js cmaps / fonts / wasm      -> public/pdfjs
//   - Open-licence fonts (Edit/Watermark) -> public/fonts
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const copy = (fromDir, toDir, files) => {
  mkdirSync(toDir, { recursive: true })
  if (files) for (const f of files) cpSync(join(fromDir, f), join(toDir, f))
  else cpSync(fromDir, toDir, { recursive: true })
}

copy(join(nm, '@jspawn', 'ghostscript-wasm'), join(root, 'public', 'gs'), ['gs.js', 'gs.wasm'])
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  copy(join(nm, 'pdfjs-dist', d), join(root, 'public', 'pdfjs', d))
}

// Keep this list in sync with src/lib/fonts.ts (the `file` field of each font).
const fontPackages = ['arimo', 'tinos', 'cousine', 'carlito', 'roboto', 'open-sans', 'lato', 'montserrat', 'merriweather', 'dancing-script']
const fontsOut = join(root, 'public', 'fonts')
mkdirSync(fontsOut, { recursive: true })
let fontCount = 0
for (const pkg of fontPackages) {
  for (const weight of [400, 700]) {
    for (const style of ['normal', 'italic']) {
      const file = `${pkg}-latin-${weight}-${style}.woff`
      const src = join(nm, '@fontsource', pkg, 'files', file)
      if (existsSync(src)) {
        cpSync(src, join(fontsOut, file))
        fontCount++
      }
    }
  }
}
console.log(`[prepare-gs] copied ghostscript + pdfjs assets + ${fontCount} font files -> public/`)
