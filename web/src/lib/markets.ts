import {
  encodePacked, encodeEventTopics, parseAbi, pad, type Address, type Hash, type PublicClient,
} from "viem";
import { IMD_ADDRESS } from "../deployment.ts";
import { quoteLimit, mapConcurrent } from "./async.ts";
import { indexerJson } from "./holdings.ts";
import {
  candidatePaths, insufficientLiquidity, MAX_INPUT, NATIVE, poolAbi, poolId,
  poolsFromLogs, POOL_MANAGER, quotePath, sameAddress,
  type LiveRoute, type Pool, type RouteResult,
} from "./routes.ts";
import { message } from "./discovery.ts";

// Canonical Ethereum deployments; only these routers/quoters are used for execution.
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" as const;
export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" as const;
export const V2_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d" as const;
export const V3_QUOTER = "0x61ffe014ba17989e743c5f6cb21bf9697530b21e" as const;
export const V3_FACTORY = "0x1f98431c8ad98523631ae4a59f267346ea31f984" as const;
export const V2_FACTORY = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f" as const;
export const v3FactoryAbi = parseAbi(["function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)"]);
export const v2FactoryAbi = parseAbi(["function getPair(address tokenA,address tokenB) view returns (address pair)"]);
export const v2Abi = parseAbi(["function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)"]);
export const v3Abi = parseAbi(["function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"]);

export function packedPath(path: readonly Address[], fees: readonly number[]) {
  if (path.length !== fees.length + 1 || path.length < 2) throw new Error("Invalid v3 path");
  let result: `0x${string}` = path[0]!;
  for (let i = 0; i < fees.length; i++) {
    if (!Number.isInteger(fees[i]) || fees[i]! < 0 || fees[i]! > 1_000_000) throw new Error("Invalid pool fee");
    result = `${result}${encodePacked(["uint24", "address"], [fees[i]!, path[i + 1]!]).slice(2)}`;
  }
  return result;
}

export async function quoteBridge(
  client: PublicClient, account: Address, amount: bigint,
  bridge: NonNullable<LiveRoute["bridge"]>, blockNumber: bigint,
): Promise<bigint> {
  if (bridge.kind === "weth") {
    if (bridge.path.length !== 1 || !sameAddress(bridge.path[0]!, WETH)) throw new Error("Invalid wrapped ETH path");
    return amount;
  }
  if (!sameAddress(bridge.path.at(-1)!, WETH)) throw new Error("Bridge must end in WETH");
  if (bridge.kind === "v2") {
    const amounts = await client.readContract({ address: V2_ROUTER, abi: v2Abi, functionName: "getAmountsOut", args: [amount, bridge.path], blockNumber });
    return amounts.at(-1)!;
  }
  const { result } = await client.simulateContract({ address: V3_QUOTER, abi: v3Abi, functionName: "quoteExactInput", args: [packedPath(bridge.path, bridge.fees), amount], account, blockNumber });
  return result[0];
}

export async function quoteLiveRoute(
  client: PublicClient, account: Address, token: Address, amount: bigint,
  route: LiveRoute, blockNumber: bigint,
): Promise<LiveRoute> {
  if (!route.bridge) return quotePath(client, account, token, amount, route.pools, blockNumber);
  if (!sameAddress(route.bridge.path[0]!, token)) throw new Error("Bridge input does not match the selected token");
  const intermediate = await quoteBridge(client, account, amount, route.bridge, blockNumber);
  const final = await quotePath(client, account, NATIVE, intermediate, route.pools, blockNumber);
  return { ...final, amountIn: amount, bridge: { ...route.bridge, amountOut: intermediate } };
}

const cachedRoutes = new Map<string, LiveRoute>();
const cachedPools = new Map<string, { pools: Pool[]; blockNumber: bigint }>();

/** Indexed Initialize events discover older non-Swarm pools without a genesis RPC scan.
 * Pool keys are hash-checked and must still pass a real on-chain quote. */
