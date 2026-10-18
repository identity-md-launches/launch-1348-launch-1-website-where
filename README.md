# SweepDust

Turn Ethereum token dust into IMD. Scan a wallet, filter by USD value, choose tokens and review a batch sale. The application is in **`web/`** and the production static export is **`dist/`**. Use the commands below: the root package and `src/` belong to the earlier Walletscope application.

Requested public domain: **https://sweepdust.sites.imd.fun**. The canonical URL, social metadata, wallet app name, favicon and footer use SweepDust. Publication and DNS/domain assignment are handled by IdentityMD after submission; this worker has not published or changed DNS.

## Install, develop, preview and rebuild

Use Node **22.12+** and npm. Existing manifests, lockfiles and build configuration are retained.

```sh
cd web
npm ci
npm run dev
npm run typecheck
node --experimental-strip-types --test test/*.test.mjs
npm run build
npm run preview
```

`npm run build` typechecks and exports to `../dist/`. Vite already uses `base: './'`. Deliver the complete root `dist/`, including its local JSON indexes, images, CSS and JavaScript chunks. Static hosting needs no rewrite rules or backend. Do not run the root package's build to rebuild SweepDust.

No API key, relay, WalletConnect project ID or private server is required. Runtime reads use public Ethereum RPCs and Ethereum Blockscout. Wallet signing takes place in the visitor's wallet. Browser extensions connect through EIP-6963; phones can open the page in MetaMask, Coinbase Wallet, Rabby or Phantom; Coinbase Smart Wallet is available behind the same connect control.

## Use the app

1. Paste an Ethereum wallet address and choose **Scan wallet**, or connect a wallet to scan it automatically. Connecting an address already being inspected preserves its inventory and selection.
2. Search by token name or contract address. Set inclusive minimum and maximum **holding values in USD**. Unpriced tokens remain visible until a USD range is active; the interface explains when they are excluded.
3. Select individual tokens or **Select shown**. The latter selects available routes under the current filters and skips flagged tokens. Hidden selections are counted. Tokens without routes, unknown decimals or unresolved transactions cannot be sold.
4. Choose **Review sweep**. Review exact inputs, partial balances, gross proceeds, 2% treasury fee, minimum receive, destinations and the estimated number of wallet requests. Only the connected owner on Ethereum can confirm.
5. Confirm in the wallet. Each sale transaction combines up to **20 tokens**. Check confirmed or pending results in token details. **Scan wallet** reconciles pending receipts and refreshes balances.

**Stop scan** keeps completed results. Reviewing available routes can stop the remaining scan so there is no need to wait for the slowest token. Open **Scan coverage & deeper search** for a fuller route search or to add a missing ERC-20 contract address.

## Faster discovery and wider coverage

The scanner paginates the wallet-wide Blockscout ERC-20 inventory instead of restricting eligibility to Swarm launches. The bundled verified launch history supplements indexer coverage and preserves legacy refunds. Actual balances, decimals and refund balances are checked on chain using bounded multicalls with isolated retries. Metadata is read only for positive balances/refunds. Results stream into the interface before route discovery finishes.

Quick scans rank known v4 pools by current liquidity, search the six shortest candidate paths per token, and try up to four successively halved partial amounts for explicit insufficient-liquidity failures. They also check canonical Uniswap v2 markets and v3 fee tiers through WETH, with USDC intermediaries. Older non-Swarm v4 pools can be discovered through indexed Initialize events; their keys are hash-checked and quotes are read from the chain. A global limit bounds concurrent quotes. Reusable paths are cached, then quoted again at the new block; a saved quote is never used as a fresh price.

Recent pool-log scanning no longer blocks the first quick quote. **Search all candidate routes** updates recent initialization events, checks every discovered simple v4 path of up to three pools and permits up to twelve smaller partial amounts. A quick-search limit or unavailable service is disclosed, not treated as proof that liquidity does not exist. This is supported-route discovery, not a claim of the globally best price or every exchange.

