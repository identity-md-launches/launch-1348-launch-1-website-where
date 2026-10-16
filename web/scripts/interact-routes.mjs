// Interaction validation for the SwarmSweep export (run after `npm run build`, from web/:
// `node --experimental-strip-types scripts/interact.mjs`). Serves dist/ on a local port inside this
// process, routes the public RPC to a JSON-RPC mock of SwarmExit and four tokens, injects an
// EIP-6963 wallet, and walks: load, connect, sell all, confirm, approvals, sale, sold/unsold marks.
// Playwright is not a project dependency: set IMD_PLAYWRIGHT to a Playwright index.mjs (for
// example from an npx cache) or have `playwright` importable. Screenshots go to test/scratch/interact-routes.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT = path.join(ROOT, "test/scratch/interact-routes");
fs.mkdirSync(OUT, { recursive: true });
const viem = await import(
  pathToFileURL(path.join(ROOT, "web/node_modules/viem/_esm/index.js")).href
);
const { chromium } = await import(
  process.env.IMD_PLAYWRIGHT
    ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href
    : "playwright"
);
const { swarmExitAbi } = await import(
  pathToFileURL(path.join(ROOT, "web/src/abi/swarmExit.ts")).href
);
const { erc20Abi } = await import(
  pathToFileURL(path.join(ROOT, "web/src/abi/erc20.ts")).href
);
const {
  parseAbi,
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseUnits,
  getAddress,
  keccak256,
  toHex,
} = viem;

const {
  poolId,
  POOL_MANAGER,
  V4_QUOTER,
  STATE_VIEW,
  stateAbi,
  quoterAbi,
  PERMIT2,
  UNIVERSAL_ROUTER,
} = await import("../src/lib/routes.ts");
const { routerAbi, permitAbi, transferAbi } = await import(
  "../src/lib/directSale.ts"
);
const { TREASURY_ADDRESS } = await import("../src/deployment.ts");
const ZERO = "0x0000000000000000000000000000000000000000";
const EXIT = "0x5c3c2a6d7d340db9f8b3e0cbbc8dbbb7ec73bc61";
const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USER = "0x1000000000000000000000000000000000000001";
const T = {
  alpha: "0x1111111111111111111111111111111111111111", // sellable, v4 to IMD
  beta: "0x2222222222222222222222222222222222222222", // sellable, V2 to WETH; fails on chain and is refunded
  gamma: "0x3333333333333333333333333333333333333333", // no route configured
  delta: "0x4444444444444444444444444444444444444444", // route but quote fails
  empty: "0x5555555555555555555555555555555555555555", // zero balance, not listed
};
const meta = {
  [T.alpha]: {
    symbol: "ALPHA",
    decimals: 18,
    balance: parseUnits("12500", 18),
    expected: parseUnits("100", 18),
    sellable: true,
    status: 0,
    route: [
      3,
      "0x000000000004444c5dc75cb358380d2e3de08a90",
      "0x0000000000000000000000000000000000000000",
      T.alpha,
      IMD,
    ],
  },
  [T.beta]: {
    symbol: "BETA",
    decimals: 18,
    balance: parseUnits("3.25", 18),
    expected: parseUnits("50", 18),
    sellable: true,
    status: 0,
    route: [
      1,
      "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      "0x0000000000000000000000000000000000000000",
      T.beta,
      WETH,
    ],
  },
  [T.gamma]: {
    symbol: "GAMMA",
    decimals: 18,
    balance: parseUnits("900000", 18),
    expected: 0n,
    sellable: false,
    status: 3,
    route: [
      0,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
    ],
  },
  [T.delta]: {
    symbol: "DELTA",
    decimals: 6,
    balance: 4200000000n,
    expected: 0n,
    sellable: false,
    status: 5,
    route: [
      2,
      "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
      "0x61ffe014ba17989e743c5f6cb21bf9697530b21e",
      T.delta,
      WETH,
    ],
  },
  [T.empty]: {
    symbol: "EMPTY",
    decimals: 18,
    balance: 0n,
    expected: 0n,
    sellable: false,
    status: 2,
    route: [
      0,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
    ],
  },
};
const tokens = Object.values(T);
const registryAbi = parseAbi([
  "function count() view returns(uint64)",
  "function writer() view returns(address)",
]);
const registryFactories = {
  "0xa47fcb220ddd1cddda865f89029bec1b9eca3bf1":
    "0x12c63b581d07093f6126bc02263c58f7eadaa96f",
  "0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23":
    "0xff03410d0fe5fa8f7f59f743de35e333d9857120",
};
const snapshot = {
  version: 1,
  chainId: 1,
  blockNumber: 1,
  blockHash: "0x" + "ab".repeat(32),
  registries: Object.entries(registryFactories).map(([address, factory]) => ({
    address,
    factory,
    count: 1,
  })),
  tokens: tokens.map((address, i) => ({
    address,
    launchNumber: i + 1,
    blockNumber: 1,
    transactionHash: "0x" + "ab".repeat(32),
  })),
};
const multiAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[] returnData)",
]);
const pool = (a, b) => {
  const [currency0, currency1] = [a, b].sort();
  const p = {
    currency0,
    currency1,
    fee: 12500,
    tickSpacing: 60,
    hooks: ZERO,
    blockNumber: 1,
    transactionHash: "0x" + "ab".repeat(32),
  };
  return { ...p, id: poolId(p) };
};
const poolSnapshot = {
  version: 1,
  chainId: 1,
  blockNumber: 16,
  blockHash: snapshot.blockHash,
  pools: [
    pool(T.alpha, IMD),
    pool(T.beta, ZERO),
    pool(ZERO, IMD),
    pool(T.delta, IMD),
  ],
};
const permits = new Map();
const allowances = new Map();
let readMode = "normal";
let delayBalances = false;
const calls = [];
let txCount = 0;
let saleTxHash = null;
const sent = [];

