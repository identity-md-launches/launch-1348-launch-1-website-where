# Walletscope design system

Extracted from the final source on 2026-10-11. All tokens live in `src/styles.css`; there is no framework theme file. Components are plain React with class names from that stylesheet.

## Overview

Walletscope is a single-page, read-only analytics tool for people who want a quick, honest picture of a wallet on Ethereum, Base and Robinhood Chain. The visual character is a calm dark "ink" surface with warm off-white text, one warm amber accent reserved for the primary action and focus, and four softly saturated chart hues. Headlines and big numbers are set in a serif display face (Fraunces); everything else is the system sans. Density is relaxed: cards, charts and notes are separated by space first and by surface tone second, with borders used only where a control or a disclosure needs an edge.

System-wide rules: one filled action per view, one `<h1>`, a six-step type scale, 4 px spacing steps, rounded surfaces (20 px cards, 12 px controls), `oklch()` for every color. Page-specific arrangement that is not a rule: the intro headline over the lookup form, and the five-card metric row followed by a two-column chart grid.

## Colors

Defined in `src/styles.css` under `:root`. Primitives are named by hue and are never used in a component; components use only the semantic tokens.

Primitives (oklch):

| Token | Value | Notes |
| --- | --- | --- |
| `--ink-950` | `oklch(0.17 0.018 262)` | page |
| `--ink-900` | `oklch(0.21 0.02 262)` | surface |
| `--ink-800` | `oklch(0.26 0.022 262)` | raised surface, badge |
| `--ink-700` | `oklch(0.34 0.024 262)` | decorative border, chart grid |
| `--ink-500` | `oklch(0.64 0.02 262)` | muted text, control borders |
| `--ink-300` | `oklch(0.76 0.016 262)` | secondary text |
| `--ink-100` | `oklch(0.92 0.01 262)` | unused step kept for a lighter surface if needed |
| `--ink-50` | `oklch(0.97 0.006 90)` | primary text (warm) |
| `--amber-300` / `--amber-400` / `--amber-900` | `oklch(0.86 0.12 80)` / `oklch(0.8 0.14 75)` / `oklch(0.28 0.06 70)` | accent ramp |
| `--mint-400`, `--sky-400`, `--lilac-400`, `--coral-400` | see source | chart and status hues |

Semantic tokens and their jobs:

| Token | Points at | Use |
| --- | --- | --- |
| `--color-bg-page` | ink-950 | `body` background (with two faint radial tints) |
| `--color-surface` | ink-900 | cards, inputs, coverage note, empty state |
| `--color-surface-raised` | ink-800 | trend badge, secondary button hover, wordmark tile |
| `--color-border` | ink-700 | decorative borders (`.method`), chart gridlines |
| `--color-border-control` | ink-500 | input and select borders (measured 5.3:1 on surface) |
| `--color-text-primary` / `-secondary` / `-muted` | ink-50 / ink-300 / ink-500 | body, labels and descriptions, footer and placeholder |
| `--color-accent-solid` / `--color-accent-hover` / `--color-accent-text` | amber-400 / amber-300 / ink-950 | the one filled button (`.button-primary`) |
| `--color-focus` | amber-300 | 2 px `:focus-visible` outline everywhere |
| `--color-positive` / `--color-negative` | mint-400 / coral-400 | profit/loss badge text, inline error text and invalid border |
| `--chart-gas` / `--chart-buy` / `--chart-sell` / `--chart-pnl` | lilac / mint / sky / amber-300 | one hue per metric, used for the line and the hover dot |

Measured WCAG 2 ratios (computed from the declared tokens with `test/scratch/contrast.mjs`): primary text on page 17.5:1, secondary on surface 8.3:1, muted on surface 5.3:1, button label on accent 10.1:1, error text on page 7.8:1, chart lines on surface ≥ 8.6:1, control border on surface 5.3:1. The decorative `--color-border` is 1.5:1 and is never the only boundary of a control. There is no light theme.

## Typography

- Display: `--font-display: 'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif`, weight 600 only, loaded from `public/fonts/fraunces-latin.woff2` (latin subset, `font-display: swap`, `font-optical-sizing: auto`). Used for the wordmark, `h1`, and metric values.
- Body: `--font-body: system-ui, …` for everything else. Mono: `--font-mono: ui-monospace, …` for the address input and the dashboard address heading.
- Scale (six steps): `--text-xs` 13 px, `--text-sm` 14 px, `--text-base` 16 px, `--text-lg` 20 px, `--text-xl` 28 px, `--text-2xl` `clamp(2.125rem, 1.5rem + 3vw, 3rem)`.
- Roles: `h1` 2xl / 1.08 / −0.015em, `text-wrap: balance`. `h2` (dashboard address) xl mono. `h3` metric and chart labels base or sm at weight 500–600. Lede lg / 1.45 secondary color, `text-wrap: pretty`. Body 1.55. Captions xs secondary.
- Numbers: `.num` applies `font-variant-numeric: tabular-nums`; use it on any value that changes.
- Inputs stay at 16 px on every viewport, so iOS does not zoom.
- Root has `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale`.

