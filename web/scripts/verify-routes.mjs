// Read-only mainnet check. RPC argument is never copied into the evidence.
// node --experimental-strip-types web/scripts/verify-routes.mjs [RPC] [report]
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { loadWallet } from "../src/lib/sweep.ts";
import { swarmExitAbi } from "../src/abi/swarmExit.ts";
import { SWARM_EXIT_ADDRESS } from "../src/deployment.ts";
const client = createPublicClient({
  chain: mainnet,
  transport: http(process.argv[2] || "https://ethereum-rpc.publicnode.com", {
    timeout: 20000,
    retryCount: 1,
  }),
});
const snapshot = JSON.parse(
  await readFile(new URL("../public/launches.json", import.meta.url), "utf8"),
);
const poolSnapshot = JSON.parse(
  await readFile(new URL("../public/pools.json", import.meta.url), "utf8"),
);
const account = "0x0ace1dbe8aab293cd58d5e3ea38814f0ccb74782";
const before = Date.now();
const state = await loadWallet(client, account, {
  snapshot,
  poolSnapshot,
  progress: (text) => {
    if (/routes (\d*[048]) of/.test(text)) console.log(text);
  },
});
const registered = await client.readContract({
  address: SWARM_EXIT_ADDRESS,
  abi: swarmExitAbi,
  functionName: "swarmTokenCount",
});
const report = {
  chainId: 1,
  account,
  publicRpcSource: "https://ethereum-rpc.publicnode.com",
  blockNumber: state.blockNumber.toString(),
  seconds: (Date.now() - before) / 1000,
  held: state.tokens.length,
  quoted: state.tokens.filter((t) => t.sellable).length,
  registered: registered.toString(),
  warnings: state.warnings,
  tokens: state.tokens.map((t) => ({
    address: t.address,
    symbol: t.symbol,
    balance: t.balance.toString(),
    amountIn: t.liveRoute?.amountIn.toString(),
    expectedImd: t.expectedImd.toString(),
    sellable: t.sellable,
    reason: t.routeReason,
    pools: t.liveRoute?.pools.map((p) => p.id),
  })),
};
if (process.argv[3])
  await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, tokens: undefined }, null, 2));
if (!report.held || !report.quoted)
  throw Error("No live routes for the known holder");
