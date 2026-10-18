import {
  encodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  BPS,
  DEADLINE_SECONDS,
  FEE_BPS,
  IMD_ADDRESS,
  SLIPPAGE_BPS,
  TREASURY_ADDRESS,
} from "../deployment.ts";
import { erc20Abi } from "../abi/erc20.ts";
import { message } from "./discovery.ts";
import {
  MAX_INPUT,
  PERMIT2,
  POOL_MANAGER,
  UNIVERSAL_ROUTER,
  pathKeys,
  quotePath,
  sameAddress,
  type LiveRoute,
} from "./routes.ts";
import type {
  Plan,
  PlanItem,
  Progress,
  SaleResult,
  SwarmToken,
} from "./sweep.ts";

export const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const permitAbi = parseAbi([
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const swapParams = parseAbiParameters(
  "(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 amountIn,uint128 amountOutMinimum)",
);
const split = (gross: bigint) => {
  const fee = (gross * FEE_BPS) / BPS;
  return { fee, net: gross - fee };
};

function proceeds(
  logs: Parameters<typeof parseEventLogs>[0]["logs"],
  account: Address,
) {
  const transfers = parseEventLogs({
    abi: transferAbi,
    logs: logs.filter((l) => sameAddress(l.address, IMD_ADDRESS)),
    strict: true,
  });
  const paid = (to: Address) =>
    transfers
      .filter(
        (l) =>
          sameAddress(l.args.from, POOL_MANAGER) && sameAddress(l.args.to, to),
      )
      .reduce((n, l) => n + l.args.value, 0n);
  if (sameAddress(account, TREASURY_ADDRESS)) {
    const gross = paid(account);
    return { gross, ...split(gross) };
  }
  const net = paid(account),
    fee = paid(TREASURY_ADDRESS);
  return { gross: net + fee, net, fee };
}

export async function resolvePending(
  client: PublicClient,
  account: Address,
  result: SaleResult,
): Promise<SaleResult | undefined> {
  if (result.kind !== "pending") return result;
  if (!result.txHash) return result;
  try {
    const receipt = await client.getTransactionReceipt({ hash: result.txHash });
    if (receipt.status === "reverted")
      return {
        kind: "unsold",
        txHash: result.txHash,
        reason:
          "Transaction reverted. No sale fee was charged; network gas was spent.",
      };
    if (result.phase === "approval") return undefined;
    const { gross, net, fee } = proceeds(receipt.logs, account);
    if (net > 0n && fee === split(gross).fee)
      return { kind: "sold", imdOut: gross, txHash: result.txHash };
  } catch {
    /* Unknown receipt remains pending and cannot be selected again. */
  }
  return result;
}
export const minimumOut = (quote: bigint) => {
  const value = (quote * (BPS - SLIPPAGE_BPS)) / BPS;
  return value > 0n ? value : 1n;
};

/** Atomic swap, bounded settlement, 2% of THIS swap's credit, and remaining IMD to sender.
 * No allow-revert commands, router-held donations, arbitrary calldata, or native value. */
export function saleCall(
  account: Address,
  token: Address,
  route: LiveRoute,
  minGross: bigint,
  deadline: bigint,
) {
  const path = pathKeys(token, route.pools);
  if (
    !path.length ||
    !sameAddress(path.at(-1)!.intermediateCurrency, IMD_ADDRESS) ||
    route.amountIn <= 0n ||
    route.amountIn > MAX_INPUT ||
    minGross <= 0n ||
    minGross > MAX_INPUT
  )
    throw new Error("Invalid sale amounts or route");
  const params = [
    encodeAbiParameters(swapParams, [
      {
        currencyIn: token,
        path,
        amountIn: route.amountIn,
        amountOutMinimum: minGross,
      },
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      token,
      route.amountIn,
    ]),
    encodeAbiParameters(parseAbiParameters("address,address,uint256"), [
      IMD_ADDRESS,
      TREASURY_ADDRESS,
      FEE_BPS,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      IMD_ADDRESS,
      split(minGross).net,
    ]),
  ];
  return {
    address: UNIVERSAL_ROUTER,
    abi: routerAbi,
    functionName: "execute" as const,
    args: [
      "0x10",
      [
        encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
          "0x070c100f",
          params,
        ]),
      ],
      deadline,
    ] as const,
    account,
    value: 0n,
  };
}

