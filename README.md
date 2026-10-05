# PDF Tools

Free PDF tools that run **100% in your browser**. Files are never uploaded: there is no backend.

Live: https://pdf-tools-app.pages.dev

| Tool | What it does | Engine |
|---|---|---|
| Compress | Shrinks PDFs (3 levels, optional B&W, automatic fallback to a stronger level if nothing was gained) | Ghostscript → WebAssembly |
| Merge | Combines PDFs and images (JPG/PNG/WebP), reorderable | pdf-lib |
| Split | By range, every N pages, every page, or click-to-pick; ZIP output | pdf-lib + JSZip |
| Watermark | Text or logo on **PDFs and images**, opacity, rotation, 9 positions or tiled, page selection, font choice, live preview | pdf-lib + canvas + pdf.js |
| Edit | **Edit existing text** (click a line to change it), add text/images/signature, whiteout, highlight, pen, rotate/reorder/delete/insert pages, 10 fonts, undo/redo | pdf-lib + pdf.js |
| Convert | Images → PDF (page size, margin, optimize) and PDF → PNG/JPG (72–300 dpi, page selection, ZIP) | pdf-lib + pdf.js |

UI is available in English and Indonesian (auto-detected, switchable).

## Why it is private

- All processing happens in Web Workers / the main thread of the visitor's browser.
- The production build ships a strict Content-Security-Policy (`connect-src 'self'`) in `index.html`
  and in `public/_headers`, so the page cannot send data to any other origin.
- Verify it yourself: DevTools → Network, run a tool, and watch that nothing carries your file.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ with the production CSP
```

`npm run dev` / `build` first copy the Ghostscript WASM, pdf.js assets and fonts into `public/`
(`scripts/copy-gs.mjs`, git-ignored) so everything is served from your own origin.

## Deploy

`dist/` is a fully static site (relative `base`, works on a sub-path). Cloudflare Pages, Netlify, Vercel or
GitHub Pages all work. `public/_headers` is honoured by Cloudflare Pages and Netlify; on hosts that ignore it the
`<meta>` CSP in `index.html` still applies.

```bash
npm run build
npx wrangler pages deploy dist --project-name <your-pages-project>
```

Set `VITE_REPO_URL` at build time to change the source link shown in the header and footer.

## Known limits

- Very large files (hundreds of MB) can exhaust browser memory, especially on phones.
- Compress uses Ghostscript's pdfwrite: text stays selectable, images are re-encoded at lower resolution/quality.
- *Edit text* covers the original text with a patch in the page's background colour and places new text on top.
  The original text is hidden, **not removed** from the file, so do not use it to redact sensitive information.
  Scanned PDFs (images) and rotated text are not detected.
- Fonts cover the Latin alphabet (including Indonesian and most European languages), not CJK/Arabic/etc.
- Password-protected PDFs are rejected with a clear message (decrypting is not supported).

## License

AGPL-3.0-or-later (required by the bundled Ghostscript WASM build). See [LICENSE](LICENSE).

Third-party software: Ghostscript (Artifex, AGPL-3.0), pdf-lib (MIT), pdf.js (Apache-2.0), JSZip (MIT/GPL), React (MIT).

Fonts, bundled via [Fontsource](https://fontsource.org): Arimo, Tinos, Cousine, Carlito, Roboto, Open Sans, Lato,
Montserrat, Merriweather, Dancing Script, all under the SIL Open Font License 1.1 or Apache-2.0.
Arimo, Tinos and Cousine are metric-compatible with Arial, Times New Roman and Courier New; Carlito with Calibri.
