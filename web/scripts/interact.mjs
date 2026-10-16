// Interaction validation for the SwarmSweep export (run after `npm run build`, from web/:
// `node --experimental-strip-types scripts/interact.mjs`). Serves dist/ on a local port inside this
// process, routes the public RPC to a JSON-RPC mock of SwarmExit and four tokens, injects an
// EIP-6963 wallet, and walks: load, connect, sell all, confirm, approvals, sale, sold/unsold marks.
// Playwright is not a project dependency: set IMD_PLAYWRIGHT to a Playwright index.mjs (for
// example from an npx cache) or have `playwright` importable. Screenshots go to test/scratch/interact.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "test/scratch/interact");
fs.mkdirSync(OUT, { recursive: true });
const viem = await import(pathToFileURL(path.join(ROOT, "web/node_modules/viem/_esm/index.js")).href);
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : "playwright");
const { swarmExitAbi } = await import(pathToFileURL(path.join(ROOT, "web/src/abi/swarmExit.ts")).href);
const { erc20Abi } = await import(pathToFileURL(path.join(ROOT, "web/src/abi/erc20.ts")).href);
const { parseAbi, decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseUnits, getAddress, keccak256, toHex } = viem;

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
  [T.alpha]: { symbol: "ALPHA", decimals: 18, balance: parseUnits("12500", 18), expected: parseUnits("100", 18), sellable: true, status: 0, route: [3, "0x000000000004444c5dc75cb358380d2e3de08a90", "0x0000000000000000000000000000000000000000", T.alpha, IMD] },
  [T.beta]: { symbol: "BETA", decimals: 18, balance: parseUnits("3.25", 18), expected: parseUnits("50", 18), sellable: true, status: 0, route: [1, "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", "0x0000000000000000000000000000000000000000", T.beta, WETH] },
  [T.gamma]: { symbol: "GAMMA", decimals: 18, balance: parseUnits("900000", 18), expected: 0n, sellable: false, status: 3, route: [0, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"] },
  [T.delta]: { symbol: "DELTA", decimals: 6, balance: 4200000000n, expected: 0n, sellable: false, status: 5, route: [2, "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", "0x61ffe014ba17989e743c5f6cb21bf9697530b21e", T.delta, WETH] },
  [T.empty]: { symbol: "EMPTY", decimals: 18, balance: 0n, expected: 0n, sellable: false, status: 2, route: [0, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"] },
};
const tokens = Object.values(T);
const registryAbi = parseAbi(['function count() view returns(uint64)','function writer() view returns(address)']);
const registryFactories = {'0xa47fcb220ddd1cddda865f89029bec1b9eca3bf1':'0x12c63b581d07093f6126bc02263c58f7eadaa96f','0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23':'0xff03410d0fe5fa8f7f59f743de35e333d9857120'};
const snapshot = { version:1,chainId:1,blockNumber:1,blockHash:'0x'+'ab'.repeat(32),registries:Object.entries(registryFactories).map(([address,factory])=>({address,factory,count:1})),tokens:tokens.map((address,i)=>({address,launchNumber:i+1,blockNumber:1,transactionHash:'0x'+'ab'.repeat(32)})) };
const multiAbi=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[] returnData)']);
const allowances=new Map();
let readMode='normal';
let delayBalances=false;
const calls = [];
let txCount = 0;
let saleTxHash = null;
const sent = [];

function ethCall({ to, data }) {
  const target = to.toLowerCase();
  if(target==='0xca11bde05977b3631167028862be2a173976ca11') {
    if(readMode==='aggregate-failure')throw Error('aggregate exceeds RPC gas cap');
    const {args}=decodeFunctionData({abi:multiAbi,data});
    return encodeFunctionResult({abi:multiAbi,functionName:'aggregate3',result:args[0].map(c=>{try{return {success:true,returnData:ethCall({to:c.target,data:c.callData})}}catch{return {success:false,returnData:'0x'}}})});
  }
  if(registryFactories[target]) { const {functionName}=decodeFunctionData({abi:registryAbi,data}); return encodeFunctionResult({abi:registryAbi,functionName,result:functionName==='count'?1n:registryFactories[target]}); }
  if (target === EXIT) {
    const { functionName, args } = decodeFunctionData({ abi: swarmExitAbi, data });
    calls.push(functionName);
    const enc = (result) => encodeFunctionResult({ abi: swarmExitAbi, functionName, result });
    switch (functionName) {
      case "paused": return enc(false);
      case "MAX_TOKENS_PER_SALE": return enc(50n);
      case "minImdOut": return enc(parseUnits("0.001", 18));
      case "preview": return enc(args[1].map((t) => ({ token:getAddress(t),balance:meta[t.toLowerCase()].balance,expectedImd:meta[t.toLowerCase()].expected,sellable:meta[t.toLowerCase()].sellable,status:meta[t.toLowerCase()].status })));
      case "previewAll": return enc(tokens.map((t) => ({ token: getAddress(t), balance: meta[t].balance, expectedImd: meta[t].expected, sellable: meta[t].sellable, status: meta[t].status })));
      case "heldRefunds": return enc(readMode === 'held-refund' && saleTxHash && args[1].toLowerCase() === T.beta ? meta[T.beta].balance : 0n);
      case "tokenRoute": { const r = meta[args[0].toLowerCase()].route; return enc({ venue: r[0], router: getAddress(r[1]), quoter: getAddress(r[2]), tokenIn: getAddress(r[3]), tokenOut: getAddress(r[4]), data: "0x" }); }
      case "quoteImdInBridge": return enc(parseUnits("0.0001", 18)); // 1 IMD = 0.0001 ETH
      case "ethUsdPrice": return enc([300000000000n, 8]); // $3000
      case "sellAll": {
        const list = args[0].map((a) => a.toLowerCase());
        const outcomes = list.map((t) => ({ token: getAddress(t), amountIn: meta[t].balance, imdOut: meta[t].expected, status: 0 }));
        const gross = outcomes.reduce((s, o) => s + o.imdOut, 0n);
        const tax = (gross * 200n) / 10000n;
        return enc([outcomes, gross, tax, gross - tax]);
      }
      default: throw new Error(`unmocked SwarmExit call ${functionName}`);
    }
  }
  if (meta[target]) {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
    calls.push(`erc20.${functionName}`);
    const enc = (result) => encodeFunctionResult({ abi: erc20Abi, functionName, result });
    if (functionName === "symbol") return enc(meta[target].symbol);
    if (functionName === "decimals") return enc(meta[target].decimals);
    if (functionName === "allowance") return enc(allowances.get(target) ?? 0n);
    if (functionName === "balanceOf") {
      if(readMode==='failure'||(readMode==='partial'&&target===T.beta))throw Error('Balance RPC failure');
      if(readMode==='held-refund' && saleTxHash && target===T.beta)return enc(0n);
      return enc(readMode==='empty'||args[0].toLowerCase()!==USER?0n:meta[target].balance);
    }
  }
  throw new Error(`unmocked eth_call to ${to}`);
}

function receiptFor(hash) {
  const tx = sent.find((t) => t.hash === hash);
  const logs = [];
  if (tx && tx.to.toLowerCase() === EXIT) {
    const log = (eventName, args, data) => logs.push({ address: EXIT, topics: encodeEventTopics({ abi: swarmExitAbi, eventName, args }), data, blockNumber: "0x10", transactionHash: hash, transactionIndex: "0x0", blockHash: "0x" + "ab".repeat(32), logIndex: toHex(logs.length), removed: false });
    log("TokenSold", { user: USER, token: T.alpha }, encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [meta[T.alpha].balance, meta[T.alpha].expected]));
    if (readMode === 'held-refund') log("RefundHeld", { user: USER, token: T.beta }, encodeAbiParameters([{ type: "uint256" }], [meta[T.beta].balance]));
    log("TokenRefunded", { user: USER, token: T.beta }, encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [meta[T.beta].balance, "0x"]));
    log("SoldAll", { user: USER }, encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [meta[T.alpha].expected, meta[T.alpha].expected / 50n, meta[T.alpha].expected - meta[T.alpha].expected / 50n]));
  }
  return { transactionHash: hash, transactionIndex: "0x0", blockHash: "0x" + "ab".repeat(32), blockNumber: "0x10", from: USER, to: tx?.to ?? EXIT, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", contractAddress: null, logs, logsBloom: "0x" + "00".repeat(256), status: "0x1", effectiveGasPrice: "0x1", type: "0x2" };
}

