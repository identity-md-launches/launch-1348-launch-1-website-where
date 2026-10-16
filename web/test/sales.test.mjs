import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import {
  planSale,
  executeSale,
  feeSplit,
  claimRefund,
} from "../src/lib/sweep.ts";
import { swarmExitAbi } from "../src/abi/swarmExit.ts";
import { SWARM_EXIT_ADDRESS } from "../src/deployment.ts";
const USER = "0x3333333333333333333333333333333333333333",
  A = "0x1111111111111111111111111111111111111111",
  B = "0x2222222222222222222222222222222222222222";
const HASH = "0x" + "ab".repeat(32);
const token = (address = A) => ({
  address,
  symbol: "TEST",
  decimals: 6,
  balance: 1234567n,
  expectedImd: 100000n,
  sellable: true,
  status: 0,
  route: { venue: 3, tokenOut: A },
  routeLabel: "test route",
  heldRefund: 0n,
});
const plan = (items = [token()]) => ({
  account: USER,
  items: items.map((token) => ({ token, imdOut: 100000n })),
  excluded: [],
  gross: 100000n * BigInt(items.length),
  ...feeSplit(100000n * BigInt(items.length)),
  requiresApproval: false,
  gasWei: 1n,
  gasNote: "",
});
function harness({
  allowance = 1234567n,
  receiptStatus = "success",
  eventAddress = SWARM_EXIT_ADDRESS,
  eventUser = USER,
} = {}) {
  const writes = [],
    allowances = new Map();
  const client = {
    getChainId: async () => 1,
    getGasPrice: async () => 10n,
    estimateContractGas: async () => 100000n,
    readContract: async ({ address, functionName }) => {
      if (functionName === "allowance")
        return allowances.get(address) ?? allowance;
      if (functionName === "balanceOf") return 1234567n;
      throw Error("Unexpected " + functionName);
    },
    simulateContract: async ({ args }) => ({
      result: [
        args[0].map((token) => ({
          token,
          amountIn: 1234567n,
          imdOut: 100000n,
          status: 0,
        })),
        100000n,
        2000n,
        98000n,
      ],
    }),
    waitForTransactionReceipt: async () => ({
      status: receiptStatus,
      logs: [
        {
          address: eventAddress,
          topics: encodeEventTopics({
            abi: swarmExitAbi,
            eventName: "TokenSold",
            args: { user: eventUser, token: A },
          }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [1234567n, 100000n],
          ),
        },
      ],
    }),
  };
  const wallet = {
    chain: { id: 1 },
    getChainId: async () => 1,
    getAddresses: async () => [USER],
    writeContract: async (x) => {
      writes.push(x);
      if (x.functionName === "approve") allowances.set(x.address, x.args[1]);
      return HASH;
    },
  };
  return { client, wallet, writes };
}
test("fee is exactly floor(2% of successful gross), including zero", () => {
  assert.deepEqual(feeSplit(0n), { fee: 0n, net: 0n });
  assert.deepEqual(feeSplit(10001n), { fee: 200n, net: 9801n });
});
test("pre-approval preview explicitly says approval is required and has no invented gas", async () => {
  const { client } = harness({ allowance: 0n });
  client.simulateContract = async () => {
    throw Error("must not simulate without allowance");
  };
  const p = await planSale(client, USER, [token()], 1n);
  assert.equal(p.requiresApproval, true);
  assert.equal(p.gasWei, null);
});
test("failed sale simulation rejects instead of substituting old quotes", async () => {
  const { client } = harness();
  client.simulateContract = async () => {
    throw Error("RPC offline");
  };
  await assert.rejects(planSale(client, USER, [token()], 1n), /RPC offline/);
});
test("failed outcomes are excluded and never charged a preview fee", async () => {
  const { client } = harness();
  client.simulateContract = async () => ({
    result: [[{ token: A, status: 7, imdOut: 0n, amountIn: 0n }], 0n, 0n, 0n],
  });
  const p = await planSale(client, USER, [token()], 1n);
  assert.equal(p.items.length, 0);
  assert.equal(p.excluded.length, 1);
  assert.equal(p.fee, 0n);
});
test("gas estimate uses RPC gas units times gas price", async () => {
  const { client } = harness();
  const p = await planSale(client, USER, [token()], 1n);
  assert.equal(p.gasWei, 1000000n);
});
test("chain switch prevents every signature", async () => {
  const { client, wallet, writes } = harness();
  wallet.getChainId = async () => 8453;
  await assert.rejects(
    executeSale(wallet, client, USER, plan(), 50, () => {}),
    /Switch to Ethereum/,
  );
  assert.equal(writes.length, 0);
});
test("changed account invalidates the confirmation", async () => {
  const { client, wallet, writes } = harness();
  wallet.getAddresses = async () => [B];
  await assert.rejects(
    executeSale(wallet, client, USER, plan(), 50, () => {}),
    /account changed/,
  );
  assert.equal(writes.length, 0);
});
test("approval receipts are checked and a reverted approval sends no sale", async () => {
  const { client, wallet, writes } = harness({
    allowance: 0n,
    receiptStatus: "reverted",
  });
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].functionName, "approve");
  assert.equal(r.get(A).kind, "unsold");
});
test("nonzero insufficient allowance is reset then set to exact balance", async () => {
  const { client, wallet, writes } = harness({ allowance: 1n });
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(writes.length, 3);
  assert.equal(writes[0].args[1], 0n);
  assert.equal(writes[1].args[1], 1234567n);
  assert.equal(writes[2].functionName, "sellAll");
  assert.equal(writes[2].args[1][0], 97000n);
  assert.equal(r.get(A).kind, "sold");
});
test("reverted sale is unsold and never a fabricated success", async () => {
  const { client, wallet } = harness({ receiptStatus: "reverted" });
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(r.get(A).kind, "unsold");
  assert.match(r.get(A).reason, /no sale fee/);
});
test("receipt timeout remains pending and blocks a second batch", async () => {
  const { client, wallet, writes } = harness();
  client.waitForTransactionReceipt = async () => {
    throw Error("timeout");
  };
  const r = await executeSale(
    wallet,
    client,
    USER,
    plan([token(), token(B)]),
    1,
    () => {},
  );
  assert.equal(r.get(A).kind, "pending");
  assert.equal(r.get(B).kind, "unsold");
  assert.equal(writes.length, 1);
});
test("forged TokenSold events from another emitter do not show Sold", async () => {
  const { client, wallet } = harness({ eventAddress: B });
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(r.get(A).kind, "pending");
});
test("another users event cannot claim success", async () => {
  const { client, wallet } = harness({ eventUser: B });
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(r.get(A).kind, "pending");
});
test("post-approval simulation failure sends no sale transaction", async () => {
  const { client, wallet, writes } = harness({ allowance: 0n });
  client.simulateContract = async () => {
    throw Error("liquidity changed");
  };
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].functionName, "approve");
  assert.equal(r.get(A).kind, "unsold");
});
test("later batch rejection preserves confirmed earlier results", async () => {
  const { client, wallet } = harness();
  const write = wallet.writeContract;
  let n = 0;
  wallet.writeContract = async (x) => {
    if (++n === 2) throw Error("user rejected");
    return write(x);
  };
  const r = await executeSale(
    wallet,
    client,
    USER,
    plan([token(), token(B)]),
    1,
    () => {},
  );
  assert.equal(r.get(A).kind, "sold");
  assert.equal(r.get(B).kind, "unsold");
});
test("reverted refund receipt does not report claimed", async () => {
  const { client, wallet } = harness({ receiptStatus: "reverted" });
  await assert.rejects(claimRefund(wallet, client, USER, A), /reverted/);
});
test("sale preview batches large selections within the contract limit", async () => {
  const { client } = harness();
  const simulate = client.simulateContract;
  const batches = [];
  client.simulateContract = async (x) => {
    batches.push(x.args[0].length);
    return simulate(x);
  };
  const chosen = Array.from({ length: 51 }, (_, i) =>
    token("0x" + (i + 1).toString(16).padStart(40, "0")),
  );
  const p = await planSale(client, USER, chosen, 1n, 50);
  assert.deepEqual(batches, [50, 1]);
  assert.equal(p.items.length, 51);
});