function ethCall({ to, data }) {
  const target = to.toLowerCase();
  if (target === "0xca11bde05977b3631167028862be2a173976ca11") {
    if (readMode === "aggregate-failure")
      throw Error("aggregate exceeds RPC gas cap");
    const { args } = decodeFunctionData({ abi: multiAbi, data });
    return encodeFunctionResult({
      abi: multiAbi,
      functionName: "aggregate3",
      result: args[0].map((c) => {
        try {
          return {
            success: true,
            returnData: ethCall({ to: c.target, data: c.callData }),
          };
        } catch {
          return { success: false, returnData: "0x" };
        }
      }),
    });
  }
  if (registryFactories[target]) {
    const { functionName } = decodeFunctionData({ abi: registryAbi, data });
    return encodeFunctionResult({
      abi: registryAbi,
      functionName,
      result: functionName === "count" ? 1n : registryFactories[target],
    });
  }
  if (target === STATE_VIEW) {
    const { functionName } = decodeFunctionData({ abi: stateAbi, data });
    return encodeFunctionResult({
      abi: stateAbi,
      functionName,
      result: 1000000n,
    });
  }
  if (target === V4_QUOTER) {
    const { functionName, args } = decodeFunctionData({ abi: quoterAbi, data });
    const t = args[0].exactCurrency.toLowerCase();
    if (readMode === "quote-offline") throw Error("RPC quote timeout");
    if (t === T.delta) throw Error("execution reverted");
    return encodeFunctionResult({
      abi: quoterAbi,
      functionName,
      result: [meta[t].expected, 100000n],
    });
  }
  if (target === PERMIT2) {
    const { functionName, args } = decodeFunctionData({ abi: permitAbi, data });
    return encodeFunctionResult({
      abi: permitAbi,
      functionName,
      result: permits.get(args[1].toLowerCase()) ?? [0n, 0, 0],
    });
  }
  if (target === UNIVERSAL_ROUTER) return "0x";
  if (target === EXIT) {
    const { functionName, args } = decodeFunctionData({
      abi: swarmExitAbi,
      data,
    });
    calls.push(functionName);
    const enc = (result) =>
      encodeFunctionResult({ abi: swarmExitAbi, functionName, result });
    switch (functionName) {
      case "paused":
        return enc(false);
      case "MAX_TOKENS_PER_SALE":
        return enc(50n);
      case "minImdOut":
        return enc(parseUnits("0.001", 18));
      case "preview":
        return enc(
          args[1].map((t) => ({
            token: getAddress(t),
            balance: meta[t.toLowerCase()].balance,
            expectedImd: meta[t.toLowerCase()].expected,
            sellable: meta[t.toLowerCase()].sellable,
            status: meta[t.toLowerCase()].status,
          })),
        );
      case "previewAll":
        return enc(
          tokens.map((t) => ({
            token: getAddress(t),
            balance: meta[t].balance,
            expectedImd: meta[t].expected,
            sellable: meta[t].sellable,
            status: meta[t].status,
          })),
        );
      case "heldRefunds":
        return enc(
          readMode === "held-refund" &&
            saleTxHash &&
            args[1].toLowerCase() === T.beta
            ? meta[T.beta].balance
            : 0n,
        );
      case "tokenRoute": {
        const r = meta[args[0].toLowerCase()].route;
        return enc({
          venue: r[0],
          router: getAddress(r[1]),
          quoter: getAddress(r[2]),
          tokenIn: getAddress(r[3]),
          tokenOut: getAddress(r[4]),
          data: "0x",
        });
      }
      case "quoteImdInBridge":
        return enc(parseUnits("0.0001", 18)); // 1 IMD = 0.0001 ETH
      case "ethUsdPrice":
        return enc([300000000000n, 8]); // $3000
      case "sellAll": {
        const list = args[0].map((a) => a.toLowerCase());
        const outcomes = list.map((t) => ({
          token: getAddress(t),
          amountIn: meta[t].balance,
          imdOut: meta[t].expected,
          status: 0,
        }));
        const gross = outcomes.reduce((s, o) => s + o.imdOut, 0n);
        const tax = (gross * 200n) / 10000n;
        return enc([outcomes, gross, tax, gross - tax]);
      }
      default:
        throw new Error(`unmocked SwarmExit call ${functionName}`);
    }
  }
  if (meta[target]) {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
    calls.push(`erc20.${functionName}`);
    const enc = (result) =>
      encodeFunctionResult({ abi: erc20Abi, functionName, result });
    if (functionName === "symbol") return enc(meta[target].symbol);
    if (functionName === "decimals") return enc(meta[target].decimals);
    if (functionName === "allowance") return enc(allowances.get(target) ?? 0n);
    if (functionName === "balanceOf") {
      if (
        readMode === "failure" ||
        (readMode === "partial" && target === T.beta)
      )
        throw Error("Balance RPC failure");
      if (readMode === "held-refund" && saleTxHash && target === T.beta)
        return enc(0n);
      return enc(
        readMode === "empty" || args[0].toLowerCase() !== USER
          ? 0n
          : meta[target].balance,
      );
    }
  }
  throw new Error(`unmocked eth_call to ${to}`);
}

