# Walletscope

A static website that reads a wallet address's history on **Ethereum**, **Base** and **Robinhood Chain** and shows a dashboard: wallet age and creation date, total gas spent, token buy volume, token sell volume and realized profit/loss, each with a cumulative line chart. No wallet connection; the user pastes an address.

Data is read in the browser from each chain's public, keyless Blockscout explorer (`eth.blockscout.com`, `base.blockscout.com`, `robinhoodchain.blockscout.com`). There is no backend and nothing is stored.

## Stack

Vite 6, React 19, TypeScript 5. Charts are hand-drawn inline SVG (no chart library). One bundled display font (Fraunces, latin subset, `public/fonts/`), system sans for body text. Playwright is a dev dependency for the verification scripts only; nothing from it ships.

## Install

```sh
npm install
npx playwright install chromium   # only for `npm run verify` and `npm run og`
```

## Develop

```sh
npm run dev
```

## Rebuild the static export

```sh
npm run typecheck   # tsc --noEmit
npm run build       # writes dist/ with relative (./) asset URLs
```

`dist/` is committed. Vite's `base` is `./`, so the export works from any subpath, an IPFS gateway or an ENS name without server rewrites. There is a single page and no client routing.

## Preview the export locally

```sh
npm run preview     # serves dist/ on a local port
```

## Publish

Copy the contents of `dist/` to any static host (IPFS, S3, GitHub Pages, Netlify). No environment variables, keys or server configuration are needed. The explorers must be reachable from the visitor's browser.

## How the metrics are defined

All amounts are in ETH because all three chains pay gas in ETH. USD figures use the explorer's current ETH price, not historical prices.

| Metric | Definition |
| --- | --- |
| Wallet age / creation date | Earliest transaction, internal transfer or token transfer touching the address. For a read that was stopped early, the explorer's record of the first transaction is used when available; otherwise the card says "Earliest read". |
| Total gas spent | Sum of the fee for every transaction the wallet signed (explorer `fee.value`, else gas used × gas price). The detail line counts those signed transactions. L1 data fees on Base and Robinhood Chain are not included. |
| Token buy volume | ETH the wallet paid in transactions that also delivered an ERC-20/721/1155 token to it. |
| Token sell volume | ETH the wallet received (directly or via internal transfer) in transactions where it sent a token away. |
| Profit / loss | Sell volume − buy volume − gas spent. Realized, in ETH. Unsold holdings are not priced. Token-for-token swaps with no ETH leg are not counted. |

### How the history is read

Each chain's transactions, token transfers and internal transfers are paged newest first, 50 rows a page, until the explorer reports no next page. There is no page cap. The dashboard updates about every two seconds per chain while a read runs, and **Stop reading** keeps the rows read so far. While a list is incomplete, each card is labelled with the window it covers ("Gas spent, newest 2,187 transactions" and "2,187 of 78,411 transactions read"); a complete read is labelled "Total gas spent". Pending transactions (no block, no timestamp) are dropped. Each request times out after 20 s; 429 and 5xx answers are retried with backoff.

The public explorers allow roughly three pages a second per client, so a very busy wallet (tens of thousands of transactions, hundreds of thousands of token transfers) takes on the order of an hour to read in full. The explorers' per-address counters are also unreliable for busy addresses (one reports 97 transactions for an address whose list pages past 14,000), so the cards say "N transactions read, more remain" instead of "N of M" when the counter is missing or lower than the rows read.

## Layout

```
index.html              page shell, meta tags, favicon/og links
public/                 favicon.svg, og.png, fonts/fraunces-latin.woff2
src/main.tsx            entry
src/App.tsx             page, lookup flow, dashboard, chain filter, coverage notes
src/components/         AddressForm, MetricCard, LineChart
src/lib/chains.ts       the three chains and their explorers
src/lib/blockscout.ts   explorer client (paging, retry/backoff, timeouts, partial snapshots)
src/lib/metrics.ts      pure metric computation (unit tested)
src/lib/chart.ts        chart scale helpers (unit tested)
src/lib/format.ts       number/date formatting
src/styles.css          design tokens and all styling
test/metrics.test.mjs   unit tests (npm test)
test/contrast.mjs       WCAG ratios from the declared tokens (npm run contrast)
test/verify.mjs         headless Chromium flow against dist/ (npm run verify)
test/make-og.mjs        regenerates public/og.png (npm run og)
artifacts/              validation.md and screenshots from the final export
dist/                   committed production export
DESIGN.md               implemented design system
```

## Validation performed

Commands run on 2026-10-11 against the final source; the full record, including the design review, is in `artifacts/validation.md`.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | passed, no errors |
| Production build | `npm run build` | passed; `dist/index.html`, one JS and one CSS chunk, fonts, favicon, og image |
| Unit tests | `npm test` (12 tests: metrics, pending rows, signed count, y-axis scale) | 12 passed |
| Token contrast | `npm run contrast` (WCAG 2 ratios from the declared oklch tokens) | all 17 text and control pairs ≥ 4.5:1 / 3:1 |
| Browser flow | `npm run verify` (headless Chromium, serving `dist/` under `/preview/`) | 35 of 35 checks passed; see `artifacts/validation.md` |

The browser script checks the first screen at 390, keyboard order and focus ring, inline validation, a real stopped read of the placeholder address (Stop with a real click, cut-window card labels, coverage after the charts, unscaled chart labels, zero-based axis, no 1970 axis), a complete read of a short wallet at 1440 (signed-transaction count, chart hover, two-column charts), the chain dropdown, 320 reflow, an unused address, a simulated offline read, reduced motion, console errors and failed local resource loads. Screenshots are saved to `artifacts/screenshots/`.

Known limitations: a full read of a very busy wallet is slow (see above) and the explorers answer 429 under load, which the client backs off from; those 429s appear in the browser console as resource notes. The internal-transactions endpoint can fail for busy wallets, which under-counts sell volume (stated on screen). Native 200% zoom, a screen-reader session and physical devices were not tested. `test/scratch/` is scratch space and is not part of the delivery.
