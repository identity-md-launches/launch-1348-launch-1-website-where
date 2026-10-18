# SweepDust design system

Extracted from the implemented `web/` source on 2026-10-18. The production export is root `dist/`. Root `src/` and the root package retain the earlier Walletscope application and do not build this export.

## Overview

SweepDust is an Ethereum token inventory and batch sale tool. Its main sequence is scan, filter, select, review and confirm. A wallet address can be scanned without connecting; signing always requires the connected owner on Ethereum.

The visual idea is a clear wallet inventory with a mint sweep summary. Warm neutral space, dark green text, one green primary action and a small token-flow drawing support that idea. Live data, approximate previews and exact transaction amounts have distinct labels. The scanner appears on the first phone screen; there is no separate marketing landing page.

## Colors

Canonical definitions are in `web/src/styles.css`. Keep its existing OKLCH notation. Components use semantic tokens; primitive ramps define the values.

| Semantic token | Implemented value / reference | Use |
| --- | --- | --- |
| `--color-bg` | `--stone-50`: `oklch(98% 0.005 100)` | Page and soft input background |
| `--color-bg-surface` | `oklch(100% 0 0)` | Scanner, inventory, fields and dialogs |
| `--color-bg-muted` | `--stone-100`: `oklch(95.5% 0.008 100)` | Disabled actions, avatars, small counts |
| `--color-bg-hover` | `oklch(92% 0.018 150)` | Neutral control hover |
| `--color-border` | `--stone-200`: `oklch(88% 0.012 100)` | Input, inventory and row separators |
| `--color-text` | `--forest-950`: `oklch(23% 0.026 155)` | Headings, primary data and focus |
| `--color-text-secondary` | `--stone-600`: `oklch(47% 0.02 145)` | Supporting text, labels and unavailable states |
| `--color-accent` | `--forest-600`: `oklch(41% 0.09 160)` | Primary action fill and links |
| `--color-accent-hover` | `--forest-700`: `oklch(35% 0.075 160)` | Primary action hover |
| `--color-on-accent` | `oklch(100% 0 0)` | Primary button text |
| `--color-accent-soft` | `--forest-100`: `oklch(94% 0.025 150)` | Sweep summary, selected rows and confirmation explanation |
| `--color-ok` | `oklch(36% 0.085 155)` | Ready and confirmed labels, accompanied by text/check mark |
| `--color-bad` | `oklch(43% 0.15 28)` | Invalid input, failure and flagged-token labels |
| `--color-warning`, `--color-warning-bg` | `oklch(42% 0.08 65)`, `oklch(96% 0.025 85)` | Pending-transaction notice |
| `--color-focus` | `--forest-950` | 2px outline, offset 3px |
| `--color-art-line`, `--color-art-soft`, `--color-art-bright` | `oklch(77% 0.065 150)`, `oklch(93% 0.043 150)`, `oklch(86% 0.12 150)` | Decorative desktop token flow only |

`web/public/favicon.svg` is the local brand mark, using `#17352b` and `#b7e6bd`. The share image uses the same palette. There is one light theme. Status is also conveyed by words, icons or a disabled control. Rendered solid pairs measured in both engines include primary text/surface 16.69:1, secondary/page 6.41:1, secondary/mint 5.71:1, button text/fill 8.41:1, error/surface 8.76:1 and pending text/background 7.67:1. These are measurements of those identified token pairs, not every composited state; see the validation record for coverage limits.

## Typography

The interface uses local system fonts with no font download:

- `--font-sans`: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- `--font-mono`: `ui-monospace, "SFMono-Regular", Consolas, monospace`, used for contract addresses.
- Weights: 400 and 600.
- Six sizes: `--text-xs` 12px, `--text-sm` 14px, `--text-base` 16px, `--text-lg` 20px, `--text-xl` 32px, `--text-display` 48px.

Body line height is 1.5. The display heading is 48px/1.08 with −0.045em tracking; it becomes 32px at 820px and below, with 1.1 line height on phones. Section headings are 20px/1.3 with −0.02em tracking; phone inventory and summary headings use 16px. Prose and labels use natural casing and letter spacing. Numbers use tabular figures.

Inputs use 16px on phones. Compact amounts have an approximation sign and an exact counterpart in token details or the review. Full token symbols are retained and wrap. Exact values and full addresses use `overflow-wrap: anywhere`; no balance or transaction amount uses an ellipsis. The shortened header address is only a connection identity; review shows the complete sender and token addresses.

## Layout

Shared page edges are `.top`, `main` and `.foot`: a maximum 1200px content width, with 40px side margins on wide screens, 24px below 1050px, and 16px below 600px. The spacing vocabulary is primarily 4, 8, 12, 16, 20, 24, 32, 44 and 56px. Fields and their labels stay grouped; larger gaps separate tasks.

The desktop introduction uses a 1.2fr/0.8fr grid with a decorative SVG flow. The scanner follows immediately. The workbench uses a flexible inventory and a 304px sweep summary, narrowing to 270px at 1050px. At 820px it becomes one column and the compact summary moves above the inventory. Below 600px the illustration is removed, the address field and scan action stack, token rows become a three-column mobile list, and exact review rows become vertical blocks. At 350px avatars disappear to preserve room for names and values.