function receiptFor(hash) {
  const tx = sent.find((t) => t.hash === hash);
  const logs = [];
  if (tx && tx.to.toLowerCase() === EXIT) {
    const log = (eventName, args, data) =>
      logs.push({
        address: EXIT,
        topics: encodeEventTopics({ abi: swarmExitAbi, eventName, args }),
        data,
        blockNumber: "0x10",
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash: "0x" + "ab".repeat(32),
        logIndex: toHex(logs.length),
        removed: false,
      });
    log(
      "TokenSold",
      { user: USER, token: T.alpha },
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        [meta[T.alpha].balance, meta[T.alpha].expected],
      ),
    );
    if (readMode === "held-refund")
      log(
        "RefundHeld",
        { user: USER, token: T.beta },
        encodeAbiParameters([{ type: "uint256" }], [meta[T.beta].balance]),
      );
    log(
      "TokenRefunded",
      { user: USER, token: T.beta },
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "bytes" }],
        [meta[T.beta].balance, "0x"],
      ),
    );
    log(
      "SoldAll",
      { user: USER },
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [
          meta[T.alpha].expected,
          meta[T.alpha].expected / 50n,
          meta[T.alpha].expected - meta[T.alpha].expected / 50n,
        ],
      ),
    );
  }
  if (tx && tx.to.toLowerCase() === UNIVERSAL_ROUTER) {
    const { args } = decodeFunctionData({ abi: routerAbi, data: tx.data });
    const [, actions] = viem.decodeAbiParameters(
      viem.parseAbiParameters("bytes,bytes[]"),
      args[1][0],
    );
    const [input] = viem.decodeAbiParameters(
      viem.parseAbiParameters("address,uint256"),
      actions[1],
    );
    const gross = meta[input.toLowerCase()].expected;
    for (const [to, amount] of [
      [USER, gross - gross / 50n],
      [TREASURY_ADDRESS, gross / 50n],
    ])
      logs.push({
        address: IMD,
        topics: encodeEventTopics({
          abi: transferAbi,
          eventName: "Transfer",
          args: { from: POOL_MANAGER, to },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [amount]),
        blockNumber: "0x10",
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash: snapshot.blockHash,
        logIndex: toHex(logs.length),
        removed: false,
      });
  }
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: "0x" + "ab".repeat(32),
    blockNumber: "0x10",
    from: USER,
    to: tx?.to ?? EXIT,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    contractAddress: null,
    logs,
    logsBloom: "0x" + "00".repeat(256),
    status: "0x1",
    effectiveGasPrice: "0x1",
    type: "0x2",
  };
}

