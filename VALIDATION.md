# SwarmSweep revision validation

Date: 2026-10-16. Complete for this revision's four reported defects. This is worker-side evidence, not independent certification. The accepted application and its visual system were retained; build configuration, dependencies, addresses, ABIs and transaction encoding were not changed. No real transaction was sent.

## Findings reproduced and repaired

| Finding | Reproduction on the original export | Change and final check |
| --- | --- | --- |
| `c4b75b…e88a` — candidate cutoff | Chromium and WebKit each quoted the first 24 ALPHA paths, then the same 24 after Refresh; fee 123, candidate 25, was never tried. | `web/src/lib/routes.ts:420` continues automatically in asynchronous batches of 24 until a quote succeeds or every candidate has been checked. Existing per-request/partial-quote limits and four-token concurrency stay in place. Candidate progress is reported through `sweep.ts`. Both engines now discover candidate 25 initially and on Refresh. Unit checks also cover candidate 49, all candidates reverting, a late RPC failure, and stopping after an early quote. |
| `85b205…3f1` — mobile review overflow | WebKit's long-symbol/uint128-max review had `scrollWidth=437` at both widths. At 320 its table moved to x=-101 after focus; at 390, x=-15. Chromium already fit. | `web/src/styles.css:498` and `.plan`/`.totals`: fixed table layout, a shrinkable sheet grid, zero minimum intrinsic widths and wrapping totals. Both engines now measure 320/320 and 390/390 scrollWidth/clientWidth, with table x=16. Screenshots retain the exact values and fee labels. At 320 the taller sheet scrolls vertically. |
| `5880c6…8cc8` — reverted receipt blocks selection | An unavailable approval receipt later returned a revert. Two refreshes retained the unchanged ALPHA balance and quote but rendered no checkbox. | `web/src/App.tsx:61` keeps only unresolved receipts in `pendingRef`; completed outcomes are retained separately and attached as `previousResult` after fresh holdings. Both engines restore ALPHA's checkbox and allow review after both refreshes, keep the reverted outcome visible, and keep an unresolved approval locked. Reconciliation sends no additional transaction. |
| `d92d0f…ba2` — missing wallet called a rejection | A clean context without an injected provider said the wallet declined. The generic error fixture received the same inaccurate message. | `web/src/wallet/connectionError.ts:5` classifies wrapped errors. Missing providers explain opening a wallet browser or choosing Coinbase; code 4001/user rejection alone says declined; other failures offer retry/another wallet. All three cases pass in both engines. |

Full finding IDs and dispositions are in `.imd-responses.json`. Baseline measurements are in [route-fixes-baseline.json](docs/validation/route-fixes-baseline.json). This fixture result does not assert that any particular live wallet has a usable omitted pool.

## Actual commands and results

The existing dependency installation could not execute the typechecker. The unchanged `web/` source, manifest and lockfile were copied into `test/scratch/build/web/`, with dependencies excluded from the copy; `npm ci` installed the locked dependencies there. Only that disposable copy's dependency directory was written. Source/configuration equality and export equality were checked before delivery.

Commands run from the repository root:

