# SweepDust validation and design review

Worker record for the 2026-10-18 revision. These are actual local observations, not independent certification. Current source: `web/`; export: root `dist/`. Current evidence is in `artifacts/validation/` and `artifacts/screenshots/sweepdust-*`. Historical `docs/validation/` files belong to earlier jobs.

## Outcome and requirements

| Area | Result |
| --- | --- |
| Faster wallet/route scanning | Implemented; live reads and actual production-browser reads passed |
| USD minimum/maximum filters | Implemented; inclusive boundaries, invalid ranges, unpriced exclusion and reset passed |
| Batch approvals and sales | Implemented; atomic wallet bundle or PermitBatch plus one combined sale per 20 tokens |
| Tokens beyond Swarm | Implemented; wallet-wide index, on-chain balances, v2/v3/v4 routes and manual import |
| Appealing, responsive dust tool | Implemented and inspected in Chromium and WebKit |
| Requested domain | Source/metadata target `sweepdust.sites.imd.fun`; publication/domain binding is after this job |
| Review and repairs | Completed for the frontend and tested transaction paths, with limits below |
| Product/main action on first 390px screen | Yes; screenshot inspected |
| Source, lockfile and complete static export | Present; existing dependency/build configuration unchanged |
| Design probe | 16/16 passed |
| Known unresolved required UI failures / faked features | None found |
| Share metadata | Title, description, favicon, og:title and local 1200×630 og:image present |

Idea: a readable Ethereum inventory with a mint sweep summary, making scan, select and review the product rather than a separate landing page.

## Commands and actual results

