import type { SwarmToken } from "./sweep.ts";

export type TokenFilters = { search: string; minUsd: string; maxUsd: string; route: "all" | "ready" | "unavailable"; sort: "value" | "name" | "quote" };
export const EMPTY_FILTERS: TokenFilters = { search: "", minUsd: "", maxUsd: "", route: "all", sort: "value" };
export function rangeError(filters: TokenFilters): string | null {
  const min = filters.minUsd.trim() === "" ? null : Number(filters.minUsd);
  const max = filters.maxUsd.trim() === "" ? null : Number(filters.maxUsd);
  if ([min, max].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return "Enter a USD value of zero or more.";
  if (min !== null && max !== null && min > max) return "Maximum value must be at least the minimum.";
  return null;
}
export function filterTokens(tokens: readonly SwarmToken[], filters: TokenFilters): SwarmToken[] {
  if (rangeError(filters)) return [];
  const search = filters.search.trim().toLowerCase();
  const min = filters.minUsd.trim() === "" ? null : Number(filters.minUsd);
  const max = filters.maxUsd.trim() === "" ? null : Number(filters.maxUsd);
  return tokens.filter((t) => {
    if (search && ![t.symbol, t.name ?? "", t.address].some((value) => value.toLowerCase().includes(search))) return false;
    if (filters.route === "ready" && (!t.sellable || !!t.result)) return false;
    if (filters.route === "unavailable" && (t.sellable || !t.routeChecked)) return false;
    if ((min !== null || max !== null) && (t.usdValue == null || !Number.isFinite(t.usdValue))) return false;
    return (min === null || t.usdValue! >= min) && (max === null || t.usdValue! <= max);
  }).sort((a, b) => filters.sort === "name" ? a.symbol.localeCompare(b.symbol)
    : filters.sort === "quote" ? (a.expectedImd > b.expectedImd ? -1 : a.expectedImd < b.expectedImd ? 1 : a.symbol.localeCompare(b.symbol))
    : (b.usdValue ?? -1) - (a.usdValue ?? -1) || a.symbol.localeCompare(b.symbol));
}
