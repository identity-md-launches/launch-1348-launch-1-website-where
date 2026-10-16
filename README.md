# SwarmSweep

SwarmSweep finds verified Swarm-launched tokens in a connected **Ethereum mainnet** wallet and lets the user sell holdings supported by the existing SwarmExit contract. Positive balances remain visible when selling is unavailable. A 2% fee applies to successful IMD sale proceeds.

**Verified result, 2026-10-16:** the supplied wallet `0x0acE1DBE8AAb293cd58D5e3Ea38814f0ccb74782` holds **163** of the **220** discovered Ethereum token contracts. All 220 balances were read successfully; independent ERC-20 calls matched every positive balance and decimals value. The production browser also displayed 163 holdings using public RPCs, with no failed requests or page errors. See [VALIDATION.md](VALIDATION.md) and the [complete balance record](docs/validation/live-discovery.json).

## Root cause and source provenance

The linked [merged SwarmSweep implementation](https://github.com/identity-md-launches/launch-1682-build-protocol-enables-user/pull/2), commit `e6a695d9a368642617f5c801a7759494caf0b81d`, called SwarmExit's `previewAll(wallet)` to discover tokens. That function only iterates the contract owner's sale registry. On Ethereum, `swarmTokenCount()` is **0**, so the original page reported no tokens even though the wallet holds 163 verified launch tokens. This was reproduced in Chromium using the merged export and real Ethereum reads.

This task's initial checkout contained the separate Walletscope history dashboard. The requested merged implementation was retrieved from the explicit repository URL and retained in its original `web/` layout. The existing root package/build configuration and dependencies remain unchanged. **Build SwarmSweep from `web/`; the old root package scripts still belong to Walletscope.** The root `dist/` now contains SwarmSweep's complete production export. No on-chain contract was changed or deployed.

## Install, develop, build and preview

Use Node 22.12+ and npm. The frontend manifest and lockfile are in `web/`.

```sh
cd web
npm ci
npm run dev
npm run typecheck
node --experimental-strip-types --test test/*.test.mjs
npm run build
npm run preview
```

`npm run build` includes the TypeScript check and writes `../dist/`. Vite uses `base: './'`; all runtime assets and the historical launch snapshot are local, relative URLs. There is one page, no backend, no private API key, and no server rewrite requirement. Wallets use EIP-6963, wallet-app browser links and Coinbase Smart Wallet.

To validate the production interactions with an available Playwright installation:

```sh
cd web
node --experimental-strip-types scripts/interact.mjs
node --experimental-strip-types scripts/check-abi.mjs
node --experimental-strip-types scripts/verify-live.mjs
node scripts/browser-live.mjs
```

`interact.mjs` uses explicitly simulated wallets and RPC responses. `verify-live.mjs` and `browser-live.mjs` use real Ethereum data and the supplied public holder address, and never request signatures. Playwright scripts accept `IMD_PLAYWRIGHT` pointing to its `index.mjs` and `PLAYWRIGHT_BROWSERS_PATH` where needed. They write disposable screenshots under `test/scratch/`.

## How discovery works

1. `web/public/launches.json` contains a generated snapshot of **all pages** of the official [launch index](https://api.imd.fun/launches?limit=500), filtered to Ethereum token artifacts. The refresh script checks successful deployment receipts and deployed code, and reconciles every record in both current on-chain registries. It is not a manually curated token list.
2. The snapshot pins Ethereum block **26,202,460**, its hash, and registry counts. At runtime the client checks chain ID 1 and that block hash, reads current registry counts, scans subsequent `LaunchRecorded` events in bounded ranges, and reads each event's `artifactsOf(launchNumber)`. Only the explicit `token` role qualifies; names and symbols do not establish eligibility. Missing events are detected by comparing counts.
3. At one current Ethereum block, batched ERC-20 `balanceOf` and `decimals` calls match discovered addresses against the wallet. Multicall failure falls back to individual reads. Amounts remain `bigint` and are formatted exactly, including 0–255 decimals. Missing decimals are shown as raw units and cannot be sold.
4. The app separately reads SwarmExit's per-token preview, route and held refunds. A positive holding survives missing registration, route, liquidity, pricing or preview errors. Unknown prices say unavailable. A failed balance or registry read produces a partial or failure state, never a completed empty-wallet result.
5. Account and network changes invalidate in-flight UI results and sale confirmations. Both the wallet chain and the public RPC chain must be Ethereum before signing.

The runtime RPCs are `https://ethereum-rpc.publicnode.com` and `https://eth.drpc.org`, with bounded timeouts and fallback. The official index does not grant cross-origin access to the static app; a browser CORS check failed. Consequently the browser reads bundled history and on-chain registry updates rather than depending on that API.

Regenerate history before releasing, or when IMD changes its factory deployments:

```sh
cd web
node scripts/update-launches.mjs
npm run typecheck
npm run build
```

The refresh script fails on incomplete pages, registry count mismatch, invalid provenance, unsuccessful deployment, absent code or a changed anchor block. It writes the snapshot only after verification. Both the snapshot and rebuilt `dist/` must be delivered.

## Selling, fees and remaining live configuration

SwarmExit remains at [`0x5c3c2a6d7d340db9f8b3e0cbbc8dbbb7ec73bc61`](https://etherscan.io/address/0x5c3c2a6d7d340db9f8b3e0cbbc8dbbb7ec73bc61). Its `SELL_TAX_BPS` was read as **200**, and its `TREASURY` as **`0xFC3ad9C531e1736690b2d5f24FebD35ebf051cFB`**. These values and the ABI remain those of the merged implementation.

Sell all / sell selected retain confirmation, exact token approvals, per-token minimum proceeds, gas estimates and batches bounded by the contract's limit. Before approval, the confirmation clearly labels its figures as quotes. After approval, a fresh simulation and gas estimate must pass before a sale is sent. Failed simulations never fall back to invented successful outcomes. The client checks receipt status and only accepts outcome logs from SwarmExit for the connected account and submitted tokens. Unknown confirmations remain pending; a later batch failure retains earlier confirmed results.

The deployed contract charges the fee on successful IMD proceeds, rounded down per transaction. A reverted sale charges no sale fee, although network gas is spent. A token that refuses its refund leaves a claimable held refund; transfer-tax tokens can return less than the initial amount. The interface states those distinctions.

**The live contract currently has zero registered sale tokens.** The 163 detected holdings are therefore visible and disabled for selling. No mainnet sale was sent or claimed to succeed. The owner must use the existing `setSwarmToken`, `setTokenRoute`, `setImdRoute` and `setEthUsdFeed` functions with the actual launch pools and price feed; discovery no longer depends on completing this configuration. See the [upstream contract's configuration documentation](https://github.com/identity-md-launches/launch-1682-build-protocol-enables-user/blob/e6a695d9a368642617f5c801a7759494caf0b81d/README.md#after-launch-owner-responsibilities).

## Supported scope and limitations

- Ethereum mainnet only. Other wallet chains require switching; this frontend does not silently query another chain.
- Historical official records plus subsequent launches in the two factory registries published in [IMD's deployment table](https://imd.fun/docs/#contracts). Future factory migrations require refreshing that configuration and rebuilding. Historical API omissions outside those registries cannot be independently discovered by this version.
- Discovery depends on available public Ethereum RPCs. A partial result identifies its gaps and offers Refresh. No private indexer or wallet token-name heuristics are used.
- USD figures depend on the configured IMD route and price feed; there are currently no real USD quotes from SwarmExit. Unknown prices are not zero prices.
- Mainnet token sales, real wallet signing, physical phones, WebKit and screen-reader sessions were not tested. Sale-path tests use mocks, supplemented by 128 passing tests from the unchanged upstream contract tree.

## Delivery and publication

`dist/index.html`, all hashed assets, favicon, share image and `launches.json` are the static delivery. The network's existing process publishes the supplied export after submission. This run has **not published or verified an updated remote deployment**; no updated URL was issued. The pinned hosting handoff names the legacy Walletscope alias, so it does not establish that the separate SwarmSweep site has been updated. No publication credentials were read and no replacement hosting service was introduced.

Once the publisher issues the actual HTTPS URL, run `node web/scripts/verify-deployed.mjs` with that URL as its argument. It compares every deployed file byte-for-byte with this `dist/`. Run `web/scripts/browser-live.mjs` against that URL for the read-only mainnet wallet check. Do not equate the local build or the previously merged site with a verified new deployment.

## Main files

| File | Purpose |
| --- | --- |
| `web/src/lib/discovery.ts` | Verified history, registry events, completeness checks |
| `web/scripts/update-launches.mjs` | Reproducible full-history snapshot generation |
| `web/src/lib/sweep.ts` | Independent balances, route eligibility, simulation and receipts |
| `web/src/lib/format.ts` | Exact integer-based balance display |
| `web/src/App.tsx` | Chain/account invalidation and explicit discovery states |
| `web/src/components/TokenList.tsx` | Visible unsupported holdings, raw balances and provenance |
| `web/src/components/ConfirmDialog.tsx` | Quote/approval distinction and gas information |
| `web/src/wallet/ConnectSheet.tsx` | Actual wallet chain and switch handling |
| `web/src/config.ts`, `web/src/deployment.ts` | RPC fallback and unchanged deployed constants |
| `web/test/`, `web/scripts/interact.mjs` | Regression and production interaction tests |
| `DESIGN.md`, `VALIDATION.md` | Final design system and actual validation evidence |
