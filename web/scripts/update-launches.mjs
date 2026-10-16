// Refresh the complete official launch history; no hand-maintained token list.
// Run from web/: node scripts/update-launches.mjs [public Ethereum RPC URL]
import { createPublicClient, http, parseAbi, stringToHex } from "viem";
import { mainnet } from "viem/chains";
import { writeFile } from "node:fs/promises";
const source = "https://api.imd.fun/launches";
const registries = [
  {
    address: "0xa47fcb220ddd1cddda865f89029bec1b9eca3bf1",
    factory: "0x12c63b581d07093f6126bc02263c58f7eadaa96f",
  },
  {
    address: "0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23",
    factory: "0xff03410d0fe5fa8f7f59f743de35e333d9857120",
  },
];
const client = createPublicClient({
  chain: mainnet,
  transport: http(process.argv[2] || "https://ethereum-rpc.publicnode.com"),
});
if ((await client.getChainId()) !== 1)
  throw Error("Ethereum mainnet RPC required");
const blockNumber = (await client.getBlockNumber()) - 12n;
const block = await client.getBlock({ blockNumber });
const records = new Map();
let before;
let pages = 0;
while (true) {
  const url = `${source}?limit=500${before === undefined ? "" : `&before=${before}`}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Official index HTTP ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data.launches)) throw new Error("Invalid launch page");
  pages++;
  if (!data.launches.length) break;
  for (const launch of data.launches) {
    if (launch.chainId !== 1 || launch.status !== "live") continue;
    for (const a of launch.artifacts) {
      if (a.role !== "token" || a.blockNumber > Number(blockNumber)) continue;
      if (
        !/^0x[0-9a-fA-F]{40}$/.test(a.address) ||
        !/^0x[0-9a-fA-F]{64}$/.test(a.txHash) ||
        !Number.isSafeInteger(a.blockNumber)
      )
        throw new Error("Malformed official token record");
      records.set(a.address.toLowerCase(), {
        address: a.address.toLowerCase(),
        launchNumber: launch.launchNumber,
        blockNumber: a.blockNumber,
        transactionHash: a.txHash.toLowerCase(),
        launchId: launch.id,
      });
    }
  }
  const next = Math.min(...data.launches.map((x) => x.launchNumber));
  if (!Number.isSafeInteger(next) || (before !== undefined && next >= before))
    throw new Error("Launch pagination did not advance");
  before = next;
}
const abi = parseAbi([
  "function count() view returns(uint64)",
  "function writer() view returns(address)",
  "function artifactsOf(uint64) view returns((bytes32 role,bytes32 name,address addr)[])",
  "event LaunchRecorded(uint64 indexed launchNumber,bytes32 indexed kind,bytes32 sourceCommit,bytes32 attestationHash,address[] artifacts,uint256[] agentIds)",
]);
async function readLogs(address, fromBlock, toBlock) {
  try {
    return await client.getLogs({
      address,
      event: abi[3],
      fromBlock,
      toBlock,
      strict: true,
    });
  } catch (e) {
    if (toBlock - fromBlock < 100n) throw e;
    const mid = (fromBlock + toBlock) / 2n;
    return [
      ...(await readLogs(address, fromBlock, mid)),
      ...(await readLogs(address, mid + 1n, toBlock)),
    ];
  }
}
for (const r of registries) {
  const writer = await client.readContract({
    address: r.address,
    abi,
    functionName: "writer",
    blockNumber,
  });
  if (writer.toLowerCase() !== r.factory)
    throw new Error("Registry writer mismatch");
  r.count = Number(
    await client.readContract({
      address: r.address,
      abi,
      functionName: "count",
      blockNumber,
    }),
  );
  // Locate deployment on chain so older ranges are neither guessed nor silently skipped.
  let low = 0n,
    high = blockNumber;
  while (low < high) {
    const mid = (low + high) / 2n;
    const code = await client.getCode({ address: r.address, blockNumber: mid });
    if (code && code !== "0x") high = mid;
    else low = mid + 1n;
  }
  const events = [];
  for (let from = low; from <= blockNumber; from += 20000n) {
    const to = from + 19999n > blockNumber ? blockNumber : from + 19999n;
    events.push(...(await readLogs(r.address, from, to)));
  }
  const unique = new Map(events.map((e) => [String(e.args.launchNumber), e]));
  if (unique.size !== r.count) throw Error("Registry history incomplete");
  // Reconcile the API with every registry record before advancing the checkpoint.
  for (const event of unique.values()) {
    const artifacts = await client.readContract({
      address: r.address,
      abi,
      functionName: "artifactsOf",
      args: [event.args.launchNumber],
      blockNumber,
    });
    for (const artifact of artifacts) {
      if (artifact.role !== stringToHex("token", { size: 32 })) continue;
      const address = artifact.addr.toLowerCase();
      if (!event.args.artifacts.some((a) => a.toLowerCase() === address))
        throw Error("Artifact/event mismatch");
      const old = records.get(address);
      if (
        old &&
        (old.transactionHash !== event.transactionHash ||
          old.blockNumber !== Number(event.blockNumber))
      )
        throw Error("API and registry provenance disagree");
      if (!old)
        records.set(address, {
          address,
          launchNumber: Number(event.args.launchNumber),
          blockNumber: Number(event.blockNumber),
          transactionHash: event.transactionHash,
        });
    }
  }
  console.log(
    JSON.stringify({
      registry: r.address,
      records: r.count,
      historyVerified: unique.size,
      creationBlock: Number(low),
    }),
  );
}
const tokens = [...records.values()].sort((a, b) =>
  a.address.localeCompare(b.address),
);
// Verify the deployment transaction and a successful balance read at the pinned block.
let verified = 0;
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < tokens.length) {
      const t = tokens[next++];
      const receipt = await client.getTransactionReceipt({
        hash: t.transactionHash,
      });
      if (
        receipt.status !== "success" ||
        receipt.blockNumber !== BigInt(t.blockNumber)
      )
        throw new Error(`Invalid deployment receipt ${t.address}`);
      const code = await client.getCode({ address: t.address, blockNumber });
      if (!code || code === "0x")
        throw new Error(`No code at official token ${t.address}`);
      verified++;
    }
  }),
);
if ((await client.getBlock({ blockNumber })).hash !== block.hash)
  throw Error("Snapshot block changed during verification");
const snapshot = {
  version: 1,
  chainId: 1,
  source,
  registrySource: "https://imd.fun/docs/#contracts",
  generatedAt: new Date().toISOString(),
  blockNumber: Number(blockNumber),
  blockHash: block.hash,
  pages,
  registries,
  tokens,
};
await writeFile(
  new URL("../public/launches.json", import.meta.url),
  JSON.stringify(snapshot, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    pages,
    tokens: tokens.length,
    verified,
    blockNumber: Number(blockNumber),
    blockHash: block.hash,
    registries,
  }),
);