export async function indexedPools(token: Address, blockNumber: bigint, signal?: AbortSignal): Promise<Pool[]> {
  const key = token.toLowerCase();
  const cached = cachedPools.get(key);
  if (cached && blockNumber >= cached.blockNumber && blockNumber - cached.blockNumber <= (cached.pools.length ? 100n : 10n)) return cached.pools;
  const topic = pad(token.toLowerCase() as Address, { size: 32 });
  const topics = encodeEventTopics({ abi: poolAbi, eventName: "Initialize" });
  const found = new Map<string, Pool>();
  await Promise.all([2, 3].map(async (position) => {
    const query = new URLSearchParams({ module: "logs", action: "getLogs", fromBlock: "21688329", toBlock: blockNumber.toString(), address: POOL_MANAGER, topic0: topics[0]!, [`topic${position}`]: topic, [`topic0_${position}_opr`]: "and" });
    const response = await indexerJson(`/api?${query}`, signal) as { status?: string; message?: string; result?: unknown };
    if (response.status === "0" && /no logs/i.test(response.message ?? "")) return;
    if (!Array.isArray(response.result)) throw new Error("Historical v4 pool lookup is unavailable");
    if (response.result.length >= 1000) throw new Error("Historical v4 lookup reached the index limit; coverage is incomplete");
    const logs = response.result.map((raw: Record<string, unknown>) => ({
      ...raw, blockNumber: BigInt(String(raw.blockNumber)), removed: false,
      transactionHash: raw.transactionHash as Hash,
    })) as Parameters<typeof poolsFromLogs>[0];
    for (const pool of poolsFromLogs(logs)) {
      if (pool.blockNumber <= Number(blockNumber) && poolId(pool) === pool.id.toLowerCase() &&
          (sameAddress(pool.currency0, token) || sameAddress(pool.currency1, token))) found.set(pool.id, pool);
    }
  }));
  const pools = [...found.values()];
  cachedPools.set(key, { pools, blockNumber });
  return pools;
}

/** Parallel paths, globally bounded RPC work, and no waiting for a slower token's batch. */
export async function findFastV4Route(
  client: PublicClient, account: Address, token: Address, amount: bigint,
  pools: Pool[], blockNumber: bigint, signal?: AbortSignal,
  options: { maxPaths?: number; partialAttempts?: number } = {},
): Promise<RouteResult> {
  const paths = candidatePaths(token, pools);
  if (!paths.length) return { route: null, reason: "No connected Uniswap v4 path to IMD found.", incomplete: false };
  if (amount <= 0n || amount > MAX_INPUT) return { route: null, reason: "Balance is outside the router’s supported input range.", incomplete: false };
  let unavailable = false;
  let partialTruncated = false;
  const count = Math.min(paths.length, options.maxPaths ?? paths.length);
  for (let start = 0; start < count; start += 3) {
    signal?.throwIfAborted();
    let won = false;
    const attempts = paths.slice(start, Math.min(start + 3, count)).map(async (path) => {
      try {
        const route = await quoteLimit(() => { signal?.throwIfAborted(); return quotePath(client, account, token, amount, path, blockNumber); });
        won = true;
        return route;
      } catch (error) {
        if (insufficientLiquidity(error)) {
          partialTruncated ||= options.partialAttempts !== undefined && options.partialAttempts < 12;
          for (let partial = amount / 2n, n = 0; partial > 0n && n < (options.partialAttempts ?? 12); partial /= 2n, n++) {
            signal?.throwIfAborted();
            if (won) return null;
            try { const route = await quoteLimit(() => { signal?.throwIfAborted(); return quotePath(client, account, token, partial, path, blockNumber); }); won = true; return route; }
            catch (e) { if (!insufficientLiquidity(e)) break; }
          }
        }
        if (!/revert|no supported IMD|outside.*range/i.test(message(error))) unavailable = true;
        return null;
      }
    });
    try {
      const route = await Promise.any(attempts.map(async (attempt) => {
        const route = await attempt;
        if (!route) throw new Error("No quote for this candidate");
        return route;
      }));
      return { route, reason: null, incomplete: false };
    } catch { signal?.throwIfAborted(); }
  }
  if (count < paths.length) return { route: null, reason: `Quick search checked ${count} of ${paths.length} candidate v4 routes. Enable the deeper search in scan coverage to check the rest.`, incomplete: true };
  if (partialTruncated) return { route: null, reason: "No route in the quick search. The deeper search also checks smaller partial balances.", incomplete: true };
  return { route: null, reason: unavailable ? "Live quotes unavailable. Retry the scan." : "Pools found, but no executable quote at this balance.", incomplete: unavailable };
}

