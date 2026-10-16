// Read-only browser integration. Real chain responses; no fabricated balances or transactions.
// Run from web/: node scripts/browser-live.mjs [RPC transport URL] [target site URL]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(ROOT, "test/scratch/browser-live");
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(
  process.env.IMD_PLAYWRIGHT
    ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href
    : "playwright"
);
const account = "0x0ace1dbe8aab293cd58d5e3ea38814f0ccb74782";
const dist = path.join(ROOT, "dist");
const server = http.createServer((req, res) => {
  const name =
    new URL(req.url, "http://local").pathname.replace(/^\/preview\//, "") ||
    "index.html";
  const p = path.resolve(dist, name);
  if (!p.startsWith(dist + path.sep) || !fs.existsSync(p)) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader(
    "content-type",
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    }[path.extname(p)] || "application/octet-stream",
  );
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url =
  process.argv[3] ||
  `http://127.0.0.1:${server.address().port}/preview/index.html`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [],
    network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) =>
    network.push({ url: r.url(), error: r.failure()?.errorText }),
  );
  if (process.argv[2])
    await page.route(
      /https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)/,
      async (route) => {
        try {
          const response = await fetch(process.argv[2], {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: route.request().postData(),
            signal: AbortSignal.timeout(25000),
          });
          await route.fulfill({
            status: response.status,
            contentType: "application/json",
            body: await response.text(),
          });
        } catch {
          await route.abort("failed");
        }
      },
    );
  await page.addInitScript((account) => {
    const listeners = {};
    let connected = false;
    const provider = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0x1";
        if (method === "wallet_requestPermissions")
          return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_requestAccounts") {
          connected = true;
          return [account];
        }
        if (method === "eth_accounts") return connected ? [account] : [];
        throw Error("Read-only verification: wallet signing is disabled");
      },
      on: (e, f) => (listeners[e] ??= []).push(f),
      removeListener: () => {},
    };
    const detail = {
      info: {
        uuid: "4ae4fc30-88b4-4cc9-851f-9bbcb52da60b",
        name: "Read-only test wallet",
        rdns: "test.readonly",
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
      },
      provider,
    };
    window.addEventListener("eip6963:requestProvider", () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail }),
      ),
    );
  }, account);
  await page.goto(url);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Read-only test wallet" }).click();
  const progressTimer=setInterval(async()=>{try{console.log(await page.locator('.status-line').first().innerText())}catch{}},15000);
  await page
    .getByText(/Discovery complete:|Discovery failed:|Partial discovery:/)
    .first()
    .waitFor({ timeout: 240000 });
  clearInterval(progressTimer);
  const status = await page.locator(".status-line").first().innerText();
  const rows = await page.locator("table.tokens tbody tr:not(.empty)").count();
  const raw = await page
    .locator("table.tokens tbody tr:not(.empty)")
    .first()
    .locator(".raw-balance .mono")
    .textContent()
    .catch(() => null);
  const formatted = await page
    .locator(".exact-balance")
    .first()
    .innerText()
    .catch(() => null);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
    await page.screenshot({ path: path.join(OUT, `${width}-live.png`) });
  }
  const report = {
    transport: process.argv[2]
      ? "provided Ethereum transport"
      : "public browser RPC",
    account,
    status,
    rows,
    selectable: await page.locator("input[type=checkbox]:enabled").count(),
    firstRaw: raw,
    firstFormatted: formatted,
    pageErrors: errors,
    networkFailures: network,
  };
  fs.writeFileSync(
    path.join(OUT, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  assert.match(status, /Discovery complete:|Partial discovery:/);
  assert.ok(rows > 0);
  assert.equal(errors.length, 0);
  assert.ok(raw && /^\d+$/.test(raw));
  // This checked holding is an official token, not a test token.
  assert.ok(
    await page
      .locator(
        'a[href="https://etherscan.io/token/0x01b3b98599608a41d46a3c5c34ed736329b7c6b2"]',
      )
      .count(),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Review all routes", exact: true })
      .isDisabled(),
    false,
  );
  await context.close();
} finally {
  await browser.close();
  server.close();
}