Observed live read-only check for the supplied wallet `0x0acE1DBE8AAb293cd58D5e3Ea38814f0ccb74782`, Ethereum block **26,217,487**:

| Result | Observed |
| --- | ---: |
| Verified candidates | 257 |
| Positive holdings / legacy refunds | 191 |
| First holdings | 2.474 seconds |
| First live route | 4.213 seconds |
| Full quick scan | 37.529 seconds |
| Live quotes | 42 |
| Partial-balance quotes | 5 |

The production browser also read real services without a wallet fixture: first visible holdings in **2.506 seconds**, first route in **4.837 seconds**, no console/script/resource failures. These are observations for this wallet and current public services, not a latency guarantee. The final scan still reported route coverage limits. The indexer returned no usable IMD USD price at this check; token-specific indexed USD filters and IMD-denominated quotes continued to work.

## Fewer wallet requests

| Wallet / current permissions | Requests per batch of up to 20 tokens |
| --- | --- |
| Already supports atomic EIP-5792 calls | One `wallet_sendCalls` request groups exact ERC-20 approvals, Permit2 router allowances and the combined sale. |
| Standard wallet, new permissions | Each required ERC-20 approval, one Permit2 **PermitBatch** typed signature, then one combined sale transaction. A token needing allowance reset can add a request. |
| Standard wallet, sufficient existing permissions | One combined sale transaction; no unnecessary re-approval. |

For two fresh standard-wallet tokens the tested flow uses **four** requests: two token approvals, one batch authorization and one sale. An atomic wallet uses **one** request for the same selection. A standard EOA still needs the first ERC-20 approval for each distinct token; the site does not promise to collapse permissions that its wallet cannot batch.

Automatic mode only uses an already-supported atomic capability. It does not silently upgrade an account or fall back to multiple sends after a rejected batch. **Use standard confirmations** is available before review. The review's count is an estimate because permissions or wallet behavior can change.

## Execution and recovery

The settlement token remains `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`. The 2% fee goes to the existing treasury, `0xFC3ad9C531e1736690b2d5f24FebD35ebf051cFB`. No contract was deployed, replaced or re-minted.

Sales use the existing Ethereum Universal Router and Permit2. Multiple v4 swaps share one router transaction. V2/v3 input legs produce WETH, which is unwrapped and settled into the v4 IMD route. Each token pays 200 basis points of its actual IMD output, rounded down per token. Remaining IMD goes to the sending wallet.

New ERC-20 approvals use the exact required amount. PermitBatch binds token amounts, current nonces, the router, Ethereum and a ten-minute deadline. Each token retains the **reviewed** 3% gross slippage floor. The implementation verifies the active account, chain and unchanged balances, re-quotes routes, simulates the complete standard-wallet sale after approvals, and estimates gas before submission. For atomic approval bundles it attempts `eth_simulateV1`; when the RPC does not support it, the review explicitly says the wallet must simulate the full bundle.

Every sale transaction is atomic. A failing swap reverts its entire batch: tokens stay in the wallet and no sale fee is charged. Gas can still cost ETH. Earlier completed batches and separate approvals can remain. There are no allow-revert swap commands or arbitrary API-supplied transaction payloads.

Success requires a canonical receipt with reconcilable per-token input and IMD recipient/treasury transfers. Unknown receipts remain pending. Transaction hashes and wallet batch IDs are stored per account in local storage to protect reloads; Web Locks additionally prevent overlapping workflows across tabs where supported. Refresh checks receipts before unlocking tokens. If browser storage is disabled, reload persistence is unavailable. A wallet reporting an ambiguous submission can require checking its activity before another sale.

Legacy SwarmExit refunds remain visible and claimable. Legacy registry-only discovery and one-token sale helpers remain for historical verification; the default `loadWallet`, `planSale` and `executeSale` exports now use the wallet-wide scanner and batched sale flow.

## Verification

