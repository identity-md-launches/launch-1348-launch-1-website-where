import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeAbiParameters,
  parseAbiParameters,
  encodeAbiParameters,
  encodeEventTopics,
} from "viem";
import {
  candidatePaths,
  findRoute,
  poolId,
  validatePools,
  POOL_MANAGER,
  PERMIT2,
  UNIVERSAL_ROUTER,
  MAX_INPUT,
  insufficientLiquidity,
} from "../src/lib/routes.ts";
import {
  saleCall,
  planDirectSale,
  executeDirectSale,
  transferAbi,
  minimumOut,
  resolvePending,
} from "../src/lib/directSale.ts";
import { IMD_ADDRESS, TREASURY_ADDRESS } from "../src/deployment.ts";
const A = "0x1111111111111111111111111111111111111111",
  B = "0x2222222222222222222222222222222222222222",
  USER = "0x3333333333333333333333333333333333333333",
  ZERO = "0x0000000000000000000000000000000000000000";
const HASH = "0x" + "ab".repeat(32);
const pool = (a, b) => {
  const [currency0, currency1] = [a, b].sort();
  const p = {
    currency0,
    currency1,
    fee: 12500,
    tickSpacing: 60,
    hooks: ZERO,
    blockNumber: 1,
    transactionHash: HASH,
  };
  return { ...p, id: poolId(p) };
};
const route = {
  pools: [pool(A, IMD_ADDRESS)],
  amountIn: 1000n,
  amountOut: 10000n,
  blockNumber: 10n,
  quotedAt: Date.now(),
};
const token = (address = A) => ({
  address,
  symbol: "TEST",
  balance: 1000n,
  decimals: 18,
  expectedImd: 10000n,
  sellable: true,
  liveRoute: { ...route, pools: [pool(address, IMD_ADDRESS)] },
});
function harness({ needsApproval = false } = {}) {
  const writes = [];
  let erc = needsApproval ? 0n : 1000n,
    permit = needsApproval ? 0n : 1000n;
  let expiry = Math.floor(Date.now() / 1000) + 3600;
  const client = {
    getChainId: async () => 1,
    getBlockNumber: async () => 10n,
    getGasPrice: async () => 2n,
    estimateContractGas: async () => 500n,
    readContract: async ({ address, functionName }) =>
      functionName === "balanceOf"
        ? 1000n
        : address === PERMIT2
          ? [permit, expiry, 0]
          : erc,
    simulateContract: async ({ functionName }) =>
      functionName === "quoteExactInput"
        ? { result: [10000n, 100n] }
        : { result: undefined },
    waitForTransactionReceipt: async () => ({
      status: "success",
      logs: [
        {
          address: IMD_ADDRESS,
          topics: encodeEventTopics({
            abi: transferAbi,
            eventName: "Transfer",
            args: { from: POOL_MANAGER, to: USER },
          }),
          data: encodeAbiParameters([{ type: "uint256" }], [9800n]),
        },
        {
          address: IMD_ADDRESS,
          topics: encodeEventTopics({
            abi: transferAbi,
            eventName: "Transfer",
            args: { from: POOL_MANAGER, to: TREASURY_ADDRESS },
          }),
          data: encodeAbiParameters([{ type: "uint256" }], [200n]),
        },
      ],
    }),
  };
  const wallet = {
    chain: { id: 1 },
    getChainId: async () => 1,
    getAddresses: async () => [USER],
    writeContract: async (call) => {
      writes.push(call);
      if (call.functionName === "approve") {
        if (call.address === PERMIT2) {
          permit = call.args[2];
          expiry = call.args[3];
        } else erc = call.args[1];
      }
      return HASH;
    },
  };
  return { client, wallet, writes };
}
test("route graph connects direct, ETH bridge and three-hop paths without cycles", () => {
  const paths = candidatePaths(A, [
    pool(A, IMD_ADDRESS),
    pool(A, ZERO),
    pool(ZERO, IMD_ADDRESS),
    pool(ZERO, B),
    pool(B, IMD_ADDRESS),
  ]);
  assert.ok(paths.some((p) => p.length === 1));
  assert.ok(paths.some((p) => p.length === 2));
  assert.ok(paths.some((p) => p.length === 3));
  assert.ok(paths.every((p) => new Set(p.map((x) => x.id)).size === p.length));
});
test("forged pool key, duplicate id, wrong chain and future provenance are refused", () => {
  const s = {
    version: 1,
    chainId: 1,
    blockNumber: 10,
    blockHash: HASH,
    pools: route.pools,
  };
  validatePools(s);
  assert.throws(() => validatePools({ ...s, chainId: 8453 }));
  assert.throws(() =>
    validatePools({ ...s, pools: [{ ...route.pools[0], fee: 3000 }] }),
  );
  assert.throws(() =>
    validatePools({ ...s, pools: [...route.pools, ...route.pools] }),
  );
  assert.throws(() =>
    validatePools({ ...s, pools: [{ ...route.pools[0], blockNumber: 11 }] }),
  );
});
test("live route discovery has no registry or SwarmExit dependency", async () => {
  const { client } = harness();
  client.readContract = async () => {
    throw Error("Registry must not be read");
  };
  const result = await findRoute(client, USER, A, 1000n, route.pools, 10n);
  assert.equal(result.route.amountOut, 10000n);
});
test("no path, reverted quote and RPC outage remain distinct", async () => {
  const { client } = harness();
  assert.match(
    (await findRoute(client, USER, A, 1000n, [], 10n)).reason,
    /No connected/,
  );
  client.simulateContract = async () => {
    throw Error("execution reverted");
  };
  assert.equal(
    (await findRoute(client, USER, A, 1000n, route.pools, 10n)).incomplete,
    false,
  );
  client.simulateContract = async () => {
    throw Error("HTTP timeout");
  };
  assert.equal(
    (await findRoute(client, USER, A, 1000n, route.pools, 10n)).incomplete,
    true,
  );
});
test("route search continues beyond 24 candidates and reports progress without concurrent quotes", async () => {
  const pools = Array.from({ length: 49 }, (_, i) => {
    const p = { ...pool(A, IMD_ADDRESS), fee: 100 + i };
    return { ...p, id: poolId(p), liquidity: 1000000n };
  });
  const ordered = candidatePaths(A, pools);
  const { client } = harness();
  const attempted = [];
  const progress = [];
  let active = 0;
  client.simulateContract = async ({ args }) => {
    assert.equal(++active, 1);
    attempted.push(args[0].path[0].fee);
    await new Promise(resolve => setTimeout(resolve, 0));
    active--;
    if (args[0].path[0].fee !== ordered[48][0].fee) throw Error("execution reverted");
    return { result: [10000n, 1n] };
  };
  const result = await findRoute(client, USER, A, 1000n, pools, 10n, (checked, total) => progress.push([checked, total]));
  assert.equal(result.route.amountOut, 10000n);
  assert.equal(result.incomplete, false);
  assert.deepEqual(attempted, ordered.map(path => path[0].fee));
  assert.deepEqual(progress, pools.map((_, i) => [i + 1, 49]));
});
test("a search exhausted after multiple batches is complete; late RPC failures remain incomplete", async () => {
  const pools = Array.from({ length: 25 }, (_, i) => {
    const p = { ...pool(A, IMD_ADDRESS), fee: 100 + i };
    return { ...p, id: poolId(p) };
  });
  const { client } = harness();
  let calls = 0;
  client.simulateContract = async () => { calls++; throw Error("execution reverted"); };
  let result = await findRoute(client, USER, A, 1000n, pools, 10n);
  assert.equal(calls, 25);
  assert.equal(result.incomplete, false);
  assert.match(result.reason, /no live quote/);
  calls = 0;
  client.simulateContract = async () => { throw Error(++calls === 25 ? "HTTP timeout" : "execution reverted"); };
  result = await findRoute(client, USER, A, 1000n, pools, 10n);
  assert.equal(calls, 25);
  assert.equal(result.incomplete, true);
  assert.match(result.reason, /Live quote unavailable/);
});
test("successful early quote stops discovery before later paths", async () => {
  const pools = Array.from({ length: 25 }, (_, i) => {
    const p = { ...pool(A, IMD_ADDRESS), fee: 100 + i };
    return { ...p, id: poolId(p) };
  });
  const { client } = harness();
  let calls = 0;
  client.simulateContract = async () => { calls++; return { result: [10000n, 1n] }; };
  await findRoute(client, USER, A, 1000n, pools, 10n);
  assert.equal(calls, 1);
});
test("insufficient full-balance liquidity yields an explicit smaller quoted amount", async () => {
  const { client } = harness();
  const error = {
    raw:
      "0x6190b2b0" +
      encodeAbiParameters(
        [{ type: "bytes" }],
        ["0x7a5ed734" + HASH.slice(2)],
      ).slice(2),
  };
  assert.equal(insufficientLiquidity(error), true);
  client.simulateContract = async ({ args }) => {
    if (args[0].exactAmount > 250n) throw error;
    return { result: [100n, 1n] };
  };
  const r = await findRoute(client, USER, A, 1000n, route.pools, 10n);
  assert.equal(r.route.amountIn, 250n);
});
test("encoded swap atomically settles exact input, takes 2% credit and transfers net to sender", () => {
  const c = saleCall(USER, A, route, 9700n, 123n);
  assert.equal(c.address, UNIVERSAL_ROUTER);
  assert.equal(c.value, 0n);
  assert.equal(c.args[0], "0x10");
  const [actions, params] = decodeAbiParameters(
    parseAbiParameters("bytes,bytes[]"),
    c.args[1][0],
  );
  assert.equal(actions, "0x070c100f");
  const [currency, amount] = decodeAbiParameters(
    parseAbiParameters("address,uint256"),
    params[1],
  );
  assert.equal(currency.toLowerCase(), A);
  assert.equal(amount, 1000n);
  const [imd, treasury, fee] = decodeAbiParameters(
    parseAbiParameters("address,address,uint256"),
    params[2],
  );
  assert.equal(imd.toLowerCase(), IMD_ADDRESS);
  assert.equal(treasury.toLowerCase(), TREASURY_ADDRESS.toLowerCase());
  assert.equal(fee, 200n);
  assert.equal(
    decodeAbiParameters(parseAbiParameters("address,uint256"), params[3])[1],
    9506n,
  );
  assert.equal(minimumOut(1n), 1n);
  assert.throws(() =>
    saleCall(USER, A, { ...route, amountIn: MAX_INPUT + 1n }, 1n, 123n),
  );
});
test("review deduplicates tokens, refreshes quotes and preserves partial amounts", async () => {
  const { client } = harness();
  let amount;
  client.simulateContract = async (c) => {
    if (c.functionName === "quoteExactInput") {
      amount = c.args[0].exactAmount;
      return { result: [10000n, 1n] };
    }
    return { result: undefined };
  };
  const t = { ...token(), liveRoute: { ...route, amountIn: 250n } };
  const p = await planDirectSale(client, USER, [t, t]);
  assert.equal(p.items.length, 1);
  assert.equal(amount, 250n);
  assert.equal(p.gasWei, 1000n);
});
test("changed balance excludes a token before approval", async () => {
  const { client } = harness();
  client.readContract = async () => 999n;
  const p = await planDirectSale(client, USER, [token()]);
  assert.equal(p.items.length, 0);
  assert.match(p.excluded[0].reason, /Balance changed/);
});
test("exact Permit2 and router approvals precede a fully simulated sale", async () => {
  const { client, wallet, writes } = harness({ needsApproval: true });
  const p = await planDirectSale(client, USER, [token()]);
  assert.equal(p.requiresApproval, true);
  assert.equal(p.gasWei, null);
  const r = await executeDirectSale(wallet, client, USER, p, () => {});
  assert.equal(r.get(A).kind, "sold");
  assert.equal(writes.length, 3);
  assert.equal(writes[0].args[0], PERMIT2);
  assert.equal(writes[0].args[1], 1000n);
  assert.equal(writes[1].args[1], UNIVERSAL_ROUTER);
  assert.equal(writes[1].args[2], 1000n);
  assert.ok(writes[1].args[3] <= Math.floor(Date.now() / 1000) + 600);
});
test("price deterioration never lowers the reviewed slippage floor", async () => {
  const { client, wallet, writes } = harness();
  const p = await planDirectSale(client, USER, [token()]);
  client.simulateContract = async () => ({ result: [9600n, 1n] });
  const r = await executeDirectSale(wallet, client, USER, p, () => {});
  assert.equal(writes.length, 0);
  assert.match(r.get(A).reason, /below the reviewed/);
});
test("failed full execution simulation sends no sale", async () => {
  const { client, wallet, writes } = harness();
  const p = await planDirectSale(client, USER, [token()]);
  client.simulateContract = async (c) => {
    if (c.functionName === "execute") throw Error("Hook rejects this sender");
    return { result: [10000n, 1n] };
  };
  const r = await executeDirectSale(wallet, client, USER, p, () => {});
  assert.equal(writes.length, 0);
  assert.equal(r.get(A).kind, "unsold");
});
test("wrong chain and account changes stop signatures", async () => {
  const { client, wallet, writes } = harness();
  const p = await planDirectSale(client, USER, [token()]);
  wallet.getChainId = async () => 8453;
  await assert.rejects(
    executeDirectSale(wallet, client, USER, p, () => {}),
    /Ethereum/,
  );
  wallet.getChainId = async () => 1;
  wallet.getAddresses = async () => [B];
  await assert.rejects(
    executeDirectSale(wallet, client, USER, p, () => {}),
    /account changed/,
  );
  assert.equal(writes.length, 0);
});
test("approval timeout stays pending and stops subsequent prompts", async () => {
  const { client, wallet, writes } = harness({ needsApproval: true });
  const p = await planDirectSale(client, USER, [token(), token(B)]);
  client.waitForTransactionReceipt = async () => {
    throw Error("timeout");
  };
  const r = await executeDirectSale(wallet, client, USER, p, () => {});
  assert.equal(r.get(A).kind, "pending");
  assert.equal(r.get(B).kind, "unsold");
  assert.equal(writes.length, 1);
});
test("reverted receipt is unsold; spoofed transfer source is never counted", async () => {
  const { client, wallet } = harness();
  const p = await planDirectSale(client, USER, [token()]);
  client.waitForTransactionReceipt = async () => ({
    status: "reverted",
    logs: [],
  });
  const r = await executeDirectSale(wallet, client, USER, p, () => {});
  assert.equal(r.get(A).kind, "unsold");
  client.waitForTransactionReceipt = async () => ({
    status: "success",
    logs: [
      {
        address: A,
        topics: encodeEventTopics({
          abi: transferAbi,
          eventName: "Transfer",
          args: { from: POOL_MANAGER, to: USER },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [9800n]),
      },
    ],
  });
  assert.equal(
    (await executeDirectSale(wallet, client, USER, p, () => {})).get(A).kind,
    "pending",
  );
});
test("confirmed earlier sale survives a later wallet rejection", async () => {
  const { client, wallet } = harness();
  const p = await planDirectSale(client, USER, [token(), token(B)]);
  const write = wallet.writeContract;
  let count = 0;
  wallet.writeContract = async (x) => {
    if (++count === 2) throw Error("User rejected");
    return write(x);
  };
  const r = await executeDirectSale(wallet, client, USER, p, () => {});
  assert.equal(r.get(A).kind, "sold");
  assert.equal(r.get(B).kind, "unsold");
});
test("refresh reconciles pending approvals and sales without inventing confirmation", async () => {
  const { client } = harness();
  const pending = {
    kind: "pending",
    phase: "sale",
    txHash: HASH,
    reason: "Awaiting receipt",
  };
  client.getTransactionReceipt = async () => {
    throw Error("not found");
  };
  assert.deepEqual(await resolvePending(client, USER, pending), pending);
  client.getTransactionReceipt = client.waitForTransactionReceipt;
  assert.equal((await resolvePending(client, USER, pending)).kind, "sold");
  assert.equal(
    await resolvePending(client, USER, { ...pending, phase: "approval" }),
    undefined,
  );
  client.getTransactionReceipt = async () => ({ status: "reverted", logs: [] });
  assert.equal((await resolvePending(client, USER, pending)).kind, "unsold");
});