The inventory is a semantic list. Its desktop header aligns token/scan balance, indexed USD value and gross IMD quote. Balance and portfolio labels identify the scan snapshot; a confirmed sale prompts a new scan for fresh balances. Mobile rows show the quote on its own line. Forty rows are displayed initially; “Show more” expands the list. Search, range and route filters precede the rows they affect. Hidden selections are counted in the sweep summary and remain explicit in the review.

Dialogs are centered on desktop, inset bottom sheets below 600px, with `100dvh` height limits, inner scrolling, contained overscroll and safe-area padding. The background is inert and cannot scroll while a dialog is open. No sticky action covers list content.

## Elevation & depth

The page is deliberately flat. Borders define scanner/inventory structure and input boundaries; mint backgrounds define selection and the sweep summary. Only dialogs cast a shadow: `0 24px 80px oklch(18% 0.02 155 / 0.18)`. Their fixed backdrop is `oklch(18% 0.02 155 / 0.4)` with 4px blur, at z-index 40. The skip link is z-index 30 when focused. No surface combines a decorative border and shadow.

## Shapes

Desktop scanner, inventory and summary use 18px corners; phone versions use 16px. Inputs use 10px, buttons 11px, wallet rows and confirmation explanations 12px, and dialogs 20px. Small token avatars use 11px desktop and 9px mobile corners. Counts use 6px corners. Keep full text outside decorative clipping; the SVG mark supplies its own rounded geometry.

## Components

| Component / source | Purpose and behavior |
| --- | --- |
| `App`, `web/src/App.tsx` | Owns read-only/connected scan, cancellation, progressive data, selection, pending recovery, review and confirmation state. Account/chain changes invalidate the active review. Connecting an already scanned address preserves its inventory and selection; the sale review refreshes them. |
| `.scanner`, `.scan-form` | Explicitly labeled address field, inline validation, enabled scan action before reading, progress and stop control. Invalid addresses focus the field. |
| `TokenList`, `web/src/components/TokenList.tsx` | Search; inclusive min/max USD bounds; sort; route filters; selection of shown routes; exact details; refunds; empty/error/loading states. Range filters explain exclusion of unpriced tokens. Flagged tokens require individual selection. |
| `.sweep-summary` | Selected count, hidden selections, estimated net IMD, fee/slippage/gas terms, review action and optional standard-confirmation mode. |
| `ConfirmDialog`, `web/src/components/ConfirmDialog.tsx` | Exact token inputs, refreshed quote, per-token floor, fee destination, net/minimum net and estimated wallet requests. Focus trap, inert background, immediate focus restoration, Escape/Cancel before submission. Signing and mining progress keep the review visible. |
| `ConnectSheet`, `web/src/wallet/ConnectSheet.tsx` | One header connect control. Named EIP-6963 extensions, mobile wallet-browser links, Coinbase Smart Wallet, rejection messages, wrong-chain switch and disconnect. All rows retain official local wallet marks. |
| `Icon`, `web/src/components/Icon.tsx` | Local outline SVG set with `currentColor`, decorative `aria-hidden`, 1.7px strokes and explicit sizes. Icon-only close controls have accessible names. |
| `.btn-primary`, `.btn-secondary`, `.text-button` | Primary fill, neutral outline and understated text action. When a selected sweep is actionable, its review button takes primary emphasis and Scan wallet becomes secondary. Hover/focus/pressed/disabled states are explicit. |
| `.coverage`, `.questions`, `.token-details` | Native disclosures for deeper search, coverage, exact data and frequently asked questions. They retain native keyboard interaction and a visible marker. |

All focus indicators use `:focus-visible`. Controls aim for 44px hit areas; checkbox labels supply larger targets than the visible checkbox. Press feedback uses scale 0.96 with a 150ms explicit-property transition. The only continuous animation is a loading spinner. Reduced-motion preferences remove animations and transitions. Forced-colors mode preserves system outlines and selected-state boundaries.

## Do’s and don’ts

- Reuse the shared page edges, semantic color tokens and six-step type scale for another surface.
- Keep exact transaction details in the review. Reuse `fmtPreview` only with its approximation cue and an exact disclosure.
- Place controls above their affected data. Label value sources and distinguish a missing quote from a missing balance.
- Keep loading, cancellation, unknown receipt, failure and confirmed success distinct. A pending token cannot be selected again.
- Preserve the native disclosure and modal keyboard behavior when extending a component.
- Use primary fill for the current consequential action. Keep wallet identity and utility controls compact.
- Do not introduce remote fonts, token-logo requests, marketing cards inside the inventory, uppercase kickers, hidden addresses or background decoration that competes with the workbench.

For another page, start with the shared content width and heading scale, use an existing field/button pattern, and put one clear task above supporting disclosures. Test 320px reflow, keyboard focus, long addresses and actual disabled/error states before exporting.

Design guidance: Jakub Krehel’s Better Interface, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Documentation method: Paul Bakaus’s Impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). The retained notices and license texts are in `docs/better-interface-LICENSE.txt`.
