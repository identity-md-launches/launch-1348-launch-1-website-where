import {
  encodeAbiParameters, encodeFunctionData, parseAbiParameters, parseEventLogs,
  type Address, type Hash, type Hex, type PublicClient, type WalletClient,
} from "viem";
import { erc20Abi } from "../abi/erc20.ts";
import { BPS, DEADLINE_SECONDS, FEE_BPS, IMD_ADDRESS, TREASURY_ADDRESS } from "../deployment.ts";
import { mapConcurrent } from "./async.ts";
import { message } from "./discovery.ts";
import { minimumOut, permitAbi, routerAbi, saleCall, transferAbi } from "./directSale.ts";
import { packedPath, quoteLiveRoute, WETH } from "./markets.ts";
import { MAX_INPUT, NATIVE, pathKeys, PERMIT2, POOL_MANAGER, sameAddress, UNIVERSAL_ROUTER } from "./routes.ts";
import type { Plan, PlanItem, Progress, SaleResult } from "./sweep.ts";

export const MAX_BATCH_SIZE = 20;
export type BatchDetails = {
  mode: "atomic" | "standard";
  batches: number;
  tokenApprovals: number;
  permitSignatures: number;
  confirmations: number;
  simulation: string;
};
type Authorization = { erc20: bigint; amount: bigint; expiration: number; nonce: number };
type PermitDetails = { token: Address; amount: bigint; expiration: number; nonce: number };
export type BatchPermit = { details: PermitDetails[]; spender: Address; sigDeadline: bigint };
type Call = { to: Address; data: Hex; value: bigint };
const split = (gross: bigint) => { const fee = gross * FEE_BPS / BPS; return { fee, net: gross - fee }; };
const expiry = () => Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
const pendingKey = (account: Address) => `sweepdust:pending:1:${account.toLowerCase()}`;

export function storedPending(account: Address): Map<string, SaleResult> {
  try {
    const rows = JSON.parse(localStorage.getItem(pendingKey(account)) ?? "[]", (_key, value) =>
      value && typeof value === "object" && typeof value.bigint === "string" && /^\d+$/.test(value.bigint) ? BigInt(value.bigint) : value,
    ) as [string, SaleResult][];
    return new Map(rows.filter(([key, result]) => /^0x[\da-f]{40}$/i.test(key) && result.kind === "pending" &&
      (result.txHash ? /^0x[\da-f]{64}$/i.test(result.txHash) : typeof result.batchId === "string")));
  } catch { return new Map(); }
}
export function persistPending(account: Address, results: Map<string, SaleResult>) {
  if (typeof localStorage === "undefined") return;
  try {
    const saved = storedPending(account);
    for (const [key, result] of results) {
      if (result.kind === "pending") saved.set(key, result);
      else saved.delete(key);
    }
    localStorage.setItem(pendingKey(account), JSON.stringify([...saved], (_key, value) => typeof value === "bigint" ? { bigint: value.toString() } : value));
  } catch { /* A storage-denied browser still retains the current in-memory pending state. */ }
}

export async function supportsAtomic(wallet: WalletClient | undefined, account: Address): Promise<boolean> {
  if (!wallet) return false;
  try {
    const capability = await wallet.getCapabilities({ account, chainId: 1 });
    // "ready" would require an account upgrade. Never trigger that implicitly.
    return capability?.atomic?.status === "supported";
  } catch { return false; }
}

