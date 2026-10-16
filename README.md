# SwarmSweep

Find Ethereum Swarm token holdings, select individual tokens, and discover live Uniswap v4 sell routes to IMD **without registering tokens with SwarmExit**. The existing wallet discovery and wallet connectors are retained. The application is in `web/`; the finished static site is in root `dist/`. The root package still belongs to the earlier Walletscope application: use the `web/` commands below.

## What was fixed

The previous frontend read balances independently but still called SwarmExit `preview` and `tokenRoute` to decide whether a token could be sold. Its deployed sale registry is empty. That produced the registration message and hid every selection checkbox.

The new sale path reads actual Uniswap v4 pool initialization events, quotes routes through the deployed v4 Quoter, and sends reviewed swaps to Uniswap Universal Router. No token registration, owner configuration, new contract or deployment is needed. SwarmExit remains available only for existing refund claims and optional legacy USD pricing; neither gates route discovery or direct sales.

At Ethereum block **26,203,183**, the supplied wallet `0x0acE1DBE8AAb293cd58D5e3Ea38814f0ccb74782` held **164** identified tokens. The new search returned **40 live quotes**, including **26 partial-balance quotes**, while SwarmExit still reported **zero registered tokens**. A quote is not a guarantee that execution will succeed. Pools with insufficient liquidity, unsupported hook rules or an incomplete bounded search stay visible with an explanation. See [VALIDATION.md](VALIDATION.md) for actual checks and limitations.

## Using the site

1. Connect an Ethereum wallet. Holdings appear while live routes are being checked.
2. Use each token's **Select** checkbox, **Select all routes**, or **Clear selection**. Tokens start unselected. Unavailable routes keep visible, disabled checkboxes and an explanatory status.
3. **Review selected** includes only those tokens. **Review all routes** reviews all currently quoted tokens. The summary estimate follows the selection.
4. Review the amount, gross IMD, minimum output, 2% treasury fee and estimated net. A **Partial balance** route sells the displayed smaller amount; the rest remains in the wallet.
5. Approve when prompted, then confirm one atomic sale per token. **Refresh routes** reloads balances and quotes. Pending receipts remain protected from resubmission in the current page session and are checked again on Refresh.

## Install, develop, preview and rebuild

Use Node 22.12+ and npm. Dependencies and the existing lockfile are in `web/`.

```sh
cd web
npm ci
npm run dev
npm run typecheck
node --experimental-strip-types --test test/*.test.mjs
npm run build
npm run preview
```

The build includes TypeScript checking and writes `../dist/`. Existing Vite configuration uses `base: './'`. The export has relative assets, local pool/launch history, favicon and share image; it works beneath a static gateway subpath without a backend or server rewrites. Do not publish from the worker: the network handles publication after submission.

## Route discovery and execution

`web/public/pools.json` contains 889 pool initialization records verified from Ethereum through block 26,203,159. It is an event index, not a token registration list or a saved quote. Its anchor hash and pool-key hashes are checked. Runtime discovery adds subsequent matching initialization events, checks launch receipts for new tokens, and reads current active liquidity to order alternatives. Historical holdings still come from `launches.json` and incremental official registry events.

Every positive holding is searched for simple v4 paths to IMD, including ETH intermediaries. The search prefers fewer hops, then active liquidity, and tests at most 24 candidate paths of up to three pools. It returns the first positive live quote, not a claim of the globally best price. For the deployed Quoter's explicit `NotEnoughLiquidity(bytes32)` failure, it tries up to 12 successively halved amounts. These amounts are labelled partial; they are not advertised as the maximum sellable amount. Search exhaustion and RPC failures are disclosed rather than treated as proof that no pool exists.

Review refreshes the chosen route and verifies the balance. Each sale then obtains another quote, retains the **reviewed** 3% slippage floor, simulates complete execution, estimates gas and verifies the active account and chain before signing. Newly requested ERC-20 approval is for the needed amount to Permit2; the Permit2 authorization names Universal Router, the needed amount and a ten-minute expiration. Existing sufficient approvals can be reused.

