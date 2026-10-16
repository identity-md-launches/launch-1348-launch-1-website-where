// Executes on a disposable local fork only. No private keys and no mainnet writes.
// node --experimental-strip-types web/scripts/verify-route-fork.mjs [upstream RPC] [report]
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";
import {
  planDirectSale,
  executeDirectSale,
  saleCall,
} from "../src/lib/directSale.ts";
import { erc20Abi } from "../src/abi/erc20.ts";
import { IMD_ADDRESS, TREASURY_ADDRESS } from "../src/deployment.ts";
const upstream = process.argv[2] || "https://ethereum-rpc.publicnode.com";
const evidence = JSON.parse(
  await readFile(
    new URL("../../test/scratch/live-routes.json", import.meta.url),
    "utf8",
  ),
);
const pools = JSON.parse(
  await readFile(new URL("../public/pools.json", import.meta.url), "utf8"),
).pools;
const child = spawn(
  "anvil",
  [
    "--fork-url",
    upstream,
    "--fork-block-number",
    evidence.blockNumber,
    "--port",
    "18546",
    "--silent",
  ],
  { stdio: "ignore" },
);
let launchError;
child.on("error", (e) => (launchError = e));
const client = createPublicClient({
  chain: mainnet,
  transport: http("http://127.0.0.1:18546", { retryCount: 0 }),
});
const wallet = createWalletClient({
  chain: mainnet,
  transport: http("http://127.0.0.1:18546"),
  account: evidence.account,
});
wallet.getAddresses = async () => [evidence.account];
const report = {
  kind: "disposable local mainnet fork",
  blockNumber: evidence.blockNumber,
  mainnetTransactionsSent: 0,
  checks: [],
};
try {
  for (let i = 0; ; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      if (launchError) throw launchError;
      if (i > 60) throw Error("Local fork unavailable");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await client.request({
    method: "anvil_impersonateAccount",
    params: [evidence.account],
  });
  await client.request({
    method: "anvil_setBalance",
    params: [evidence.account, "0x56bc75e2d63100000"],
  });
  const selected = [];
  for (const t of evidence.tokens.filter((t) => t.sellable)) {
    const poolList = t.pools.map((id) => pools.find((p) => p.id === id));
    const kind =
      poolList.length > 1
        ? "bridge"
        : poolList[0].hooks === "0x0000000000000000000000000000000000000000"
          ? "direct"
          : "hook";
    if (!selected.some((s) => s.kind === kind))
      selected.push({ kind, t, poolList });
  }
  for (const { kind, t, poolList } of selected) {
    const beforeUser = await client.readContract({
      address: IMD_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [evidence.account],
    });
    const beforeFee = await client.readContract({
      address: IMD_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [TREASURY_ADDRESS],
    });
    const token = {
      ...t,
      balance: BigInt(t.balance),
      expectedImd: BigInt(t.expectedImd),
      decimals: 18,
      sellable: true,
      heldRefund: 0n,
      liveRoute: {
        pools: poolList,
        amountIn: BigInt(t.amountIn),
        amountOut: BigInt(t.expectedImd),
        blockNumber: BigInt(evidence.blockNumber),
        quotedAt: Date.now(),
      },
    };
    const plannedAmount = token.liveRoute.amountIn;
    const plan = await planDirectSale(client, evidence.account, [token]);
    if (!plan.items.length)
      throw Error(
        "Plan excluded " + t.symbol + ": " + JSON.stringify(plan.excluded),
      );
    const results = await executeDirectSale(
      wallet,
      client,
      evidence.account,
      plan,
      () => {},
    );
    const result = results.get(t.address);
    if (result?.kind !== "sold")
      throw Error(
        "Fork sale failed " + t.symbol + ": " + JSON.stringify(result),
      );
    const received =
      (await client.readContract({
        address: IMD_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [evidence.account],
      })) - beforeUser;
    const fee =
      (await client.readContract({
        address: IMD_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [TREASURY_ADDRESS],
      })) - beforeFee;
    if (fee !== ((received + fee) * 200n) / 10000n) throw Error("Fee mismatch");
    const remaining = await client.readContract({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [evidence.account],
    });
    if (remaining !== token.balance - plannedAmount)
      throw Error("Input amount mismatch");
    if (remaining > 0n) {
      const beforeRevert = await client.readContract({
        address: IMD_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [TREASURY_ADDRESS],
      });
      const bad = saleCall(
        evidence.account,
        t.address,
        { ...token.liveRoute, amountIn: 1n },
        (1n << 128n) - 1n,
        BigInt(Math.floor(Date.now() / 1000) + 600),
      );
      const failedHash = await wallet.writeContract({
        ...bad,
        chain: mainnet,
        gas: 2000000n,
      });
      const failedReceipt = await client.waitForTransactionReceipt({
        hash: failedHash,
      });
      if (failedReceipt.status !== "reverted")
        throw Error("Slippage rejection did not revert");
      if (
        (await client.readContract({
          address: t.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [evidence.account],
        })) !== remaining
      )
        throw Error("Reverted sale changed input balance");
      if (
        (await client.readContract({
          address: IMD_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [TREASURY_ADDRESS],
        })) !== beforeRevert
      )
        throw Error("Reverted sale charged fee");
      report.checks.push({
        kind: "reverted sale retains input and charges no fee",
        passed: true,
      });
    }
    report.checks.push({
      kind,
      token: t.address,
      symbol: t.symbol,
      received: received.toString(),
      fee: fee.toString(),
      remaining: remaining.toString(),
      passed: true,
    });
    console.log("Passed fork sale:", kind, t.symbol);
  }
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill("SIGTERM");
}
