import { formatUnits, isAddress, type Address } from "viem";
import { IMD_ADDRESS } from "../deployment.ts";
import { indexerLimit } from "./async.ts";

export const INDEXER = "https://eth.blockscout.com";
export type Candidate = {
  address: Address;
  symbol?: string;
  name?: string;
  usdPrice?: number | null;
  unverified?: boolean;
};
export type IndexedHoldings = { tokens: Candidate[]; complete: boolean; warnings: string[] };

export async function indexerJson(path: string, signal?: AbortSignal): Promise<unknown> {
  return indexerLimit(async () => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const response = await fetch(`${INDEXER}${path}`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise<void>((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        continue;
      }
      if (!response.ok) throw new Error(`Token index HTTP ${response.status}. Retry the scan.`);
      return response.json();
    }
  });
}

export function validPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** The index provides candidates, never trusted balances, calldata or permission targets. */
export async function indexedHoldings(
  account: Address,
  options: { signal?: AbortSignal; progress?: (text: string) => void } = {},
): Promise<IndexedHoldings> {
  const tokens = new Map<string, Candidate>();
  const cursors = new Set<string>();
  const warnings: string[] = [];
  let query = new URLSearchParams({ type: "ERC-20" });
  let complete = false;
  for (let page = 0; page < 200; page++) {
    options.signal?.throwIfAborted();
    const cursor = query.toString();
    if (cursors.has(cursor)) { warnings.push("The token index repeated a page. Some holdings may be missing; retry the scan."); break; }
    cursors.add(cursor);
    options.progress?.(`Finding Ethereum tokens · ${tokens.size} indexed so far…`);
    try {
      const response = await indexerJson(`/api/v2/addresses/${account}/tokens?${query}`, options.signal) as {
        items?: { token?: Record<string, unknown>; value?: string }[];
        next_page_params?: Record<string, unknown> | null;
      };
      if (!Array.isArray(response.items)) throw new Error("The token index returned an invalid response. Retry the scan.");
      for (const item of response.items) {
        const t = item.token;
        if (!t || t.type !== "ERC-20" || typeof t.address_hash !== "string" || !isAddress(t.address_hash, { strict: false })) continue;
        const address = t.address_hash.toLowerCase() as Address;
        if (/^0x0{40}$/.test(address)) continue;
        tokens.set(address, {
          address,
          symbol: typeof t.symbol === "string" ? t.symbol : undefined,
          name: typeof t.name === "string" ? t.name : undefined,
          usdPrice: validPrice(t.exchange_rate),
          unverified: t.reputation === "scam" || t.reputation === "spam",
        });
      }
      if (!response.next_page_params || Object.keys(response.next_page_params).length === 0) { complete = true; break; }
      query = new URLSearchParams({ type: "ERC-20" });
      for (const [key, value] of Object.entries(response.next_page_params)) {
        if (/^[a-z_]+$/.test(key) && ["string", "number", "boolean"].includes(typeof value)) query.set(key, String(value));
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      warnings.push(error instanceof Error ? error.message : "Token index unavailable. Retry the scan.");
      break;
    }
  }
  if (!complete && warnings.length === 0) warnings.push("The 10,000-token index limit was reached. Add a missing token by its contract address.");
  return { tokens: [...tokens.values()], complete, warnings };
}

export function holdingUsd(balance: bigint, decimals: number | null, price?: number | null): number | null {
  if (decimals === null || price == null) return null;
  const value = Number(formatUnits(balance, decimals)) * price;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function settlementPrice(signal?: AbortSignal): Promise<number | null> {
  try {
    const token = await indexerJson(`/api/v2/tokens/${IMD_ADDRESS}`, signal) as { exchange_rate?: unknown };
    return validPrice(token.exchange_rate);
  } catch { signal?.throwIfAborted(); return null; }
}