async function approvals(
  client: PublicClient,
  account: Address,
  token: Address,
  amount: bigint,
  expiry: number,
) {
  const [erc20, permit] = await Promise.all([
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, PERMIT2],
    }),
    client.readContract({
      address: PERMIT2,
      abi: permitAbi,
      functionName: "allowance",
      args: [account, token, UNIVERSAL_ROUTER],
    }),
  ]);
  return {
    erc20,
    permit,
    required: erc20 < amount || permit[0] < amount || permit[1] < expiry,
  };
}

export async function planDirectSale(
  client: PublicClient,
  account: Address,
  chosen: SwarmToken[],
): Promise<Plan> {
  if ((await client.getChainId()) !== 1)
    throw new Error("Switch to Ethereum before preparing a sale.");
  const items: PlanItem[] = [],
    excluded: Plan["excluded"] = [];
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  let requiresApproval = false,
    gasWei: bigint | null = 0n;
  const seen = new Set<string>();
  for (const token of chosen) {
    if (seen.has(token.address.toLowerCase())) continue;
    seen.add(token.address.toLowerCase());
    try {
      if (!token.liveRoute || !token.sellable || token.decimals === null)
        throw new Error("No live route for this token. Refresh routes.");
      const balance = await client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
        blockNumber,
      });
      if (balance !== token.balance)
        throw new Error("Balance changed. Refresh the wallet before selling.");
      const route = await quotePath(
        client,
        account,
        token.address,
        token.liveRoute.amountIn,
        token.liveRoute.pools,
        blockNumber,
      );
      const approval = await approvals(
        client,
        account,
        token.address,
        route.amountIn,
        Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
      );
      requiresApproval ||= approval.required;
      if (approval.required) gasWei = null;
      else {
        const call = saleCall(
          account,
          token.address,
          route,
          minimumOut(route.amountOut),
          BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS),
        );
        await client.simulateContract(call);
        const gas = await client.estimateContractGas(call);
        if (gasWei !== null) gasWei += gas * (await client.getGasPrice());
      }
      items.push({
        token: { ...token, liveRoute: route },
        imdOut: route.amountOut,
      });
    } catch (e) {
      excluded.push({ token, reason: message(e) });
    }
  }
  const gross = items.reduce((n, i) => n + i.imdOut, 0n);
  const fee = items.reduce((n, i) => n + split(i.imdOut).fee, 0n);
  return {
    account,
    items,
    excluded,
    gross,
    fee,
    net: gross - fee,
    requiresApproval,
    gasWei,
    gasNote:
      "One atomic sale per token, confirmed in sequence. Gas is checked again before each sale; your wallet estimates approvals.",
  };
}

