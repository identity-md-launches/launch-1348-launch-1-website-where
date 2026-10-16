# SwarmSweep validation — 2026-10-16

## Review revision

All five review findings reproduced against the accepted source/export and are fixed. The revision changes three production source files: `web/src/lib/sweep.ts`, `web/src/styles.css` and `web/src/wallet/ConnectSheet.tsx`. Tests, evidence, documentation and `dist/` were updated. `web/scripts/verify-live.mjs` also now records its supplied RPC URL instead of always labelling its report PublicNode. Existing package manifests, lockfiles, build configuration, chain/deployment constants and ABI are unchanged.

### Reproduction and correction

| Finding | Before the fix | Final behavior and source |
| --- | --- | --- |
| Held refund overwritten | `RefundHeld(A)`, `TokenRefunded(A)`, `TokenSold(B)` left `A.held` undefined and claimed delivery. | `web/src/lib/sweep.ts:682` reduces verified logs per token, prioritizing held refunds. Both event orders pass; unrelated emitter/user/token logs cannot change the outcome. Browser shows the claim instruction, exact held amount and enabled claim control after refresh. |
| Precise proceeds overflow | At 320px, `100.123456789012345678 IMD` expanded the page to 358px before sale and 458px after sale. | `web/src/styles.css:755` wraps token notes; `:691` gives the mobile grid shrinkable tracks. Both states now measure exactly 320px wide. Quotes, preview totals and sold amounts retain every digit. |
| Rejected multicall bypassed fallback | Real viem `allowFailure:true` returned failure entries; the browser issued zero isolated balance calls and showed discovery failure. | `web/src/lib/sweep.ts:230` retries failed entries at the same block, retaining successful reads. The browser recovers four holdings with five isolated balance calls. Remaining RPC/metadata failures still produce partial/unknown states. |
| Desktop route clipped | At 1440px, the 230.65625px route pill ended at x=1221.03125 beyond its cell at x=1183.5. | `web/src/styles.css:429` wraps token pills at all widths. The complete two-leg route now occupies 180.625px and ends at x=1171, inside the content edge x=1171.5. |
| Phone hid EIP-6963 provider | The specified iPhone user agent with an announced provider but no `window.ethereum` showed zero Mock Wallet buttons. | `web/src/wallet/ConnectSheet.tsx:81` bases open-in links on provider availability and retains named injected connectors. The phone fixture connects and discovers four holdings; the no-provider phone links and Coinbase option still work. |

