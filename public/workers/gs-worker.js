/* Ghostscript WASM worker (classic worker so we can importScripts the Emscripten build).
 * Runs entirely in the browser: the PDF bytes arrive via postMessage and the result is
 * posted back. Nothing is ever sent over the network. */
importScripts('../gs/gs.js') // defines the global `Module` factory

const gsBase = new URL('../gs/', self.location.href).href

self.onmessage = async (e) => {
  const { id, input, args } = e.data
  const tail = []
  let totalPages = 0
  const onLine = (line) => {
    tail.push(line)
    if (tail.length > 12) tail.shift()
    let m = /^Processing pages 1 through (\d+)/.exec(line)
    if (m) {
      totalPages = Number(m[1])
      self.postMessage({ id, type: 'progress', page: 0, total: totalPages })
      return
    }
    m = /^Page (\d+)/.exec(line)
    if (m) self.postMessage({ id, type: 'progress', page: Number(m[1]), total: totalPages })
  }
  try {
    const mod = await Module({
      noInitialRun: true,
      locateFile: (f) => gsBase + f,
      print: onLine,
      printErr: onLine,
    })
    mod.FS.writeFile('input.pdf', new Uint8Array(input))
    const code = mod.callMain(args)
    if (code) throw new Error('Ghostscript exit code ' + code + '\n' + tail.join('\n'))
    const out = mod.FS.readFile('output.pdf').slice()
    self.postMessage({ id, type: 'done', output: out.buffer }, [out.buffer])
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    self.postMessage({ id, type: 'error', message: msg + (tail.length ? '\n' + tail.join('\n') : '') })
  }
}
