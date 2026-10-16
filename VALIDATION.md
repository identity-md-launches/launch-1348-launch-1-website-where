# Live sell-route implementation validation

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
