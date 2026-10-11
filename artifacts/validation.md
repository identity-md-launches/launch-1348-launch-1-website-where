# Walletscope validation record (revision of 2026-10-11)

## 1. Scope and assumptions

- Single page, `dist/` built with `vite build` (base `./`), served for inspection at `http://127.0.0.1:<port>/preview/` by `test/verify.mjs` for the life of that process.
- Flows reviewed: first screen, keyboard path, inline validation, a stopped read of the placeholder address (Ethereum, Base, Robinhood Chain), a complete read of a short wallet, the chain filter, an unused address, a simulated offline read, reduced motion.
- Inferred choices: a read with no page cap is shown progressively (snapshots every ~2 s per chain) and Stop keeps the rows read so far; card labels name the window while a list is incomplete. The explorers' per-address counters are unreliable for busy addresses, so "N of M" is used only when M is known and above N.
- Variants: dark theme only, English only. No dialogs, no routing.

## 2. Coverage (Better Interface, six domains)

| Domain | Status | Evidence |
| --- | --- | --- |
| Accessibility | Checked | Native form, label, `aria-invalid`/`aria-describedby`, `role="status"` live region, skip link first in tab order, 2 px focus ring on the input (computed and screenshot), reduced motion disables the button transition, SVG charts named via `aria-label` and summarised in text. Not performed: screen-reader session, native 200% zoom, physical device. |
| Layout | Checked | 320, 390 and 1440: no horizontal overflow; first screen at 390 shows the field and Read history (button bottom 515 px); cards directly under the dashboard heading (191 px); coverage notes after the charts; charts two columns at 1440. |
| Writing | Checked | h1 names the task; lede states what happens; status, failure, stopped and empty states say only what the app knows; one wallet statement on the first screen. |
| Typography | Checked | Six-size scale unchanged; chart labels now 12 px at every width (SVG viewBox equals rendered width: 326/326 at 390, 256/256 at 320, 536/536 at 1440). |
| Colors | Checked | 17 pairs computed from the declared oklch tokens (`npm run contrast`): all text ≥ 5.3:1, controls and chart lines ≥ 5.3:1. Rendered contrast over the two faint radial tints was not measured separately. |
| UI | Checked | Stop/Read buttons are distinct nodes; hover updates the chart summary; empty, failure, stopped and reading states each have their own copy. |

## 3. Findings and fixes (reviewer findings reproduced and corrected)

| Sev | Location | Finding | Fix | Recheck |
| --- | --- | --- | --- | --- |
| High | `src/lib/blockscout.ts` | Lists cut at 1,000 rows, cards said Total | No page cap, Stop keeps partial rows, progressive snapshots, per-card window labels | Stopped read shows "Gas spent, newest 1,000 transactions / 1,000 transactions read, more remain"; 3-min watch paged past 14,000 rows |
| Med | `src/components/AddressForm.tsx` | Stop restarted the read | Distinct keys + preventDefault | 1 submit, button back to Read history, +1 in-flight response only |
| Med | `src/lib/blockscout.ts`, `src/lib/metrics.ts` | Pending rows became 1970 points | Drop rows without timestamp; skip t=0 in series | Axis starts "May 1, 2026" / "Dec 2, 2024"; unit test |
| Med | `src/App.tsx` | All-fail read said No activity | "Could not read this address" + failure status | Offline step verified |
| Med | `src/lib/metrics.ts`, `src/App.tsx` | Transaction count mixed lists | `signedCount`; status line without a count | "Fees on 10 transactions this wallet signed"; unit test |
| Med | `src/lib/chart.ts` | Axis never showed 0; flat series got 1.0 scale | `yScale()` floor/mid/ceiling, flat → [0] | Lowest label "0"; unit tests |
| Med | `src/components/LineChart.tsx` | 6 px labels at 390 | ResizeObserver-sized viewBox | 12 px at 320/390/1440 |
| Med | `public/og.png` | Blank bars | Regenerated with name and line | Image inspected |
| Med | `src/App.tsx` | h1 was a slogan | Task-naming h1, lede, og:title | Verified |
| Med | `src/App.tsx` | Coverage above the cards | Moved after the charts | 191 px heading-to-card at 390 |
| Low | `src/App.tsx` | Wallet statement twice | Footer shortened | One occurrence |
| Low | `README.md` | Cited missing files | Scripts and artifacts committed | Paths resolve |

Found during this revision: an address the explorer has never seen is treated as an empty history rather than a failure (`pageAll` maps a 404 on an empty list to no rows); the counters request now retries twice because it was the first casualty of 429 pressure.

## 4. Verification

- `npm run typecheck`: passed.
- `npm run build`: passed (`dist/index.html`, `dist/assets/index-*.css`, `dist/assets/index-*.js`, fonts, favicon, og.png).
- `npm test`: 12 passed, 0 failed.
- `npm run contrast`: 17 of 17 pairs pass.
- `npm run verify` (headless Chromium 156 via Playwright 1.64, viewports 390×844, 1440×900, 320×700): 35 of 35 checks passed on the final export. Live explorers were read; the run took about four minutes. The console carried "Failed to load resource" notes for explorer 429 answers (retried by the client) and for the deliberately blocked offline step; no page errors.
- Screenshots (final export): `artifacts/screenshots/390-first-screen.png`, `390-stopped-read.png`, `1440-dashboard.png`, `320-dashboard.png`, `390-offline.png`.

## 5. Completion

Complete for the stated scope. Remaining limitations: a full read of a very busy wallet takes on the order of an hour because of the explorers' rate limit (shown progressively, stoppable); the explorers' counters can be lower than the rows read, so some cards say "more remain" rather than "N of M"; screen-reader, native zoom and physical-device checks were not performed.