```sh
npm ci --prefix test/scratch/build/web --ignore-scripts --cache /tmp/swarm-revision-npm-cache
npm --prefix test/scratch/build/web run typecheck
npm --prefix test/scratch/build/web run build
node --experimental-strip-types --test test/scratch/build/web/test/*.test.mjs
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node --experimental-strip-types test/scratch/build/web/scripts/interact-routes.mjs
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node --experimental-strip-types test/scratch/build/web/scripts/interact-routes.mjs --revision-only
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/swarm-revision-browsers PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node --experimental-strip-types test/scratch/build/web/scripts/interact-routes.mjs --webkit --webkit-libs=test/scratch/webkit-runtime/libs/usr/lib/x86_64-linux-gnu
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/swarm-revision-browsers PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node --experimental-strip-types test/scratch/build/web/scripts/interact-routes.mjs --revision-only --webkit --webkit-libs=test/scratch/webkit-runtime/libs/usr/lib/x86_64-linux-gnu
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

The WebKit test runtime and its public runtime dependencies were downloaded into disposable directories; they are not application dependencies or submission assets. Its launcher was adjusted only to preserve the explicitly supplied test-library path. On a normal installation with WebKit available, `--webkit` is sufficient. The browser connector tool returned `Transport closed`; actual rendered checks instead ran through Playwright in the foreground validation scripts.

- Typecheck and production build: passed. The existing nonfatal bundle-size warning remains (main JavaScript approximately 650 kB uncompressed).
- Unit/regression suite: **61 passed**, zero failed. Three new route-search regressions supplement the accepted suite.
- Chromium: **101 general interaction checks + 31 revision checks passed**. WebKit: **101 + 31 passed**. General interactions cover 320, 390, 768 and 1440px; focused mobile review checks cover 320 and 390px. Each export was served under `/preview/` to exercise relative assets.
- The general flow covers connect, token discovery, individual/select-all/clear selection, selected-only review, keyboard selection, Escape/focus restoration, approvals, outcomes, empty/error/quote-failure states, Refresh and wrong-chain handling. Browser script/resource error assertions passed.
- The isolated pending fixture shortens only the browser's 180,000ms receipt timeout to 1,000ms. Its mock receipt is initially absent, then reverted; no real approval or sale is broadcast.
- The original export failed the expected regression assertions before edits. Final fixture records are [Chromium regressions](docs/validation/route-fixes-chromium-regressions.json), [WebKit regressions](docs/validation/route-fixes-webkit-regressions.json), [Chromium general interactions](docs/validation/route-fixes-chromium-interactions.json) and [WebKit general interactions](docs/validation/route-fixes-webkit-interactions.json).
- The root export passed **16/16 taste@1 checks**: first-screen content, metadata, responsive layout, typography, motion and measured contrast. The probe excludes unresolved backgrounds from contrast; the connected-state scripts separately measured six solid token pairs. [Probe record](docs/validation/route-fixes-design-probe.json).

## Better Interface coverage

The pinned guide's six core domains informed these focused corrections; the existing palette, type scale, components and spacing remain intact. The product and connect/review actions are visible on the 390px first screen. `dist/index.html` retains title, favicon, description, `og:title` and `og:image`.

| Domain | Checked in this revision | Limits |
| --- | --- | --- |
| Accessibility | Native labelled checkboxes, keyboard selection, Escape, restored focus, inert modal background and text statuses in both engines. Critical review text remains reachable after focusing confirmation. | No screen-reader or forced-colors session. |
| Layout | First screen and primary interactions at 320/390/768/1440; long-symbol/uint128-max review reflow in Chromium and WebKit; screenshot inspection of phone sheets and recovery. | No physical-device, native 200% zoom, RTL or localization session. |
| Writing | Missing-provider, user-rejection and other-error messages now describe the observed state and a recovery. Route progress and confirmed-revert outcomes stay explicit. | External wallet wording is outside this revision. |
| Typography | Existing five-size/two-family/two-weight system retained. Fixed table/grid widths and wrapping preserve every digit and the long symbol. | Cross-platform font rendering is not exhaustively covered. |
| Colors | Existing semantic tokens retained; six solid text/surface pairs pass 4.5:1 in both engines, with the probe's measurement exclusions retained. | Every composited/background state is not measured; there is no dark theme. |
| UI | Loading, no route, valid route, disabled selection, review, pending, reverted, refreshed and connection-error states exercised. Unknown transactions remain locked. | No real wallet signature, Coinbase service session, or slow-motion animation replay. |

Inspected final screenshots: [390 first screen](docs/validation/route-fixes-chromium-390-first.png), [missing-wallet recovery](docs/validation/route-fixes-chromium-390-no-wallet.png), [reverted-transaction recovery](docs/validation/route-fixes-chromium-390-reverted-recovery.png), [320 WebKit review](docs/validation/route-fixes-webkit-320-long-review.png) and [390 WebKit review](docs/validation/route-fixes-webkit-390-long-review.png). `DESIGN.md` documents the final source and responsive sheet behavior.

## Delivery integrity

The final production rebuild is byte-identical to the checked root `dist/`; all 44 build-copy source/configuration files match the submitted source. The nine export files include relative hashed assets and byte-identical launch/pool indexes, favicon and share image. Protected configuration, manifests and lockfiles have no changes; no ignore rule, submodule, dependency archive or runtime package was added. `git diff --check` passed. The source/export/documentation payload is approximately **5.14 MiB**, below 8 MiB. [Integrity record](docs/validation/route-fixes-integrity.json).

## Scope and limitations

All four reported findings were reproduced and fixed. Discovery still supports the existing Ethereum Uniswap v4 graph of up to three pools, without custom hook inputs or best-price optimization. It now considers every candidate in that graph; network failures can still make a search incomplete. A real pool or positive quote is not guaranteed for every token. Pending protection remains limited to the current page session.

The chain/fork data below is historical evidence from the accepted implementation, not a fresh market measurement for this revision. No mainnet signing, fresh public-RPC CORS verification, physical iPhone, screen reader, native zoom or RTL session was performed. Source, locked dependencies and runtime assets remain complete; no browser/runtime package or test scaffolding is part of the submission. Publication occurs after review.

---

# Previous implementation validation (before this revision)

The remainder is the retained historical record. Its old 24-candidate limit and WebKit coverage limitations are superseded by the revision above; its live-chain figures have not been remeasured.


Date: 2026-10-16. This is the worker's own implementation and validation record, not an independent security audit or a certification by the structural verifier.

## Result and scope

The finished SwarmSweep source is in `web/` and its static production export is in root `dist/`. Token selection and live Uniswap v4 routes no longer depend on SwarmExit registration. The existing deployment, fee recipient, launch-token discovery, wallet connectors, package manifests, lockfiles and build configurations were preserved. No contract was deployed, replaced or modified. No mainnet transaction was sent.

The known wallet `0x0acE1DBE8AAb293cd58D5e3Ea38814f0ccb74782` had 164 positive holdings. At block 26,203,183, 40 returned live routes while SwarmExit's registered token count remained zero. Of those quotes, 26 were explicitly partial balances. The other results were 103 pool/quote failures, 18 exhausted bounded searches and three without a connected v4 path. These are disclosed unavailable routes, not fabricated successful quotes. The live-browser run checked all 222 discovered balances and displayed the same 164 holdings and 40 selectable routes.

## Acceptance coverage

| Requirement | Result | Evidence |
| --- | --- | --- |
| Working website and primary interactions | Implemented; selection, review, approvals, transaction outcomes and retries exercised | `route-interactions.json`, local-fork execution |
| Automatic sell-route discovery without registration | Implemented for every positive identified holding within the declared v4 search scope | `live-routes.json`; zero registered, 40 quoted |
| Select specific tokens | Visible named checkboxes, select all, clear, selected count and selected-only review | 320/390/768/1440 Chromium checks |
| Static export with relative URLs | Built; `/preview/` subpath exercised, local assets and both indexes included | `dist/index.html` and integrity check |
| Production build and typecheck | Passed from `web/` | Commands below |
| Better Interface six-domain review | Completed with concrete fixes; limitations listed below | Coverage table and screenshots |
| Product and main action on first 390px screen | Passed; connect control, summary and review actions visible | `routes-390-first.png` |
| Title, favicon, description, og:title, og:image | Present and probe passed | `web/index.html`, `dist/index.html` |
| Final DESIGN.md and rebuild instructions | Updated against final source | Root DESIGN.md and README.md |
| Publication | After review, outside this worker task | No remote deployment claim |

## Actual verification

Commands ran from the repository root unless stated otherwise:

```sh
npm --prefix web run typecheck
npm --prefix web run build
node --experimental-strip-types --test web/test/*.test.mjs
node --experimental-strip-types web/scripts/check-abi.mjs
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node --experimental-strip-types web/scripts/interact-routes.mjs
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

- Typecheck and production build exited 0. Vite emitted a nonfatal warning for the approximately 649 kB main JavaScript chunk. No build configuration or dependency was changed to suppress it.
- **58/58 unit and regression tests passed.** Coverage includes independent holdings, real viem multicall recovery, malformed event indexes, direct/bridge paths, liquidity-limited amounts, live RPC failures, exact approval destinations, expiry, slippage floors, simulated failures, account/chain changes, pending receipt reconciliation, spoofed receipt rejection, retained earlier successes and legacy held-refund semantics.
- **101/101 Chromium interaction assertions passed.** Viewports: 320, 390, 768 and 1440 by 844. The exported page was served under `/preview/`. Checks exercise named EIP-6963 connection; visible unsupported tokens; per-token, all and clear selection; selected-only review; approval explanation; keyboard Space/Escape and focus return; real application transaction encoding against mocked RPC responses; confirmed output; empty, failed and retry states; wrong-chain invalidation; 64-character symbols and 39-digit values. No script/resource errors or horizontal overflow were recorded. Two desktop checks verify the checkbox label does not overlap the token name.
- **16/16 taste@1 checks passed** on the production export at 320, 390 and 1440, plus reduced motion. Its disconnected first-screen copy budget was 47 prose words at 390. The automatic contrast check excluded 34 unresolved-background text boxes; it does not establish contrast for those boxes.
- Separately, Chromium resolved the CSS color tokens through a canvas and measured six actual solid text/surface pairs: text/page **17.72:1**, secondary/surface **5.97:1**, primary-button text/fill **8.52:1**, route text/background **7.17:1**, success **7.43:1**, error **6.66:1**. All exceed 4.5:1. This is not a claim about every opacity, focus, image or forced-color combination.
- The original SwarmExit ABI hash still matches its deployment record.

### Real Ethereum checks

`web/scripts/verify-routes.mjs` ran using the worker-provided Ethereum transport, representing the public source `https://ethereum-rpc.publicnode.com`. It read live balances and quotes, and wrote the sanitized [route evidence](docs/validation/live-routes.json). The final recorded scan took 75.409 seconds. Counts and detailed per-token pool IDs/input amounts are in that record. Prices were never copied from a quote cache.

`web/scripts/browser-live.mjs` ran against the production export with the same real Ethereum transport and a read-only injected account. It displayed **164 holdings and 40 selectable routes**, successfully read all **222** discovered balances, and reported **zero page errors and zero failed requests**. The source labels discovery partial because some bounded route searches are incomplete. It does not call the wallet empty. [Browser evidence](docs/validation/route-browser-mainnet.json).

This transport substitution tests browser application behavior with real chain data; it does not prove current CORS behavior of public RPC providers. No wallet signature was requested.

### Disposable mainnet-fork execution

`web/scripts/verify-route-fork.mjs` started its own Anvil fork at block 26,203,183, impersonated only the supplied public test account locally, and closed the fork afterwards. The exact application encoder, quote planner and execution code were used against forked deployed contracts; no application contracts were replaced.

| Scenario | Observed result |
| --- | --- |
| GENESIS hook pool, partial balance | Confirmed; net IMD 1,720,593,450,699,152 minor units; treasury 35,114,152,055,084; remaining input 89,790,723,981,900,452,488,689 minor units |
| 1MD through ETH to IMD | Confirmed; net IMD 969,562,568,544,633 minor units; treasury 19,786,991,194,788; remaining input zero |
| Deliberately impossible minimum | Transaction reverted; input balance unchanged and no treasury fee |

For both successful sales, the input debit equalled the reviewed amount and treasury receipts equalled `floor(gross * 200 / 10000)`. [Fork evidence](docs/validation/route-fork.json). These are local fork transactions, not real mainnet transactions.

## Better Interface review

The implemented visual idea remains a warm, compact wallet inventory with blue primary actions and explicit availability states. The pinned six-domain guide was used during implementation; the existing visual system was retained.

| Domain | Coverage and evidence | Unperformed subchecks |
| --- | --- | --- |
| Accessibility | Native labelled checkboxes/buttons; visible focus rule; keyboard selection; inert modal background; Escape and focus restoration; text status alongside colors; live progress and selected count | Screen-reader session, forced-colors inspection and full assistive-technology audit |
| Layout | First-screen action, static subpath, 320/390/768/1440 interaction checks; 320/390/1440 real-wallet overflow checks; long-symbol and exact-number stress; inspected screenshots | Native 200% browser zoom, RTL and translated layouts |
| Writing | Registration requirement removed; selection instructions next to controls; partial amount and remaining tokens explicit; quote versus execution distinction; per-token minimum, fee, approvals, atomic reverts and gas described | External/localized copy variants |
| Typography | Existing five sizes and two system families retained; full addresses/amounts wrap; long symbol and amount reviewed in screenshots | Cross-platform system-font rendering |
| Colors | Existing semantic palette reused; 16-check probe plus six computed token-pair contrast measurements | Every composited state, dark mode (not implemented), physical-device displays |
| UI | Loading holdings and route progress, valid/no-path/failed-quote states, selected/disabled controls, review, approval, confirmation, failure, pending and retry covered by browser/unit/fork checks; reduced-motion probe passed | Slow-motion replay, physical phone wallets, WebKit and real signing |

### Reproduced findings and fixes

| Finding | Source | Fix and recheck |
| --- | --- | --- |
| High: route eligibility still used an empty owner registry | `web/src/lib/sweep.ts:170`, `web/src/lib/routes.ts:187` | Added an on-chain pool index, incremental discovery and current-block quote search. Live check returned 40 routes with zero registered tokens. |
| High: unavailable registration hid every checkbox | `web/src/components/TokenList.tsx:206`, `web/src/App.tsx:320` | Always show selection controls, disable only unavailable routes, add select-all/clear and selected-only review. All viewport interactions passed. |
| High: full-balance liquidity failure hid executable smaller trades | `web/src/lib/routes.ts:429`, `web/src/components/TokenList.tsx:72` | Recognize the Quoter's wrapped insufficient-liquidity error, quote bounded smaller amounts, label partial inputs in list and review. Unit test and GENESIS fork execution passed. |
| High: replacing only the label would leave the old sale transaction unusable | `web/src/lib/directSale.ts:113`, `web/src/lib/directSale.ts:281` | Encode and simulate direct atomic v4 swaps, scoped approvals, the existing 2% fee and net transfer. Hook and bridge fork sales passed. |
| Medium: quote-loading disabled the trigger before the dialog captured focus | `web/src/App.tsx:139`, `web/src/components/ConfirmDialog.tsx:47` | Capture trigger before asynchronous planning, restore after close, use the token heading as completion fallback. Escape/focus checks passed at all four widths. |
| Medium: visible Select label overlapped token name on desktop | `web/src/styles.css:141`, `.tokens .col-pick` | Stack checkbox/label and use a 72px desktop selection column; retain the 44px mobile grid track. Bounding-box checks and screenshots passed. |
| Medium: successful-looking stale quotes or ambiguous receipts could invite a repeat sale | `web/src/lib/directSale.ts:82`, `web/src/App.tsx:59` | Re-quote and simulate before signing; preserve the reviewed minimum; keep pending hashes by account in the page session and reconcile on Refresh. Pending/rejection tests passed. |

No unresolved observed layout defect remains in the exercised states. Visual coverage is representative, not an exhaustive accessibility certification.

## Evidence and delivery integrity

The current records are `docs/validation/route-interactions.json`, `route-design-probe.json`, `route-browser-mainnet.json`, `live-routes.json` and `route-fork.json`. Current inspected screenshots are `routes-390-first.png`, `routes-390-tokens.png`, `routes-390-review.png`, `routes-1440-tokens.png` and `routes-320-long-review.png`. Older files in that folder belong to preceding project work and are not claimed as evidence for this change.

The final export includes source-matching `launches.json` and `pools.json`, relative hashed assets, favicon and share card. `git diff --check` passed; protected configuration, package manifests and lockfiles have no changes. No ignore rule, dependency archive, submodule or credential file was added. The final file payload is approximately **4.69 MiB**, below the 8 MiB limit, including the complete export, source, unchanged lockfiles and evidence. The integrity check confirmed relative assets, required metadata and byte-identical source/export indexes. Details are in [route-integrity.json](docs/validation/route-integrity.json).

## Limitations and completion

Complete for the implemented **Ethereum Uniswap v4** website scope, with the market/search limits disclosed in the UI and README. Every positive identified holding is considered; executable routes are not guaranteed for every token. Other DEXs, custom hook input formats, more than three hops and searches beyond 24 candidate paths are outside this implementation. Partial amounts are found by bounded halving rather than optimization. Large wallets can take several minutes over browser RPC transport.

Real signing, mainnet execution, physical wallets, WebKit, screen readers, native zoom, RTL and public-provider CORS were not verified in this task. A fully reloaded page does not retain in-memory pending-transaction guards. Network publication occurs after the worker handoff and was not performed or claimed here.
