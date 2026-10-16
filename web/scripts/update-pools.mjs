// On-chain v4 pool index for identified launch currencies and IMD. No price cache.
// Run from web/: node --experimental-strip-types scripts/update-pools.mjs [RPC]
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { IMD_ADDRESS } from "../src/deployment.ts";
import {
  POOL_MANAGER,
  poolAbi,
  poolsFromLogs,
  validatePools,
} from "../src/lib/routes.ts";
const client = createPublicClient({
  chain: mainnet,
  transport: http(process.argv[2] || "https://ethereum-rpc.publicnode.com", {
    timeout: 30000,
    retryCount: 2,
  }),
});
if ((await client.getChainId()) !== 1) throw Error("Ethereum mainnet required");
const launches = JSON.parse(
  await readFile(new URL("../public/launches.json", import.meta.url), "utf8"),
);
const block = await client.getBlock();
const pools = new Map();
const currencies = [IMD_ADDRESS, ...launches.tokens.map((t) => t.address)];
// Indexed-topic filters avoid downloading unrelated swaps or full chain transaction history.
async function range(group, position, start, end) {
  try {
    const logs = await client.getLogs({
      address: POOL_MANAGER,
      event: poolAbi[0],
      args: { [position]: group },
      fromBlock: start,
      toBlock: end,
      strict: true,
    });
    for (const p of poolsFromLogs(logs)) pools.set(p.id, p);
  } catch (e) {
    if (end - start < 100n) throw e;
    const mid = (start + end) / 2n;
    await range(group, position, start, mid);
    await range(group, position, mid + 1n, end);
  }
}
// V4 deployment block, from the PoolManager's creation receipt.
for (let i = 0; i < currencies.length; i += 100)
  await Promise.all(
    ["currency0", "currency1"].map((position) =>
      range(currencies.slice(i, i + 100), position, 21688329n, block.number),
    ),
  );
const snapshot = validatePools({
  version: 1,
  chainId: 1,
  blockNumber: Number(block.number),
  blockHash: block.hash,
  pools: [...pools.values()].sort((a, b) => a.id.localeCompare(b.id)),
});
await writeFile(
  new URL("../public/pools.json", import.meta.url),
  JSON.stringify(snapshot, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    blockNumber: snapshot.blockNumber,
    pools: snapshot.pools.length,
    launchTokens: launches.tokens.length,
  }),
);