function rpc({ method, params }) {
  switch (method) {
    case "eth_chainId":
      return "0x1";
    case "net_version":
      return "1";
    case "eth_blockNumber":
      return "0x10";
    case "eth_call":
      return ethCall(params[0]);
    case "eth_estimateGas":
      return "0x30000";
    case "eth_gasPrice":
      return "0x3b9aca00";
    case "eth_maxPriorityFeePerGas":
      return "0x3b9aca00";
    case "eth_getBlockByNumber":
      return {
        number: "0x10",
        hash: "0x" + "ab".repeat(32),
        parentHash: "0x" + "ac".repeat(32),
        timestamp: toHex(Math.floor(Date.now() / 1000)),
        baseFeePerGas: "0x3b9aca00",
        gasLimit: "0x1c9c380",
        gasUsed: "0x0",
        miner: USER,
        transactions: [],
        nonce: "0x0000000000000000",
        difficulty: "0x0",
        extraData: "0x",
        logsBloom: "0x" + "00".repeat(256),
        mixHash: "0x" + "00".repeat(32),
        receiptsRoot: "0x" + "00".repeat(32),
        sha3Uncles: "0x" + "00".repeat(32),
        size: "0x0",
        stateRoot: "0x" + "00".repeat(32),
        totalDifficulty: "0x0",
        transactionsRoot: "0x" + "00".repeat(32),
        uncles: [],
      };
    case "eth_getTransactionReceipt":
      return receiptFor(params[0]);
    case "eth_getTransactionByHash": {
      const tx = sent.find((t) => t.hash === params[0]);
      return tx
        ? {
            hash: tx.hash,
            from: USER,
            to: tx.to,
            input: tx.data,
            nonce: "0x1",
            blockNumber: "0x10",
            blockHash: "0x" + "ab".repeat(32),
            transactionIndex: "0x0",
            value: "0x0",
            gas: "0x30000",
            gasPrice: "0x1",
            type: "0x2",
            chainId: "0x1",
            v: "0x0",
            r: "0x0",
            s: "0x0",
          }
        : null;
    }
    case "eth_sendTransaction": {
      const hash = keccak256(toHex(`tx-${++txCount}`));
      sent.push({ hash, to: params[0].to, data: params[0].data });
      if (meta[params[0].to.toLowerCase()]) {
        const d = decodeFunctionData({ abi: erc20Abi, data: params[0].data });
        if (d.functionName === "approve")
          allowances.set(params[0].to.toLowerCase(), d.args[1]);
      }
      if (params[0].to.toLowerCase() === PERMIT2) {
        const d = decodeFunctionData({ abi: permitAbi, data: params[0].data });
        permits.set(d.args[0].toLowerCase(), [d.args[2], d.args[3], 0]);
      }
      if ([EXIT, UNIVERSAL_ROUTER].includes(params[0].to.toLowerCase()))
        saleTxHash = hash;
      return hash;
    }
    case "eth_accounts":
    case "eth_requestAccounts":
      return [USER];
    case "wallet_switchEthereumChain":
      return null;
    case "wallet_requestPermissions":
      return [{ parentCapability: "eth_accounts" }];
    case "wallet_revokePermissions":
      return null;
    default:
      console.log("unmocked rpc", method);
      return null;
  }
}