test("changed balance cannot sell an amount absent from the preview", async () => {
  const { client, wallet, writes } = harness();
  const read = client.readContract;
  client.readContract = async (x) =>
    x.functionName === "balanceOf" ? 2000000n : read(x);
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(writes.length, 0);
  assert.match(r.get(A).reason, /balance changed/);
});

function refundLog(eventName, { user = USER, token = A, address = SWARM_EXIT_ADDRESS } = {}) {
  return {
    address,
    topics: encodeEventTopics({ abi: swarmExitAbi, eventName, args: { user, token } }),
    data: eventName === "TokenRefunded"
      ? encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [1234567n, "0x"])
      : encodeAbiParameters([{ type: "uint256" }], [1234567n]),
  };
}

for (const order of [["RefundHeld", "TokenRefunded"], ["TokenRefunded", "RefundHeld"]]) {
  test(`held refund takes precedence with events in order: ${order.join(", ")}`, async () => {
    const { client, wallet } = harness();
    client.waitForTransactionReceipt = async () => ({
      status: "success",
      logs: [
        ...order.map((eventName) => refundLog(eventName)),
        {
          address: SWARM_EXIT_ADDRESS,
          topics: encodeEventTopics({ abi: swarmExitAbi, eventName: "TokenSold", args: { user: USER, token: B } }),
          data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1234567n, 100000n]),
        },
      ],
    });
    const r = await executeSale(wallet, client, USER, plan([token(), token(B)]), 50, () => {});
    assert.equal(r.get(A).kind, "unsold");
    assert.equal(r.get(A).held, true);
    assert.equal(r.get(A).reason, "Token refused the refund. Claim it below.");
    assert.equal(r.get(A).txHash, HASH);
    assert.deepEqual(r.get(B), { kind: "sold", imdOut: 100000n, txHash: HASH });
  });
}

test("successful refund is not marked held by unrelated RefundHeld logs", async () => {
  const { client, wallet } = harness();
  client.waitForTransactionReceipt = async () => ({
    status: "success",
    logs: [
      refundLog("TokenRefunded"),
      refundLog("RefundHeld", { address: B }),
      refundLog("RefundHeld", { user: B }),
      refundLog("RefundHeld", { token: B }),
    ],
  });
  const r = await executeSale(wallet, client, USER, plan(), 50, () => {});
  assert.equal(r.get(A).kind, "unsold");
  assert.notEqual(r.get(A).held, true);
  assert.match(r.get(A).reason, /tokens refunded/);
  assert.equal(r.size, 1);
});
