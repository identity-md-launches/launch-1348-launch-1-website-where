import { useEffect, useState } from "react";
import { EXPLORER_URL, IMD_SYMBOL } from "../config";
import { fmtAmount, fmtPreview, fmtUsd, short } from "../lib/format";
import { EMPTY_FILTERS, rangeError, type TokenFilters } from "../lib/filters";
import type { SwarmToken } from "../lib/sweep";
import { Icon } from "./Icon";

type Props = {
  tokens: SwarmToken[]; allTokens: SwarmToken[]; filters: TokenFilters;
  onFilters: (filters: TokenFilters) => void; selected: Set<string>;
  onToggle: (address: string) => void; onSelectShown: () => void; onClear: () => void;
  onClaim: (token: SwarmToken) => void; claiming: string | null; busy: boolean;
  scanned: boolean; loading: boolean; error: string | null; canClaim: boolean;
};
function RouteStatus({ token: t, loading }: { token: SwarmToken; loading: boolean }) {
  if (t.result?.kind === "pending") return <span className="route-status waiting"><span className="status-dot" />Confirmation pending</span>;
  if (t.result?.kind === "sold") return <span className="route-status ready"><Icon name="check" size={14} />Sweep confirmed</span>;
  if (t.result?.kind === "unsold") return <span className="route-status failed">Not sold</span>;
  if (t.sellable) return <span className="route-status ready"><Icon name="check" size={14} />{t.liveRoute && t.liveRoute.amountIn < t.balance ? "Partial route" : "Ready to sweep"}</span>;
  if (!t.routeChecked && !t.readError) return <span className="route-status waiting"><span className="status-dot" />{loading ? "Checking routes" : "Not checked"}</span>;
  if (t.routeReason?.includes("Quick search") || t.routeReason?.includes("quick search")) return <span className="route-status waiting">More routes to check</span>;
  return <span className="route-status unavailable">{t.address.toLowerCase() === "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" ? "Already IMD" : "No route available"}</span>;
}
export function TokenList({ tokens, allTokens, filters, onFilters, selected, onToggle, onSelectShown, onClear, onClaim, claiming, busy, scanned, loading, error, canClaim }: Props) {
  const [visible, setVisible] = useState(40);
  useEffect(() => setVisible(40), [filters.search, filters.minUsd, filters.maxUsd, filters.route, filters.sort]);
  const invalid = rangeError(filters);
  const update = (patch: Partial<TokenFilters>) => onFilters({ ...filters, ...patch });
  const ready = allTokens.filter((t) => t.sellable && !t.result).length;
  const unavailable = allTokens.filter((t) => t.routeChecked && !t.sellable).length;
  const activeRange = filters.minUsd !== "" || filters.maxUsd !== "";
  const hasFilters = filters.search !== "" || activeRange || filters.route !== "all";
  return <section className="inventory" aria-labelledby="tokens-heading">
    <div className="section-heading"><h2 id="tokens-heading" tabIndex={-1}>Wallet tokens <span className="count">{allTokens.length}</span></h2><span className="quiet">ERC-20 · Ethereum</span></div>
    <div className="filters">
      <label className="search-field"><span className="sr-only">Search tokens by name or address</span><Icon name="search" size={18} /><input type="search" name="token-search" placeholder="Search tokens or address" value={filters.search} onChange={(e) => update({ search: e.target.value })} /></label>
      <div className="value-filters">
        <label htmlFor="min-usd">Min value (USD)<input id="min-usd" name="min-usd" type="number" inputMode="decimal" min="0" step="any" placeholder="No minimum" value={filters.minUsd} aria-invalid={!!invalid} aria-describedby={invalid ? "range-error" : "value-help"} onChange={(e) => update({ minUsd: e.target.value })} /></label>
        <label htmlFor="max-usd">Max value (USD)<input id="max-usd" name="max-usd" type="number" inputMode="decimal" min="0" step="any" placeholder="No maximum" value={filters.maxUsd} aria-invalid={!!invalid} aria-describedby={invalid ? "range-error" : "value-help"} onChange={(e) => update({ maxUsd: e.target.value })} /></label>
      </div>
      {invalid && <p className="field-error" id="range-error" role="alert">{invalid}</p>}
      <div className="filter-bottom"><div className="route-filters" role="group" aria-label="Filter tokens by route">{([['all', 'All tokens', allTokens.length], ['ready', 'Ready', ready], ['unavailable', 'Unavailable', unavailable]] as const).map(([value, label, count]) => <button type="button" key={value} className={filters.route === value ? "filter-tab active" : "filter-tab"} aria-pressed={filters.route === value} onClick={() => update({ route: value })}>{label}<span>{count}</span></button>)}</div><label className="sort-field"><span className="sr-only">Sort tokens</span><select aria-label="Sort tokens" value={filters.sort} onChange={(e) => update({ sort: e.target.value as TokenFilters["sort"] })}><option value="value">Value: high to low</option><option value="name">Name: A to Z</option><option value="quote">IMD: high to low</option></select></label></div>
      <div className="filter-note"><p id="value-help">{activeRange ? "Unpriced tokens are excluded while a USD range is active." : "USD values are indexed market estimates, separate from live sell quotes."}</p>{hasFilters && <button className="text-button" onClick={() => onFilters({ ...EMPTY_FILTERS })}>Reset filters</button>}</div>
    </div>
    {allTokens.length > 0 && <div className="selection-tools"><label className="select-shown"><input type="checkbox" aria-label="Select shown tokens with routes" disabled={busy || !tokens.some((t) => t.sellable && !t.result && !t.unverified)} checked={tokens.some((t) => t.sellable && !t.result && !t.unverified) && tokens.filter((t) => t.sellable && !t.result && !t.unverified).every((t) => selected.has(t.address.toLowerCase()))} onChange={(e) => e.target.checked ? onSelectShown() : tokens.filter((t) => selected.has(t.address.toLowerCase())).forEach((t) => onToggle(t.address))} /><span>Select shown</span></label><span className="quiet" role="status">{tokens.length} of {allTokens.length} shown</span>{selected.size > 0 && <button className="text-button" onClick={onClear} disabled={busy}>Clear selection</button>}</div>}
    <div className="table-head" aria-hidden="true"><span /><span>Token / scan balance</span><span>Value (USD)</span><span>Est. IMD gross</span></div>
    {tokens.length > 0 ? <ul className="token-list">{tokens.slice(0, visible).map((t) => {
      const key = t.address.toLowerCase(), result = t.result ?? t.previousResult, selectedToken = selected.has(key);
      return <li className={`token-row${selectedToken ? " selected" : ""}`} key={key} data-token={key}>
        <label className="token-pick"><input type="checkbox" checked={selectedToken} onChange={() => onToggle(t.address)} disabled={busy || !t.sellable || !!t.result} aria-label={`Select ${t.symbol} (${short(t.address)})`} /></label>
        <div className="token-identity"><span className="token-avatar" aria-hidden="true">{t.symbol.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "·"}</span><div className="token-title"><strong>{t.symbol}</strong><span className="quiet">≈ {fmtPreview(t.balance, t.decimals)} at scan</span><RouteStatus token={t} loading={loading} /></div></div>
        <div className="token-value"><span>{t.usdValue == null ? "Unpriced" : fmtUsd(t.usdValue)}</span>{t.unverified && <span className="flagged">Flagged by indexer</span>}</div>
        <div className="token-quote">{t.sellable ? <><span className="mobile-label">Est. IMD gross</span><span>≈ {fmtPreview(t.expectedImd)}</span></> : <span className="quiet">No quote</span>}</div>
        <details className="token-details"><summary>Details &amp; route</summary><div className="token-detail-content"><dl>
          <div><dt>Contract</dt><dd><a className="mono" href={`${EXPLORER_URL}/token/${t.address}`} target="_blank" rel="noreferrer">{t.address}<Icon name="external" size={14} /></a></dd></div><div><dt>Exact balance</dt><dd>{fmtAmount(t.balance, t.decimals)}</dd></div>
          {t.liveRoute && <><div><dt>Amount to sell</dt><dd>{fmtAmount(t.liveRoute.amountIn, t.decimals)} {t.symbol}</dd></div><div><dt>Live route</dt><dd>{t.routeLabel}</dd></div><div><dt>Exact quote, before fee</dt><dd>{fmtAmount(t.expectedImd)} {IMD_SYMBOL}</dd></div><div><dt>Quote block</dt><dd>{t.liveRoute.blockNumber.toString()}</dd></div></>}
          </dl>{t.liveRoute && t.liveRoute.amountIn < t.balance && <p className="detail-note">This route sells a partial balance. The rest stays in your wallet.</p>}{(t.routeReason || t.readError) && <p className="detail-note">{t.readError ?? t.routeReason}</p>}{t.unverified && <p className="detail-note">The indexer flagged this token. Check its contract before selecting it. “Select shown” skips flagged tokens.</p>}{result && <p className="detail-note">{t.previousResult && !t.result ? "Previous sweep: " : ""}{result.kind === "sold" ? `Confirmed ${fmtAmount(result.imdOut)} IMD gross.` : result.reason} {result.txHash && <a href={`${EXPLORER_URL}/tx/${result.txHash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>}{t.heldRefund > 0n && <div className="refund"><p>{fmtAmount(t.heldRefund, t.decimals)} {t.symbol} held as a legacy refund.</p><button className="btn btn-secondary" onClick={() => onClaim(t)} disabled={busy || claiming !== null || !canClaim}>{claiming === t.address ? "Claiming…" : "Claim refund"}</button></div>}</div></details>
      </li>;
    })}</ul> : <div className="empty-state"><span className="empty-icon"><Icon name={loading ? "search" : error ? "info" : "wallet"} size={28} /></span><h3>{loading ? "Finding your tokens" : error ? "Wallet scan interrupted" : hasFilters ? "No tokens match these filters" : scanned ? "No positive balances found" : "A fresh start for your wallet"}</h3><p>{loading ? "Verified balances appear here as the scan progresses." : error ? "Holdings are unknown. Use Scan wallet to retry." : hasFilters ? "Try a wider value range or reset the filters." : scanned ? "The index may miss new or uncommon tokens. You can add a token by its contract address." : "Scan an Ethereum address above. Connecting is only needed when you’re ready to sell."}</p>{hasFilters && <button className="btn btn-secondary" onClick={() => onFilters({ ...EMPTY_FILTERS })}>Reset filters</button>}</div>}
    {visible < tokens.length && <button className="btn btn-secondary show-more" onClick={() => setVisible((n) => n + 40)}>Show {Math.min(40, tokens.length - visible)} more tokens</button>}
  </section>;
}