Actual commands, findings, evidence and limitations are recorded in [VALIDATION.md](VALIDATION.md), with design tokens and responsive behavior in [DESIGN.md](DESIGN.md). Final results include production build/typecheck, **91 unit/regression tests**, **151 interaction checks in each of Chromium and WebKit**, 13 rendered contrast pairs per engine, **16/16 design-probe checks** and **19 deployed-bytecode fork checks**. Browser wallet/signing fixtures are explicitly simulated; the separate public-browser and chain checks use real reads.

To run the independent browser checks, install test tooling **outside the repository**:

```sh
npm install --prefix /tmp/sweepdust-check playwright @axe-core/playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/sweepdust-browsers /tmp/sweepdust-check/node_modules/.bin/playwright install chromium webkit
IMD_PLAYWRIGHT=/tmp/sweepdust-check/node_modules/playwright/index.mjs IMD_AXE=/tmp/sweepdust-check/node_modules/@axe-core/playwright/dist/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/sweepdust-browsers node --experimental-strip-types web/scripts/interact-sweepdust.mjs
# Use the same environment and add --webkit for the second engine.
IMD_PLAYWRIGHT=/tmp/sweepdust-check/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/sweepdust-browsers node web/scripts/browser-sweepdust-live.mjs
```

The interaction checker serves `dist/` at `/preview/`, starts and closes its own browser/server, mocks public reads and wallet requests, and writes only to `test/scratch/`. The real-browser checker scans the supplied public address and never installs a signer. WebKit requires its normal system runtime dependencies; an existing compatible launcher can be supplied with `SWEEP_WEBKIT_EXECUTABLE`.

Read-only chain and local-fork checks:

```sh
node --experimental-strip-types web/scripts/verify-sweepdust.mjs --out=test/scratch/live-sweepdust-fast.json
node --experimental-strip-types web/scripts/verify-sweepdust-fork.mjs
node web/scripts/check-abi.mjs
```

The fork check requires Anvil. It generates an ephemeral local signing account in memory, executes only against a loopback fork, verifies a two-token batch, WETH/v2/v3 bridges, actual fee/recipient balances, and full rollback. It deploys no contracts and sends no mainnet transactions. No key is saved or printed. The fork's upstream must support state reads at the recorded block.

The build has a nonfatal chunk-size warning (approximately 690 kB uncompressed main JavaScript, 207 kB gzip). Existing dependency/build files were not changed. Runtime indexes and required chunks are included; dependency directories, caches and downloaded browser packages are excluded from the Git deliverable. An exact evidence allowlist overrides the existing artifact exclusion; [artifacts/PATH-BUDGET.md](artifacts/PATH-BUDGET.md) sets per-path limits and a 1,600,000-byte aggregate ceiling. Dependency/cache exclusions remain in place.

## Limits

Ethereum ERC-20s and supported Uniswap paths only. NFTs, native ETH balances, other chains/exchanges, split routing and custom hook data are outside this version. Indexers can miss fresh or nonstandard tokens; add a contract address to verify it directly. Prices, liquidity, gas and RPC availability can change. Flagged tokens are not automatically selected. A live quote can still fail full execution simulation.

No physical phone, real visitor-wallet mainnet sale, screen-reader session or native-browser zoom session was tested. Desktop WebKit exercises the Safari engine. Simulated EIP-5792 interaction tests do not certify every smart wallet. The local fork proves the tested calldata against deployed bytecode, not future liquidity or an independent security certification.

## Implementation references

Canonical targets and formats were checked against [Uniswap v2 deployments](https://developers.uniswap.org/docs/protocols/v2/deployments), [v3 deployments](https://developers.uniswap.org/docs/protocols/v3/deployments), [v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), [Permit2 allowance transfer](https://developers.uniswap.org/docs/protocols/permit2/concepts/allowance-transfer) and [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792). The retained router uses the original v4 parameter layout. The actual v2/v3/v4 encodings were also exercised on the local fork.
