# SwarmSweep design system

Extracted from the final `web/` source on 2026-10-16. The root legacy Walletscope files are not the source of the SwarmSweep export.

## Overview

SwarmSweep is an Ethereum wallet tool: connect, inspect verified token holdings, select live Uniswap v4 routes, review proceeds and confirm. It retains the merged site's warm neutral surfaces, blue actions and compact table. The first phone screen contains the product, connect control and sale actions. Holdings and sale eligibility are separate concepts throughout the interface.

The page uses one primary heading, a summary above the actions, a disclosure for discovery coverage, then the token list. The main product idea is a readable wallet inventory with explicit availability states. There is no decorative animation or remote font dependency.

## Colors

The canonical palette is `web/src/styles.css`; components consume semantic tokens.

| Token | Implemented value / reference | Role |
| --- | --- | --- |
| `--color-bg` | `--gray-50`, `oklch(97.5% 0.004 80)` | Warm page background |
| `--color-bg-surface` | `oklch(100% 0 0)` | Summary, table and dialogs |
| `--color-bg-muted`, `--color-bg-hover` | `--gray-100`, `oklch(94.5% 0.005 80)` | Tonal states |
| `--color-text` | `--gray-950`, `oklch(17% 0.015 80)` | Primary text |
| `--color-text-secondary`, `--color-text-disabled` | `--gray-600`, `oklch(50% 0.012 80)` | Secondary text and unsupported holdings; still readable |
| `--color-border` | `--gray-200`, `oklch(89% 0.006 80)` | Structural separators |
| `--color-accent` | `--blue-600`, `oklch(42% 0.11 255)` | Primary button fill and links |
| `--color-accent-hover`, `--color-accent-active` | blue 700 / 800 | Interactive states |
| `--color-on-accent` | `oklch(100% 0 0)` | Primary button text |
| `--color-ok` | `oklch(40% 0.12 150)` | Confirmed sold status |
| `--color-bad` | `oklch(45% 0.17 25)` | Confirmed unsold / failure status |
| `--color-focus` | `--gray-950` | Two-pixel keyboard outline |

Status colors always accompany text. A holding with no route has muted text, a visible disabled Select checkbox, and a reason. Its balance remains legible. There is one light theme. The measured probe passed its applicable text contrast checks; its background-resolution exclusions and the connected-state review are recorded in `VALIDATION.md`. A Chromium canvas conversion of the resolved color tokens measured text/page 17.72:1, secondary text/surface 5.97:1, primary-button text/fill 8.52:1, route text/background 7.17:1, success 7.43:1 and error 6.66:1. These measurements cover those solid token pairs, not every composited state.

## Typography

Two system font families: `--font-sans` (`ui-sans-serif`, system-ui, Apple/Segoe/Roboto/Helvetica fallbacks) and `--font-mono` (`ui-monospace`, SF Mono, Menlo, Consolas, monospace). No font download is needed. Weights are 400 and 600.

The five sizes are 13px (`--text-xs`, notes), 14px (`--text-sm`, table and addresses), 16px (`--text-base`, body and controls), 20px (`--text-lg`, summary and section headings), and 28px (`--text-xl`, page title). Body line height is 1.5. The heading is 600 weight, 1.1 line height and −0.02em tracking. Numbers use tabular figures. Addresses, raw integers and formatted balances wrap instead of clipping. `.tokens .note` also wraps anywhere so exact quoted proceeds and confirmed outcome amounts retain every digit. `.tokens .pill` uses normal whitespace and wraps at every width, including desktop two-leg routes.

`fmtAmount` performs exact bigint-to-decimal formatting with grouping, including unusual decimals. It never rounds a wallet balance through a JavaScript Number. Missing decimals are explicitly shown as raw units. The token's full address and a disclosure containing raw units and its launch transaction are available on each row.

## Layout

`--content-width` is 960px. The outer page uses 16px inline margins. The spacing steps are 4, 8, 12, 16, 24, 32 and 48px. Groups have more space between them than their internal controls.

At 640px and above the summary has three columns and tokens use a fixed-layout table. Under 640px, the summary has two columns with proceeds spanning both; Review selected spans the action row; Review all routes and Refresh routes share the next row. The token table becomes a labelled grid: selection, token and balance on the first row; live route and IMD quote below. Its tracks are `44px minmax(0, 1fr) minmax(0, 1fr)`, so long values cannot force the page wider. Full addresses and long exact amounts wrap with `overflow-wrap: anywhere`. Chromium and WebKit checks exercised a 64-character symbol, 39-digit input and long quote/minimum at 320, 390 and 1440px. Desktop selection occupies 72px; its label is below the checkbox, avoiding overlap with the token name. At 320/390 the selection track remains 44px.

