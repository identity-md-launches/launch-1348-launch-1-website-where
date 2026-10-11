// WCAG 2 contrast ratios computed from the oklch tokens declared in src/styles.css.
// Run: node test/contrast.mjs   Exits 1 when a text or control pair misses its target.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8')
const tokens = {}
for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim()
const resolve = (name) => {
  let v = tokens[name]
  for (let i = 0; i < 8 && v && v.startsWith('var('); i++) v = tokens[v.slice(6, -1)]
  return v
}

function oklchToSrgb(str) {
  const [L, C, h] = str.match(/oklch\(([^)]+)\)/)[1].split(/\s+/).map(Number)
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, c)))
}
const luminance = (name) => {
  const [r, g, b] = oklchToSrgb(resolve(name))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (fg, bg) => {
  const a = luminance(fg), b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const pairs = [
  ['color-text-primary', 'color-bg-page', 4.5, 'body text on page'],
  ['color-text-primary', 'color-surface', 4.5, 'card text on surface'],
  ['color-text-secondary', 'color-surface', 4.5, 'labels, chart ticks on surface'],
  ['color-text-secondary', 'color-bg-page', 4.5, 'lede, status on page'],
  ['color-text-muted', 'color-bg-page', 4.5, 'footer on page'],
  ['color-text-muted', 'color-surface', 4.5, 'placeholder on input'],
  ['color-accent-text', 'color-accent-solid', 4.5, 'primary button label'],
  ['color-negative', 'color-bg-page', 4.5, 'error text on page'],
  ['color-positive', 'color-surface-raised', 4.5, 'Profit badge'],
  ['color-negative', 'color-surface-raised', 4.5, 'Loss badge'],
  ['color-border-control', 'color-surface', 3, 'input border (non-text)'],
  ['color-focus', 'color-bg-page', 3, 'focus ring on page'],
  ['color-focus', 'color-surface', 3, 'focus ring on card'],
  ['chart-gas', 'color-surface', 3, 'gas line'],
  ['chart-buy', 'color-surface', 3, 'buy line'],
  ['chart-sell', 'color-surface', 3, 'sell line'],
  ['chart-pnl', 'color-surface', 3, 'profit line'],
]
let failed = 0
for (const [fg, bg, min, what] of pairs) {
  const r = ratio(fg, bg)
  const ok = r >= min
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(1)}:1 (min ${min}) ${what}: --${fg} on --${bg}`)
}
console.log(`decorative --color-border on surface: ${ratio('color-border', 'color-surface').toFixed(1)}:1 (not a control boundary)`)
process.exit(failed ? 1 : 0)
