import {
  parseAbi,
  stringToHex,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

export const REGISTRIES = [
  {
    address: "0xa47fcb220ddd1cddda865f89029bec1b9eca3bf1",
    factory: "0x12c63b581d07093f6126bc02263c58f7eadaa96f",
  },
  {
    address: "0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23",
    factory: "0xff03410d0fe5fa8f7f59f743de35e333d9857120",
  },
] as const;
export const registryAbi = parseAbi([
  "function count() view returns (uint64)",
  "function writer() view returns (address)",
  "function artifactsOf(uint64) view returns ((bytes32 role, bytes32 name, address addr)[])",
  "event LaunchRecorded(uint64 indexed launchNumber, bytes32 indexed kind, bytes32 sourceCommit, bytes32 attestationHash, address[] artifacts, uint256[] agentIds)",
]);
const launchEvent = registryAbi[3];
const TOKEN_ROLE = stringToHex("token", { size: 32 });
export type LaunchToken = {
  address: Address;
  launchNumber: number;
  blockNumber: number;
  transactionHash: Hash;
  launchId?: string;
};
export type Snapshot = {
  version: number;
  chainId: number;
  blockNumber: number;
  blockHash: Hash;
  registries: { address: string; factory: string; count: number }[];
  tokens: LaunchToken[];
};
export type Discovery = {
  tokens: LaunchToken[];
  blockNumber: bigint;
  warnings: string[];
  snapshotBlock: number;
};
export const message = (e: unknown) =>
  e instanceof Error ? e.message.split("\n")[0]! : String(e);

export function validateSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  if (
    !s ||
    s.version !== 1 ||
    s.chainId !== 1 ||
    !Number.isSafeInteger(s.blockNumber) ||
    s.blockNumber <= 0 ||
    !/^0x[0-9a-f]{64}$/.test(s.blockHash) ||
    !Array.isArray(s.tokens) ||
    !Array.isArray(s.registries)
  )
    throw new Error("Launch snapshot is invalid. Discovery did not complete.");
  for (const t of s.tokens) {
    if (
      !/^0x[0-9a-f]{40}$/.test(t.address) ||
      /^0x0{40}$/.test(t.address) ||
      !/^0x[0-9a-f]{64}$/.test(t.transactionHash) ||
      !Number.isSafeInteger(t.launchNumber) ||
      !Number.isSafeInteger(t.blockNumber) ||
      t.blockNumber > s.blockNumber
    )
      throw new Error("Invalid token provenance in launch snapshot.");
  }
  for (const r of REGISTRIES) {
    const saved = s.registries.find(
      (x) => x.address === r.address && x.factory === r.factory,
    );
    if (!saved || !Number.isSafeInteger(saved.count) || saved.count < 0)
      throw new Error("Launch registry checkpoint is missing.");
  }
  return s;
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch("./launches.json", {
    signal: AbortSignal.timeout(15000),
    cache: "no-cache",
  });
  if (!response.ok)
    throw new Error(
      `Launch snapshot HTTP ${response.status}. Retry discovery.`,
    );
  return validateSnapshot(await response.json());
}

// Bounded provider ranges, halved on refusal. Never turn a failed log range into [].
async function logsInRange(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Awaited<ReturnType<typeof client.getLogs<typeof launchEvent>>>> {
  try {
    return await client.getLogs({
      address,
      event: launchEvent,
      fromBlock,
      toBlock,
      strict: true,
    });
  } catch (error) {
    if (toBlock - fromBlock < 100n) throw error;
    const middle = (fromBlock + toBlock) / 2n;
    return [
      ...(await logsInRange(client, address, fromBlock, middle)),
      ...(await logsInRange(client, address, middle + 1n, toBlock)),
    ];
  }
}

/** Complete historical official records plus every subsequent launch in the two official registries. */
export async function discoverLaunches(
  client: PublicClient,
  snapshot?: Snapshot,
  progress: (text: string) => void = () => {},
): Promise<Discovery> {
  if ((await client.getChainId()) !== 1)
    throw new Error("Wrong RPC chain. Ethereum mainnet (1) is required.");
  const saved = validateSnapshot(snapshot ?? (await fetchSnapshot()));
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  if (blockNumber < BigInt(saved.blockNumber))
    throw new Error(
      "RPC is behind the launch snapshot. Try another Ethereum endpoint.",
    );
  const anchor = await client.getBlock({
    blockNumber: BigInt(saved.blockNumber),
  });
  if (anchor.hash !== saved.blockHash)
    throw new Error(
      "Launch snapshot block hash does not match Ethereum. Refresh the launch snapshot.",
    );
  const tokens = new Map(saved.tokens.map((t) => [t.address.toLowerCase(), t]));
  const warnings: string[] = [];
  for (const registry of REGISTRIES) {
    progress("Checking new Ethereum launches…");
    try {
      const [count, writer] = await Promise.all([
        client.readContract({
          address: registry.address,
          abi: registryAbi,
          functionName: "count",
          blockNumber,
        }),
        client.readContract({
          address: registry.address,
          abi: registryAbi,
          functionName: "writer",
          blockNumber,
        }),
      ]);
      if (writer.toLowerCase() !== registry.factory)
        throw new Error("Registry writer does not match the official factory.");
      const previous = saved.registries.find(
        (r) => r.address === registry.address,
      )!.count;
      if (count < BigInt(previous))
        throw new Error("Registry count is behind the snapshot.");
      if (count === BigInt(previous)) continue;
      const logs = [];
      for (
        let from = BigInt(saved.blockNumber) + 1n;
        from <= blockNumber;
        from += 20000n
      ) {
        const to = from + 19999n > blockNumber ? blockNumber : from + 19999n;
        logs.push(...(await logsInRange(client, registry.address, from, to)));
      }
      const unique = new Map(
        logs
          .filter((l) => !l.removed)
          .map((l) => [String(l.args.launchNumber), l]),
      );
      if (BigInt(unique.size + previous) !== count)
        throw new Error(
          "RPC returned incomplete launch events (registry count mismatch).",
        );
      for (const log of unique.values()) {
        if (log.args.launchNumber === undefined || !log.args.artifacts)
          throw new Error("Malformed launch event");
        const artifacts = await client.readContract({
          address: registry.address,
          abi: registryAbi,
          functionName: "artifactsOf",
          args: [log.args.launchNumber],
          blockNumber,
        });
        for (const artifact of artifacts) {
          if (artifact.role !== TOKEN_ROLE) continue;
          if (
            !log.args.artifacts.some(
              (a) => a.toLowerCase() === artifact.addr.toLowerCase(),
            ) ||
            !log.transactionHash ||
            log.blockNumber === null
          )
            throw new Error("Launch artifact does not match its event.");
          const address = artifact.addr.toLowerCase() as Address;
          tokens.set(address, {
            address,
            launchNumber: Number(log.args.launchNumber),
            blockNumber: Number(log.blockNumber),
            transactionHash: log.transactionHash,
          });
        }
      }
    } catch (e) {
      warnings.push(`New launches from ${registry.address}: ${message(e)}`);
    }
  }
  return {
    tokens: [...tokens.values()],
    blockNumber,
    warnings,
    snapshotBlock: saved.blockNumber,
  };
}