Sale-review tables use `table-layout: fixed`. Sheets have a single `minmax(0, 1fr)` grid column and children with `min-width: 0`; totals rows, labels and values can also shrink. Exact values retain `overflow-wrap: anywhere`, with `word-break: break-word` on totals. This keeps full amounts and fee labels reachable without horizontal scrolling in WebKit at 320 and 390px. Taller reviews scroll vertically, and focusing confirmation does not move the sheet horizontally.

The top bar wraps when the connected address and disconnect control need more space. The wallet dialog becomes a bottom sheet below 640px and is centered above that width. In the previous implementation check, real mainnet holdings were inspected at 320, 390 and 1440px without horizontal overflow; fixture interactions additionally covered 768px. Native zoom, RTL and translated layouts were not verified.

## Elevation & Depth

The page, summary and table are flat surfaces with structural borders, not stacked cards. Dialogs use `--shadow-sheet`: `0 1px 2px oklch(0 0 0 / 0.06), 0 12px 32px oklch(0 0 0 / 0.14)`. The overlay uses `--color-backdrop: oklch(17% 0.015 80 / 0.45)`.

## Shapes

Radii: `--radius-sm` 6px for small controls, `--radius-md` 10px for buttons, and `--radius-lg` 16px for main surfaces and sheets. Primary controls are at least 44px high; wallet-choice rows are 48px. Status labels have rounded backgrounds. The local favicon is the original sweep mark; the 1200×630 share card is rendered from `web/scripts/og.html` with the corrected product description.

## Components

- **ConnectSheet** (`web/src/wallet/ConnectSheet.tsx`): EIP-6963 named browser wallets, Coinbase Smart Wallet and phone links to MetaMask, Coinbase, Rabby and Phantom. Named providers remain selectable on phones even without `window.ethereum`; external open-in links appear when the phone has no available injected provider. The connected state offers Disconnect and a chain switch when required. The sheet moves focus inside, wraps Tab/Shift+Tab, closes with Escape and restores focus. The background is inert while open. Connection errors distinguish a missing browser provider (with wallet-browser/Coinbase recovery), an actual rejection, and other failures; the note is a polite status message.
- **Summary and discovery status** (`web/src/App.tsx`): held/quoted counts, selected count, selected net IMD estimate, Review selected, Review all routes and Refresh routes. Tokens initially remain unselected. Progress names the current read and reports candidate-path counts while asynchronous route batches continue beyond 24 candidates. Completed, partial, empty and failed discovery have separate text. The coverage disclosure contains the block, source scope, pricing errors and individual read failures. Late results cannot overwrite a different wallet or chain. Direct routes are independent of SwarmExit owner settings. Discovered holdings remain visible while quotes are checked.
- **TokenList** (`web/src/components/TokenList.tsx`): balance, gross IMD quote, optional USD annotation, contract address, raw units, provenance and live route. Visible Select checkboxes, Select all routes, Clear selection and a selected count make selection explicit. Unsupported holdings remain visible and disabled for selection. Partial routes state the exact input amount and that the remainder stays in the wallet. Pool details disclose the quote block and complete pool IDs. Pending outcomes link to the transaction and never appear Sold. Confirmed transaction outcomes take precedence over later route-read errors. After a successful holdings refresh, completed outcomes are retained as `previousResult` separately from the pending selection lock; unsold holdings with fresh routes regain their checkboxes. Unresolved transactions remain locked.
- **ConfirmDialog** (`web/src/components/ConfirmDialog.tsx`): selected tokens, exact input amounts, partial-balance labels, quoted gross IMD, per-token minimums, 2% treasury fee, net estimate and gas information. Pre-approval quotes are distinguished from simulations. It keeps focus inside, restores the trigger on close, and prevents closing while submitting. It explains the Permit2 approval and router authorization, the ten-minute expiration, sequential atomic sales and network gas. The trigger is captured before quote loading so Escape/Cancel returns focus correctly; after a completed sale, the token heading is the fallback focus target.
- **Buttons** (`.btn` variants): blue primary, bordered secondary, and compact utility variant. Hover, active, disabled and keyboard-focus states are explicit. Transitions name background, border, color and scale and last 120ms; press scale is 0.96. Reduced motion removes transitions and press scaling.

## Do's and Don'ts

- Reuse the existing page width, spacing, five-size scale and semantic colors. Add a section in normal reading order below the controls it depends on.
- Use the filled action for the current primary step; keep alternatives secondary.
- Preserve full token addresses and exact amounts. Secondary details can be collapsed behind a labelled disclosure, not truncated.
- Treat “unknown”, “no balance”, “no route”, “reverted” and “pending” as different states. Do not replace a failed read with zero or a failed simulation with a successful-looking quote.
- Keep data checks in the library modules and presentation in the components. Do not add remote visual assets or depend on a wallet token symbol for identity.

Review guidance: Jakub Krehel's Better Interface, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT); documentation guidance adapted from [Paul Bakaus's Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0). The provided notices are retained in [docs/better-interface-LICENSE.txt](docs/better-interface-LICENSE.txt).
