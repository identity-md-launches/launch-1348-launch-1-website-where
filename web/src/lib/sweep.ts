// Reads and writes against SwarmExit. Every function here takes viem clients and returns plain data;
// the components decide how to show it.
import {
  parseEventLogs,
  parseUnits,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { swarmExitAbi } from "../abi/swarmExit.ts";
import { erc20Abi } from "../abi/erc20.ts";
import {
  BPS,
  DEADLINE_SECONDS,
  FEE_BPS,
  IMD_ADDRESS,
  IMD_DECIMALS,
  SLIPPAGE_BPS,
  SWARM_EXIT_ADDRESS,
} from "../deployment.ts";
import { mainnet } from "viem/chains";
import {
  discoverLaunches,
  message,
  type Snapshot,
  type LaunchToken,
} from "./discovery.ts";
import { short } from "./format.ts";
import {
  findRoute,
  loadPools,
  routeLabel,
  type LiveRoute,
  type PoolSnapshot,
} from "./routes.ts";
import { planDirectSale, executeDirectSale } from "./directSale.ts";

/** SwarmExit.Status, in declaration order. */
export const STATUS_TEXT = [
  "Sellable",
  "No connected pool path found",
  "No balance",
  "No sale route configured",
  "IMD route not configured",
  "No liquidity (quote failed)",
  "Below the minimum proceeds",
  "Sale would fail on chain",
  "Price impact too high",
  "Not approved",
] as const;
export const STATUS_SOLD = 0;

export type SellRoute = { venue: number; tokenOut: Address };

export type SwarmToken = {
  address: Address;
  liveRoute?: LiveRoute;
  routeReason?: string;
  symbol: string;
  decimals: number | null;
  readError?: string;
  launch?: LaunchToken;
  balance: bigint;
  /** Expected IMD from the contract's preview (gross, before the fee). */
  expectedImd: bigint;
  sellable: boolean;
  status: number;
  route: SellRoute | null;
  /** Human label of the sell route, or null when the contract has none for this token. */
  routeLabel: string | null;
  heldRefund: bigint;
  /** Set after a sale transaction. */
  result?: SaleResult;
  /** Completed outcome retained after fresh holdings release the selection lock. */
  previousResult?: Exclude<SaleResult, { kind: "pending" }>;
};

export type SaleResult =
  | { kind: "sold"; imdOut: bigint; txHash: Hash }
  | { kind: "unsold"; reason: string; txHash?: Hash; held?: boolean }
  | {
      kind: "pending";
      phase?: "approval" | "sale";
      reason: string;
      txHash: Hash;
    };

export type Pricing = { imdUsd: number; ethUsd: number };

export type WalletState = {
  tokens: SwarmToken[];
  pricing: Pricing | null;
  pricingError: string | null;
  paused: boolean | null;
  maxPerSale: number;
  minImdOut: bigint;
  registered: number;
  discovered: number;
  balancesRead: number;
  blockNumber: bigint;
  snapshotBlock: number;
  warnings: string[];
  complete: boolean;
};

export type PlanItem = { token: SwarmToken; imdOut: bigint };
export type Plan = {
  account: Address;
  items: PlanItem[];
  excluded: { token: SwarmToken; reason: string }[];
  gross: bigint;
  fee: bigint;
  net: bigint;
  requiresApproval: boolean;
  gasWei: bigint | null;
  gasNote: string;
};

const exit = { address: SWARM_EXIT_ADDRESS, abi: swarmExitAbi } as const;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function describeRoute(route: SellRoute | null): string | null {
  if (!route || route.venue === 0) return null;
  const venue =
    route.venue === 1
      ? "Uniswap V2"
      : route.venue === 2
        ? "Uniswap V3"
        : "Uniswap v4";
  const end = same(route.tokenOut, IMD_ADDRESS) ? "IMD" : "ETH, then IMD";
  return `${venue} to ${end}`;
}

export function usdValue(imd: bigint, pricing: Pricing | null): number | null {
  if (!pricing) return null;
  return (Number(imd) / 10 ** IMD_DECIMALS) * pricing.imdUsd;
}

export function feeSplit(gross: bigint) {
  const fee = (gross * FEE_BPS) / BPS;
  return { fee, net: gross - fee };
}

async function loadPricing(
  client: PublicClient,
  account: Address,
): Promise<{ pricing: Pricing | null; error: string | null }> {
  try {
    const [{ result: bridgePerImd }, [price, decimals]] = await Promise.all([
      client.simulateContract({
        ...exit,
        functionName: "quoteImdInBridge",
        args: [parseUnits("1", IMD_DECIMALS)],
        account,
      }),
      client.readContract({ ...exit, functionName: "ethUsdPrice" }),
    ]);
    const ethUsd = Number(price) / 10 ** Number(decimals);
    const imdUsd = (Number(bridgePerImd) / 1e18) * ethUsd;
    return { pricing: { imdUsd, ethUsd }, error: null };
  } catch (e) {
    return {
      pricing: null,
      error: e instanceof Error ? e.message.split("\n")[0]! : String(e),
    };
  }
}

/** Discover provenance first; the sale registry must never decide which holdings exist. */
export async function loadWallet(
  client: PublicClient,
  account: Address,
  options: {
    snapshot?: Snapshot;
    poolSnapshot?: PoolSnapshot;
    progress?: (text: string) => void;
    onHoldings?: (tokens: SwarmToken[]) => void;
  } = {},
): Promise<WalletState> {
  const discovery = await discoverLaunches(
    client,
    options.snapshot,
    options.progress,
  );
  const { blockNumber } = discovery;
  const warnings = [...discovery.warnings];
  // Direct routes have no SwarmExit registry, owner pause, or configured minimum.
  const paused = false;
  const maxPerSale = 1;
  const minImdOut = 1n;
  const priced = await loadPricing(client, account);
  const tokens: SwarmToken[] = [];
  let balancesRead = 0;
  const registered = 0;
  let failedBalances = 0;
  // Keep requests below provider call/gas limits. A failed aggregate falls back to isolated calls.
  for (let offset = 0; offset < discovery.tokens.length; offset += 32) {
    options.progress?.(
      `Reading balances ${offset + 1}–${Math.min(offset + 32, discovery.tokens.length)} of ${discovery.tokens.length}…`,
    );
    const chunk = discovery.tokens.slice(offset, offset + 32);
    const contracts = chunk.flatMap(
      (t) =>
        [
          {
            address: t.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
          },
          { address: t.address, abi: erc20Abi, functionName: "decimals" },
        ] as const,
    );
    let reads: (
      | { status: "success"; result: unknown }
      | { status: "failure"; error: unknown }
    )[];
    try {
      reads = await client.multicall({
        contracts,
        allowFailure: true,
        blockNumber,
        multicallAddress: mainnet.contracts.multicall3.address,
        batchSize: 0,
      });
    } catch (error) {
      reads = contracts.map(() => ({ status: "failure" as const, error }));
    }
    // With allowFailure, viem also resolves aggregate RPC rejection as failed entries.
    // Retry only those entries, at the same block, before deciding coverage is incomplete.
    reads = await Promise.all(
      contracts.map(async (c, i) => {
        const read = reads[i];
        if (read?.status === "success") return read;
        try {
          return {
            status: "success" as const,
            result: await client.readContract({ ...c, blockNumber }),
          };
        } catch (error) {
          return { status: "failure" as const, error };
        }
      }),
    );
    await Promise.all(
      chunk.map(async (launch, i) => {
        const balanceRead = reads[i * 2]!;
        if (
          balanceRead.status !== "success" ||
          typeof balanceRead.result !== "bigint"
        ) {
          failedBalances++;
          return;
        }
        balancesRead++;
        const balance = balanceRead.result;
        // Refunds stay visible even when the wallet balance has become zero.
        let heldRefund = 0n;
        try {
          heldRefund = await client.readContract({
            ...exit,
            functionName: "heldRefunds",
            args: [account, launch.address],
            blockNumber,
          });
        } catch {
          warnings.push(`Refund balance unavailable for ${launch.address}.`);
        }
        if (balance === 0n && heldRefund === 0n) return;
        const decimalRead = reads[i * 2 + 1]!;
        const d =
          decimalRead.status === "success" ? Number(decimalRead.result) : NaN;
        const decimals = Number.isInteger(d) && d >= 0 && d <= 255 ? d : null;
        const token: SwarmToken = {
          address: launch.address,
          launch,
          symbol: short(launch.address),
          decimals,
          balance,
          expectedImd: 0n,
          sellable: false,
          status: 1,
          route: null,
          routeLabel: null,
          heldRefund,
        };
        if (decimals === null) {
          token.readError =
            "Decimals unavailable. Showing raw units; selling disabled.";
          warnings.push(`Decimals unavailable for ${launch.address}.`);
        }
        try {
          token.symbol = String(
            await client.readContract({
              address: launch.address,
              abi: erc20Abi,
              functionName: "symbol",
              blockNumber,
            }),
          ).slice(0, 64);
        } catch {
          /* The address remains the identity. */
        }
        tokens.push(token);
      }),
    );
  }
  if (failedBalances)
    warnings.push(
      `${failedBalances} token balance reads failed. These holdings are unknown; retry discovery.`,
    );
  if (discovery.tokens.length && balancesRead === 0)
    throw new Error(
      "RPC failure: no token balances could be read. Your wallet has not been reported empty.",
    );
  tokens.sort((a, b) => a.address.localeCompare(b.address));
  options.onHoldings?.([...tokens]);
  options.progress?.("Finding live Uniswap v4 sell routes…");
  const market = await loadPools(
    client,
    discovery.tokens,
    blockNumber,
    options.poolSnapshot,
  );
  warnings.push(...market.warnings);
  let checked = 0;
  for (let offset = 0; offset < tokens.length; offset += 4) {
    await Promise.all(
      tokens.slice(offset, offset + 4).map(async (token) => {
        if (token.balance > 0n && token.decimals !== null) {
          const result = await findRoute(
            client,
            account,
            token.address,
            token.balance,
            market.pools,
            blockNumber,
            (pathsChecked, total) => options.progress?.(
              `Checking ${token.symbol}: ${pathsChecked} of ${total} candidate paths; ${checked} of ${tokens.length} tokens checked…`,
            ),
          );
          token.liveRoute = result.route ?? undefined;
          token.routeReason = result.reason ?? undefined;
          token.sellable = !!result.route;
          token.expectedImd = result.route?.amountOut ?? 0n;
          token.routeLabel = result.route ? routeLabel(result.route) : null;
          token.status = result.route ? 0 : 5;
          if (result.incomplete)
            warnings.push(
              `Route search incomplete for ${token.address}: ${result.reason}`,
            );
        }
        checked++;
        options.progress?.(
          `Checking live routes ${checked} of ${tokens.length}…`,
        );
      }),
    );
    options.onHoldings?.(tokens.map((t) => ({ ...t })));
  }

  return {
    tokens,
    pricing: priced.pricing,
    pricingError: priced.error,
    paused,
    maxPerSale,
    minImdOut,
    registered,
    discovered: discovery.tokens.length,
    balancesRead,
    blockNumber,
    snapshotBlock: discovery.snapshotBlock,
    warnings,
    complete: warnings.length === 0,
  };
}

type Outcome = {
  token: Address;
  amountIn: bigint;
  imdOut: bigint;
  status: number;
};

const settles = (o: Outcome | undefined, floor: bigint) =>
  !!o && o.status === STATUS_SOLD && o.imdOut > 0n && o.imdOut >= floor;

/**
 * Dry run of sellAll with zero minimums. Sales execute one after another and share the IMD pool,
 * so the simulated outputs are the real quote. A token whose sale would fail is left out; if the
 * whole call reverts, each token is simulated alone to find the culprits and the rest is rerun.
 */
export async function planLegacySale(
  client: PublicClient,
  account: Address,
  chosen: SwarmToken[],
  minImdOut: bigint,
  maxPerSale = 50,
): Promise<Plan> {
  if ((await client.getChainId()) !== 1)
    throw new Error("Switch to Ethereum before preparing a sale.");
  if (!Number.isSafeInteger(maxPerSale) || maxPerSale < 1 || maxPerSale > 50)
    throw new Error("Invalid sale batch limit");
  const items: PlanItem[] = [];
  const excluded: Plan["excluded"] = [];
  let requiresApproval = false;
  for (const token of chosen) {
    if (!token.sellable || token.balance <= 0n || token.decimals === null) {
      excluded.push({ token, reason: "No verified sale route." });
      continue;
    }
    const allowance = await client.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, SWARM_EXIT_ADDRESS],
    });
    if (allowance !== token.balance) requiresApproval = true;
    items.push({ token, imdOut: token.expectedImd });
  }
  let gasWei: bigint | null = null;
  let gasNote = requiresApproval
    ? "Sale gas is available after token approval. Your wallet estimates each approval."
    : "No tokens selected.";
  if (items.length && !requiresApproval) {
    const simulated: PlanItem[] = [];
    gasWei = 0n;
    for (let start = 0; start < items.length; start += maxPerSale) {
      const batch = items.slice(start, start + maxPerSale);
      // Every batch is re-simulated immediately before signing, after earlier batches settle.
      const { result } = await client.simulateContract({
        ...exit,
        functionName: "sellAll",
        args: [
          batch.map((i) => i.token.address),
          batch.map(() => 0n),
          deadline(),
        ],
        account,
      });
      const passing: PlanItem[] = [];
      for (const item of batch) {
        const outcome = result[0].find((o) =>
          same(o.token, item.token.address),
        );
        if (!settles(outcome, minImdOut))
          excluded.push({
            token: item.token,
            reason: "Sale did not settle in simulation.",
          });
        else passing.push({ token: item.token, imdOut: outcome!.imdOut });
      }
      simulated.push(...passing);
      if (passing.length) {
        try {
          const gas = await client.estimateContractGas({
            ...exit,
            functionName: "sellAll",
            args: [
              passing.map((i) => i.token.address),
              passing.map((i) => (i.imdOut * (BPS - SLIPPAGE_BPS)) / BPS),
              deadline(),
            ],
            account,
          });
          if (gasWei !== null) gasWei += gas * (await client.getGasPrice());
          gasNote =
            "Estimated sale gas; later batches are checked again after earlier sales settle.";
        } catch (e) {
          gasWei = null;
          gasNote = `Gas estimate unavailable: ${message(e)}. The sale will be checked again before sending.`;
        }
      }
    }
    items.splice(0, items.length, ...simulated);
  }

  const gross = items.reduce((n, i) => n + i.imdOut, 0n);
  // SwarmExit rounds the fee once per transaction, not once for the entire UI selection.
  let fee = 0n;
  for (let i = 0; i < items.length; i += maxPerSale)
    fee += feeSplit(
      items.slice(i, i + maxPerSale).reduce((n, x) => n + x.imdOut, 0n),
    ).fee;
  return {
    account,
    items,
    excluded,
    gross,
    fee,
    net: gross - fee,
    requiresApproval,
    gasWei,
    gasNote,
  };
}