## Layout

- Container: `.wrap` is `min(100% - 2 × 16px, 72rem)` on narrow screens and `min(100% - 2 × 32px, 72rem)` from 40rem up, centered.
- Spacing scale: `--space-1` 4 px through `--space-12` 48 px. Within a group use 4–8 px; between groups 16–32 px.
- Logical properties throughout (`margin-inline-start`, `padding-block`, `inset-inline-start`).
- Intro column is capped at 44rem; the lede at 36rem; the method list at 70ch.
- Metric cards: `.metrics` grid `repeat(auto-fit, minmax(15rem, 1fr))`, gap 12 px, so cards wrap by content width rather than by device breakpoints.
- Charts: `.charts` is one column, two columns from 56rem.
- Lookup form: `.lookup-row` flex with wrap; the input is `flex: 1 1 18rem`, so the button drops below it under about 26rem.
- Verified in headless Chromium at 320, 390, 820 and 1280 wide: no horizontal overflow at any of them. Native 200% zoom was not tested.

## Elevation & Depth

Flat by default with two tonal layers: page (`ink-950`) and surface (`ink-900`). Cards and charts add `--shadow-raised` (a 1 px inner highlight plus a soft 24 px shadow) for lift. Controls use a 1 px `--color-border-control` border for structure. The method disclosure uses a decorative 1 px `--color-border`. No overlays, dialogs or z-index stacking beyond the skip link (`z-index: 10`).

## Shapes

- `--radius-lg` 20 px: cards (`.metric`, `.chart`, `.empty`).
- `--radius-md` 12 px: inputs, select, buttons, coverage note, method box.
- `--radius-sm` 8 px: skip link, wordmark hit area.
- Pill (999 px): trend badge.
- Icons: a single inline SVG wordmark mark; the select's chevron is a data-URI SVG at 1.75 px stroke beside 16 px regular text.

## Components

- **AddressForm** (`src/components/AddressForm.tsx`): visible label, mono input with example placeholder, primary button "Read history" that becomes a secondary "Stop reading" while busy. Validates on submit; on failure sets `aria-invalid`, points `aria-describedby` at the inline error and refocuses the field. Hint text otherwise.
- **Buttons** (`.button`, `.button-primary`, `.button-secondary` in `src/styles.css`): 48 px tall, 120 ms color transition, `scale: 0.96` on press (disabled under reduced motion), hover only under `@media (hover: hover)`. One primary per view.
- **Select** (`.select`, used in `src/App.tsx` for the chain filter): native `<select>` with a visible label, custom chevron, same metrics as the input.
- **MetricCard** (`src/components/MetricCard.tsx`): label (`h3`), display-face value, optional detail line, optional `trend` that renders a "Profit"/"Loss" text badge so sign is never color-only.
- **LineChart** (`src/components/LineChart.tsx`): inline SVG step line of a cumulative series, viewBox 640×260, props `title`, `description`, `points`, `field`, `color`. `figure` with `aria-labelledby`/`aria-describedby`; the SVG has `role="img"` and an `aria-label` carrying the latest value. Pointer hover shows a cursor line, dot and updates the text summary; the summary shows "Today" plus the latest value otherwise. Empty series renders a text empty state.
- **Status region** (`.status` in `src/App.tsx`): a persistent `role="status"` live region that lists per-chain progress while reading and a one-line result afterwards.
- **Coverage notes** (`CoverageNotes` in `src/App.tsx`): a list on `--color-surface` stating rows read versus explorer totals, cuts, missing internal transfers and per-chain errors with a link to the explorer.
- **Empty state** (`.empty`): title plus one sentence pointing to the next action.
- **Method disclosure** (`.method`): native `<details>` explaining the metric definitions.

## Do's and Don'ts

- Start a new page from `.wrap`, a `<main id="main">`, one `h1` in the display face, and the skip link.
- Use `--color-accent-solid` only on the single primary action; secondary actions use `.button-secondary`. Never put the accent on static text.
- Use chart hues only for their metric: lilac gas, mint buy, sky sell, amber profit/loss. Add a new hue only if a new metric must be told apart at a glance.
- Keep everything in `oklch()`; add a semantic token rather than reusing a primitive or borrowing a token for another role.
- Pair any color-coded state with text (as the trend badge does).
- Keep inputs at 16 px, hit areas at 48 px, and rely on the global `:focus-visible` outline instead of custom focus styles.
- Do not add a light theme, modals or motion beyond the 120 ms color transitions without extending the tokens first.

Recipe for another page: copy the masthead and skip link from `src/App.tsx`, place content in `.wrap`, use `.metric`/`.chart` cards for data, `.coverage`-style notes for caveats, and the existing button and field classes for controls.
