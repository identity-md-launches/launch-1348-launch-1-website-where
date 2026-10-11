// Browser verification of the committed export in headless Chromium.
// Serves dist/ under /preview/ for the life of this process, walks the primary flows and
// saves screenshots to artifacts/screenshots/. Run: node test/verify.mjs
// Needs `npx playwright install chromium` once. Reads the live explorers, so it needs the network.
import { chromium } from 'playwright'
import http from 'node:http'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const shots = path.join(root, 'artifacts/screenshots')
mkdirSync(shots, { recursive: true })

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (!url.pathname.startsWith('/preview/')) return res.writeHead(404).end()
  let file = path.join(dist, url.pathname.slice('/preview/'.length) || 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/preview/`

const results = []
let failures = 0
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// A short history that reads to the end in well under a minute. (The explorer's counters are not
// reliable for busy addresses: 0x4cD0…BC31 reports 97 transactions but pages past 14,000.)
const SMALL = '0xC25e636ce5b5454Bc410415AB767A27213A68332'
const BIG = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // the placeholder: 78k transactions, 400k token transfers
const EMPTY = '0x7f3a9c2e1b4d5f6a8c9e0b1d2f3a4c5e6b7d8f90' // never used on any of the three chains

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
const consoleErrors = []
const failedLocal = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('requestfailed', (r) => r.url().startsWith(base) && failedLocal.push(r.url()))
page.on('response', (r) => r.url().startsWith(base) && r.status() >= 400 && failedLocal.push(`${r.status()} ${r.url()}`))

const textOf = async (sel) => (await page.locator(sel).first().textContent())?.trim() ?? ''
const box = async (sel) => page.locator(sel).first().boundingBox()

// 1. First screen at 390: product and main action visible without scrolling.
await page.goto(base)
await page.waitForSelector('h1')
check('title, favicon, description, og tags', await page.evaluate(() => !!document.title && !!document.querySelector('link[rel=icon]') && !!document.querySelector('meta[name=description]') && !!document.querySelector('meta[property="og:title"]') && !!document.querySelector('meta[property="og:image"]')))
check('h1 names the task', (await textOf('h1')).startsWith('Look up a wallet'), await textOf('h1'))
const btn = await box('button[type=submit]')
check('first screen at 390 shows the address field and Read history', btn !== null && btn.y + btn.height <= 844, `button bottom ${btn && Math.round(btn.y + btn.height)}`)
check('no horizontal overflow at 390', await page.evaluate(() => document.documentElement.scrollWidth <= 390))
check('wallet statement appears once on the first screen', (await page.locator('text=no wallet').count()) <= 1 && (await page.locator('footer').textContent()).includes('Nothing is stored.'))
await page.screenshot({ path: path.join(shots, '390-first-screen.png') })

// 2. Keyboard: tab order and focus ring.
await page.keyboard.press('Tab')
check('first Tab lands on the skip link', await page.evaluate(() => document.activeElement?.className === 'skip-link'))
await page.keyboard.press('Tab')
await page.keyboard.press('Tab')
check('address input reachable by keyboard', await page.evaluate(() => document.activeElement?.tagName === 'INPUT'))
check('focus ring on the input', await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none' && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2))

// 3. Validation.
await page.fill('input[name=wallet-address]', '0x123')
await page.keyboard.press('Enter')
check('invalid address shows inline error', (await page.locator('.lookup-error').count()) === 1 && (await page.getAttribute('input[name=wallet-address]', 'aria-invalid')) === 'true')

// 4. Stop reading with a real click stops the read instead of restarting it.
let submits = 0
await page.exposeFunction('__submitted', () => submits++)
await page.evaluate(() => document.querySelector('form').addEventListener('submit', () => window.__submitted()))
let explorerRequests = 0
page.on('request', (r) => /blockscout\.com/.test(r.url()) && explorerRequests++)
await page.fill('input[name=wallet-address]', BIG)
await page.click('button[type=submit]')
await page.waitForSelector('button:has-text("Stop reading")')
await page.waitForTimeout(6000)
const before = explorerRequests
await page.locator('button:has-text("Stop reading")').click()
await page.waitForSelector('button[type=submit]:has-text("Read history")', { timeout: 30000 })
await page.waitForTimeout(1500)
check('Stop reading stops the read (one submit, button back to Read history)', submits === 1 && (await page.locator('button[type=submit]').count()) === 1, `submits ${submits}, explorer requests before stop ${before}, after ${explorerRequests}`)
check('status says the read was stopped', (await textOf('.status')).startsWith('Stopped reading'), await textOf('.status'))
const gasLabel = await textOf('.metric:nth-child(2) .metric-label')
const gasDetail = await textOf('.metric:nth-child(2) .metric-detail')
// The detail reads "N of M transactions read" when the explorer's counter answered, "N transactions read, more remain" when it did not.
check('cut read labels the gas card with the window it covers', /^Gas spent, newest [\d,]+ transactions$/.test(gasLabel) && /^[\d,]+ (of [\d,]+ )?transactions read/.test(gasDetail), `${gasLabel} / ${gasDetail}`)
check('buy, sell and profit cards carry the newest-N wording', (await page.locator('.metric-label:has-text("newest")').count()) === 4)
check('coverage notes sit after the charts', await page.evaluate(() => { const c = document.querySelector('.coverage'); const ch = document.querySelector('.charts'); return !!c && !!ch && !!(ch.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) }))
const dashHead = await box('.dash-head')
const firstMetric = await box('.metric')
check('first metric card directly under the dashboard heading at 390', firstMetric.y - dashHead.y < 200, `${Math.round(firstMetric.y - dashHead.y)}px below the heading`)
// Labels are declared at 12px; they render at that size only if the SVG is not scaled, i.e. its
// rendered width equals its viewBox width.
const unscaled = () => page.evaluate(() => [...document.querySelectorAll('.chart-svg')].every((s) => Math.abs(s.getBoundingClientRect().width - s.viewBox.baseVal.width) < 1) && [...document.querySelectorAll('.chart-tick')].every((t) => getComputedStyle(t).fontSize === '12px'))
const svgInfo = () => page.evaluate(() => { const s = document.querySelector('.chart-svg'); return `svg ${s.getBoundingClientRect().width.toFixed(0)}px wide, viewBox ${s.viewBox.baseVal.width}, tick font ${getComputedStyle(document.querySelector('.chart-tick')).fontSize}` })
check('chart SVG unscaled and tick labels 12px at 390', await unscaled(), await svgInfo())
check('lowest y-axis label reads 0 on the gas chart', (await page.locator('.chart').first().locator('.chart-tick').allTextContents()).includes('0'))
const stoppedStarts = await page.$$eval('.chart-svg', (svgs) => svgs.map((s) => [...s.querySelectorAll('text')].find((t) => /\d{4}$/.test(t.textContent) && t.getAttribute('text-anchor') === 'start')?.textContent))
check('no chart axis starts in 1970 after the stopped read', stoppedStarts.every((d) => d && !d.includes('1970')), stoppedStarts.join(' | '))
await page.screenshot({ path: path.join(shots, '390-stopped-read.png'), fullPage: true })

// 5. Pending rows never put a 1970 point on the timeline; a small wallet reads to the end.
await page.setViewportSize({ width: 1440, height: 900 })
await page.fill('input[name=wallet-address]', SMALL)
await page.click('button[type=submit]')
await page.waitForSelector('.status:has-text("Finished reading"), .status:has-text("Could not reach")', { timeout: 240000 })
const firstDates = await page.$$eval('.chart-svg', (svgs) => svgs.map((s) => [...s.querySelectorAll('text')].find((t) => /\d{4}$/.test(t.textContent) && t.getAttribute('text-anchor') === 'start')?.textContent))
check('no chart axis starts in 1970', firstDates.every((d) => d && !d.includes('1970')), firstDates.join(' | '))
check('status line has no transaction count', !/\d transactions found/.test(await textOf('.status')), await textOf('.status'))
const gasDetailFull = await textOf('.metric:nth-child(2) .metric-detail')
check('complete read: gas card counts signed transactions', /^Fees on [\d,]+ transactions this wallet signed/.test(gasDetailFull), gasDetailFull)
check('complete read: gas card is titled Total gas spent', (await textOf('.metric:nth-child(2) .metric-label')) === 'Total gas spent')
check('no horizontal overflow at 1440', await page.evaluate(() => document.documentElement.scrollWidth <= 1440))
check('charts in two columns at 1440', (await box('.chart')).width < 700)
check('chart SVG unscaled and tick labels 12px at 1440', await unscaled(), await svgInfo())
await page.hover('.chart-svg')
check('chart hover updates the summary with a date', !(await textOf('.chart-summary')).startsWith('Today'), await textOf('.chart-summary'))
await page.screenshot({ path: path.join(shots, '1440-dashboard.png'), fullPage: true })

// 6. Chain filter.
await page.selectOption('#chain-select', 'robinhood')
check('chain dropdown filters the dashboard', (await textOf('.dash-sub')).startsWith('Robinhood Chain only'))
await page.selectOption('#chain-select', 'all')

// 7. 320 wide reflow.
await page.setViewportSize({ width: 320, height: 700 })
check('no horizontal overflow at 320', await page.evaluate(() => document.documentElement.scrollWidth <= 320))
check('chart SVG unscaled and tick labels 12px at 320', await unscaled(), await svgInfo())
await page.screenshot({ path: path.join(shots, '320-dashboard.png'), fullPage: true })

// 8. Empty wallet.
await page.setViewportSize({ width: 390, height: 844 })
await page.fill('input[name=wallet-address]', EMPTY)
await page.click('button[type=submit]')
await page.waitForSelector('.empty-title', { timeout: 120000 })
check('unused address shows No activity found, not a failure', (await textOf('.empty-title')) === 'No activity found', await textOf('.empty-title'))

// 9. All explorers unreachable: a failure state, not an empty-wallet state.
await context.route(/blockscout\.com/, (r) => r.abort('internetdisconnected'))
await page.fill('input[name=wallet-address]', SMALL)
await page.click('button[type=submit]')
await page.waitForSelector('.empty-title', { timeout: 60000 })
check('offline read shows Could not read this address', (await textOf('.empty-title')) === 'Could not read this address', await textOf('.empty-title'))
check('offline status names the failure', (await textOf('.status')).startsWith('Could not reach the explorers'), await textOf('.status'))
await page.screenshot({ path: path.join(shots, '390-offline.png'), fullPage: true })
await context.unroute(/blockscout\.com/)

// 10. Reduced motion and console.
const rm = await context.newPage()
await rm.emulateMedia({ reducedMotion: 'reduce' })
await rm.goto(base)
check('reduced motion disables the button transition', await rm.evaluate(() => getComputedStyle(document.querySelector('.button')).transitionDuration === '0s'))
await rm.close()
// The browser logs every non-2xx explorer response as "Failed to load resource": 429s that the
// client backs off and retries, and the offline step's deliberately blocked requests. Those are
// expected network notes, not page errors, and are reported separately.
const networkNotes = consoleErrors.filter((m) => /^Failed to load resource/.test(m))
const pageErrors = consoleErrors.filter((m) => !/^Failed to load resource/.test(m))
check('no console errors from the page', pageErrors.length === 0, pageErrors.join(' | ') || `${networkNotes.length} explorer network notes (429 retried / simulated offline)`)
check('no failed local resource loads', failedLocal.length === 0, failedLocal.join(' | '))

await browser.close()
server.close()
console.log(`\n${results.length - failures} of ${results.length} checks passed`)
process.exit(failures ? 1 : 0)