The encoded v4 actions are `SWAP_EXACT_IN`, `SETTLE_ALL`, `TAKE_PORTION` and `TAKE_ALL`. Each token sale is atomic. The fee is 200 basis points of that swap's IMD credit, sent to the existing treasury `0xFC3ad9C531e1736690b2d5f24FebD35ebf051cFB`, rounded down per transaction. Net IMD goes to the connected sender. There are no allow-revert commands, arbitrary external calldata or native ETH sale payments. A reverted sale leaves input tokens in the wallet and charges no sale fee; network gas still costs ETH. Multiple selected tokens require separate transactions and accumulate IMD in the wallet.

Receipts must succeed and contain reconcilable IMD transfers from PoolManager to the account and treasury before showing Sold. Unknown receipts remain pending. A later rejection or failure preserves earlier confirmed results. Legacy SwarmExit held refunds keep their claim control.

## Validation commands and results

From the repository root, with Playwright available:

```sh
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node --experimental-strip-types web/scripts/interact-routes.mjs
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
node --experimental-strip-types web/scripts/verify-routes.mjs https://ethereum-rpc.publicnode.com test/scratch/live-routes.json
node --experimental-strip-types web/scripts/verify-route-fork.mjs https://ethereum-rpc.publicnode.com test/scratch/fork-routes.json
```

The fork check requires Anvil and the preceding live evidence file. It starts and closes its own disposable fork; all simulated transactions remain local. An archive-capable RPC may be needed. `web/scripts/browser-live.mjs` performs the production browser's read-only known-wallet check; it accepts an optional RPC transport argument. No script needs a private key.

Completed checks: production build and typecheck; **58 unit/regression tests**; **101 Chromium interaction assertions** at 320, 390, 768 and 1440 pixels; **16/16 taste@1 checks**; real-chain wallet discovery and quotes; local-fork hook and ETH-bridge sales with exact input/fee reconciliation; local-fork reverted sale retaining tokens with no sale fee. The build reports a nonfatal JavaScript chunk-size warning (approximately 649 kB uncompressed). Browser tests use simulated wallets and explicitly mocked transactions; the separate mainnet browser check uses real chain responses and forbids signing.

## Updating the event indexes

```sh
node --experimental-strip-types web/scripts/update-launches.mjs
node --experimental-strip-types web/scripts/update-pools.mjs https://ethereum-rpc.publicnode.com
npm --prefix web run build
```

Deliver both source indexes and the rebuilt copies in `dist/`. `update-pools.mjs` filters initialization events by launch currencies and IMD, recursively reduces refused ranges, and validates the resulting pool keys before writing. Never edit quotes into these indexes.

## Scope and limits

- Ethereum and Uniswap v4 only. This searches all identified holdings, not all DEXs or every possible route. V2/V3, RFQs, token-specific hook inputs and split-routing are not implemented. Future factory changes need discovery configuration updates.
- Quotes depend on live liquidity, RPC availability and hook behavior. Custom or taxed token transfers may still fail the final simulation. Some holdings have no usable quote even at reduced amounts.
- Large wallets can take several minutes over browser RPC transport. Progress and discovered holdings remain visible. Estimates are refreshed before review and execution.
- No real-wallet mainnet transaction, physical phone, WebKit, screen reader, native zoom or RTL session was tested. The worker's supplied Ethereum transport was used for real-chain checks; this run does not claim fresh public-browser CORS verification.
- Pending-transaction protection lasts within the current page session, including account/chain switches. After reloading the page, inspect any outstanding wallet transaction before starting another sale.
- The site was built locally; remote publication is handled after this task and was not claimed or performed.

## Implementation references

Addresses are verified against [Uniswap's Ethereum deployment table](https://developers.uniswap.org/docs/protocols/v4/deployments). The original router parameter layout comes from [IV4Router at the pinned periphery commit](https://github.com/Uniswap/v4-periphery/blob/3796e9c460b4ad5befd40163f5c14595e7aeb107/src/interfaces/IV4Router.sol), with actions from [Actions.sol at that same commit](https://github.com/Uniswap/v4-periphery/blob/3796e9c460b4ad5befd40163f5c14595e7aeb107/src/libraries/Actions.sol). The calldata was also executed against the deployed bytecode on the local fork. See [DESIGN.md](DESIGN.md) for the final interface system.