export async function findAnyRoute(
  client: PublicClient, account: Address, token: Address, amount: bigint,
  pools: Pool[], blockNumber: bigint, signal?: AbortSignal,
  historyCovered = false,
  deep = true,
): Promise<RouteResult> {
  if (sameAddress(token, IMD_ADDRESS)) return { route: null, reason: "Already IMD. This balance stays in your wallet.", incomplete: false };
  const key = `${token.toLowerCase()}:${amount}`;
  const cached = cachedRoutes.get(key);
  if (cached) {
    try { return { route: await quoteLimit(() => quoteLiveRoute(client, account, token, amount, cached, blockNumber)), reason: null, incomplete: false }; }
    catch { cachedRoutes.delete(key); }
  }
  const search = deep ? {} : { maxPaths: 6, partialAttempts: 4 };
  const direct = await findFastV4Route(client, account, token, amount, pools, blockNumber, signal, search);
  if (direct.route) { cachedRoutes.set(key, direct.route); return direct; }
  if (amount > MAX_INPUT || amount <= 0n) return direct;
  const bridges: NonNullable<LiveRoute["bridge"]>[] = sameAddress(token, WETH)
    ? [{ kind: "weth", path: [WETH], fees: [], amountOut: amount }]
    : [
      ...[500, 3000, 10000, 100].map((fee) => ({ kind: "v3" as const, path: [token, WETH], fees: [fee], amountOut: 0n })),
      ...(!sameAddress(token, USDC) ? [500, 3000, 10000].map((fee) => ({ kind: "v3" as const, path: [token, USDC, WETH], fees: [fee, 500], amountOut: 0n })) : []),
      { kind: "v2", path: [token, WETH], fees: [], amountOut: 0n },
      ...(!sameAddress(token, USDC) ? [{ kind: "v2" as const, path: [token, USDC, WETH], fees: [], amountOut: 0n }] : []),
    ];
  let bridgeUnavailable = false;
  // A factory multicall eliminates nonexistent v2/v3 markets before expensive quoter calls.
  const existence = await mapConcurrent(bridges, 6, async (bridge) => {
    if (bridge.kind === "weth") return true;
    try {
      const address = bridge.kind === "v2"
        ? await client.readContract({ address: V2_FACTORY, abi: v2FactoryAbi, functionName: "getPair", args: [bridge.path[0]!, bridge.path[1]!], blockNumber })
        : await client.readContract({ address: V3_FACTORY, abi: v3FactoryAbi, functionName: "getPool", args: [bridge.path[0]!, bridge.path[1]!, bridge.fees[0]!], blockNumber });
      return !/^0x0{40}$/i.test(address);
    } catch { bridgeUnavailable = true; return true; }
  }, signal);
  const quotes = await mapConcurrent(bridges.filter((_bridge, i) => existence[i]), 3, async (bridge) => {
    try {
      const output = await quoteLimit(() => quoteBridge(client, account, amount, bridge, blockNumber));
      return output > 0n && output <= MAX_INPUT ? { ...bridge, amountOut: output } : null;
    } catch (e) { if (!/revert|insufficient|no data|zero data/i.test(message(e))) bridgeUnavailable = true; return null; }
  }, signal);
  const ordered = quotes.filter((q): q is NonNullable<typeof q> => q !== null).sort((a, b) => a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0);
  for (const bridge of ordered) {
    const final = await findFastV4Route(client, account, NATIVE, bridge.amountOut, pools, blockNumber, signal, search);
    if (final.route && final.route.amountIn === bridge.amountOut) {
      const route = { ...final.route, amountIn: amount, bridge };
      cachedRoutes.set(key, route);
      return { route, reason: null, incomplete: false };
    }
    bridgeUnavailable ||= final.incomplete;
  }
  try {
    if (historyCovered) return { route: null, incomplete: direct.incomplete || bridgeUnavailable, reason: direct.incomplete ? direct.reason : bridgeUnavailable ? "Some markets could not be checked. Retry the scan." : "No executable Uniswap v2, v3 or v4 route found. Other exchanges may have liquidity." };
    const older = await indexedPools(token, blockNumber, signal);
    if (older.length) {
      const result = await findFastV4Route(client, account, token, amount, [...new Map([...pools, ...older].map((p) => [p.id, p])).values()], blockNumber, signal, search);
      if (result.route) { cachedRoutes.set(key, result.route); return result; }
      if (result.incomplete) return result;
    }
  } catch { signal?.throwIfAborted(); bridgeUnavailable = true; }
  return { route: null, incomplete: direct.incomplete || bridgeUnavailable,
    reason: direct.incomplete ? direct.reason : bridgeUnavailable ? "Some markets could not be checked. Retry the scan." : "No executable Uniswap v2, v3 or v4 route found. Other exchanges may have liquidity." };
}

export function marketLabel(route: LiveRoute): string {
  return route.bridge ? `${route.bridge.kind === "weth" ? "WETH" : `Uniswap ${route.bridge.kind}`} → ETH → IMD` : `Uniswap v4 → IMD`;
}
