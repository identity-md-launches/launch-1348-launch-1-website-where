# Walletscope

A static website that reads a wallet address's history on **Ethereum**, **Base** and **Robinhood Chain** and shows a dashboard: wallet age and creation date, total gas spent, token buy volume, token sell volume and realized profit/loss, each with a cumulative line chart. No wallet connection; the user pastes an address.

Data is read in the browser from each chain's public, keyless Blockscout explorer (`eth.blockscout.com`, `base.blockscout.com`, `robinhoodchain.blockscout.com`). There is no backend and nothing is stored.

## Stack

Vite 6, React 19, TypeScript 5. Charts are hand-drawn inline SVG (no chart library). One bundled display font (Fraunces, latin subset, `public/fonts/`), system sans for body text.

## Install

```sh
npm install
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
| Wallet age / creation date | Earliest transaction, internal transfer or token transfer touching the address. For wallets longer than the read limit, the explorer's record of the first transaction is used when available; otherwise the card says "Earliest read". |
| Total gas spent | Sum of the fee for every transaction the wallet signed (explorer `fee.value`, else gas used × gas price). L1 data fees on Base and Robinhood Chain are not included. |
| Token buy volume | ETH the wallet paid in transactions that also delivered an ERC-20/721/1155 token to it. |
| Token sell volume | ETH the wallet received (directly or via internal transfer) in transactions where it sent a token away. |
| Profit / loss | Sell volume − buy volume − gas spent. Realized, in ETH. Unsold holdings are not priced. Token-for-token swaps with no ETH leg are not counted. |

Read limits per chain: 1,000 transactions, 1,000 token transfers and 500 internal transfers (newest first), a 60 s budget per chain and a 20 s timeout per request. The dashboard's coverage line reports the rows read versus the explorer's totals and any cut.

## Layout

```
index.html            page shell, meta tags, favicon/og links
public/               favicon.svg, og.png, fonts/fraunces-latin.woff2
src/main.tsx          entry
src/App.tsx           page, lookup flow, dashboard, chain filter, coverage notes
src/components/       AddressForm, MetricCard, LineChart
src/lib/chains.ts     the three chains and their explorers
src/lib/blockscout.ts explorer client (paging, retry/backoff, timeouts)
src/lib/metrics.ts    pure metric computation (unit tested)
src/lib/format.ts     number/date formatting
src/styles.css        design tokens and all styling
dist/                 committed production export
artifacts/            validation.md and screenshots
DESIGN.md             implemented design system
```

## Validation performed

Commands run on 2026-10-11 against the final source (see `artifacts/validation.md` for the full record):

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | passed, no errors |
| Production build | `npm run build` | passed; `dist/index.html`, one JS and one CSS chunk, fonts, favicon, og image |
| Metric unit tests | `node --test test/scratch/metrics.test.mjs` (7 tests) | 7 passed |
| Token contrast | `node test/scratch/contrast.mjs` (WCAG 2 ratios from the declared oklch tokens) | all text and control pairs ≥ 4.5:1 / 3:1 |
| Browser flow | `node test/scratch/verify.mjs` (headless Chromium via Playwright, serving `dist/` under `/preview/`) | see `artifacts/validation.md` |

The browser script checks the first screen at 390 and 320 wide, keyboard order and focus rings, inline validation, an address with no activity, a real wallet read across all three chains, the chain dropdown filter, chart hover, two-column charts at 1280, reduced-motion handling, console errors and failed local resource loads, and saves screenshots to `artifacts/screenshots/`.

Known limitations: the public explorers rate-limit clients (about 150–180 v2 requests per minute and a very small quota for the legacy route used for the first-transaction lookup), so very busy wallets show the most recent 1,000 rows per list with the cut stated on screen; the internal-transactions endpoint is slow for busy wallets and is skipped after the chain budget, which can under-count sell volume (also stated on screen). The `test/scratch/` directory is scratch space and is not part of the delivery.
