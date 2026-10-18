// Read-only integration check; never connects a wallet or sends a transaction.
// node --experimental-strip-types scripts/verify-live.mjs [RPC URL] [report path]
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { discoverLaunches, registryAbi } from "../src/lib/discovery.ts";
import { loadSwarmWallet as loadWallet } from "../src/lib/sweep.ts";
import { erc20Abi } from "../src/abi/erc20.ts";
import { swarmExitAbi } from "../src/abi/swarmExit.ts";
import { SWARM_EXIT_ADDRESS } from "../src/deployment.ts";
const account = "0x0ace1dbe8aab293cd58d5e3ea38814f0ccb74782";
const rpcSource = process.argv[2] || "https://ethereum-rpc.publicnode.com";
const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcSource, {
    timeout: 20000,
  }),
});
const snapshot = JSON.parse(
  await readFile(new URL("../public/launches.json", import.meta.url), "utf8"),
);
const state = await loadWallet(client, account, {
  snapshot,
  progress: console.log,
});
const holdings = [];
for (const t of state.tokens) {
  const raw = await client.readContract({
    address: t.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
    blockNumber: state.blockNumber,
  });
  const decimals = await client.readContract({
    address: t.address,
    abi: erc20Abi,
    functionName: "decimals",
    blockNumber: state.blockNumber,
  });
  if (raw !== t.balance || decimals !== t.decimals)
    throw new Error("Independent balance/decimals mismatch " + t.address);
  holdings.push({
    address: t.address,
    symbol: t.symbol,
    launchNumber: t.launch.launchNumber,
    raw: raw.toString(),
    decimals,
    formatted: formatUnits(raw, decimals),
    sellable: t.sellable,
    status: t.status,
  });
}
if (!holdings.length)
  throw new Error("Known-holder regression: no holdings detected");
const registryCount = await client.readContract({
  address: SWARM_EXIT_ADDRESS,
  abi: swarmExitAbi,
  functionName: "swarmTokenCount",
  blockNumber: state.blockNumber,
});
const treasury = await client.readContract({
  address: SWARM_EXIT_ADDRESS,
  abi: swarmExitAbi,
  functionName: "TREASURY",
  blockNumber: state.blockNumber,
});
const feeBps = await client.readContract({
  address: SWARM_EXIT_ADDRESS,
  abi: swarmExitAbi,
  functionName: "SELL_TAX_BPS",
  blockNumber: state.blockNumber,
});
if (
  treasury.toLowerCase() !== "0xfc3ad9c531e1736690b2d5f24febd35ebf051cfb" ||
  feeBps !== 200n
)
  throw new Error("Deployed sale fee mismatch");
// Exercise real incremental event discovery, not only the bundled history path.
const rewindBlock = BigInt(snapshot.blockNumber) - 1500n;
const rewind = {
  ...snapshot,
  blockNumber: Number(rewindBlock),
  blockHash: (await client.getBlock({ blockNumber: rewindBlock })).hash,
  tokens: snapshot.tokens.filter((t) => BigInt(t.blockNumber) <= rewindBlock),
  registries: await Promise.all(
    snapshot.registries.map(async (r) => ({
      ...r,
      count: Number(
        await client.readContract({
          address: r.address,
          abi: registryAbi,
          functionName: "count",
          blockNumber: rewindBlock,
        }),
      ),
    })),
  ),
};
const incremental = await discoverLaunches(client, rewind);
if (
  incremental.warnings.length ||
  incremental.tokens.length !== state.discovered ||
  !state.tokens.every((t) =>
    incremental.tokens.some((x) => x.address === t.address),
  )
)
  throw new Error(
    "Real incremental registry discovery differs from the complete scan",
  );
const incrementalCheck = {
  fromBlock: Number(rewindBlock),
  historicalTokens: rewind.tokens.length,
  recoveredTokens: incremental.tokens.length - rewind.tokens.length,
  totalTokens: incremental.tokens.length,
  warnings: incremental.warnings,
};
const report = {
  incrementalCheck,
  treasury,
  feeBps: feeBps.toString(),
  chainId: 1,
  account,
  blockNumber: state.blockNumber.toString(),
  rpcSource,
  officialSource: snapshot.source,
  snapshotBlock: snapshot.blockNumber,
  launchContracts: state.discovered,
  balancesRead: state.balancesRead,
  swarmExitRegistered: registryCount.toString(),
  complete: state.complete,
  warnings: state.warnings,
  holdings,
};
if (process.argv[3])
  await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    blockNumber: report.blockNumber,
    discovered: report.launchContracts,
    balancesRead: report.balancesRead,
    registered: report.swarmExitRegistered,
    held: holdings.length,
    complete: state.complete,
    warnings: state.warnings,
    examples: holdings.slice(0, 4),
  }),
);