function rpc({ method, params }) {
  switch (method) {
    case "eth_chainId": return "0x1";
    case "net_version": return "1";
    case "eth_blockNumber": return "0x10";
    case "eth_call": return ethCall(params[0]);
    case "eth_estimateGas": return "0x30000";
    case "eth_gasPrice": return "0x3b9aca00";
    case "eth_maxPriorityFeePerGas": return "0x3b9aca00";
    case "eth_getBlockByNumber": return { number: "0x10", hash: "0x" + "ab".repeat(32), parentHash: "0x" + "ac".repeat(32), timestamp: toHex(Math.floor(Date.now() / 1000)), baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: USER, transactions: [], nonce: "0x0000000000000000", difficulty: "0x0", extraData: "0x", logsBloom: "0x" + "00".repeat(256), mixHash: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), sha3Uncles: "0x" + "00".repeat(32), size: "0x0", stateRoot: "0x" + "00".repeat(32), totalDifficulty: "0x0", transactionsRoot: "0x" + "00".repeat(32), uncles: [] };
    case "eth_getTransactionReceipt": return receiptFor(params[0]);
    case "eth_getTransactionByHash": { const tx = sent.find((t) => t.hash === params[0]); return tx ? { hash: tx.hash, from: USER, to: tx.to, input: tx.data, nonce: "0x1", blockNumber: "0x10", blockHash: "0x" + "ab".repeat(32), transactionIndex: "0x0", value: "0x0", gas: "0x30000", gasPrice: "0x1", type: "0x2", chainId: "0x1", v: "0x0", r: "0x0", s: "0x0" } : null; }
    case "eth_sendTransaction": { const hash = keccak256(toHex(`tx-${++txCount}`)); sent.push({ hash, to: params[0].to, data: params[0].data }); if (meta[params[0].to.toLowerCase()]) { const d=decodeFunctionData({abi:erc20Abi,data:params[0].data}); if(d.functionName==='approve') allowances.set(params[0].to.toLowerCase(),d.args[1]); } if (params[0].to.toLowerCase() === EXIT) saleTxHash = hash; return hash; }
    case "eth_accounts": case "eth_requestAccounts": return [USER];
    case "wallet_switchEthereumChain": return null;
    case "wallet_requestPermissions": return [{parentCapability:"eth_accounts"}];
    case "wallet_revokePermissions": return null;
    default: console.log("unmocked rpc", method); return null;
  }
}