async function authorization(client: PublicClient, account: Address, token: Address): Promise<Authorization> {
  const [erc20, permit] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, PERMIT2] }),
    client.readContract({ address: PERMIT2, abi: permitAbi, functionName: "allowance", args: [account, token, UNIVERSAL_ROUTER] }),
  ]);
  return { erc20, amount: permit[0], expiration: permit[1], nonce: permit[2] };
}
function approvalCalls(items: PlanItem[], auth: Authorization[], until: number): Call[] {
  const calls: Call[] = [];
  items.forEach(({ token }, i) => {
    const needed = token.liveRoute!.amountIn;
    const current = auth[i]!;
    if (current.erc20 < needed) {
      for (const amount of current.erc20 > 0n ? [0n, needed] : [needed]) calls.push({ to: token.address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PERMIT2, amount] }) });
    }
    if (current.amount < needed || current.expiration < until) calls.push({ to: PERMIT2, value: 0n, data: encodeFunctionData({ abi: permitAbi, functionName: "approve", args: [token.address, UNIVERSAL_ROUTER, needed, until] }) });
  });
  return calls;
}

/** All swaps in this call revert together. Each v4 leg pays 2% of its own IMD credit. */
export function batchSaleCall(account: Address, items: PlanItem[], until: bigint, permit?: { value: BatchPermit; signature: Hex }) {
  if (!items.length || items.length > MAX_BATCH_SIZE) throw new Error(`Choose between 1 and ${MAX_BATCH_SIZE} tokens per batch.`);
  let commands = "0x";
  const inputs: Hex[] = [];
  const seen = new Set<string>();
  if (permit) {
    if (!sameAddress(permit.value.spender, UNIVERSAL_ROUTER) || permit.value.sigDeadline !== until) throw new Error("Invalid router authorization");
    commands += "03";
    inputs.push(encodeAbiParameters(parseAbiParameters("((address token,uint160 amount,uint48 expiration,uint48 nonce)[] details,address spender,uint256 sigDeadline),bytes"), [permit.value, permit.signature]));
  }
  for (const item of items) {
    const { token } = item;
    const route = token.liveRoute;
    if (!route || sameAddress(token.address, IMD_ADDRESS) || seen.has(token.address.toLowerCase()) || route.amountIn <= 0n || route.amountIn > token.balance || route.amountIn > MAX_INPUT) throw new Error("Invalid or duplicate batch input");
    seen.add(token.address.toLowerCase());
    const floor = minimumOut(item.imdOut);
    if (!route.bridge) {
      const call = saleCall(account, token.address, route, floor, until);
      commands += call.args[0].slice(2);
      inputs.push(...call.args[1]);
      continue;
    }
    const bridge = route.bridge;
    if (!sameAddress(bridge.path[0]!, token.address) || !sameAddress(bridge.path.at(-1)!, WETH)) throw new Error("Invalid bridge path");
    const bridgeFloor = minimumOut(bridge.amountOut);
    if (bridge.kind === "weth") {
      if (!sameAddress(token.address, WETH) || bridge.path.length !== 1) throw new Error("Invalid WETH input");
      commands += "02";
      inputs.push(encodeAbiParameters(parseAbiParameters("address,address,uint160"), [WETH, UNIVERSAL_ROUTER, route.amountIn]));
    } else if (bridge.kind === "v3") {
      commands += "00";
      inputs.push(encodeAbiParameters(parseAbiParameters("address,uint256,uint256,bytes,bool"), [UNIVERSAL_ROUTER, route.amountIn, bridgeFloor, packedPath(bridge.path, bridge.fees), true]));
    } else {
      commands += "08";
      inputs.push(encodeAbiParameters(parseAbiParameters("address,uint256,uint256,address[],bool"), [UNIVERSAL_ROUTER, route.amountIn, bridgeFloor, bridge.path, true]));
    }
    // The first leg leaves WETH in the router. Unwrap, settle that native balance as credit,
    // consume the exact open credit, then settle this token's fee and net to the sender.
    commands += "0c10";
    inputs.push(encodeAbiParameters(parseAbiParameters("address,uint256"), [UNIVERSAL_ROUTER, bridgeFloor]));
    const path = pathKeys(NATIVE, route.pools);
    if (!path.length || !sameAddress(path.at(-1)!.intermediateCurrency, IMD_ADDRESS)) throw new Error("Bridge does not settle in IMD");
    inputs.push(encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), ["0x0b07100f", [
      encodeAbiParameters(parseAbiParameters("address,uint256,bool"), [NATIVE, 1n << 255n, false]),
      encodeAbiParameters(parseAbiParameters("(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 amountIn,uint128 amountOutMinimum)"), [{ currencyIn: NATIVE, path, amountIn: 0n, amountOutMinimum: floor }]),
      encodeAbiParameters(parseAbiParameters("address,address,uint256"), [IMD_ADDRESS, TREASURY_ADDRESS, FEE_BPS]),
      encodeAbiParameters(parseAbiParameters("address,uint256"), [IMD_ADDRESS, split(floor).net]),
    ]]));
  }
  return { address: UNIVERSAL_ROUTER, abi: routerAbi, functionName: "execute" as const,
    args: [commands as Hex, inputs, until] as const, account, value: 0n };
}