// --- static server for dist, under a subpath so relative URLs are exercised ---
const dist = path.join(ROOT, "dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!p.startsWith("/preview/")) {
    res.writeHead(404);
    return res.end();
  }
  p = p.slice("/preview/".length) || "index.html";
  const file = path.join(dist, p);
  if (
    !file.startsWith(dist) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    res.writeHead(404);
    return res.end("missing " + p);
  }
  res.writeHead(200, {
    "content-type": types[path.extname(file)] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;

const browser = await chromium.launch();
const failures = [];
const checks = [];
const measurements = {};
const check = (cond, msg) => {
  checks.push({ passed: !!cond, message: msg });
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

async function openPage(width, height, { wallet = true, userAgent } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 700,
    userAgent,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    if (!r.url().includes("publicnode") && !r.url().includes("drpc"))
      errors.push(`requestfailed: ${r.url()}`);
  });
  await page.route(
    /https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?.*/,
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (delayBalances && body.method === "eth_call")
        await new Promise((r) => setTimeout(r, 100));
      if (
        readMode === "primary-failure" &&
        route.request().url().includes("publicnode") &&
        body.method === "eth_call"
      )
        return route.fulfill({ status: 503, body: "RPC unavailable" });
      const answer = (req) => {
        try {
          return { jsonrpc: "2.0", id: req.id, result: rpc(req) };
        } catch (e) {
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32000, message: String(e.message) },
          };
        }
      };
      const out = Array.isArray(body) ? body.map(answer) : answer(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(out),
      });
    },
  );
  await page.route("**/launches.json", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/pools.json", (route) =>
    route.fulfill({ json: poolSnapshot }),
  );
  if (wallet) {
    await page.addInitScript(
      ({ user }) => {
        const listeners = {};
        window.__walletChain = 1;
        window.__emit = (event, value) => {
          if (event === "chainChanged") window.__walletChain = Number(value);
          for (const f of listeners[event] ?? []) f(value);
        };
        const provider = {
          isMockWallet: true,
          request: async ({ method, params }) => {
            if (method === "eth_chainId")
              return "0x" + window.__walletChain.toString(16);
            if (method === "wallet_switchEthereumChain") {
              window.__emit("chainChanged", params[0].chainId);
              return null;
            }
            if (method === "eth_accounts" && !window.__authorized) return [];
            if (method === "eth_requestAccounts") window.__authorized = true;
            const res = await fetch("https://ethereum-rpc.publicnode.com/", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method,
                params: params ?? [],
              }),
            });
            const j = await res.json();
            if (j.error)
              throw Object.assign(new Error(j.error.message), {
                code: j.error.code,
              });
            return j.result;
          },
          on: (e, f) => {
            (listeners[e] ??= []).push(f);
          },
          removeListener: () => {},
        };
        const detail = Object.freeze({
          info: {
            uuid: "0b1d4b6a-2c0e-4c4a-9a1a-000000000001",
            name: "Mock Wallet",
            icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='6' fill='%23e8732a'/%3E%3C/svg%3E",
            rdns: "test.mockwallet",
          },
          provider,
        });
        const announce = () =>
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", { detail }),
          );
        window.addEventListener("eip6963:requestProvider", announce);
        announce();
        void user;
      },
      { user: USER },
    );
  }
  await page.goto(base + "index.html");
  await page.waitForSelector("h1");
  return { ctx, page, errors };
}