// --- static server for dist, under a subpath so relative URLs are exercised ---
const dist = path.join(ROOT, "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!p.startsWith("/preview/")) { res.writeHead(404); return res.end(); }
  p = p.slice("/preview/".length) || "index.html";
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("missing " + p); }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;

const browser = await chromium.launch();
const failures = [];
const checks = [];
const measurements = {};
const check = (cond, msg) => { checks.push({ passed: !!cond, message: msg }); console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failures.push(msg); };

async function openPage(width, height, { wallet = true, userAgent } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700, userAgent });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (!r.url().includes("publicnode") && !r.url().includes("drpc")) errors.push(`requestfailed: ${r.url()}`); });
  await page.route(/https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?.*/, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if(delayBalances && body.method==='eth_call')await new Promise(r=>setTimeout(r,100));
    if(readMode==='primary-failure' && route.request().url().includes('publicnode') && body.method==='eth_call')return route.fulfill({status:503,body:'RPC unavailable'});
    const answer = (req) => { try { return { jsonrpc: "2.0", id: req.id, result: rpc(req) }; } catch (e) { return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: String(e.message) } }; } };
    const out = Array.isArray(body) ? body.map(answer) : answer(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  await page.route("**/launches.json", route => route.fulfill({json:snapshot}));
  if (wallet) {
    await page.addInitScript(({ user }) => {
      const listeners = {};
      window.__walletChain=1;
      window.__emit=(event,value)=>{if(event==='chainChanged')window.__walletChain=Number(value);for(const f of listeners[event]??[])f(value);};
      const provider = {
        isMockWallet: true,
        request: async ({ method, params }) => {
          if(method==='eth_chainId')return '0x'+window.__walletChain.toString(16);
          if(method==='wallet_switchEthereumChain'){window.__emit('chainChanged',params[0].chainId);return null;}
          if (method === "eth_accounts" && !window.__authorized) return [];
          if (method === "eth_requestAccounts") window.__authorized = true;
          const res = await fetch("https://ethereum-rpc.publicnode.com/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) });
          const j = await res.json();
          if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
          return j.result;
        },
        on: (e, f) => { (listeners[e] ??= []).push(f); },
        removeListener: () => {},
      };
      const detail = Object.freeze({ info: { uuid: "0b1d4b6a-2c0e-4c4a-9a1a-000000000001", name: "Mock Wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='6' fill='%23e8732a'/%3E%3C/svg%3E", rdns: "test.mockwallet" }, provider });
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
      void user;
    }, { user: USER });
  }
  await page.goto(base + "index.html");
  await page.waitForSelector("h1");
  return { ctx, page, errors };
}

// ---- 1. first screen at 390, no wallet, keyboard walk ----
{
  const { ctx, page, errors } = await openPage(390, 844, { wallet: false });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "390-first-screen.png") });
  const h1 = await page.locator("h1").boundingBox();
  const sellAll = await page.getByRole("button", { name: "Sell all" }).boundingBox();
  const connect = await page.getByRole("button", { name: "Connect wallet" }).boundingBox();
  check(h1 && h1.y + h1.height < 844, "390: headline on the first screen");
  check(sellAll && sellAll.y + sellAll.height < 844, `390: Sell all on the first screen (bottom ${sellAll && Math.round(sellAll.y + sellAll.height)})`);
  check(connect && connect.y + connect.height < 844, "390: Connect wallet on the first screen");
  check(sellAll && sellAll.height >= 44, `390: Sell all is ${sellAll && sellAll.height}px tall`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `390: no horizontal overflow (${overflow})`);
  check(await page.getByText("Connect a wallet to list the swarm-launched tokens it holds.").isVisible(), "390: empty state explains what to do");
  // keyboard: Tab reaches Connect, Enter opens the sheet, Escape closes it and returns focus
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  check((await page.evaluate(() => document.activeElement?.textContent)) === "Connect wallet", "keyboard: second Tab stop is Connect wallet");
  await page.keyboard.press("Enter");
  await page.waitForSelector("[role=dialog]");
  check(await page.getByRole("dialog", { name: "Connect a wallet" }).isVisible(), "keyboard: Enter opens the connect sheet");
  check(await page.getByRole("button", { name: "Browser wallet" }).isVisible(), "no extension: generic row reads 'Browser wallet'");
  check(await page.getByRole("button", { name: "Coinbase Wallet" }).isVisible(), "sheet lists Coinbase Wallet");
  const rowH = await page.getByRole("button", { name: "Coinbase Wallet" }).boundingBox();
  check(rowH && rowH.height >= 48, `sheet rows are ${rowH && rowH.height}px high`);
  await page.screenshot({ path: path.join(OUT, "390-connect-sheet.png") });
  const focusInside = await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  check(focusInside, "sheet: focus moved inside on open");
  await page.keyboard.press('Shift+Tab');
  check((await page.evaluate(()=>document.activeElement?.textContent)).includes('Coinbase Wallet'),'sheet: Shift+Tab wraps to the last control');
  await page.keyboard.press('Tab');
  check(await page.getByRole('button',{name:'Close',exact:true}).evaluate(el=>el===document.activeElement),'sheet: Tab wraps to close');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check((await page.locator("[role=dialog]").count()) === 0, "sheet: Escape closes it");
  check((await page.evaluate(() => document.activeElement?.textContent)) === "Connect wallet", "sheet: focus returns to the trigger");
  check(errors.length === 0, `390: no console/page errors (${errors.join("; ")})`);
  await ctx.close();
}