async function freshItems(client: PublicClient, account: Address, items: PlanItem[]): Promise<PlanItem[]> {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  return mapConcurrent(items, 3, async (item) => {
    const token = item.token;
    if (!token.liveRoute) throw new Error("A sale route is missing. Scan and review again.");
    const balance = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account], blockNumber });
    if (balance !== token.balance) throw new Error(`Balance changed for ${token.symbol}. Scan and review again.`);
    const route = await quoteLiveRoute(client, account, token.address, token.liveRoute.amountIn, token.liveRoute, blockNumber);
    if (route.amountOut < minimumOut(item.imdOut)) throw new Error(`The quote for ${token.symbol} fell below the reviewed minimum. Scan and review again.`);
    return { token: { ...token, liveRoute: route }, imdOut: item.imdOut };
  });
}

const unsupportedSimulation = (error: unknown) => /not supported|not available|not found|method.*(exist|disabled)|unsupported|eth_simulateV1|invalid.*method/i.test(message(error));
async function simulateAtomic(client: PublicClient, account: Address, calls: Call[]) {
  try {
    const simulation = await client.simulateCalls({ account, calls });
    const failed = simulation.results.find((r) => r.status === "failure");
    if (failed) throw new Error(`The complete batch failed simulation: ${message(failed.error)}`);
    return simulation.results.reduce((sum, result) => sum + (result.status === "success" ? result.gasUsed : 0n), 0n);
  } catch (error) { if (unsupportedSimulation(error)) return null; throw error; }
}