try {
  for (const width of [320, 390, 768, 1440]) {
    readMode = "normal";
    allowances.clear();
    permits.clear();
    sent.length = 0;
    const { ctx, page, errors } = await openPage(width, 844);
    const primary = page.getByRole("button", {
      name: "Review selected",
      exact: true,
    });
    const box = await primary.boundingBox();
    check(box.y + box.height < 844, `${width}: primary action on first screen`);
    await page.screenshot({ path: path.join(OUT, `${width}-first.png`) });
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mock Wallet", exact: true })
      .click();
    await page
      .getByText(/Discovery complete:/)
      .first()
      .waitFor();
    check(
      (await page.locator(".tokens tbody tr:not(.empty)").count()) === 4,
      `${width}: all positive holdings visible`,
    );
    check(
      (await page.getByRole("checkbox").count()) === 4,
      `${width}: selection controls remain visible`,
    );
    check(
      await page
        .getByRole("checkbox", { name: "Select GAMMA", exact: true })
        .isDisabled(),
      `${width}: unavailable route disabled with reason`,
    );
    check(
      await page
        .getByRole("checkbox", { name: "Select DELTA", exact: true })
        .isDisabled(),
      `${width}: failed quote disabled`,
    );
    check(await primary.isDisabled(), `${width}: no automatic sell selection`);
    if(width===390) {
      measurements.contrast=await page.evaluate(()=>{
        const context=document.createElement('canvas').getContext('2d');
        const root=getComputedStyle(document.documentElement);
        const rgb=name=>{context.clearRect(0,0,1,1);context.fillStyle=root.getPropertyValue(name).trim();context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3).map(x=>x/255)};
        const luminance=rgb=>rgb.map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[0.2126,0.7152,0.0722][i],0);
        return [['--color-text','--color-bg'],['--color-text-secondary','--color-bg-surface'],['--color-on-accent','--color-accent'],['--color-accent','--color-accent-soft'],['--color-ok','--color-ok-soft'],['--color-bad','--color-bad-soft']].map(([foreground,background])=>{const a=luminance(rgb(foreground)),b=luminance(rgb(background));return{foreground,background,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)}});
      });
      check(measurements.contrast.every(p=>p.ratio>=4.5),'rendered color tokens meet 4.5:1 for all six text/surface pairs');
    }
    await page.locator('.tokens').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(OUT,`${width}-tokens.png`)});
    if(width>=640) {
      const pickBox=await page.locator('.pick-label').first().boundingBox();
      const nameBox=await page.locator('.token-name').first().boundingBox();
      check(pickBox.x+pickBox.width<=nameBox.x,`${width}: selection label does not overlap token`);
    }
    await page
      .getByRole("button", { name: "Select all routes", exact: true })
      .click();
    check(
      (await page.getByRole("checkbox", { checked: true }).count()) === 2,
      `${width}: select all only includes quoted tokens`,
    );
    await page
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    check(
      (await page.getByRole("checkbox", { checked: true }).count()) === 0,
      `${width}: clear selection`,
    );
    await page
      .getByRole("checkbox", { name: "Select BETA", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Review selected (1)", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    check(
      (await dialog.locator(".plan tbody tr").count()) === 1,
      `${width}: only chosen token reaches review`,
    );
    check(
      (await dialog.locator(".plan").innerText()).includes("BETA"),
      `${width}: selected BETA is reviewed`,
    );
    check(
      !(await dialog.locator(".plan").innerText()).includes("ALPHA"),
      `${width}: unselected ALPHA excluded`,
    );
    check(
      (await dialog.innerText()).includes("Permit2"),
      `${width}: approval destination explained`,
    );
    check((await dialog.innerText()).includes("2%"), `${width}: fee explained`);
    await page.screenshot({ path: path.join(OUT, `${width}-review.png`) });
    await page.keyboard.press("Escape");
    check((await dialog.count()) === 0, `${width}: Escape closes review`);
    await page.waitForFunction(() =>
      document.activeElement?.textContent?.startsWith("Review selected"),
    );
    check(
      (
        await page.evaluate(() => document.activeElement?.textContent)
      ).startsWith("Review selected"),
      `${width}: focus restored`,
    );
    await page
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    const pick = page.getByRole("checkbox", {
      name: "Select ALPHA",
      exact: true,
    });
    await pick.focus();
    await page.keyboard.press("Space");
    check(await pick.isChecked(), `${width}: keyboard selects one token`);
    await page
      .getByRole("button", { name: "Review selected (1)", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sell 1 token", exact: true })
      .click();
    await page.getByText(/1 of 1 sold/).waitFor();
    check(
      (await page.getByText("Sold", { exact: true }).count()) === 1,
      `${width}: confirmed transfer outcome shown`,
    );
    const sales = sent.filter((t) => t.to.toLowerCase() === UNIVERSAL_ROUTER);
    check(
      sales.length === 1,
      `${width}: exactly one selected sale sent to router`,
    );
    check(
      sent.every((t) => t.to.toLowerCase() !== EXIT),
      `${width}: no legacy registration or sale request`,
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${width}: no page overflow`,
    );
    await page.screenshot({ path: path.join(OUT, `${width}-result.png`) });
    check(errors.length === 0, `${width}: no script or resource errors`);
    await ctx.close();
  }
  for (const mode of ["empty", "failure", "quote-offline"]) {
    readMode = mode;
    const { ctx, page } = await openPage(390, 844);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mock Wallet", exact: true })
      .click();
    await page
      .getByText(/Discovery complete:|Discovery failed:|Partial discovery:/)
      .first()
      .waitFor();
    if (mode === "empty")
      check(
        (await page.locator(".list").innerText()).includes("No positive"),
        "empty wallet has distinct message",
      );
    if (mode === "failure")
      check(
        (await page.locator(".list").innerText()).includes("unknown"),
        "RPC failure never claims empty wallet",
      );
    if (mode === "quote-offline") {
      check(
        (await page.locator(".tokens tbody tr:not(.empty)").count()) === 4,
        "quote failure preserves holdings",
      );
      check(
        await page.getByRole("checkbox", { name: "Select ALPHA" }).isDisabled(),
        "quote failure blocks sale",
      );
      readMode = "normal";
      await page
        .getByRole("button", { name: "Refresh routes", exact: true })
        .click();
      await page
        .getByText(/Discovery complete:/)
        .first()
        .waitFor();
      check(
        await page.getByRole("checkbox", { name: "Select ALPHA" }).isEnabled(),
        "Refresh recovers live route",
      );
    }
    await ctx.close();
  }
  readMode='normal';
  const savedAlpha={...meta[T.alpha]};
  meta[T.alpha]={...meta[T.alpha],symbol:'LongToken'.repeat(7)+'X',decimals:0,balance:(1n<<128n)-1n,expected:(1n<<128n)-1n};
  for(const width of [320,390,1440]) {
    const {ctx,page}=await openPage(width,844);
    await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
    await page.getByRole('button',{name:'Mock Wallet',exact:true}).click();
    await page.getByText(/Discovery complete:/).first().waitFor();
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: long symbol and 39-digit amount fit`);
    await page.getByRole('checkbox',{name:`Select ${meta[T.alpha].symbol}`,exact:true}).check();
    await page.getByRole('button',{name:'Review selected (1)',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    check(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`${width}: long quote and minimum fit review`);
    await page.screenshot({path:path.join(OUT,`${width}-long-review.png`)});
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.__emit('chainChanged','0x2105'));
    await page.getByRole('button',{name:'Switch to Ethereum',exact:true}).waitFor();
    check(await page.getByRole('button',{name:'Review selected',exact:true}).isDisabled(),`${width}: wrong chain clears selection and blocks sale`);
    await ctx.close();
  }
  meta[T.alpha]=savedAlpha;
  fs.writeFileSync(
    path.join(OUT, "result.json"),
    JSON.stringify({ checks, failures, measurements }, null, 2),
  );
  if (failures.length) throw Error(`${failures.length} checks failed`);
} finally {
  await browser.close();
  server.close();
}