The event order was also checked against the unchanged [upstream contract](https://github.com/identity-md-launches/launch-1682-build-protocol-enables-user/blob/e6a695d9a368642617f5c801a7759494caf0b81d/src/SwarmExit.sol#L465): `_refund` can emit `RefundHeld` before `_sellOne` emits `TokenRefunded`. No contract changes or transactions were needed.

### Checks actually run for this revision

The locked frontend was installed and built in the disposable `test/scratch/revision/web/` copy. Source/test changes were copied there before each relevant check, and its final export was copied to root `dist/`. Commands below are relative to that frontend copy unless noted. Browser scripts served that production export under `/preview/`, exercising relative asset URLs. Playwright and its Chromium download were kept in disposable locations; neither is part of the submission.

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Installed the existing lockfile without changing dependencies |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing ~639kB wallet-bundle size warning remains |
| `node --experimental-strip-types --test test/*.test.mjs` | **42 passed, 0 failed**, including real viem transport regressions, event precedence, exact decimals and transaction guards |
| `node --experimental-strip-types scripts/interact.mjs` | **129 passed, 0 failed** in Chromium; connection, selection, fees, preview, approvals, receipts, held refunds, retry, partial/empty/RPC states, chain switching, phone EIP-6963 and precise-amount layouts |
| `node --experimental-strip-types scripts/check-abi.mjs` | Deployment ABI digest matched |
| `node --experimental-strip-types scripts/verify-live.mjs https://eth.drpc.org` | **220 balances read, 163 holdings** independently matched at block **26,202,661**; real historical replay recovered two tokens, no warnings |
| `node scripts/browser-live.mjs` | **163 holdings** using direct public browser RPCs; exact first raw/formatted balance matched; zero page/request failures; no overflow at 320/390/1440 |
| Root: `node --test test/metrics.test.mjs` | **12 passed**, preserving the legacy checkout |
| Root: `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **16/16 passed** against final root `dist/` |

The initial PublicNode live-script invocation completed the current balance checks but failed during the additional historical replay: “Archive requests require a personal token.” The full script subsequently passed through dRPC, one of the app's existing RPCs. No credential was requested or used. The failure and successful rerun are distinguished here; PublicNode archive support is not claimed.

Evidence: [revision measurements](docs/validation/revision.json), [fresh live holdings](docs/validation/revision-live-discovery.json), [fresh browser-mainnet result](docs/validation/revision-browser-mainnet.json), and [.imd-responses.json](.imd-responses.json). Screenshots inspected: [390px first screen](docs/validation/revision-390-first-screen.png), [320px exact quote](docs/validation/revision-320-quote.png), [320px receipt](docs/validation/revision-320-outcome.png), [1440px routes](docs/validation/revision-1440-routes.png), [phone wallet sheet](docs/validation/revision-390-wallet.png), [held refund](docs/validation/revision-390-held-refund.png).

Final integrity checks confirmed the delivered source matches the tested source and root `dist/` matches the built export byte-for-byte. The export has eight files totaling **785,129 bytes**; local HTML asset references are relative and resolve. The complete submission files total approximately **3.56 MB uncompressed**, below 8 MiB, with disposable dependencies/caches confined to scratch and no added dependency archives. Existing manifests, lockfiles and ignore rules were not changed.

### Better Interface coverage and limitations

All six pinned domains were reviewed on the changed surfaces, retaining the established design:

- **Accessibility:** named wallet buttons remain reachable on mobile; keyboard focus entry, wrapping, Escape and restoration passed. Claim and disabled-sale states remain explicit. Screen readers were not tested.
- **Layout:** first-screen product/connect/sale actions fit at 390px. Measured and inspected exact-value states at 320px and routes at 390/1440px; no horizontal overflow. Native zoom and RTL were not tested.
- **Writing:** held refunds now say they must be claimed; completed, partial and failed discovery stay distinct. No delivered-refund or empty-wallet claim is made on those failure paths.
- **Typography:** full exact amounts and route text wrap, with no rounding, clipping or new type sizes. Five-size scale, two families and two weights remain.
- **Colors:** existing tokens retained; all probe-measured pairs passed. The probe excludes 34 text boxes with unresolved backgrounds, so this is not comprehensive contrast certification.
- **UI:** wallet/no-provider states, confirmations, gas/fee display, mixed sale outcomes and claim availability passed. Reduced-motion and share metadata checks passed. Physical devices, real signing and WebKit were not tested; the iPhone user-agent check ran in Chromium.

Complete for the five reported findings. Ethereum mainnet remains the only supported chain. The live sale registry remains empty, so those real holdings stay visible and disabled for selling; no mainnet sale, fee transfer or refund claim was executed. Historical discovery still depends on the official snapshot and documented registries, with future factory migrations requiring configuration updates. The publisher must publish this export and issue its URL before remote verification can run. This revision does **not** claim an updated remote deployment. The original implementation evidence below is retained as a historical record, not as checks rerun in this revision.

## Outcome

The discovery fix is demonstrated by real Ethereum reads and the production browser export: **163 held tokens detected across 220 verified token contracts** for `0x0acE1DBE8AAb293cd58D5e3Ea38814f0ccb74782`. The original merged export displayed **zero** for that same wallet. All 163 positive raw balances and decimals were independently re-read and matched. No sale was sent on mainnet.

The updated static export is complete. **Remote publication and verification of a newly deployed version remain unperformed.** Publication is handled after submission by the network. The pinned handoff names a different, legacy Walletscope site; this does not prove a SwarmSweep deployment. `web/scripts/verify-deployed.mjs` provides an exact byte comparison once the publisher issues the URL.

## Reproduction and exact root cause

The task workspace was Walletscope, with no connected-wallet or sale implementation. The explicitly requested public repository was inspected at merged commit `e6a695d9a368642617f5c801a7759494caf0b81d`. Its frontend and unchanged ABI were brought into the original `web/` layout. Root build configuration and dependencies were not changed.

Original flow: EIP-6963 connection → wagmi Ethereum public client → `loadWallet` → `previewAll(account)` → filter positive balances from the returned previews. `src/SwarmExit.sol` in the linked upstream tree defines `previewAll` by iterating `_swarmTokens`; only the owner can populate it through `setSwarmToken`. That registry is sale configuration, not a complete launch history. `_previewOne` also rejects unregistered addresses before balance discovery, so merely passing more addresses to preview is insufficient.

Read-only Ethereum reproduction:

- `eth_chainId` returned **1**.
- At block **26,202,388**, SwarmExit `swarmTokenCount()` returned **0** and `previewAll(0x0ace…4782)` returned an empty array.
- The original merged `dist/`, rendered in Chromium with a read-only EIP-6963 adapter for that wallet and actual public Ethereum RPC responses, displayed zero holdings. There were no page errors or failed network requests. Its pricing message reported unavailable configuration. See [browser baseline](docs/validation/browser-baseline.json).
- Separately, a browser request from the static origin to the official launch API failed with `Failed to fetch`; its response lacked `Access-Control-Allow-Origin`. Therefore a runtime-only API fix would introduce a CORS dependency.

## Implemented corrections

| Source | Defect and correction | Validation |
| --- | --- | --- |
| `web/src/lib/discovery.ts:123` | Discovery used only SwarmExit's empty registry. Use generated official history, validate its chain/block hash, and read all subsequent token-role artifacts from both official registries. Registry counts detect missing event ranges. | Full-history reconciliation, real incremental recovery and regression tests |
| `web/src/lib/sweep.ts:156` | Holdings depended on route previews. Read ERC-20 balances/decimals independently, pin reads to one block, preserve unsupported holdings, and report partial reads. | 220 successful reads, 163 independent positive-balance comparisons |
| `web/src/lib/format.ts:8` | Metadata failure assumed 18 decimals and formatting rounded through Number. Preserve bigint precision; show raw units when decimals are unknown. | 0, 6, 24 and 255-decimal regression cases |
| `web/src/App.tsx:31` | An earlier asynchronous load could overwrite a changed account/chain. Invalidate requests and sale confirmations by wallet identity and read generation. | Wrong-chain, switch-back and late-refresh-after-disconnect browser checks |
| `web/src/lib/sweep.ts:385` | A failed simulation could fall back to preview values, implying a valid sale. Distinguish pre-approval quotes; require successful post-approval simulation and gas estimation before sending. | Reverting simulation, zero proceeds, changed balance and gas tests |
| `web/src/lib/sweep.ts:496` | Receipt errors or later batch failures could lose/overstate outcomes. Check approvals and receipt status; filter events by emitter, user and token; retain confirmed batches; mark unknown receipts pending. | Forged logs, receipt timeout, reverted approval/sale, refund and multi-batch tests |
| `web/src/wallet/ConnectSheet.tsx:93` | Chain state came from configured chain rather than the connected account; switch fallback ran without waiting. Use actual account chain and await switching. | Browser chain-switch test and signature guards |
| `web/src/components/TokenList.tsx:179`, `web/src/styles.css:749` | Full exact balances and addresses need room. Wrap both and expose raw units and launch transaction. | 320/390/1440 browser measurements with real holdings |
| `web/src/styles.css:28` | Greyed holdings inherited low-contrast disabled text, although their balances are useful data. Use the readable secondary text tone while retaining disabled sale selection. | Rendered connected-state inspection and probe |

The deployed SwarmExit address, ABI, settlement token and treasury remain unchanged. ABI digest check passed: `f259fa26782bfa734371ae5b1cad46e56f29ea84e49c0b994e5a241087fd68a2`.

## Official provenance and live results

The generator read three pages, including the terminating empty page, from the [official launch index](https://api.imd.fun/launches?limit=500). It reconciled all events and typed artifacts in the two registries listed in [IMD's official deployment table](https://imd.fun/docs/#contracts):

| Registry | Factory | Records through snapshot |
| --- | --- | ---: |
| `0xa47fcb220ddd1cddda865f89029bec1b9eca3bf1` | `0x12c63b581d07093f6126bc02263c58f7eadaa96f` | 30 |
| `0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23` | `0xff03410d0fe5fa8f7f59f743de35e333d9857120` | 238 |

Registry writers were checked. Their creation blocks were located with historical code reads, not guessed: **26,128,678** and **26,128,681**. Successful deployment receipts and nonempty deployed code were checked for all **220** resulting Ethereum token contracts. Registry artifacts distinguish tokens from hooks and other contracts; neither names nor symbols establish inclusion.

Snapshot block: **26,202,460**, hash `0x57562d383dbf2dd80afbfe7b3cc3729318c568b8e03cf541cad8e91ccc15c859`.

Independent live balance report: block **26,202,527**. All 220 balances read, 163 positive holdings, no discovery warnings. A second integration check rewound the history to block **26,200,960**, removed the later records and re-read actual registry events. It recovered **2** new tokens from **218** historical tokens, producing the same **220**-contract universe with no warnings.

Example verified holdings (all 18 decimals):

| Contract | Raw balance | Exact token balance |
| --- | --- | --- |
| `0x01b3b98599608a41d46a3c5c34ed736329b7c6b2` | `90497737556561085972851` | `90497.737556561085972851` |
| `0x047ceafe0e715b7af38b65dd7185c60d9420594c` | `103896103896103896103897` | `103896.103896103896103897` |
| `0x05931b5d7c0f5fbb2315a87ed48e3167483b1b67` | `111888111888111888111889` | `111888.111888111888111889` |

The [full report](docs/validation/live-discovery.json) lists all contracts, raw balances, decimals, formatted balances and sale eligibility. Mainnet fee reads returned `SELL_TAX_BPS = 200` and `TREASURY = 0xFC3ad9C531e1736690b2d5f24FebD35ebf051cFB`.

The production browser independently used `https://ethereum-rpc.publicnode.com` / `https://eth.drpc.org` directly. It displayed 163 rows, the exact first raw and formatted balance above, no page errors and no failed network requests. See [browser report](docs/validation/browser-mainnet.json), [390px mainnet screenshot](docs/validation/390-mainnet.png), and [1440px mainnet screenshot](docs/validation/1440-mainnet.png). The read-only wallet adapter identifies the supplied account but refuses all signing; these are real chain balances, not fixture balances.

## Commands actually run

Dependencies were installed into a disposable copy of the frontend in `test/scratch/`, using the unchanged imported `web/package-lock.json`. The deliverable sources were copied into that build tree before checks; its final `dist/` was copied to repository-root `dist/`. Neither dependencies nor scratch data are included in the submission. Equivalent commands for a normal checkout are:

| Check | Command | Actual result |
| --- | --- | --- |
| Locked install | `cd web && npm ci --ignore-scripts --no-audit --no-fund` | Passed |
| TypeScript | `cd web && npm run typecheck` | Passed |
| Production export | `cd web && npm run build` | Passed, one wallet-bundle size warning (~639 kB uncompressed); static export ~785 kB |
| Discovery and sale regressions | `node --experimental-strip-types --test web/test/*.test.mjs` | **35 passed, 0 failed** |
| Production interactions | `node --experimental-strip-types web/scripts/interact.mjs` | **101 checks passed** |
| ABI integrity | `node --experimental-strip-types web/scripts/check-abi.mjs` | Matched the merged deployment ABI digest |
| Mainnet balances + real incremental discovery | `node --experimental-strip-types web/scripts/verify-live.mjs` | 220 reads, 163 holdings, independent raw/decimals matches; 2 later tokens recovered |
| Browser mainnet | `node web/scripts/browser-live.mjs` | 163 holdings, zero page/request failures, no overflow at 320/390/1440 |
| Legacy checkout regression | `node --test test/metrics.test.mjs` | 12 passed |
| Upstream contract baseline | `forge test --offline` in the unchanged pinned upstream tree under scratch | **128 tests passed**, 0 failed; includes fee conservation, failed sales, held refunds, fuzz and invariant suites |
| Pinned design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **16/16 passed** |

The probe and browser commands used the provided Playwright/Chromium installation. The upstream Solidity suite was an additional check of the existing contract behavior, not a claim that this frontend-only submission contains a new Solidity build or that a real mainnet sale was executed.

The browser interaction suite exercises connection, keyboard focus containment/restoration, wallet-app links, token selection, confirmations, fees, exact approvals, sell arguments, receipt outcome rendering, unavailable routes, zero balances, failed RPCs, partial reads, retry recovery, RPC fallback, chain switching and late results after disconnect. Fixture balances and successful transactions exist only in the test harness.

## Better Interface review

The merged SwarmSweep visual identity was retained. All six domains were reviewed against the pinned guide.

| Domain | Coverage, findings and disposition |
| --- | --- |
| Accessibility | Native buttons, labelled checkboxes, status live region, disabled sale controls, dialog inert background, focus entry/Tab wrapping/Escape/return. Dialog focus containment and restoration were fixed and exercised. Physical assistive technology not tested. |
| Layout | First screen inspected at 390; connect and sale actions fit. No horizontal overflow at 320/390/1440 in fixtures and 163 real holdings. Full addresses and exact balances wrap. Native 200% zoom and RTL not tested. |
| Writing | Removed the unsupported “sell every token in one transaction” claim. Loading, partial, empty, failed, pending, reverted and refunded states describe actual knowledge. Retry is explicit. Owner configuration and unknown prices are visible. |
| Typography | Five size tokens, two families, two weights. Exact balances use bigint formatting; addresses/raw units remain selectable. Long values wrap. No custom fonts or font-loading claims. |
| Colors | Existing warm-grey/blue palette retained. Unsupported holdings use secondary text instead of the lighter disabled-control tone (`web/src/styles.css:28`). Probe measured text pairs passed; 34 boxes were excluded by its solid-background resolver, so it does not establish comprehensive contrast coverage. |
| UI | Primary/secondary/disabled/loading states, keyboard sheets, transaction confirmation and raw-data disclosure exercised. Explicit 120ms transitions and reduced-motion rules retained. No new decorative motion or competing visual theme. |

Probe details: zero render errors or missing local assets; no overflow, overlap or clipping; 16/16 checks passed; first-screen prose 48 words at 390px; five font sizes counting one-offs, two families and two weights. Five measured initial controls met the 24px target/spacing rule; one is below the comfortable 44px target. Metadata contains a title, description, favicon, og:title and a local og:image. Screenshots were actually produced and inspected.

## Remaining limitations and requirement status

- **Discovery implemented and demonstrated:** complete generated historical official records, current-registry updates, exact balances, visible unsupported tokens, loading/empty/failure/partial states, automated tests and real-holder verification.
- **Sale functionality retained and checked with fixtures:** selected/all sales, preview, gas, exact approvals, guarded signatures and outcome reporting. The deployed contract currently has zero registered sale tokens and no usable configured price path. This app cannot turn that owner-only configuration into a valid sell route. No mainnet sale or real fee transfer was performed.
- **Chain support:** Ethereum mainnet only. Future factory migrations require updating the documented registry configuration and regenerating the historical snapshot. Historical omissions outside those registries remain dependent on the official index.
- **Export complete:** root `dist/` contains all runtime assets and relative URLs. Existing protected build/dependency files and ignore rules are unchanged; caches, node_modules and dependency archives are excluded. The current uncompressed submission file set is below 8 MiB.
- **Publication pending:** the updated remote site has not been published or verified within this run. The supplied hosting handoff refers to Walletscope. Verification must target the URL actually issued for the updated export, using the provided file comparison and read-only browser checks.
- **Not verified:** WebKit, physical phones, real wallet/passkey signing, screen readers, native zoom, RTL and localization. The production wallet bundle emits Vite's size warning; no performance claim is made beyond the recorded render checks.
