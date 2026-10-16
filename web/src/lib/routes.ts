import {
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { IMD_ADDRESS } from "../deployment.ts";
import { message, type LaunchToken } from "./discovery.ts";
import { mainnet } from "viem/chains";

// Ethereum deployments: https://docs.uniswap.org/contracts/v4/deployments
// This router uses the original v4 ABI (no minHopPriceX36 field).
export const POOL_MANAGER =
  "0x000000000004444c5dc75cb358380d2e3de08a90" as const;
export const V4_QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203" as const;
export const UNIVERSAL_ROUTER =
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" as const;
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;
export const MAX_INPUT = (1n << 128n) - 1n;
export const STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227" as const;
export const stateAbi = parseAbi([
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
export const poolAbi = parseAbi([
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
]);
export const quoterAbi = parseAbi([
  "function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const poolKeyParams = parseAbiParameters(
  "address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks",
);
export type Pool = {
  id: Hash;
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  blockNumber: number;
  transactionHash: Hash;
  liquidity?: bigint;
};
export type PoolSnapshot = {
  version: 1;
  chainId: 1;
  blockNumber: number;
  blockHash: Hash;
  pools: Pool[];
};
export type LiveRoute = {
  pools: Pool[];
  amountIn: bigint;
  amountOut: bigint;
  blockNumber: bigint;
  quotedAt: number;
};
export type RouteResult = {
  route: LiveRoute | null;
  reason: string | null;
  incomplete: boolean;
};
export const sameAddress = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
export const poolId = (p: Pool) =>
  keccak256(
    encodeAbiParameters(poolKeyParams, [
      p.currency0,
      p.currency1,
      p.fee,
      p.tickSpacing,
      p.hooks,
    ]),
  );

export function validatePools(value: unknown): PoolSnapshot {
  const s = value as PoolSnapshot;
  if (
    !s ||
    s.version !== 1 ||
    s.chainId !== 1 ||
    !Number.isSafeInteger(s.blockNumber) ||
    s.blockNumber <= 0 ||
    !/^0x[\da-f]{64}$/i.test(s.blockHash) ||
    !Array.isArray(s.pools)
  )
    throw new Error("Invalid pool snapshot. Refresh routes.");
  const ids = new Set<string>();
  for (const p of s.pools) {
    if (
      ![p.currency0, p.currency1, p.hooks].every((a) =>
        /^0x[\da-f]{40}$/i.test(a),
      ) ||
      BigInt(p.currency0) >= BigInt(p.currency1) ||
      !Number.isInteger(p.fee) ||
      p.fee < 0 ||
      p.fee > 0xffffff ||
      !Number.isInteger(p.tickSpacing) ||
      p.tickSpacing <= 0 ||
      p.tickSpacing > 32767 ||
      !Number.isSafeInteger(p.blockNumber) ||
      p.blockNumber > s.blockNumber ||
      p.blockNumber <= 0 ||
      !/^0x[\da-f]{64}$/i.test(p.transactionHash) ||
      poolId(p) !== p.id.toLowerCase() ||
      ids.has(p.id.toLowerCase())
    )
      throw new Error("Invalid pool provenance. Refresh routes.");
    ids.add(p.id.toLowerCase());
  }
  return s;
}

export function poolsFromLogs(
  logs: Parameters<typeof parseEventLogs>[0]["logs"],
): Pool[] {
  return parseEventLogs({
    abi: poolAbi,
    logs: logs.filter((l) => sameAddress(l.address, POOL_MANAGER)),
    strict: true,
  })
    .filter(
      (l) => !l.removed && l.blockNumber !== null && l.transactionHash !== null,
    )
    .map((l) => ({
      id: l.args.id,
      currency0: l.args.currency0,
      currency1: l.args.currency1,
      fee: l.args.fee,
      tickSpacing: l.args.tickSpacing,
      hooks: l.args.hooks,
      blockNumber: Number(l.blockNumber),
      transactionHash: l.transactionHash!,
    }));
}

/** Bounded, adaptive log ranges. Errors remain errors; they never become an empty market. */
export async function scanPools(
  client: PublicClient,
  currencies: Address[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Pool[]> {
  if (fromBlock > toBlock) return [];
  const found = new Map<string, Pool>();
  async function read(
    from: bigint,
    to: bigint,
    position: "currency0" | "currency1",
    group: Address[],
  ): Promise<void> {
    try {
      const logs = await client.getLogs({
        address: POOL_MANAGER,
        event: poolAbi[0],
        args: { [position]: group },
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      for (const p of poolsFromLogs(logs)) found.set(p.id, p);
    } catch (e) {
      if (to - from < 100n) throw e;
      const mid = (from + to) / 2n;
      await read(from, mid, position, group);
      await read(mid + 1n, to, position, group);
    }
  }
  for (let i = 0; i < currencies.length; i += 100)
    for (let start = fromBlock; start <= toBlock; start += 20000n) {
      const end = start + 19999n < toBlock ? start + 19999n : toBlock;
      await Promise.all([
        read(start, end, "currency0", currencies.slice(i, i + 100)),
        read(start, end, "currency1", currencies.slice(i, i + 100)),
      ]);
    }
  return [...found.values()];
}

/** A verified event index is only a search accelerator. Every output is freshly quoted on chain. */
export async function loadPools(
  client: PublicClient,
  launches: LaunchToken[],
  blockNumber: bigint,
  snapshot?: PoolSnapshot,
) {
  const warnings: string[] = [];
  const pools = new Map<string, Pool>();
  let start = blockNumber + 1n;
  try {
    if (!snapshot) {
      const response = await fetch("./pools.json", {
        cache: "no-cache",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Pool history HTTP ${response.status}`);
      snapshot = validatePools(await response.json());
    } else snapshot = validatePools(snapshot);
    if (
      BigInt(snapshot.blockNumber) > blockNumber ||
      (await client.getBlock({ blockNumber: BigInt(snapshot.blockNumber) }))
        .hash !== snapshot.blockHash
    )
      throw new Error("Pool history does not match the current chain");
    snapshot.pools.forEach((p) => pools.set(p.id, p));
    start = BigInt(snapshot.blockNumber) + 1n;
  } catch (e) {
    warnings.push(
      `Pool history unavailable: ${message(e)}. Launch pools are checked individually; bridge routes may be missing.`,
    );
  }
  const unknown = launches.filter(
    (t) =>
      ![...pools.values()].some(
        (p) =>
          sameAddress(p.currency0, t.address) ||
          sameAddress(p.currency1, t.address),
      ),
  );
  for (let i = 0; i < unknown.length; i += 6)
    await Promise.all(
      unknown.slice(i, i + 6).map(async (t) => {
        try {
          const receipt = await client.getTransactionReceipt({
            hash: t.transactionHash,
          });
          if (receipt.status !== "success" || receipt.blockNumber > blockNumber)
            throw new Error("Launch receipt is not confirmed");
          poolsFromLogs(receipt.logs)
            .filter(
              (p) =>
                sameAddress(p.currency0, t.address) ||
                sameAddress(p.currency1, t.address),
            )
            .forEach((p) => pools.set(p.id, p));
        } catch (e) {
          warnings.push(`Pool lookup failed for ${t.address}: ${message(e)}`);
        }
      }),
    );
  if (start <= blockNumber) {
    const currencies = [
      ...new Set(
        [
          IMD_ADDRESS,
          ...launches.map((t) => t.address),
          ...[...pools.values()].flatMap((p) => [p.currency0, p.currency1]),
        ].map((a) => a.toLowerCase()),
      ),
    ].filter((a) => a !== NATIVE) as Address[];
    try {
      (await scanPools(client, currencies, start, blockNumber)).forEach((p) =>
        pools.set(p.id, p),
      );
    } catch (e) {
      warnings.push(
        `Recent pools unavailable: ${message(e)}. Known pools can still be quoted; refresh to retry.`,
      );
    }
  }
  const list = [...pools.values()];
  // Rank alternatives by current active liquidity. Zero liquidity is not excluded: a swap
  // can cross into another tick range. A missing state read does not invent a zero balance.
  for (let i = 0; i < list.length; i += 64) {
    try {
      const chunk = list.slice(i, i + 64);
      const reads = await client.multicall({
        contracts: chunk.map((p) => ({
          address: STATE_VIEW,
          abi: stateAbi,
          functionName: "getLiquidity" as const,
          args: [p.id] as const,
        })),
        blockNumber,
        allowFailure: true,
        multicallAddress: mainnet.contracts.multicall3.address,
      });
      reads.forEach((r, j) => {
        if (r.status === "success") chunk[j]!.liquidity = r.result;
      });
    } catch {
      /* Quoting still determines whether each candidate can trade. */
    }
  }
  return { pools: list, warnings };
}

/** Simple paths of at most three v4 pools; no repeated currencies or pool cycles. */
export function candidatePaths(
  token: Address,
  pools: Pool[],
  target: Address = IMD_ADDRESS,
): Pool[][] {
  const paths: Pool[][] = [];
  const walk = (currency: Address, path: Pool[], seen: Set<string>) => {
    if (path.length >= 3) return;
    for (const pool of pools) {
      const next = sameAddress(pool.currency0, currency)
        ? pool.currency1
        : sameAddress(pool.currency1, currency)
          ? pool.currency0
          : null;
      if (!next || seen.has(next.toLowerCase())) continue;
      if (sameAddress(next, target)) paths.push([...path, pool]);
      else walk(next, [...path, pool], new Set([...seen, next.toLowerCase()]));
    }
  };
  walk(token, [], new Set([token.toLowerCase()]));
  const liquidity = (path: Pool[]) =>
    path.reduce(
      (n, p) =>
        n === null || (p.liquidity ?? 0n) < n ? (p.liquidity ?? 0n) : n,
      null as bigint | null,
    ) ?? 0n;
  return paths.sort(
    (a, b) =>
      a.length - b.length ||
      (liquidity(a) > liquidity(b)
        ? -1
        : liquidity(a) < liquidity(b)
          ? 1
          : 0) ||
      a
        .map((p) => p.id)
        .join()
        .localeCompare(b.map((p) => p.id).join()),
  );
}

export function pathKeys(token: Address, pools: Pool[]) {
  let currency = token;
  return pools.map((p) => {
    const next = sameAddress(p.currency0, currency)
      ? p.currency1
      : sameAddress(p.currency1, currency)
        ? p.currency0
        : null;
    if (!next || poolId(p) !== p.id.toLowerCase())
      throw new Error("Invalid sale path");
    currency = next;
    return {
      intermediateCurrency: next,
      fee: p.fee,
      tickSpacing: p.tickSpacing,
      hooks: p.hooks,
      hookData: "0x" as const,
    };
  });
}

export async function quotePath(
  client: PublicClient,
  account: Address,
  token: Address,
  amount: bigint,
  pools: Pool[],
  blockNumber: bigint,
): Promise<LiveRoute> {
  if (amount <= 0n || amount > MAX_INPUT)
    throw new Error("Balance is outside this router’s supported range");
  const path = pathKeys(token, pools);
  if (
    !path.length ||
    !sameAddress(path[path.length - 1]!.intermediateCurrency, IMD_ADDRESS)
  )
    throw new Error("Route does not end in IMD");
  const { result } = await client.simulateContract({
    address: V4_QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInput",
    args: [{ exactCurrency: token, path, exactAmount: amount }],
    account,
    blockNumber,
  });
  if (result[0] <= 0n || result[0] > MAX_INPUT)
    throw new Error("Pool returned no supported IMD output");
  return {
    pools,
    amountIn: amount,
    amountOut: result[0],
    blockNumber,
    quotedAt: Date.now(),
  };
}

export async function findRoute(
  client: PublicClient,
  account: Address,
  token: Address,
  amount: bigint,
  pools: Pool[],
  blockNumber: bigint,
  progress?: (checked: number, total: number) => void,
): Promise<RouteResult> {
  const paths = candidatePaths(token, pools);
  if (!paths.length)
    return {
      route: null,
      reason:
        "No connected Uniswap v4 path to IMD found. Refresh to check new pools.",
      incomplete: false,
    };
  if (amount > MAX_INPUT)
    return {
      route: null,
      reason: "Balance exceeds the router’s maximum input amount.",
      incomplete: false,
    };
  let unavailable = false;
  let checked = 0;
  // Prefer a shorter executable path; this is route discovery, not a best-price aggregator.
  // Keep requests sequential within each token and yield between bounded batches.
  // A batch boundary must never discard the remaining candidates.
  for (let offset = 0; offset < paths.length; offset += 24) {
    if (offset > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (const path of paths.slice(offset, offset + 24)) {
      try {
        const quote = await quotePath(
          client,
          account,
          token,
          amount,
          path,
          blockNumber,
        );
        return { route: quote, reason: null, incomplete: false };
      } catch (e) {
        if (insufficientLiquidity(e)) {
          // A full-balance failure is not the same as no route. Find a smaller executable
          // amount, without claiming this is the maximum or silently selling the full balance.
          let partial = amount / 2n;
          for (
            let attempt = 0;
            attempt < 12 && partial > 0n;
            attempt++, partial /= 2n
          ) {
            try {
              return {
                route: await quotePath(
                  client,
                  account,
                  token,
                  partial,
                  path,
                  blockNumber,
                ),
                reason: null,
                incomplete: false,
              };
            } catch (partialError) {
              if (!insufficientLiquidity(partialError)) break;
            }
          }
        }
        const error = e as { name?: string; walk?: () => { name?: string } };
        const text = message(e);
        if (
          !/revert|no supported IMD|outside this router/i.test(text) &&
          error.walk?.()?.name !== "ContractFunctionRevertedError"
        )
          unavailable = true;
      } finally {
        progress?.(++checked, paths.length);
      }
    }
  }
  return {
    route: null,
    incomplete: unavailable,
    reason: unavailable
      ? "Live quote unavailable. Refresh to retry the RPC request."
      : "Pools found, but no live quote for this balance. Liquidity or pool rules may prevent selling.",
  };
}

export function routeLabel(route: LiveRoute): string {
  if (route.pools.length === 1) return "Uniswap v4 → IMD";
  return `Uniswap v4 · ${route.pools.length} pools → IMD`;
}

/** The deployed quoter wraps NotEnoughLiquidity(bytes32) in UnexpectedRevertBytes(bytes). */
export function insufficientLiquidity(error: unknown): boolean {
  let current = error as
    | { raw?: string; data?: unknown; cause?: unknown }
    | undefined;
  for (let i = 0; current && i < 12; i++) {
    const raw =
      typeof current.raw === "string"
        ? current.raw
        : typeof current.data === "string"
          ? current.data
          : "";
    if (raw.startsWith("0x7a5ed734")) return true;
    if (raw.startsWith("0x6190b2b0")) {
      try {
        if (
          decodeAbiParameters(
            parseAbiParameters("bytes"),
            `0x${raw.slice(10)}`,
          )[0].startsWith("0x7a5ed734")
        )
          return true;
      } catch {
        /* malformed error */
      }
    }
    current = current.cause as typeof current;
  }
  return false;
}