// ---- 2. mobile user agent: open-in rows ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base + "index.html");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForSelector("[role=dialog]");
  for (const w of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"]) check(await page.getByRole("link", { name: `Open in ${w}` }).isVisible(), `phone: 'Open in ${w}' row`);
  check(await page.getByRole("button", { name: "Coinbase Smart Wallet" }).isVisible(), "phone: Coinbase Smart Wallet row");
  const href = await page.getByRole("link", { name: "Open in MetaMask" }).getAttribute("href");
  check(href?.startsWith("https://link.metamask.io/dapp/127.0.0.1"), `phone: MetaMask link carries this page (${href})`);
  await page.screenshot({ path: path.join(OUT, "390-phone-sheet.png") });
  await ctx.close();
}

// ---- 3. connect with the mock wallet, list, sell all, confirm, result; at 390 and 1440 ----
for (const width of [390, 1440]) {
  calls.length = 0; sent.length = 0; allowances.clear(); saleTxHash = null; txCount = 0;
  const height = width < 700 ? 844 : 900;
  const { ctx, page, errors } = await openPage(width, height);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForSelector("[role=dialog]");
  check(await page.getByRole("button", { name: "Mock Wallet" }).isVisible(), `${width}: EIP-6963 wallet listed by its own name`);
  check((await page.getByRole("button", { name: "Browser wallet" }).count()) === 0, `${width}: generic injected row hidden when an extension is named`);
  await page.getByRole("button", { name: "Mock Wallet" }).click();
  await page.waitForSelector("text=ALPHA", { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${width}-connected.png`), fullPage: true });
  check(await page.getByRole("button", { name: /0x1000…0001/ }).isVisible(), `${width}: header shows the short address and Disconnect`);
  const rows = page.locator("table.tokens tbody tr");
  check((await rows.count()) === 4, `${width}: four held tokens listed, zero balance token hidden (${await rows.count()})`);
  check(await page.getByText("Uniswap v4 to IMD").isVisible(), `${width}: ALPHA sell route identified`);
  check(await page.getByText("Uniswap V2 to ETH, then IMD").isVisible(), `${width}: BETA sell route identified`);
  const routeBounds = await page.getByText("Uniswap V2 to ETH, then IMD", { exact: true }).evaluate((el) => {
    const pill = el.getBoundingClientRect(), cell = el.closest('td').getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(el.closest('td')).paddingRight);
    return { pillWidth: pill.width, pillRight: pill.right, cellRight: cell.right, contentRight: cell.right - padding };
  });
  measurements[`route-${width}`] = routeBounds;
  check(routeBounds.pillRight <= routeBounds.contentRight + 0.5, `${width}: complete two-leg route fits its status cell (${JSON.stringify(routeBounds)})`);
  check((await page.getByText("No sell route found").count()) === 2, `${width}: GAMMA and DELTA marked 'No sell route found'`);
  const dim = await page.locator("tr.dim").count();
  check(dim === 2, `${width}: two rows greyed out (${dim})`);
  const gammaColor = await page.locator("tr.dim td[data-label=Token] .token-name").first().evaluate((el) => getComputedStyle(el).color);
  const alphaColor = await page.locator("tr:not(.dim) td[data-label=Token] .token-name").first().evaluate((el) => getComputedStyle(el).color);
  check(gammaColor !== alphaColor, `${width}: greyed rows use the disabled text color (${gammaColor} vs ${alphaColor})`);
  check(await page.getByText("$30.00").isVisible(), `${width}: ALPHA USD value shown (100 IMD at $0.30)`);
  check(await page.getByText("$15.00").isVisible(), `${width}: BETA USD value shown`);
  check(await page.getByText("$45.00").isVisible(), `${width}: total USD value shown`);
  check(await page.getByText("147 IMD").isVisible(), `${width}: net after 2% fee shown (147 IMD)`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${width}: no horizontal overflow when the list is full (${overflow})`);
  // selection: untick BETA, Sell selected becomes available with count 1
  await page.getByRole("checkbox", { name: "Select BETA" }).uncheck();
  check(await page.getByRole("button", { name: "Sell selected (1)" }).isEnabled(), `${width}: Sell selected (1) enabled after unticking BETA`);
  await page.getByRole("button", { name: "Sell selected (1)" }).click();
  await page.waitForSelector("[role=dialog]");
  check(await page.getByRole("dialog", { name: "Sell 1 token for IMD?" }).isVisible(), `${width}: confirmation for the selected token`);
  check(await page.getByText("98 IMD").isVisible(), `${width}: net for one token is 98 IMD`);
  await page.screenshot({ path: path.join(OUT, `${width}-confirm-selected.png`) });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(100);
  check((await page.locator("[role=dialog]").count()) === 0, `${width}: Cancel closes the confirmation`);
  check((await page.evaluate(()=>document.activeElement?.textContent)).includes('Sell selected'),`${width}: confirmation restores focus to its trigger`);
  await page.getByRole("checkbox", { name: "Select BETA" }).check();
  // sell all
  await page.getByRole("button", { name: "Sell all" }).click();
  await page.waitForSelector("[role=dialog]");
  check(await page.getByRole("dialog", { name: "Sell 2 tokens for IMD?" }).isVisible(), `${width}: confirmation lists 2 tokens`);
  check(await page.getByText("150 IMD").isVisible(), `${width}: gross 150 IMD`);
  check(await page.getByText("−3 IMD").isVisible(), `${width}: fee 3 IMD`);
  check(await page.getByText("147 IMD").first().isVisible(), `${width}: you receive 147 IMD`);
  check(await page.getByText("0xFC3a…1cFB").isVisible(), `${width}: treasury address shown`);
  await page.screenshot({ path: path.join(OUT, `${width}-confirm-all.png`) });
  await page.getByRole("button", { name: "Sell 2 tokens" }).click();
  await page.waitForSelector("text=1 of 2 sold.", { timeout: 20000 });
  await page.waitForTimeout(500);
  check(sent.length === 3, `${width}: two approvals then one sellAll sent (${sent.length})`);
  check(sent[2] && sent[2].to.toLowerCase() === EXIT, `${width}: last transaction goes to SwarmExit`);
  const sellArgs = sent[2] && decodeFunctionData({ abi: swarmExitAbi, data: sent[2].data });
  check(sellArgs && sellArgs.functionName === "sellAll" && sellArgs.args[0].length === 2, `${width}: sellAll(tokens[2], mins, deadline)`);
  check(sellArgs && sellArgs.args[1][0] === (parseUnits("100", 18) * 9700n) / 10000n, `${width}: per-token minimum is 3% under the simulated output`);
  check(await page.getByText("1 of 2 sold. See each token for its confirmed outcome or pending transaction.").isVisible(), `${width}: completion notice`);
  const sold = page.locator(".pill-ok", { hasText: "Sold" });
  const unsold = page.locator(".pill-bad", { hasText: "Unsold" });
  check((await sold.count()) === 1 && (await unsold.count()) === 1, `${width}: one Sold and one Unsold mark`);
  const soldColor = await sold.first().evaluate((el) => getComputedStyle(el).color);
  const unsoldColor = await unsold.first().evaluate((el) => getComputedStyle(el).color);
  check(soldColor !== unsoldColor, `${width}: Sold ${soldColor}, Unsold ${unsoldColor}`);
  check(await page.getByText("Sale failed; tokens refunded. Transfer-tax tokens may refund less.").isVisible(), `${width}: refund explained on the unsold row`);
  await page.screenshot({ path: path.join(OUT, `${width}-after-sale.png`), fullPage: true });
  check(errors.length === 0, `${width}: no console/page errors (${errors.join("; ")})`);
  await ctx.close();
}

// ---- 4. 320 reflow ----
{
  const { ctx, page } = await openPage(320, 700);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Mock Wallet" }).click();
  await page.waitForSelector("text=ALPHA", { timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `320: no horizontal overflow with the list (${overflow})`);
  await page.screenshot({ path: path.join(OUT, "320-connected.png"), fullPage: true });
  await ctx.close();
}

// ---- Error, partial and zero-balance states, plus actual wallet chain events ----
for (const mode of ['failure','partial','empty','primary-failure']) {
  readMode=mode;
  const {ctx,page}=await openPage(390,844);
  await page.getByRole('button',{name:'Connect wallet'}).click();
  await page.getByRole('button',{name:'Mock Wallet'}).click();
  if(mode==='failure') {
    await page.getByText(/Wallet holdings are unknown/).waitFor();
    check(await page.getByText(/Discovery failed:/).isVisible(),'RPC failure has a visible retryable failure state');
    check(await page.getByText(/No positive swarm-token balances/).count()===0,'RPC failure never reports an empty wallet');
    readMode='normal';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('ALPHA',{exact:true}).waitFor();
    check(true,'Refresh recovers after an RPC failure');
  } else if(mode==='partial') {
    await page.getByText(/Partial discovery:/).first().waitFor();
    check(await page.getByText('ALPHA',{exact:true}).isVisible(),'partial discovery retains successful holdings');
  } else if(mode==='primary-failure') {
    await page.getByText('ALPHA',{exact:true}).waitFor();
    check(await page.getByText(/Discovery complete:/).isVisible(),'secondary Ethereum RPC recovers primary endpoint failure');
  } else {
    await page.getByText(/No positive swarm-token balances/).waitFor();
    check(await page.getByText(/Discovery complete:/).isVisible(),'empty wallet requires completed discovery');
  }
  await page.screenshot({path:path.join(OUT,`390-${mode}.png`),fullPage:true});
  await ctx.close();
}
readMode='normal';
{
 const {ctx,page}=await openPage(390,844);
 await page.getByRole('button',{name:'Connect wallet'}).click();await page.getByRole('button',{name:'Mock Wallet'}).click();await page.getByText('ALPHA',{exact:true}).waitFor();
 await page.evaluate(()=>window.__emit('chainChanged','0x2105'));
 await page.getByRole('button',{name:'Switch to Ethereum'}).waitFor();
 check(await page.getByRole('button',{name:'Sell all',exact:true}).isDisabled(),'chain change disables selling');
 check(await page.getByText('ALPHA',{exact:true}).count()===0,'chain change clears old-chain holdings');
 await page.getByRole('button',{name:'Switch to Ethereum'}).click();await page.getByText('ALPHA',{exact:true}).waitFor();
 check(await page.getByRole('button',{name:'Sell all',exact:true}).isEnabled(),'switching back to Ethereum reloads balances');
 await ctx.close();
}

// A late refresh must not repopulate holdings after disconnect.
{
 const {ctx,page}=await openPage(390,844);
 await page.getByRole('button',{name:'Connect wallet'}).click();await page.getByRole('button',{name:'Mock Wallet'}).click();await page.getByText('ALPHA',{exact:true}).waitFor();
 delayBalances=true;
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.getByRole('button',{name:/Disconnect/}).click();
 await page.waitForTimeout(1500);
 check(await page.getByText('ALPHA',{exact:true}).count()===0,'late refresh cannot repopulate disconnected holdings');
 check(await page.getByRole('button',{name:'Connect wallet'}).isVisible(),'disconnect returns the connect control');
 delayBalances=false;
 await ctx.close();
}

// Precise amounts must remain exact and readable in both quote and receipt states at 320px.
{
  const original = meta[T.alpha].expected;
  meta[T.alpha].expected = parseUnits('100.123456789012345678', 18);
  calls.length = 0; sent.length = 0; allowances.clear(); saleTxHash = null; txCount = 0;
  const { ctx, page, errors } = await openPage(320, 844);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Mock Wallet' }).click();
  await page.getByText(/Discovery complete:/).waitFor();
  const alpha = page.locator('table.tokens tbody tr', { has: page.getByText('ALPHA', { exact: true }) });
  check(await alpha.locator('[data-label=Value] .note').textContent() === '100.123456789012345678 IMD', '320: precise quote retains all 18 decimal places');
  measurements.preciseQuoteWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(measurements.preciseQuoteWidth === 320, `320: precise quote has no horizontal overflow (${measurements.preciseQuoteWidth})`);
  await page.screenshot({ path: path.join(OUT, '320-precise-quote.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sell all', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  check(await page.getByText('150.123456789012345678 IMD', { exact: true }).isVisible(), '320: transaction preview preserves precise gross proceeds');
  await page.getByRole('button', { name: 'Sell 2 tokens', exact: true }).click();
  await page.getByText(/1 of 2 sold/).waitFor();
  check(await alpha.locator('.status .note').first().textContent() === '100.123456789012345678 IMD gross', '320: sold outcome retains all 18 decimal places');
  measurements.preciseOutcomeWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(measurements.preciseOutcomeWidth === 320, `320: precise sale outcome has no horizontal overflow (${measurements.preciseOutcomeWidth})`);
  await page.screenshot({ path: path.join(OUT, '320-precise-outcome.png'), fullPage: true });
  check(errors.length === 0, `320: precise quote/sale has no console/page errors (${errors.join('; ')})`);
  await ctx.close();
  meta[T.alpha].expected = original;
}

// A phone can announce a real EIP-6963 provider without setting window.ethereum.
{
  const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const { ctx, page, errors } = await openPage(390, 844, { userAgent });
  check(await page.evaluate(() => !window.ethereum), 'phone EIP-6963 fixture has no legacy window.ethereum');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  const mock = page.getByRole('button', { name: 'Mock Wallet', exact: true });
  measurements.mobileNamedWalletCount = await mock.count();
  check(measurements.mobileNamedWalletCount === 1, 'phone: EIP-6963-only Mock Wallet is selectable');
  check(await page.getByRole('link', { name: /Open in/ }).count() === 0, 'phone: available provider takes precedence over external wallet links');
  check(await page.getByRole('button', { name: 'Browser wallet' }).count() === 0, 'phone: named provider hides generic injected connector');
  check(await page.getByRole('button', { name: 'Coinbase Smart Wallet' }).isVisible(), 'phone: Coinbase Smart Wallet remains available with EIP-6963');
  await page.screenshot({ path: path.join(OUT, '390-phone-eip6963-sheet.png') });
  if (measurements.mobileNamedWalletCount === 1) {
    await mock.click();
    await page.getByText(/Discovery complete:/).waitFor();
    check(await page.locator('table.tokens tbody tr:not(.empty)').count() === 4, 'phone: EIP-6963 connection discovers four positive holdings');
    check(await page.getByRole('button', { name: /Disconnect/ }).isVisible(), 'phone: EIP-6963 wallet connects and closes the sheet');
  }
  check(errors.length === 0, `phone EIP-6963: no console/page errors (${errors.join('; ')})`);
  await ctx.close();
}

// Actual viem client with both aggregate RPC endpoints rejected must issue isolated reads.
{
  readMode = 'aggregate-failure';
  calls.length = 0;
  const { ctx, page, errors } = await openPage(390, 844);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Mock Wallet' }).click();
  await page.getByText(/Discovery complete:|Discovery failed:|Partial discovery:/).first().waitFor();
  const status = await page.locator('.status-line').first().innerText();
  measurements.aggregateFallback = { status, balanceCalls: calls.filter((c) => c === 'erc20.balanceOf').length, rows: await page.locator('table.tokens tbody tr:not(.empty)').count() };
  check(status.includes('Discovery complete:'), 'aggregate RPC rejection recovers complete discovery');
  check(measurements.aggregateFallback.rows === 4, `aggregate RPC rejection retains four positive holdings (${measurements.aggregateFallback.rows})`);
  check(measurements.aggregateFallback.balanceCalls === 5, `aggregate RPC rejection issues five isolated balance calls (${measurements.aggregateFallback.balanceCalls})`);
  if (measurements.aggregateFallback.rows === 4) {
    const alpha = page.locator('table.tokens tbody tr', { has: page.getByText('ALPHA', { exact: true }) });
    check(await alpha.locator('.exact-balance').innerText() === '12,500', 'aggregate fallback preserves formatted ALPHA balance');
    check(await alpha.locator('.raw-balance .mono').textContent() === '12500000000000000000000', 'aggregate fallback preserves raw ALPHA balance');
  }
  check(errors.length === 0, `aggregate fallback: no console/page errors (${errors.join('; ')})`);
  await page.screenshot({ path: path.join(OUT, '390-aggregate-fallback.png'), fullPage: true });
  await ctx.close();
  readMode = 'normal';
}

// On-chain event order: RefundHeld precedes TokenRefunded when the token refuses the transfer.
{
  readMode = 'held-refund';
  sent.length = 0; allowances.clear(); saleTxHash = null; txCount = 0;
  const { ctx, page, errors } = await openPage(390, 844);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Mock Wallet' }).click();
  await page.getByText(/Discovery complete:/).waitFor();
  await page.getByRole('button', { name: 'Sell all', exact: true }).click();
  await page.getByRole('button', { name: 'Sell 2 tokens', exact: true }).click();
  await page.getByText(/1 of 2 sold/).waitFor();
  const beta = page.locator('table.tokens tbody tr', { has: page.getByText('BETA', { exact: true }) });
  await beta.getByRole('button', { name: 'Claim refund' }).waitFor();
  check(await beta.getByText('Token refused the refund. Claim it below.', { exact: true }).isVisible(), 'held refund: receipt says tokens are held and must be claimed');
  check(await beta.getByText(/tokens refunded/).count() === 0, 'held refund: receipt never claims the transfer succeeded');
  check(await beta.locator('.exact-balance').textContent() === '0', 'held refund: zero wallet balance remains visible with the claim');
  check(await beta.getByRole('button', { name: 'Claim refund' }).isEnabled(), 'held refund: confirmed held balance exposes an enabled claim control');
  check(await beta.getByText(/3.25 held as refund/).isVisible(), 'held refund: exact held balance is displayed');
  check(errors.length === 0, `held refund: no console/page errors (${errors.join('; ')})`);
  await page.screenshot({ path: path.join(OUT, '390-held-refund.png'), fullPage: true });
  await ctx.close();
  readMode = 'normal';
}

await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ checks, measurements, failures }, null, 2) + '\n');
console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