export async function planBatchSale(client: PublicClient, account: Address, chosen: PlanItem["token"][], wallet?: WalletClient, preferAtomic = true): Promise<Plan> {
  if (await client.getChainId() !== 1) throw new Error("Switch to Ethereum before reviewing a sweep.");
  const mode = preferAtomic && await supportsAtomic(wallet, account) ? "atomic" : "standard";
  const unique = [...new Map(chosen.map((t) => [t.address.toLowerCase(), t])).values()];
  const unresolved = storedPending(account);
  if (unique.some((t) => unresolved.has(t.address.toLowerCase()))) throw new Error("A selected token has an unresolved transaction. Scan the wallet to check its receipt first.");
  const excluded: Plan["excluded"] = [];
  const prepared = await mapConcurrent(unique, 3, async (token) => {
    try {
      if (!token.sellable || !token.liveRoute || token.result || token.decimals === null || sameAddress(token.address, IMD_ADDRESS)) throw new Error("No available sale route. Scan again.");
      const [fresh] = await freshItems(client, account, [{ token, imdOut: token.expectedImd }]);
      return { token: fresh!.token, imdOut: fresh!.token.liveRoute!.amountOut };
    } catch (error) { excluded.push({ token, reason: message(error) }); return null; }
  });
  const items = prepared.filter((i): i is PlanItem => i !== null);
  const auth = await mapConcurrent(items, 6, ({ token }) => authorization(client, account, token.address));
  const until = expiry();
  let tokenApprovals = 0, permitSignatures = 0;
  auth.forEach((a, i) => { if (a.erc20 < items[i]!.token.liveRoute!.amountIn) tokenApprovals += a.erc20 > 0n ? 2 : 1; });
  for (let start = 0; start < items.length; start += MAX_BATCH_SIZE) if (auth.slice(start, start + MAX_BATCH_SIZE).some((a, j) => a.amount < items[start + j]!.token.liveRoute!.amountIn || a.expiration < until)) permitSignatures++;
  const batches = Math.ceil(items.length / MAX_BATCH_SIZE);
  let gasWei: bigint | null = 0n;
  let simulated = true;
  for (let start = 0; start < items.length; start += MAX_BATCH_SIZE) {
    const chunk = items.slice(start, start + MAX_BATCH_SIZE);
    const approvals = approvalCalls(chunk, auth.slice(start, start + MAX_BATCH_SIZE), until);
    const sale = batchSaleCall(account, chunk, BigInt(until));
    let gas: bigint | null;
    if (mode === "atomic") gas = await simulateAtomic(client, account, [...approvals, { to: sale.address, data: encodeFunctionData(sale), value: 0n }]);
    else if (approvals.length) gas = null;
    else { await client.simulateContract(sale); gas = await client.estimateContractGas(sale); }
    if (gas === null) { gasWei = null; simulated = false; }
    else if (gasWei !== null) gasWei += gas * await client.getGasPrice();
  }
  const gross = items.reduce((sum, item) => sum + item.imdOut, 0n);
  const fee = items.reduce((sum, item) => sum + split(item.imdOut).fee, 0n);
  const simulation = simulated ? "The complete transaction passed simulation." : mode === "atomic" ? "The public RPC cannot simulate the approval bundle. Your wallet must check the complete batch before confirmation." : "The complete sale will be simulated after approvals and before submission.";
  return { account, items, excluded, gross, fee, net: gross - fee, requiresApproval: tokenApprovals > 0 || permitSignatures > 0, gasWei,
    gasNote: gasWei === null ? "Your wallet will show network gas before confirmation." : "Estimated network gas; your wallet shows the final amount.",
    batch: { mode, batches, tokenApprovals, permitSignatures: mode === "standard" ? permitSignatures : 0,
      confirmations: mode === "atomic" ? batches : tokenApprovals + permitSignatures + batches, simulation } };
}

/** Reconcile actual, ordered token inputs and IMD payouts; never copy a total to every token. */
export function reconcileBatch(logs: Parameters<typeof parseEventLogs>[0]["logs"], account: Address, tokens: Address[], token: Address, amountIn: bigint, floor: bigint, txHash: Hash): SaleResult {
  const transfers = parseEventLogs({ abi: transferAbi, logs, strict: true });
  const inputs = tokens.map((address) => transfers.findIndex((l) => sameAddress(l.address, address) && sameAddress(l.args.from, account)));
  const index = tokens.findIndex((address) => sameAddress(address, token));
  const start = inputs[index] ?? -1;
  const end = inputs.filter((i) => i > start).sort((a, b) => a - b)[0] ?? transfers.length;
  const input = transfers[start];
  if (start >= 0 && input?.args.value === amountIn) {
    const outputs = transfers.slice(start + 1, end).filter((l) => sameAddress(l.address, IMD_ADDRESS) && sameAddress(l.args.from, POOL_MANAGER));
    const paid = (address: Address) => outputs.filter((l) => sameAddress(l.args.to, address)).reduce((sum, l) => sum + l.args.value, 0n);
    const gross = sameAddress(account, TREASURY_ADDRESS) ? paid(account) : paid(account) + paid(TREASURY_ADDRESS);
    const expected = split(gross);
    if (gross >= floor && gross > 0n && (sameAddress(account, TREASURY_ADDRESS) || (paid(account) === expected.net && paid(TREASURY_ADDRESS) === expected.fee))) return { kind: "sold", imdOut: gross, txHash };
  }
  return { kind: "pending", phase: "sale", txHash, batchTokens: tokens, minimumGross: floor, amountIn,
    reason: "The receipt is confirmed, but this token’s input and IMD payout could not be reconciled. Inspect the transaction before retrying." };
}

