// Renders public/og.png (1200×630) from the site's own tokens and font with headless Chromium.
// Run: node test/make-og.mjs   (needs `npx playwright install chromium` once)
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const font = readFileSync(path.join(root, 'public/fonts/fraunces-latin.woff2')).toString('base64')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Fraunces'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 600; }
html, body { margin: 0; }
body {
  width: 1200px; height: 630px; overflow: hidden; position: relative;
  background:
    radial-gradient(60rem 30rem at 85% -10%, oklch(0.26 0.05 75 / 0.35), transparent 70%),
    radial-gradient(50rem 30rem at -10% 20%, oklch(0.3 0.05 225 / 0.3), transparent 70%),
    oklch(0.17 0.018 262);
  color: oklch(0.97 0.006 90);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
.mark { position: absolute; left: 96px; top: 84px; display: flex; align-items: center; gap: 20px; }
.tile { width: 64px; height: 64px; }
.name { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 72px; letter-spacing: -0.015em; line-height: 1; }
.line { position: absolute; left: 96px; top: 200px; width: 760px; font-size: 34px; line-height: 1.35; color: oklch(0.76 0.016 262); }
svg.step { position: absolute; right: 0; bottom: 0; }
</style></head><body>
<div class="mark">
  <svg class="tile" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="oklch(0.26 0.022 262)"/><path d="M12 42 L24 30 L32 36 L44 20 L52 26" fill="none" stroke="oklch(0.8 0.1 225)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="52" cy="26" r="5" fill="oklch(0.8 0.14 75)"/></svg>
  <div class="name">Walletscope</div>
</div>
<div class="line">Wallet age, gas, trades and profit on Ethereum, Base and Robinhood Chain</div>
<svg class="step" width="1200" height="330" viewBox="0 0 1200 330" aria-hidden="true">
  <path d="M0 300 H140 V250 H300 V262 H430 V190 H560 V205 H700 V120 H860 V140 H980 V60 H1140" fill="none" stroke="oklch(0.82 0.11 165)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="1140" cy="60" r="14" fill="oklch(0.8 0.14 75)"/>
</svg>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
const png = await page.screenshot({ type: 'png' })
await browser.close()
const out = path.join(root, 'public/og.png')
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