Commands ran from the repository root unless stated. Final successful checks exited 0.

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --cache <temporary cache>` in `web/` | Existing lock installed; 46 packages audited, zero reported vulnerabilities at installation |
| `npm --prefix web run typecheck` | Strict TypeScript passed |
| `npm --prefix web run build` | TypeScript and Vite production export passed |
| `node --experimental-strip-types --test web/test/*.test.mjs` | **91 passed, 0 failed** |
| `node web/scripts/check-abi.mjs` | Deployment hash matched `f259fa26782bfa734371ae5b1cad46e56f29ea84e49c0b994e5a241087fd68a2` |
| `node --experimental-strip-types web/scripts/interact-sweepdust.mjs`, with Playwright and axe | **151 interaction checks passed in Chromium** |
| Same command with `--webkit` | **151 interaction checks passed in WebKit** |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline`, with Playwright | **16/16 passed** on the production export |
| `node --experimental-strip-types web/scripts/verify-sweepdust.mjs --out=test/scratch/live-sweepdust-final.json` | Live public-service wallet/route reads passed, with explicit coverage limits |
| `node web/scripts/browser-sweepdust-live.mjs`, with Playwright | Real production Chromium reads at `/preview/` passed, without a signer |
| `node --experimental-strip-types web/scripts/verify-sweepdust-fork.mjs` | **19 checks passed** against deployed bytecode on a disposable Ethereum fork |

The build has a nonfatal chunk-size warning: approximately 690 kB uncompressed / 207 kB gzip for the main script. No source maps, dependency directory, downloaded browser, npm archive or registry mirror is in the export. Assets and indexes are local; relative URLs were exercised under `/preview/`.

Playwright 1.64.1 was temporary verification tooling outside the repository. The assigned browser MCP returned “Chromium distribution 'chrome' is not found”; rendered checks instead used Playwright Chromium and WebKit. WebKit used temporary runtime libraries and software rendering outside the deliverable. No browser tooling was vendored into Git.

## Interaction and rendered coverage

Both engines exercised **320, 390, 768 and 1440px** layouts using explicitly simulated EIP-6963, RPC and indexer fixtures. The fixture checker sends no real wallet transactions. It covered:

- First-screen scanner, subpath assets, address validation and horizontal overflow.
- Paginated all-token discovery, a non-Swarm holding, visible unpriced balances and legacy refunds.
- Search; ready-only filter; inclusive USD bounds; invalid ranges; reset and empty states.
- Filtered selection, flagged-token exclusion, hidden picks and selection preservation when connecting the inspected address.
- Read-only ownership restrictions, wallet connection, wrong-network blocking/switch, exact amounts, fee/minimum receive and request counts.
- Two-token standard flow: two exact approvals, one PermitBatch signature and one combined sale with distinct outcomes.
- Atomic flow: one wallet request with five calls, required atomicity and no separate signature/fallback.
- Rejection, revert, unknown approval receipt, persistent reload lock and successful receipt recovery.
- RPC failure distinguished from an empty wallet; retry; manual contract import; honest cancellation.
- Long symbols, full addresses and very large exact amounts at 320/390px.
- MetaMask, Coinbase, Rabby and Phantom phone-browser links, plus Coinbase Smart Wallet.
- Keyboard-only connection, selection and review; visible focus; forward/backward modal wrap; Escape; focus return and background scroll lock.
- No script or missing-local-resource failures in the primary fixture flows.

Axe WCAG A/AA checks in disconnected, connected and review states found **zero violations and zero incomplete checks** in each engine. This is automated evidence for those states, not a screen-reader session or full accessibility certification.

## Live measurements and transaction audit

At Ethereum block **26,217,487**, the supplied public wallet had **257 verified candidates**, **191 holdings/refund entries**, **42 live quotes** and **5 partial quotes**. First holdings: **2.474 s**. First quote: **4.213 s**. Full quick scan: **37.529 s**. The indexer had no usable IMD USD price; it remained unknown. Token-specific USD filtering and IMD quotes still worked.

An earlier diagnostic run still waited for recent pool history: first quote **114.360 s**, full scan **178.958 s**, at block 26,217,409. Deferring that work and repairing the v2 target removed the bottleneck. These are observations under different public-service/current-block conditions, not a controlled benchmark or a latency promise. The final quick run disclosed **104 incomplete route searches**. The interface groups the coverage notice and retains each token's reason; deeper search remains available.

The separate real production-browser check used no wallet fixture: visible holdings in **2.506 s**, first route in **4.837 s**, zero script/console errors or failed requests. It captured the first **40 displayed rows**, stopped the remaining scan after establishing the primary read interaction, and also inspected 1440px. The 191 total comes from the complete read-only scan, not the paginated visible row count.

The local-fork checker generated a temporary signing account in memory and never saved/printed its key. Actual deployed-bytecode checks passed for:

| Path/check | Observed result |
| --- | --- |
| Two held tokens in one router transaction | Exact inputs and separate canonical outcomes reconciled |
| WETH → native ETH → v4 IMD | Passed |
| v2 → WETH → native ETH → v4 IMD | Passed |
| v3 → WETH → native ETH → v4 IMD | Passed |
| Real PermitBatch typed authorization | Accepted by deployed Permit2 bytecode for each tested sale |
| Recipient/treasury balances | Matched exact 2% per-token fee rounding and net IMD |
| Impossible minimum on one input | Entire two-token batch reverted; both inputs and both IMD balances unchanged |

**Mainnet writes: 0. Contracts deployed: 0.** All writes targeted loopback Anvil. IMD, treasury, SwarmExit, Permit2 and Universal Router were retained. Atomic smart-wallet UX/capability was checked with fixtures; standard-wallet cryptographic authorization and router execution were checked on the actual forked bytecode.

## Better Interface: six-domain review

The pinned contents/workflow and core principles for all six domains were read and applied during construction. Source and rendered checks are distinguished here.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | **Checked**: native controls/disclosures, names, associated errors, live progress, touch labels, inert dialogs, keyboard flow, focus return and motion preferences | Both engines, keyboard screenshot and axe in three states. Physical screen reader, native zoom and real phone not performed. |
| Layout | **Checked**: shared edges, grouped controls, responsive order, breakpoints, wrapping, long values and modal scrolling | 320/390/768/1440 interactions and inspected screenshots. RTL mirror/translation not performed. |
| Writing | **Checked**: action labels, ownership, indexed USD versus quote, quick/deeper coverage, partial sales, fee/minimum terms, errors and pending states | Source and walkthrough. Repeated coverage warnings grouped; unknown/cancelled data does not claim success or zero holdings. |
| Typography | **Checked**: six sizes, two weights, system sans/address mono, tabular figures, exact-value wrapping and hierarchy | Probe and stress screenshots. No remote font. OS rendering beyond tested engines is not certified. |
| Colors | **Checked**: semantic tokens, redundant status text/icons, disabled/error/active states and actual solid contrast pairs | Thirteen pairs in each engine, all ≥4.5:1, plus axe. Not every composited backdrop/display measured. |
| UI | **Checked**: restrained surfaces, coherent corners/icons and hover/pressed/focus/disabled/loading/empty/error/pending/success states | Both-engine flows/screenshots. Spinner is removed under reduced motion. No entrance system exists; 10%-speed animation replay and physical haptics not performed. |

Not applicable: dark theme, translated UI, carousel, video, drag-and-drop and server-side routes. These are not part of this product.

### Measured contrast

Actual CSS colors were rendered through each browser's canvas conversion, rather than estimating OKLCH contrast. Solid pairs (rounded): primary/surface **16.69:1**; secondary/page **6.41:1**; secondary/surface **6.76:1**; secondary/mint **5.71:1**; button text/fill **8.41:1**; hover **10.92:1**; disabled/muted **5.92:1**; ready/surface **10.40:1**; ready/mint **8.79:1**; error/surface **8.76:1**; pending/notice **7.67:1**; focus/surface **16.69:1** and focus/mint **14.10:1**.

The taste probe reports 121 background-resolution exclusions; its contrast pass alone is not the evidence for these pairs. It also reports six controls below its comfortable 44px target; they pass its 24px/spacing check and are disclosures/text links rather than scan, sale or wallet actions. Pair data and axe results are included separately.

## Findings, corrections and rechecks

No known required high/medium finding remains open. Locations reference final source. Construction failures were repaired and rechecked.

| Severity / domain | Source | Finding, fix and evidence |
| --- | --- | --- |
| High / data | `web/src/lib/inventory.ts:26`, `web/src/lib/holdings.ts:39` | Registry-only eligibility excluded ordinary tokens. Added paginated candidates, verified balances and import. Real scan found 191 holdings; non-Swarm fixtures and real v3 execution passed. |
| Medium / performance | `web/src/lib/inventory.ts:50`, `web/src/lib/inventory.ts:126`, `web/src/lib/routes.ts:282` | Serial work/history gated results. Batched necessary reads, ranked concurrently, deferred recent-log expansion and skipped pool lookup for refund-only zero balances. First quote observed at 4.213 s; holdings stream first. |
| High / transaction UX | `web/src/lib/batchSale.ts:82`, `web/src/lib/batchSale.ts:158` | Per-token approval/sale loops multiplied prompts. Added PermitBatch, combined sales and capability-gated atomic calls. Standard two-token=4 requests; atomic=1; both-engine and fork checks passed. |
| High / route integrity | `web/src/lib/markets.ts:17` | A construction v2 router literal had 41 hex digits; the real fork refused it. Used canonical Router02, added target validation and reran successful v2 execution. |
| Medium / filtering | `web/src/lib/filters.ts:5`, `web/src/components/TokenList.tsx:30` | Bounds/unknown values needed explicit semantics. Added inclusive bounds, field errors/reset and unpriced exclusion. Range/search/selection checks passed. |
| High / layout | `web/src/styles.css:116` | A large USD total widened a 320px document to 415px. Constrained flex width, wrapped exact values and retained full token symbols. Both-engine stress checks now remain at viewport width. |
| Medium / continuity | `web/src/App.tsx:116` | Connecting the inspected address restarted scanning and cleared picks. Preserve the existing view while review refreshes amounts. Four-width connection regression passed in both engines. |
| Medium / accessibility | `web/src/components/ConfirmDialog.tsx:76`, `web/src/wallet/ConnectSheet.tsx:138` | Delayed focus return, missing connected trigger ref and background scroll. Restore to the live control immediately and lock scrolling. Keyboard-only flow, modal wrap, Escape and focus screenshot passed. |
| High / recovery | `web/src/lib/batchSale.ts:40`, `web/src/lib/batchSale.ts:202`, `web/src/lib/batchSale.ts:371` | Batches required durable pending IDs and per-token attribution. Persist before waiting; reconcile ordered input/payout segments; block repeat sends and overlapping tabs. Reload, reject, revert and bad-fee tests passed. |
| Medium / writing-data | `web/src/App.tsx:230`, `web/src/lib/inventory.ts:145` | Scan balances could appear current after sale; many repeated warnings obscured coverage. Label snapshots, request fresh scan, group coverage count and retain row reasons. Source/state checks passed. |
| Medium / status honesty | `web/src/App.tsx:231`, `web/src/components/TokenList.tsx:20` | Cancelled or indexer-failed scans could imply empty; stopped rows could say “Checking”. Distinguish unscanned/stopped state and show “Not checked”. Cancellation checks passed. |

`DESIGN.md` was extracted from the corrected source, including real values, responsive behavior and components. The Better Interface and Impeccable license notices are retained.

## Limits and completion

**Complete for the stated static-site and supported-route implementation scope.** Domain publication/binding is a later IdentityMD step. No real visitor-wallet mainnet sale, independent contract audit, formal proof, physical phone, screen-reader session, native 200% zoom session or RTL session was performed. Desktop WebKit is an engine check, not a physical iPhone check.

Wallet-wide discovery uses indexed Ethereum ERC-20 candidates and chain verification, not protocol-level enumeration of every possible contract. Pagination is capped at 10,000 candidates with a warning. New/unindexed tokens can be imported. NFTs, native ETH balances, other chains/DEXs, split routing and custom hook data are excluded and disclosed.

Quick search is bounded; deeper search can be slow and public services can refuse requests. Quotes can change or fail full execution. Pending state stays conservative if submission/receipt cannot be reconciled. Disabled storage removes reload persistence; Web Locks availability varies. Earlier completed batches and separate approvals remain if later work stops. A new scan updates post-sale balances.

The export/source/lockfiles are present. No build/dependency file, environment file, Git metadata or submodule was changed. The only ignore change is an exact evidence allowlist, bounded by `artifacts/PATH-BUDGET.md` to 1,600,000 bytes; dependency and cache exclusions remain in place. Export hashes and payload-size checks are in `artifacts/validation/export.json` and `artifacts/validation/bundle-budget.json`.