export async function resolveBatchPending(client: PublicClient, wallet: WalletClient | undefined, account: Address, token: Address, result: SaleResult): Promise<SaleResult | undefined> {
  if (result.kind !== "pending") return result;
  let hash = result.txHash;
  try {
    if (!hash && result.batchId && wallet) {
      const status = await wallet.getCallsStatus({ id: result.batchId });
      if (status.status === "failure") return { kind: "unsold", reason: "The wallet batch failed. Check your wallet, then scan and review again." };
      if (status.status !== "success" || status.atomic !== true) return result;
      hash = status.receipts?.at(-1)?.transactionHash;
    }
    if (!hash) return result;
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status === "reverted") return { kind: "unsold", txHash: hash, reason: "The batch reverted. Tokens stayed in your wallet; no sale fee was charged. Network gas was spent." };
    if (result.phase === "approval") return undefined;
    if (result.batchTokens && result.amountIn !== undefined && result.minimumGross !== undefined) return reconcileBatch(receipt.logs, account, result.batchTokens, token, result.amountIn, result.minimumGross, hash);
  } catch { /* Unknown means pending; a network error must never unlock another sale. */ }
  return result;
}

async function executeBatchSaleUnlocked(wallet: WalletClient, client: PublicClient, account: Address, plan: Plan, onProgress: (p: Progress) => void, onOutcome: (results: Map<string, SaleResult>) => void = () => {}) {
  const results = new Map<string, SaleResult>();
  const emit = () => { persistPending(account, results); onOutcome(new Map(results)); };
  const assertWallet = async () => {
    if (await wallet.getChainId() !== 1 || await client.getChainId() !== 1) throw new Error("Switch to Ethereum before signing.");
    const accounts = await wallet.getAddresses();
    if (!accounts[0] || !sameAddress(accounts[0], account)) throw new Error("The connected account changed. Review the sweep again.");
  };
  if (!sameAddress(plan.account, account)) throw new Error("This review belongs to a different account.");
  const unresolved = storedPending(account);
  if (plan.items.some((item) => unresolved.has(item.token.address.toLowerCase()))) throw new Error("A selected token has an unresolved transaction. Scan the wallet before submitting another sweep.");
  await assertWallet();
  const batches = Math.ceil(plan.items.length / MAX_BATCH_SIZE);
  let stopped = false;
  for (let start = 0, batch = 1; start < plan.items.length; start += MAX_BATCH_SIZE, batch++) {
    const chunk = plan.items.slice(start, start + MAX_BATCH_SIZE);
    if (stopped) { for (const { token } of chunk) results.set(token.address.toLowerCase(), { kind: "unsold", reason: "Not submitted. Resolve the earlier wallet request before starting another sweep." }); emit(); continue; }
    let hash: Hash | undefined, bundleId: string | undefined;
    let bundleAccepted = false, definitiveFailure = false;
    let phase: "approval" | "sale" = "approval";
    let currentApproval: Address | undefined;
    try {
      await assertWallet();
      let fresh = await freshItems(client, account, chunk);
      const until = expiry();
      let auth = await mapConcurrent(fresh, 6, ({ token }) => authorization(client, account, token.address));
      if (plan.batch?.mode === "atomic") {
        if (!await supportsAtomic(wallet, account)) throw new Error("This wallet no longer supports atomic batches. Choose standard confirmations and review again.");
        const sale = batchSaleCall(account, fresh, BigInt(until));
        const calls = [...approvalCalls(fresh, auth, until), { to: sale.address, data: encodeFunctionData(sale), value: 0n }];
        await simulateAtomic(client, account, calls);
        await assertWallet();
        onProgress({ step: "batch-sign", batch, batches, calls: calls.length });
        phase = "sale";
        // A caller-supplied EIP-5792 identifier also protects ambiguous transport failures.
        bundleId = `sweepdust-${crypto.randomUUID()}`;
        for (const item of chunk) results.set(item.token.address.toLowerCase(), { kind: "pending", phase: "sale", batchId: bundleId, batchTokens: chunk.map((i) => i.token.address), amountIn: item.token.liveRoute!.amountIn, minimumGross: minimumOut(item.imdOut), reason: "A wallet batch request is open. Check its status before starting another sale." });
        emit();
        const response = await wallet.sendCalls({ account, chain: wallet.chain, calls, forceAtomic: true, experimental_fallback: false, id: bundleId });
        bundleId = response.id;
        bundleAccepted = true;
        for (const item of chunk) results.set(item.token.address.toLowerCase(), { kind: "pending", phase: "sale", batchId: bundleId, batchTokens: chunk.map((i) => i.token.address), amountIn: item.token.liveRoute!.amountIn, minimumGross: minimumOut(item.imdOut), reason: "Wallet batch submitted. Its confirmation is being checked." });
        emit();
        onProgress({ step: "batch-mine", batch, batches, id: bundleId });
        const status = await wallet.waitForCallsStatus({ id: bundleId, timeout: 90_000, pollingInterval: 1500 });
        if (status.status === "failure") {
          definitiveFailure = (status.statusCode >= 400 && status.statusCode < 500) || !!status.receipts?.length && status.receipts.every((receipt) => receipt.status === "reverted");
          hash = status.receipts?.at(-1)?.transactionHash;
        }
        if (status.status !== "success") throw new Error(status.status === "failure" ? "The atomic wallet batch failed." : "Wallet batch confirmation is still pending.");
        if (status.atomic !== true) throw new Error("The wallet did not confirm atomic execution. Inspect its activity before retrying.");
        hash = status.receipts?.at(-1)?.transactionHash;
        if (!hash) throw new Error("The wallet has not provided a transaction receipt yet.");
      } else {
        for (let i = 0; i < fresh.length; i++) {
          const token = fresh[i]!.token, needed = token.liveRoute!.amountIn;
          const existing = auth[i]!.erc20;
          if (existing >= needed) continue;
          currentApproval = token.address;
          for (const amount of existing > 0n ? [0n, needed] : [needed]) {
            await assertWallet();
            onProgress({ step: "approve", token, index: i + 1, total: fresh.length, approval: "token" });
            hash = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: "approve", args: [PERMIT2, amount], account, chain: wallet.chain });
            results.set(token.address.toLowerCase(), { kind: "pending", phase: "approval", txHash: hash, reason: "Token approval submitted; waiting for its receipt." });
            emit();
            const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000, confirmations: 1 });
            if (receipt.status !== "success") { hash = undefined; throw new Error("Token approval reverted. No sale was submitted."); }
            hash = undefined;
            results.set(token.address.toLowerCase(), { kind: "unsold", reason: "Approval confirmed. The batch sale has not yet been submitted." });
            emit();
          }
        }
        currentApproval = undefined;
        await assertWallet();
        fresh = await freshItems(client, account, chunk);
        auth = await mapConcurrent(fresh, 6, ({ token }) => authorization(client, account, token.address));
        if (auth.some((a, i) => a.erc20 < fresh[i]!.token.liveRoute!.amountIn)) throw new Error("A token did not grant the required allowance. Check its approval in your wallet.");
        const permitUntil = expiry();
        const details = auth.flatMap((a, i) => a.amount < fresh[i]!.token.liveRoute!.amountIn || a.expiration < permitUntil ? [{ token: fresh[i]!.token.address, amount: fresh[i]!.token.liveRoute!.amountIn, expiration: permitUntil, nonce: a.nonce }] : []);
        let permit: { value: BatchPermit; signature: Hex } | undefined;
        if (details.length) {
          onProgress({ step: "permit", batch, batches, tokens: details.length });
          const value: BatchPermit = { details, spender: UNIVERSAL_ROUTER, sigDeadline: BigInt(permitUntil) };
          const signature = await wallet.signTypedData({ account,
            domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 }, primaryType: "PermitBatch",
            types: { PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }], PermitBatch: [{ name: "details", type: "PermitDetails[]" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] }, message: value });
          permit = { value, signature };
        }
        await assertWallet();
        const call = batchSaleCall(account, fresh, BigInt(permitUntil), permit);
        await client.simulateContract(call);
        const gas = await client.estimateContractGas(call);
        const gasPrice = await client.getGasPrice();
        await assertWallet();
        onProgress({ step: "sign", batch, batches, gasWei: gas * gasPrice });
        phase = "sale";
        hash = await wallet.writeContract({ ...call, chain: wallet.chain, gas: gas * 120n / 100n });
        for (const item of chunk) results.set(item.token.address.toLowerCase(), { kind: "pending", phase: "sale", txHash: hash, batchTokens: chunk.map((i) => i.token.address), amountIn: item.token.liveRoute!.amountIn, minimumGross: minimumOut(item.imdOut), reason: "The batch transaction is awaiting confirmation." });
        emit();
        onProgress({ step: "mine", hash, batch, batches });
      }
      const receipt = await client.waitForTransactionReceipt({ hash: hash!, timeout: 90_000, confirmations: 1 });
      for (const item of chunk) results.set(item.token.address.toLowerCase(), receipt.status === "success"
        ? reconcileBatch(receipt.logs, account, chunk.map((i) => i.token.address), item.token.address, item.token.liveRoute!.amountIn, minimumOut(item.imdOut), hash!)
        : { kind: "unsold", txHash: hash, reason: "The batch reverted. Tokens stayed in your wallet and no sale fee was charged. Network gas was spent." });
      stopped = receipt.status !== "success" || [...results.values()].some((r) => r.kind === "pending");
      emit();
    } catch (error) {
      const code = (error as { code?: number; cause?: { code?: number } }).code ?? (error as { cause?: { code?: number } }).cause?.code;
      const rejected = code === 4001 || /user rejected|user denied/i.test(message(error));
      const refused = !bundleAccepted && [-32601, -32602, 4200, 5700, 5710, 5720, 5730, 5740, 5750].includes(code ?? 0);
      if (rejected || refused) bundleId = undefined;
      for (const item of chunk) {
        const key = item.token.address.toLowerCase();
        if (definitiveFailure) {
          results.set(key, { kind: "unsold", txHash: hash, reason: "The wallet batch failed. No sale is confirmed; check your wallet before reviewing again." });
        } else if (hash && phase === "approval" && currentApproval && !sameAddress(currentApproval, item.token.address)) {
          results.set(key, { kind: "unsold", reason: "No sale submitted. Another token’s approval is still awaiting confirmation." });
        } else if (hash || bundleId) results.set(key, { kind: "pending", phase, txHash: hash, batchId: bundleId,
          batchTokens: chunk.map((i) => i.token.address), amountIn: item.token.liveRoute!.amountIn, minimumGross: minimumOut(item.imdOut), reason: `${phase === "approval" ? "Approval" : "Batch"} confirmation is unknown. Check your wallet and use Scan wallet to reconcile it before retrying.` });
        else results.set(key, { kind: "unsold", reason: rejected ? "You declined the wallet request. No sale was submitted." : `Not submitted: ${message(error)}` });
      }
      stopped = true;
      emit();
    }
  }
  return results;
}

/** One wallet workflow per origin/account, including across tabs when Web Locks is available. */
export async function executeBatchSale(...args: Parameters<typeof executeBatchSaleUnlocked>) {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`sweepdust:1:${args[2].toLowerCase()}`, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Another tab is already sweeping this wallet. Complete its request before retrying.");
      return executeBatchSaleUnlocked(...args);
    });
  }
  return executeBatchSaleUnlocked(...args);
}
