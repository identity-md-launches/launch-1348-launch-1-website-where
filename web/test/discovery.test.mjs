import { test } from "node:test";
import assert from "node:assert/strict";
import { stringToHex } from "viem";
import {
  discoverLaunches,
  REGISTRIES,
  validateSnapshot,
} from "../src/lib/discovery.ts";
import { loadWallet } from "../src/lib/sweep.ts";
import { fmtAmount } from "../src/lib/format.ts";
const A = "0x1111111111111111111111111111111111111111",
  B = "0x2222222222222222222222222222222222222222",
  USER = "0x3333333333333333333333333333333333333333";
const HASH = "0x" + "ab".repeat(32);
const record = (address, n) => ({
  address,
  launchNumber: n,
  blockNumber: 90,
  transactionHash: HASH,
});
const snapshot = () => ({
  version: 1,
  chainId: 1,
  blockNumber: 100,
  blockHash: HASH,
  registries: REGISTRIES.map((r) => ({ ...r, count: 1 })),
  tokens: [record(A, 1), record(B, 2)],
});
function fixture({
  balances = { [A]: 1234567n, [B]: 0n },
  decimals = { [A]: 6, [B]: 18 },
  failure = [],
  registered = false,
} = {}) {
  const client = {
    getChainId: async () => 1,
    getBlockNumber: async () => 120n,
    getBlock: async () => ({ hash: HASH }),
    readContract: async ({ address, functionName, args }) => {
      if (functionName === "count") return 1n;
      if (functionName === "writer")
        return REGISTRIES.find((r) => r.address === address).factory;
      if (functionName === "paused") return false;
      if (functionName === "MAX_TOKENS_PER_SALE") return 50n;
      if (functionName === "minImdOut") return 1n;
      if (functionName === "heldRefunds") return 0n;
      if (functionName === "symbol") return "COIN";
      if (functionName === "decimals") {
        if (decimals[address] === null) throw Error("decimals reverted");
        return decimals[address];
      }
      if (functionName === "balanceOf") {
        if (failure.includes(address)) throw Error("balance failed");
        return balances[address];
      }
      if (functionName === "tokenRoute") return { venue: 0, tokenOut: A };
      if (functionName === "ethUsdPrice") throw Error("not configured");
      throw Error("Unexpected read " + functionName + " " + args);
    },
    multicall: async ({ contracts }) =>
      Promise.all(
        contracts.map(async (c) => {
          try {
            return { status: "success", result: await client.readContract(c) };
          } catch (error) {
            return { status: "failure", error };
          }
        }),
      ),
    simulateContract: async ({ functionName, args }) => {
      if (functionName === "quoteImdInBridge") throw Error("no price");
      if (functionName === "preview")
        return {
          result: args[1].map((token) => ({
            token,
            balance: registered ? balances[token] : 0n,
            expectedImd: 0n,
            sellable: false,
            status: registered ? 3 : 1,
          })),
        };
      throw Error("Unexpected simulation " + functionName);
    },
  };
  return client;
}
test("official history is deduplicated by address, never by symbol", async () => {
  const s = snapshot();
  s.tokens.push(record(A, 1));
  const d = await discoverLaunches(fixture(), s);
  assert.equal(d.tokens.length, 2);
});
test("positive holding remains visible when the sale registry is empty", async () => {
  const state = await loadWallet(fixture(), USER, { snapshot: snapshot() });
  assert.equal(state.tokens.length, 1);
  assert.equal(state.tokens[0].address, A);
  assert.equal(state.tokens[0].balance, 1234567n);
  assert.equal(
    fmtAmount(state.tokens[0].balance, state.tokens[0].decimals),
    "1.234567",
  );
  assert.equal(state.tokens[0].sellable, false);
  assert.equal(state.registered, 0);
  assert.equal(state.complete, true);
});
test("positive tokens without sell routes are retained and disabled", async () => {
  const s = await loadWallet(fixture({ registered: true }), USER, {
    snapshot: snapshot(),
  });
  assert.equal(s.tokens[0].status, 3);
  assert.equal(s.tokens[0].sellable, false);
});
test("zero balances produce a complete empty wallet only after successful reads", async () => {
  const s = await loadWallet(
    fixture({ balances: { [A]: 0n, [B]: 0n } }),
    USER,
    { snapshot: snapshot() },
  );
  assert.deepEqual(s.tokens, []);
  assert.equal(s.complete, true);
  assert.equal(s.balancesRead, 2);
});
test("failed balances never become a zero-token success", async () => {
  await assert.rejects(
    loadWallet(fixture({ failure: [A, B] }), USER, { snapshot: snapshot() }),
    /no token balances/,
  );
});
test("one failed balance marks partial discovery while keeping successful holdings", async () => {
  const s = await loadWallet(fixture({ failure: [B] }), USER, {
    snapshot: snapshot(),
  });
  assert.equal(s.tokens.length, 1);
  assert.equal(s.complete, false);
  assert.match(s.warnings.join(" "), /1 token balance reads failed/);
});
test("decimals failure shows raw units instead of assuming 18", async () => {
  const s = await loadWallet(
    fixture({ decimals: { [A]: null, [B]: 18 } }),
    USER,
    { snapshot: snapshot() },
  );
  assert.equal(s.tokens[0].decimals, null);
  assert.equal(fmtAmount(s.tokens[0].balance, null), "1234567 raw units");
  assert.equal(s.tokens[0].sellable, false);
  assert.equal(s.complete, false);
});
test("decimal formatting is exact for zero, six, twenty-four and 255 decimals", () => {
  assert.equal(
    fmtAmount(123456789012345678901234567890n, 0),
    "123,456,789,012,345,678,901,234,567,890",
  );
  assert.equal(fmtAmount(1000001n, 6), "1.000001");
  assert.equal(
    fmtAmount(1000000000000000000000001n, 24),
    "1.000000000000000000000001",
  );
  assert.equal(fmtAmount(1n, 255), "0." + "0".repeat(254) + "1");
});
test("RPC chain mismatch blocks discovery", async () => {
  const c = fixture();
  c.getChainId = async () => 8453;
  await assert.rejects(
    loadWallet(c, USER, { snapshot: snapshot() }),
    /Wrong RPC chain/,
  );
});
test("snapshot hash mismatch fails closed", async () => {
  const c = fixture();
  c.getBlock = async () => ({ hash: "0x" + "cd".repeat(32) });
  await assert.rejects(discoverLaunches(c, snapshot()), /block hash/);
});
test("invalid snapshot provenance is rejected", () => {
  const s = snapshot();
  s.tokens[0].address = "0x123";
  assert.throws(() => validateSnapshot(s), /provenance/);
});
test("multicall transport failure falls back to isolated token reads", async () => {
  const c = fixture();
  c.multicall = async () => {
    throw Error("provider rejects multicall");
  };
  const s = await loadWallet(c, USER, { snapshot: snapshot() });
  assert.equal(s.tokens[0].balance, 1234567n);
  assert.equal(s.complete, true);
});
test("route RPC failure preserves balances and reports incomplete data", async () => {
  const c = fixture();
  c.simulateContract = async () => {
    throw Error("RPC offline");
  };
  const s = await loadWallet(c, USER, { snapshot: snapshot() });
  assert.equal(s.tokens.length, 1);
  assert.equal(s.complete, false);
  assert.match(s.tokens[0].readError, /Sell route unavailable/);
});
test("new launches use registry event and token role, excluding hooks", async () => {
  const c = fixture(),
    read = c.readContract,
    C = "0x4444444444444444444444444444444444444444";
  c.readContract = async (x) =>
    x.functionName === "count" && x.address === REGISTRIES[0].address
      ? 2n
      : x.functionName === "artifactsOf"
        ? [
            {
              role: stringToHex("token", { size: 32 }),
              name: stringToHex("X", { size: 32 }),
              addr: C,
            },
            { role: stringToHex("hook", { size: 32 }), addr: USER },
          ]
        : read(x);
  c.getLogs = async () => [
    {
      args: { launchNumber: 3n, artifacts: [C, USER] },
      transactionHash: HASH,
      blockNumber: 110n,
      removed: false,
    },
  ];
  const d = await discoverLaunches(c, snapshot());
  assert.equal(d.tokens.length, 3);
  assert.ok(d.tokens.some((t) => t.address === C));
  assert.ok(!d.tokens.some((t) => t.address === USER));
  assert.deepEqual(d.warnings, []);
});
test("silent log truncation is detected by comparing registry count", async () => {
  const c = fixture(),
    read = c.readContract;
  c.readContract = async (x) => (x.functionName === "count" ? 2n : read(x));
  c.getLogs = async () => [];
  const d = await discoverLaunches(c, snapshot());
  assert.equal(d.tokens.length, 2);
  assert.equal(d.warnings.length, 2);
  assert.match(d.warnings[0], /count mismatch/);
});
test("registry RPC failure retains historical records as partial coverage", async () => {
  const c = fixture(),
    read = c.readContract;
  c.readContract = async (x) => {
    if (x.functionName === "count") throw Error("offline");
    return read(x);
  };
  const s = await loadWallet(c, USER, { snapshot: snapshot() });
  assert.equal(s.tokens.length, 1);
  assert.equal(s.complete, false);
});

test("unreadable sale settings are unknown, not an invented paused state", async () => {
  const c = fixture(),
    read = c.readContract;
  c.readContract = async (x) => {
    if (x.functionName === "paused") throw Error("offline");
    return read(x);
  };
  const s = await loadWallet(c, USER, { snapshot: snapshot() });
  assert.equal(s.paused, null);
  assert.equal(s.tokens.length, 1);
  assert.equal(s.tokens[0].sellable, false);
  assert.equal(s.complete, false);
  assert.match(s.tokens[0].readError, /Sale settings/);
});
