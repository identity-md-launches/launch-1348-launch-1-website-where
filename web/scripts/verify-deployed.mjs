// Verifies the published bytes against the local production export. Does not publish.
// node scripts/verify-deployed.mjs https://the-assigned-static-site/
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const site = process.argv[2];
if (!site || !/^https:\/\//.test(site))
  throw Error("Pass the HTTPS URL issued by the project publisher.");
const base = new URL(site.endsWith("/") ? site : site + "/");
const root = new URL("../../dist/", import.meta.url);
async function list(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await list(new URL(entry.name + "/", dir), name + "/")));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}
const files = await list(root);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const file of files) {
  const response = await fetch(new URL(file, base), {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `${file}: HTTP ${response.status}`);
  assert.equal(
    sha(Buffer.from(await response.arrayBuffer())),
    sha(await readFile(new URL(file, root))),
    `${file}: published content differs from this export`,
  );
}
console.log(`Published export verified: ${files.length} files match ${base}`);