export async function executeDirectSale(
  wallet: WalletClient,
  client: PublicClient,
  account: Address,
  plan: Plan,
  onProgress: (p: Progress) => void,
): Promise<Map<string, SaleResult>> {
  const results = new Map<string, SaleResult>();
  const assertWallet = async () => {
    if ((await wallet.getChainId()) !== 1 || (await client.getChainId()) !== 1)
      throw new Error("Switch to Ethereum before signing.");
    const accounts = await wallet.getAddresses();
    if (!accounts[0] || !sameAddress(accounts[0], account))
      throw new Error("Connected account changed. Review the sale again.");
  };
  if (!sameAddress(plan.account, account))
    throw new Error("Sale belongs to another account. Review again.");
  await assertWallet();
  let stop = false;
  for (let i = 0; i < plan.items.length; i++) {
    const { token, imdOut } = plan.items[i]!;
    const key = token.address.toLowerCase();
    if (stop) {
      results.set(key, {
        kind: "unsold",
        reason:
          "Not submitted. Resolve the previous wallet request or pending transaction first.",
      });
      continue;
    }
    let hash: Hash | undefined;
    let phase: "approval" | "sale" = "approval";
    try {
      await assertWallet();
      const route = token.liveRoute;
      if (!route) throw new Error("Route missing. Refresh and review again.");
      // Lock the reviewed balance and floor; re-quotes must never silently lower either.
      if (
        (await client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        })) !== token.balance
      )
        throw new Error("Balance changed. Refresh and review the sale again.");
      const amount = route.amountIn;
      if (amount <= 0n || amount > token.balance)
        throw new Error("Invalid reviewed amount");
      const expiry = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
      const allowance = await approvals(
        client,
        account,
        token.address,
        amount,
        expiry,
      );
      const approve = async (kind: "token" | "permit", amount: bigint) => {
        await assertWallet();
        onProgress({
          step: "approve",
          token,
          index: i + 1,
          total: plan.items.length,
          approval: kind,
        });
        hash =
          kind === "token"
            ? await wallet.writeContract({
                address: token.address,
                abi: erc20Abi,
                functionName: "approve",
                args: [PERMIT2, amount],
                account,
                chain: wallet.chain,
              })
            : await wallet.writeContract({
                address: PERMIT2,
                abi: permitAbi,
                functionName: "approve",
                args: [token.address, UNIVERSAL_ROUTER, amount, expiry],
                account,
                chain: wallet.chain,
              });
        const receipt = await client.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });
        if (receipt.status !== "success") {
          hash = undefined;
          throw new Error("Approval reverted. No sale submitted.");
        }
        hash = undefined;
      };
      if (allowance.erc20 < amount) {
        if (allowance.erc20 > 0n) await approve("token", 0n);
        await approve("token", amount);
      }
      if (allowance.permit[0] < amount || allowance.permit[1] < expiry)
        await approve("permit", amount);
      await assertWallet();
      if (
        (
          await approvals(
            client,
            account,
            token.address,
            amount,
            Math.floor(Date.now() / 1000) + 30,
          )
        ).required
      )
        throw new Error("Approval is missing or expired. Review again.");
      const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      const fresh = await quotePath(
        client,
        account,
        token.address,
        amount,
        route.pools,
        blockNumber,
      );
      const floor = minimumOut(imdOut);
      if (fresh.amountOut < floor)
        throw new Error(
          "Quote fell below the reviewed minimum. Refresh and review again.",
        );
      const call = saleCall(
        account,
        token.address,
        fresh,
        floor,
        BigInt(
          Math.min(expiry, Math.floor(Date.now() / 1000) + DEADLINE_SECONDS),
        ),
      );
      // This real execution simulation includes hooks, transfers, Permit2 and fee distribution.
      await client.simulateContract(call);
      const gas = await client.estimateContractGas(call);
      const gasPrice = await client.getGasPrice();
      await assertWallet();
      phase = "sale";
      onProgress({
        step: "sign",
        batch: i + 1,
        batches: plan.items.length,
        gasWei: gas * gasPrice,
      });
      hash = await wallet.writeContract({
        ...call,
        chain: wallet.chain,
        gas: (gas * 120n) / 100n,
      });
      onProgress({
        step: "mine",
        hash,
        batch: i + 1,
        batches: plan.items.length,
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        results.set(key, {
          kind: "unsold",
          txHash: hash,
          reason:
            "Sale reverted atomically: tokens stayed in your wallet and no sale fee was charged. Network gas was spent.",
        });
        continue;
      }
      const { net, fee, gross } = proceeds(receipt.logs, account);
      if (net < split(floor).net || fee !== split(gross).fee) {
        results.set(key, {
          kind: "pending",
          phase: "sale",
          txHash: hash,
          reason:
            "Transaction confirmed, but IMD transfers could not be reconciled. Inspect it before trying again.",
        });
        stop = true;
      } else results.set(key, { kind: "sold", imdOut: gross, txHash: hash });
    } catch (e) {
      if (hash)
        results.set(key, {
          kind: "pending",
          phase,
          txHash: hash,
          reason: `${phase === "approval" ? "Approval" : "Sale"} submitted; confirmation is unknown. Refresh to check its receipt before retrying.`,
        });
      else
        results.set(key, {
          kind: "unsold",
          reason: `Not submitted: ${message(e)}`,
        });
      // A rejection/account change/unknown receipt stops new wallet prompts, preserving prior results.
      stop = true;
    }
  }
  return results;
}
