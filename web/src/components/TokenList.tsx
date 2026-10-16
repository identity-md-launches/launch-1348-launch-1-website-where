import { EXPLORER_URL, IMD_SYMBOL } from "../config";
import { fmtAmount, fmtUsd } from "../lib/format";
import {
  STATUS_TEXT,
  usdValue,
  type Pricing,
  type SwarmToken,
} from "../lib/sweep";

type Props = {
  tokens: SwarmToken[];
  pricing: Pricing | null;
  selected: Set<string>;
  onToggle: (address: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onClaim: (token: SwarmToken) => void;
  claiming: string | null;
  busy: boolean;
  connected: boolean;
  loading: boolean;
  error: string | null;
  complete: boolean;
};

function StatusCell({ t }: { t: SwarmToken }) {
  const result = t.result ?? t.previousResult;
  if (result?.kind === "pending")
    return (
      <>
        <span className="pill pill-muted">Confirmation pending</span>
        <span className="note">{result.reason}</span>
        <a
          href={`${EXPLORER_URL}/tx/${result.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
      </>
    );
  if (result?.kind === "sold") {
    return (
      <>
        <span className="pill pill-ok">Sold</span>
        <span className="note">
          {fmtAmount(result.imdOut)} {IMD_SYMBOL} gross
        </span>
      </>
    );
  }
  if (result?.kind === "unsold") {
    return (
      <>
        <span className="pill pill-bad">Unsold</span>
        <span className="note">{result.reason}</span>
      </>
    );
  }
  if (t.readError)
    return (
      <>
        <span className="pill pill-muted">Sale unavailable</span>
        <span className="note">{t.readError}</span>
      </>
    );
  if (t.sellable)
    return (
      <>
        <span className="pill pill-route">{t.routeLabel ?? "Route found"}</span>
        {t.liveRoute && t.liveRoute.amountIn < t.balance && (
          <span className="note partial-route">
            Partial balance: sell {fmtAmount(t.liveRoute.amountIn, t.decimals)}{" "}
            {t.symbol}. The rest stays in your wallet.
          </span>
        )}
        {t.liveRoute && (
          <details className="route-details">
            <summary>Pool details</summary>
            <span className="note">
              Quoted at block {t.liveRoute.blockNumber.toString()}. Refreshed
              before review.
            </span>
            {t.liveRoute.pools.map((p) => (
              <span className="note mono" key={p.id}>
                {p.id}
              </span>
            ))}
          </details>
        )}
      </>
    );
  return (
    <>
      <span className="pill pill-muted">No sell route found</span>
      <span className="note">
        {t.routeReason ??
          (t.routeLabel
            ? `${t.routeLabel}: ${STATUS_TEXT[t.status] ?? "not sellable"}`
            : (STATUS_TEXT[t.status] ?? "Not sellable"))}
      </span>
    </>
  );
}

export function TokenList({
  tokens,
  pricing,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  onClaim,
  claiming,
  busy,
  connected,
  loading,
  error,
  complete,
}: Props) {
  return (
    <div className="list" role="region" aria-labelledby="tokens-heading">
      <h2 id="tokens-heading" className="h3" tabIndex={-1}>
        Swarm tokens in this wallet
      </h2>
      {tokens.length > 0 && (
        <div className="selection-tools">
          <p className="hint">
            Select tokens using the checkboxes. Partial routes sell only the
            quoted amount.
          </p>
          <div className="selection-actions">
            <button
              className="btn btn-small"
              disabled={busy || !tokens.some((t) => t.sellable && !t.result)}
              onClick={onSelectAll}
            >
              Select all routes
            </button>
            <button
              className="btn btn-small"
              disabled={busy || selected.size === 0}
              onClick={onClear}
            >
              Clear selection
            </button>
            <span role="status" className="hint">
              {selected.size} selected
            </span>
          </div>
        </div>
      )}
      <table className="tokens">
        <thead>
          <tr>
            <th className="col-pick">
              <span className="sr-only">Select</span>
            </th>
            <th>Token</th>
            <th className="num">Balance</th>
            <th className="num">IMD quote</th>
            <th>Live sell route</th>
          </tr>
        </thead>
        <tbody>
          {!connected && (
            <tr className="empty">
              <td colSpan={5}>
                Connect a wallet to list the swarm-launched tokens it holds.
              </td>
            </tr>
          )}
          {connected && loading && (
            <tr className="empty">
              <td colSpan={5}>Reading your wallet…</td>
            </tr>
          )}
          {connected && !loading && !error && tokens.length === 0 && (
            <tr className="empty">
              <td colSpan={5}>
                {complete
                  ? "No positive swarm-token balances at this Ethereum block."
                  : "No positive balances confirmed. Discovery is incomplete; retry with Refresh."}
              </td>
            </tr>
          )}
          {connected && !loading && error && (
            <tr className="empty">
              <td colSpan={5}>
                Wallet holdings are unknown because discovery failed. Use
                Refresh to retry.
              </td>
            </tr>
          )}
          {tokens.map((t) => {
            const result = t.result ?? t.previousResult;
            const usd = t.sellable ? usdValue(t.expectedImd, pricing) : null;
            const pickable = t.sellable && !busy && t.result === undefined;
            const id = `pick-${t.address}`;
            return (
              <tr
                key={t.address}
                className={t.sellable || result ? "" : "dim"}
                data-result={result?.kind ?? ""}
              >
                <td className="col-pick">
                  {t.result === undefined && (
                    <label className="pick-label">
                      <input
                        id={id}
                        type="checkbox"
                        checked={selected.has(t.address.toLowerCase())}
                        onChange={() => onToggle(t.address)}
                        disabled={!pickable}
                        aria-label={`Select ${t.symbol}`}
                      />
                      <span>Select</span>
                    </label>
                  )}
                </td>
                <td data-label="Token">
                  <label
                    htmlFor={t.sellable ? id : undefined}
                    className="token-name"
                  >
                    {t.symbol}
                  </label>
                  <a
                    className="mono addr"
                    href={`${EXPLORER_URL}/token/${t.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.address}
                  </a>
                </td>
                <td className="num" data-label="Balance">
                  <span className="exact-balance">
                    {fmtAmount(t.balance, t.decimals)}
                  </span>
                  <details className="raw-balance">
                    <summary>Raw units &amp; launch</summary>
                    <span className="mono">{t.balance.toString()}</span>
                    {t.launch && (
                      <a
                        href={`${EXPLORER_URL}/tx/${t.launch.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Launch {t.launch.launchNumber} deployment
                      </a>
                    )}
                  </details>
                  {t.heldRefund > 0n && (
                    <span className="note">
                      {fmtAmount(t.heldRefund, t.decimals)} held as refund{" "}
                      <button
                        className="btn btn-small"
                        onClick={() => onClaim(t)}
                        disabled={busy || claiming !== null}
                      >
                        {claiming === t.address ? "Claiming…" : "Claim refund"}
                      </button>
                    </span>
                  )}
                </td>
                <td className="num" data-label="IMD quote">
                  {t.sellable ? (
                    <>
                      <span className="value-usd">
                        {fmtAmount(t.expectedImd)} {IMD_SYMBOL}
                      </span>
                      <span className="note">
                        Before 2% fee{pricing ? ` · ${fmtUsd(usd)}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="note">No quote</span>
                  )}
                </td>
                <td data-label="Live sell route" className="status">
                  {loading && !t.liveRoute && !t.routeReason ? (
                    <span className="note">Checking pools…</span>
                  ) : (
                    <StatusCell t={t} />
                  )}
                  {result?.txHash && result.kind !== "pending" && (
                    <a
                      className="note"
                      href={`${EXPLORER_URL}/tx/${result.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View transaction
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