export type Progress =
  | {
      step: "approve";
      token: SwarmToken;
      index: number;
      total: number;
      approval?: "token" | "permit";
    }
  | { step: "sign"; batch: number; batches: number; gasWei?: bigint }
  | { step: "mine"; hash: Hash; batch: number; batches: number };

/** Approves what is missing, sends sellAll in batches, and reports what happened to each token. */
export async function executeLegacySale(
  wallet: WalletClient,
  client: PublicClient,
  account: Address,
  plan: Plan,
  maxPerSale: number,
  onProgress: (p: Progress) => void,
): Promise<Map<string, SaleResult>> {
  const results = new Map<string, SaleResult>();
  const assertWallet = async () => {
    if ((await wallet.getChainId()) !== 1 || (await client.getChainId()) !== 1)
      throw new Error("Switch to Ethereum before signing.");
    const accounts = await wallet.getAddresses();
    if (!accounts.some((a) => same(a, account)))
      throw new Error("Connected account changed. Review the sale again.");
  };
  if (!same(plan.account, account))
    throw new Error("Sale belongs to a different account. Review again.");
  await assertWallet();
  if (!Number.isSafeInteger(maxPerSale) || maxPerSale < 1 || maxPerSale > 50)
    throw new Error("Invalid batch size");
  const stop = (reason: string) => {
    for (const { token } of plan.items)
      if (!results.has(token.address.toLowerCase()))
        results.set(token.address.toLowerCase(), { kind: "unsold", reason });
    return results;
  };
  try {
    for (let i = 0; i < plan.items.length; i++) {
      const token = plan.items[i]!.token;
      await assertWallet();
      const allowance = await client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, SWARM_EXIT_ADDRESS],
      });
      const balance = await client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      });
      if (balance !== token.balance)
        throw new Error(
          "Wallet balance changed. Refresh and review the sale again.",
        );
      if (allowance === token.balance) continue;
      onProgress({
        step: "approve",
        token,
        index: i + 1,
        total: plan.items.length,
      });
      // Tokens requiring allowance reset (e.g. USDT) are supported without unlimited approval.
      for (const amount of allowance > 0n
        ? [0n, token.balance]
        : [token.balance]) {
        await assertWallet();
        const hash = await wallet.writeContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [SWARM_EXIT_ADDRESS, amount],
          account,
          chain: wallet.chain,
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error("Token approval reverted. No sale was sent.");
      }
      const after = await client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, SWARM_EXIT_ADDRESS],
      });
      if (after < token.balance)
        throw new Error("Token did not grant the required allowance.");
    }
  } catch (e) {
    return stop(`No sale sent for this token: ${message(e)}`);
  }
  const batches = Math.ceil(plan.items.length / maxPerSale);
  for (let b = 0; b < batches; b++) {
    const batch = plan.items.slice(b * maxPerSale, (b + 1) * maxPerSale);
    let hash: Hash;
    try {
      await assertWallet();
      for (const { token } of batch)
        if (
          (await client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
          })) !== token.balance
        )
          throw new Error(
            "Wallet balance changed after approval. Refresh and review again.",
          );
      const args = [
        batch.map((i) => i.token.address),
        batch.map((i) => (i.imdOut * (BPS - SLIPPAGE_BPS)) / BPS),
        deadline(),
      ] as const;
      const { result } = await client.simulateContract({
        ...exit,
        functionName: "sellAll",
        args,
        account,
      });
      if (
        batch.some(
          (item, i) =>
            !settles(
              result[0].find((o) => same(o.token, item.token.address)),
              args[1][i]!,
            ),
        )
      )
        throw new Error(
          "Quote changed or a token failed after approval. Refresh and review again; approvals remain until revoked.",
        );
      const gas = await client.estimateContractGas({
        ...exit,
        functionName: "sellAll",
        args,
        account,
      });
      const gasWei = gas * (await client.getGasPrice());
      onProgress({ step: "sign", batch: b + 1, batches, gasWei });
      await assertWallet();
      hash = await wallet.writeContract({
        ...exit,
        functionName: "sellAll",
        args,
        account,
        chain: wallet.chain,
        gas: (gas * 120n) / 100n,
      });
    } catch (e) {
      return stop(`Not sent: ${message(e)}`);
    }
    onProgress({ step: "mine", hash, batch: b + 1, batches });
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash });
    } catch (e) {
      for (const { token } of batch)
        results.set(token.address.toLowerCase(), {
          kind: "pending",
          reason: `Confirmation unavailable: ${message(e)}. Check the transaction before retrying.`,
          txHash: hash,
        });
      return stop(
        "Later batch not sent because an earlier transaction is unconfirmed.",
      );
    }
    if (receipt.status !== "success") {
      for (const { token } of batch)
        results.set(token.address.toLowerCase(), {
          kind: "unsold",
          reason:
            "Sale reverted; no sale fee was charged. Network gas was spent.",
          txHash: hash,
        });
      continue;
    }
    for (const { token } of batch)
      results.set(token.address.toLowerCase(), {
        kind: "pending",
        reason:
          "Receipt has no verified outcome for this token. Check the transaction.",
        txHash: hash,
      });
    const logs = parseEventLogs({
      abi: swarmExitAbi,
      logs: receipt.logs.filter((l) => same(l.address, SWARM_EXIT_ADDRESS)),
    });
    for (const { token } of batch) {
      const tokenLogs = logs.filter(
        (log) =>
          "user" in log.args &&
          same(log.args.user, account) &&
          "token" in log.args &&
          same(log.args.token, token.address),
      );
      const k = token.address.toLowerCase();
      const held = tokenLogs.find((log) => log.eventName === "RefundHeld");
      const sold = tokenLogs.find((log) => log.eventName === "TokenSold");
      const refunded = tokenLogs.find(
        (log) => log.eventName === "TokenRefunded",
      );
      const skipped = tokenLogs.find((log) => log.eventName === "TokenSkipped");
      // _refund emits RefundHeld before TokenRefunded when the transfer fails.
      // Interpret the whole token outcome so event order cannot imply delivery.
      if (held)
        results.set(k, {
          kind: "unsold",
          reason: "Token refused the refund. Claim it below.",
          txHash: hash,
          held: true,
        });
      else if (sold)
        results.set(k, {
          kind: "sold",
          imdOut: sold.args.imdOut,
          txHash: hash,
        });
      else if (refunded)
        results.set(k, {
          kind: "unsold",
          reason:
            "Sale failed; tokens refunded. Transfer-tax tokens may refund less.",
          txHash: hash,
        });
      else if (skipped)
        results.set(k, {
          kind: "unsold",
          reason:
            STATUS_TEXT[Number(skipped.args.status)] ??
            "Skipped by the contract.",
          txHash: hash,
        });
    }
  }
  return results;
}

export async function claimRefund(
  wallet: WalletClient,
  client: PublicClient,
  account: Address,
  token: Address,
): Promise<Hash> {
  if (
    (await wallet.getChainId()) !== 1 ||
    (await client.getChainId()) !== 1 ||
    !(await wallet.getAddresses()).some((a) => same(a, account))
  )
    throw new Error(
      "Wallet account or chain changed. Reconnect before claiming.",
    );
  const hash = await wallet.writeContract({
    ...exit,
    functionName: "claimRefund",
    args: [token],
    account,
    chain: wallet.chain,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Refund claim reverted.");
  return hash;
}

/** Public sale flow: permissionless pool routes, with no registry configuration. */
export async function planSale(
  client: PublicClient,
  account: Address,
  chosen: SwarmToken[],
  _minImdOut = 1n,
  _maxPerSale = 1,
): Promise<Plan> {
  return planDirectSale(client, account, chosen);
}
export async function executeSale(
  wallet: WalletClient,
  client: PublicClient,
  account: Address,
  plan: Plan,
  _maxPerSale: number,
  onProgress: (p: Progress) => void,
) {
  return executeDirectSale(wallet, client, account, plan, onProgress);
}
