import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { chain } from "./chain";
import { EXPLORER_URL, IMD_SYMBOL, SWARM_EXIT_ADDRESS } from "./config";
import { ConnectSheet } from "./wallet/ConnectSheet";
import { TokenList } from "./components/TokenList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { errorText, fmtAmount, fmtUsd, short } from "./lib/format";
import {
  claimRefund,
  executeSale,
  feeSplit,
  loadWallet,
  planSale,
  usdValue,
  type Plan,
  type Progress,
  type SwarmToken,
  type WalletState,
} from "./lib/sweep";

type Sale = { plan: Plan; progress: Progress | null; error: string | null };

export function App() {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: 1 });
  const { data: wallet } = useWalletClient();
  const onChain = isConnected && chainId === chain.id;

  const identity = `${address ?? ""}:${chainId ?? ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const requestRef = useRef(0);
  const [readProgress, setReadProgress] = useState("");
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sale, setSale] = useState<Sale | null>(null);
  const [planning, setPlanning] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!client || !address || !onChain) return;
    const request = ++requestRef.current;
    const current = () =>
      request === requestRef.current && identityRef.current === identity;
    setLoading(true);
    setLoadError(null);
    setState(null);
    setSelected(new Set());
    setReadProgress("Loading verified launch history…");
    try {
      const next = await loadWallet(client, address, {
        progress: (text) => {
          if (current()) setReadProgress(text);
        },
      });
      if (!current()) return;
      setState(next);
      setSelected(
        new Set(
          next.tokens
            .filter((t) => t.sellable)
            .map((t) => t.address.toLowerCase()),
        ),
      );
    } catch (e) {
      if (current())
        setLoadError(`Discovery failed: ${errorText(e)} Retry with Refresh.`);
    } finally {
      if (current()) {
        setLoading(false);
        setReadProgress("");
      }
    }
  }, [client, address, onChain, identity]);

  useEffect(() => {
    setState(null);
    setSelected(new Set());
    setSale(null);
    setPlanning(false);
    setClaiming(null);
    setNotice("");
    setLoadError(null);
    setLoading(false);
    if (onChain && address) void refresh();
    return () => {
      requestRef.current++;
    };
  }, [onChain, address, identity, refresh]);

  const tokens = state?.tokens ?? [];
  const sellable = useMemo(
    () => tokens.filter((t) => t.sellable && t.result === undefined),
    [tokens],
  );
  const chosen = useMemo(
    () => sellable.filter((t) => selected.has(t.address.toLowerCase())),
    [sellable, selected],
  );
  const grossAll = sellable.reduce((s, t) => s + t.expectedImd, 0n);
  const { net: netAll } = feeSplit(grossAll);
  const totalUsd = state?.pricing ? usdValue(grossAll, state.pricing) : null;
  const busy =
    planning ||
    (sale !== null && sale.progress !== null && sale.error === null);

  const toggle = (addr: string) => {
    const k = addr.toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const startSale = async (list: SwarmToken[]) => {
    if (!client || !address || !state) return;
    setPlanning(true);
    setNotice("");
    try {
      const plan = await planSale(
        client,
        address,
        list,
        state.minImdOut,
        state.maxPerSale,
      );
      if (identityRef.current === identity)
        setSale({ plan, progress: null, error: null });
    } catch (e) {
      if (identityRef.current === identity)
        setNotice(`Unable to simulate the sale: ${errorText(e)}`);
    } finally {
      if (identityRef.current === identity) setPlanning(false);
    }
  };

  const confirmSale = async () => {
    if (!sale || !client || !wallet || !address || !state || !onChain) return;
    setSale({
      ...sale,
      error: null,
      progress: { step: "sign", batch: 1, batches: 1 },
    });
    let results = new Map<
      string,
      Awaited<ReturnType<typeof executeSale>> extends Map<string, infer R>
        ? R
        : never
    >();
    try {
      results = await executeSale(
        wallet,
        client,
        address,
        sale.plan,
        state.maxPerSale,
        (progress) => setSale((s) => (s ? { ...s, progress } : s)),
      );
    } catch (e) {
      setSale((s) =>
        s
          ? {
              ...s,
              progress: null,
              error: `Sale not completed: ${errorText(e)}`,
            }
          : s,
      );
      return;
    }
    if (identityRef.current !== identity) return;
    const sold = [...results.values()].filter((r) => r.kind === "sold").length;
    setState((s) =>
      s
        ? {
            ...s,
            tokens: s.tokens.map((t) =>
              results.has(t.address.toLowerCase())
                ? { ...t, result: results.get(t.address.toLowerCase()) }
                : t,
            ),
          }
        : s,
    );
    setSelected(new Set());
    setSale(null);
    setNotice(
      `${sold} of ${results.size} sold. See each token for its confirmed outcome or pending transaction.`,
    );
    // Refresh balances in the background, keeping the sold/unsold marks.
    if (client && address) {
      const fresh = await loadWallet(client, address).catch(() => null);
      if (fresh && identityRef.current === identity) {
        setState((s) => {
          if (!s) return s;
          const marks = new Map(
            s.tokens.map((t) => [t.address.toLowerCase(), t.result] as const),
          );
          const merged: SwarmToken[] = fresh.tokens.map((t) => ({
            ...t,
            result: marks.get(t.address.toLowerCase()),
          }));
          for (const old of s.tokens)
            if (
              old.result &&
              !merged.some(
                (t) => t.address.toLowerCase() === old.address.toLowerCase(),
              )
            )
              merged.push({
                ...old,
                balance: old.result.kind === "sold" ? 0n : old.balance,
              });
          return { ...fresh, tokens: merged };
        });
      }
    }
  };

  const onClaim = async (t: SwarmToken) => {
    if (!wallet || !client || !address || !onChain) return;
    setClaiming(t.address);
    try {
      await claimRefund(wallet, client, address, t.address);
      if (identityRef.current === identity) {
        setNotice(`Refund of ${t.symbol} claimed.`);
        await refresh();
      }
    } catch (e) {
      if (identityRef.current === identity)
        setNotice(`Unable to claim the refund: ${errorText(e)}`);
    } finally {
      if (identityRef.current === identity) setClaiming(null);
    }
  };

  const sellDisabled =
    !onChain || busy || loading || !!loadError || state?.paused === true;

  return (
    <>
      <div id="page">
        <header className="top">
          <a className="brand" href="./" aria-label="SwarmSweep home">
            <img src="./favicon.svg" alt="" width={28} height={28} />
            <span>SwarmSweep</span>
          </a>
          <ConnectSheet />
        </header>

        <main>
          <section className="hero">
            <h1>Sweep swarm tokens into IMD</h1>
            <p>
              Find your Ethereum swarm tokens. Sell supported holdings for $
              {IMD_SYMBOL}, with a 2% fee on successful proceeds.
            </p>
          </section>

          <section className="panel" aria-labelledby="summary-heading">
            <h2 id="summary-heading" className="sr-only">
              Summary and actions
            </h2>
            <dl className="summary">
              <div>
                <dt>Held / sellable tokens</dt>
                <dd>
                  {state
                    ? `${tokens.filter((t) => t.balance > 0n).length} / ${sellable.length}`
                    : "–"}
                </dd>
              </div>
              <div>
                <dt>Sellable value</dt>
                <dd>
                  {state ? (state.pricing ? fmtUsd(totalUsd) : "USD n/a") : "–"}
                </dd>
              </div>
              <div>
                <dt>You receive, after the 2% fee</dt>
                <dd>{state ? `${fmtAmount(netAll)} ${IMD_SYMBOL}` : "–"}</dd>
              </div>
            </dl>

            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={() => startSale(sellable)}
                disabled={sellDisabled || sellable.length === 0}
              >
                {planning ? "Checking…" : "Sell all"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => startSale(chosen)}
                disabled={sellDisabled || chosen.length === 0}
              >
                Sell selected{chosen.length > 0 ? ` (${chosen.length})` : ""}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => void refresh()}
                disabled={!onChain || loading || busy}
              >
                {loading ? "Reading…" : "Refresh"}
              </button>
              {!isConnected && (
                <span className="hint">Connect a wallet to start.</span>
              )}
              {isConnected && !onChain && (
                <span className="hint">
                  Switch your wallet to {chain.name} to continue.
                </span>
              )}
              {state?.paused && (
                <span className="hint">
                  Selling is paused by the contract owner.
                </span>
              )}
            </div>

            <p className="status-line" role="status" aria-live="polite">
              {loading
                ? readProgress
                : loadError ||
                  notice ||
                  (state
                    ? `${state.complete ? "Discovery complete" : "Partial discovery"}: ${state.balancesRead} of ${state.discovered} token balances checked.`
                    : "")}
            </p>
          </section>

          {state && (
            <details className="coverage">
              <summary>
                {state.complete
                  ? "Discovery coverage and prices"
                  : "Partial discovery: some data is unavailable"}
              </summary>
              <p>
                Ethereum block {state.blockNumber.toString()}. Historical
                official records through block {state.snapshotBlock}, plus
                subsequent launches from both current IMD registries.
              </p>
              {state.pricingError && (
                <p>USD prices unavailable: {state.pricingError}</p>
              )}
              {state.registered === 0 && state.tokens.length > 0 && (
                <p>
                  These tokens have verified launch records. SwarmExit has not
                  registered them for selling; its owner must configure tokens
                  and routes.
                </p>
              )}
              <ul>
                {state.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <TokenList
            tokens={tokens}
            pricing={state?.pricing ?? null}
            selected={selected}
            onToggle={toggle}
            onClaim={onClaim}
            claiming={claiming}
            busy={busy}
            connected={onChain}
            loading={loading}
            error={loadError}
            complete={state?.complete ?? false}
          />
        </main>

        <footer className="foot">
          <p>
            Contract SwarmExit{" "}
            <a
              className="mono"
              href={`${EXPLORER_URL}/address/${SWARM_EXIT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              {short(SWARM_EXIT_ADDRESS)}
            </a>{" "}
            on {chain.name}. Failed sales incur no sale fee. A refused refund
            stays claimable; transfer-tax tokens may return less. Network gas is
            still paid.
          </p>
        </footer>
      </div>

      {sale && (
        <ConfirmDialog
          plan={sale.plan}
          pricing={state?.pricing ?? null}
          progress={sale.progress}
          error={sale.error}
          onConfirm={() => void confirmSale()}
          onClose={() => setSale(null)}
        />
      )}
    </>
  );
}
