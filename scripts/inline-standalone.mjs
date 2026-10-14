// Produces dist/standalone.html — a fully self-contained build used only for
// static-file preview (the real deployment keeps separate assets).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
let html = readFileSync(join(dist, 'index.html'), 'utf8')

// inline the stylesheet
const cssMatch = html.match(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/)
if (cssMatch) {
  const css = readFileSync(join(dist, 'assets', cssMatch[1]), 'utf8')
  html = html.replace(cssMatch[0], () => `<style>${css}</style>`)
}

// inline the module script (function replacer: never interpret $ tokens in the bundle)
const jsMatch = html.match(/<script type="module"[^>]*src="\.\/assets\/([^"]+)"[^>]*><\/script>/)
if (jsMatch) {
  let js = readFileSync(join(dist, 'assets', jsMatch[1]), 'utf8')
  // escape any literal closing tags so the inline <script> keeps its integrity
  js = js.replace(/<\/script/gi, () => '<\\/script')
  html = html.replace(jsMatch[0], () => `<script type="module">${js}</script>`)
}

writeFileSync(join(dist, 'standalone.html'), html, 'utf8')
console.log('wrote dist/standalone.html')
