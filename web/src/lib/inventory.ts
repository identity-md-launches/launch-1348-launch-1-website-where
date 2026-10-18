import { type Address, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { erc20Abi } from "../abi/erc20.ts";
import { swarmExitAbi } from "../abi/swarmExit.ts";
import { IMD_ADDRESS, SWARM_EXIT_ADDRESS } from "../deployment.ts";
import { mapConcurrent } from "./async.ts";
import { fetchSnapshot, type Snapshot } from "./discovery.ts";
import { holdingUsd, indexedHoldings, settlementPrice, type Candidate, type IndexedHoldings } from "./holdings.ts";
import { findAnyRoute, marketLabel } from "./markets.ts";
import { loadPools, type PoolSnapshot } from "./routes.ts";
import { short } from "./format.ts";
import type { SwarmToken, WalletState } from "./sweep.ts";

export type ScanOptions = {
  signal?: AbortSignal;
  extraTokens?: Address[];
  progress?: (text: string) => void;
  onUpdate?: (state: WalletState) => void;
  // Explicit data inputs also make read-only integrations and regression checks reproducible.
  indexed?: IndexedHoldings;
  snapshot?: Snapshot;
  poolSnapshot?: PoolSnapshot;
  deep?: boolean;
};

export async function scanWallet(client: PublicClient, account: Address, options: ScanOptions = {}): Promise<WalletState> {
  const started = Date.now();
  const { signal, progress } = options;
  if (await client.getChainId() !== 1) throw new Error("The RPC is on the wrong network. Ethereum is required.");
  signal?.throwIfAborted();
  progress?.("Finding your Ethereum token balances…");
  const [blockNumber, indexed, saved, imdPrice] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    options.indexed ?? indexedHoldings(account, options),
    options.snapshot ?? fetchSnapshot().catch(() => null),
    settlementPrice(signal),
  ]);
  signal?.throwIfAborted();
  const warnings = [...indexed.warnings];
  if (!saved) warnings.push("The supplemental Swarm history could not be loaded. Indexed Ethereum tokens are still checked.");
  const candidates = new Map<string, Candidate>();
  for (const t of saved?.tokens ?? []) candidates.set(t.address.toLowerCase(), { address: t.address });
  for (const t of indexed.tokens) candidates.set(t.address.toLowerCase(), t);
  for (const address of options.extraTokens ?? []) if (!candidates.has(address.toLowerCase())) candidates.set(address.toLowerCase(), { address });
  const launches = new Map((saved?.tokens ?? []).map((t) => [t.address.toLowerCase(), t]));
  const list = [...candidates.values()];
  let balancesRead = 0, failedBalances = 0, failedRefunds = 0;
  const positive: SwarmToken[] = [];
  const chunks = Array.from({ length: Math.ceil(list.length / 48) }, (_, i) => list.slice(i * 48, i * 48 + 48));
  await mapConcurrent(chunks, 3, async (chunk) => {
    signal?.throwIfAborted();
    const contracts = chunk.flatMap((token) => [
      { address: token.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [account] as const },
      ...(launches.has(token.address.toLowerCase()) ? [{ address: SWARM_EXIT_ADDRESS, abi: swarmExitAbi, functionName: "heldRefunds" as const, args: [account, token.address] as const }] : []),
    ]);
    let reads;
    try { reads = await client.multicall({ contracts, allowFailure: true, blockNumber, multicallAddress: mainnet.contracts.multicall3.address, batchSize: 0 }); }
    catch { reads = contracts.map(() => ({ status: "failure" as const })); }
    const repaired = await mapConcurrent(contracts, 6, async (contract, i) => {
      if (reads[i]?.status === "success") return reads[i]!;
      signal?.throwIfAborted();
      try { return { status: "success" as const, result: contract.functionName === "balanceOf"
        ? await client.readContract({ ...contract, blockNumber })
        : await client.readContract({ ...contract, blockNumber }) }; }
      catch { return { status: "failure" as const }; }
    }, signal);
    let offset = 0;
    for (const candidate of chunk) {
      const balanceRead = repaired[offset++]!;
      const launch = launches.get(candidate.address.toLowerCase());
      const refundRead = launch ? repaired[offset++] : null;
      if (refundRead?.status === "failure") failedRefunds++;
      const heldRefund = refundRead?.status === "success" && typeof refundRead.result === "bigint" ? refundRead.result : 0n;
      if (balanceRead.status !== "success" || typeof balanceRead.result !== "bigint") { failedBalances++; continue; }
      balancesRead++;
      if (balanceRead.result <= 0n && heldRefund <= 0n) continue;
      positive.push({
        address: candidate.address, symbol: candidate.symbol || short(candidate.address), name: candidate.name,
        decimals: null, balance: balanceRead.result, expectedImd: 0n, sellable: false, status: 1,
        route: null, routeLabel: null, heldRefund, launch, usdPrice: candidate.usdPrice ?? null,
        usdValue: null, unverified: candidate.unverified,
      });
    }
    progress?.(`Verifying balances · ${balancesRead} of ${list.length} checked…`);
  }, signal);
  if (list.length && balancesRead === 0) throw new Error("No token balances could be verified. Check your connection and scan again.");
  if (failedBalances) warnings.push(`${failedBalances} balances could not be verified. These holdings are unknown; retry the scan.`);
  if (failedRefunds) warnings.push(`${failedRefunds} legacy refund balances could not be checked. Retry to check refunds.`);

  const metadataChunks = Array.from({ length: Math.ceil(positive.length / 32) }, (_, i) => positive.slice(i * 32, i * 32 + 32));
  await mapConcurrent(metadataChunks, 3, async (chunk) => {
    const contracts = chunk.flatMap((token) => [
      { address: token.address, abi: erc20Abi, functionName: "decimals" as const },
      { address: token.address, abi: erc20Abi, functionName: "symbol" as const },
    ]);
    let reads;
    try { reads = await client.multicall({ contracts, allowFailure: true, blockNumber, multicallAddress: mainnet.contracts.multicall3.address, batchSize: 0 }); }
    catch { reads = contracts.map(() => ({ status: "failure" as const })); }
    await mapConcurrent(chunk, 6, async (token, i) => {
      let decimal = reads[i * 2];
      if (decimal?.status !== "success") {
        try { decimal = { status: "success", result: await client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals", blockNumber }) }; }
        catch { /* Raw units remain visible; never guess a token's decimals. */ }
      }
      const d = decimal?.status === "success" ? Number(decimal.result) : NaN;
      token.decimals = Number.isInteger(d) && d >= 0 && d <= 255 ? d : null;
      if (token.decimals === null) token.readError = "Token decimals could not be read. Raw units are shown; selling is disabled.";
      const symbol = reads[i * 2 + 1];
      if (symbol?.status === "success" && typeof symbol.result === "string" && symbol.result) token.symbol = symbol.result;
      token.usdValue = holdingUsd(token.balance, token.decimals, token.usdPrice);
    }, signal);
  }, signal);
  positive.sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || a.symbol.localeCompare(b.symbol));
  const price = positive.find((t) => t.address.toLowerCase() === IMD_ADDRESS)?.usdPrice ?? imdPrice;
  const state: WalletState = {
    tokens: positive, pricing: price !== null && price !== undefined && price > 0 ? { imdUsd: price, ethUsd: null } : null,
    pricingError: price ? null : "An indexed USD price for IMD is unavailable. IMD quotes still work.",
    paused: false, maxPerSale: 20, minImdOut: 1n, registered: 0, discovered: list.length,
    balancesRead, blockNumber, snapshotBlock: saved?.blockNumber ?? Number(blockNumber), warnings,
    complete: indexed.complete && failedBalances === 0, indexed: indexed.complete, scannedAt: Date.now(),
  };
  const emit = () => options.onUpdate?.({ ...state, tokens: state.tokens.map((t) => ({ ...t })), warnings: [...warnings], durationMs: Date.now() - started });
  emit();
  progress?.(`Balances ready · finding routes for ${positive.length} tokens…`);
  const held = positive.filter((token) => token.balance > 0n);
  const market = await loadPools(client, held.flatMap((t) => t.launch ? [t.launch] : []), blockNumber, options.poolSnapshot, { currencies: held.map((t) => t.address), rankLiquidity: true, recent: options.deep ?? false, progress });
  warnings.push(...market.warnings);
  let checked = 0, incompleteRoutes = 0;
  await mapConcurrent(positive, 4, async (token) => {
    if (token.balance > 0n && token.decimals !== null) {
      const historyCovered = !!token.launch && !market.warnings.some((warning) => warning.startsWith("Pool history unavailable")) && token.launch.blockNumber <= (options.poolSnapshot?.blockNumber ?? saved?.blockNumber ?? 0);
      const result = await findAnyRoute(client, account, token.address, token.balance, market.pools, blockNumber, signal, historyCovered, options.deep ?? false);
      token.liveRoute = result.route ?? undefined;
      token.routeReason = result.reason ?? undefined;
      token.sellable = !!result.route;
      token.expectedImd = result.route?.amountOut ?? 0n;
      token.routeLabel = result.route ? marketLabel(result.route) : null;
      if (result.incomplete) { state.complete = false; state.incompleteRoutes = ++incompleteRoutes; }
    }
    token.routeChecked = true;
    progress?.(`Finding sell routes · ${++checked} of ${positive.length} checked…`);
    emit();
  }, signal);
  signal?.throwIfAborted();
  if (incompleteRoutes) warnings.push(`${incompleteRoutes} token route searches were incomplete. Token details explain whether deeper paths or unavailable services need checking.`);
  state.complete &&= warnings.length === 0;
  return { ...state, tokens: positive.map((t) => ({ ...t })), durationMs: Date.now() - started };
}
