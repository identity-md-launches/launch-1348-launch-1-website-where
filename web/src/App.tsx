import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { chain } from "./chain";
import { EXPLORER_URL, IMD_ADDRESS, SITE_URL, SWARM_EXIT_ADDRESS } from "./config";
import { ConnectSheet } from "./wallet/ConnectSheet";
import { TokenList } from "./components/TokenList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Icon } from "./components/Icon";
import { scanWallet } from "./lib/inventory";
import { EMPTY_FILTERS, filterTokens, type TokenFilters } from "./lib/filters";
import { executeBatchSale, persistPending, planBatchSale, resolveBatchPending, storedPending } from "./lib/batchSale";
import { claimRefund, feeSplit, usdValue, type Plan, type Progress, type SaleResult, type SwarmToken, type WalletState } from "./lib/sweep";
import { errorText, fmtAmount, fmtPreview, fmtUsd, short } from "./lib/format";

type Sale = { plan: Plan; progress: Progress | null; error: string | null };

function SweepArt() {
  return <div className="sweep-art" aria-hidden="true"><svg viewBox="0 0 420 230" fill="none"><path d="M38 70C170 70 175 115 288 115M28 177C150 177 177 115 288 115M112 30C188 30 192 115 288 115" stroke="var(--color-art-line)" strokeWidth="1.5" strokeDasharray="4 7"/><rect x="25" y="41" width="58" height="58" rx="17" fill="var(--color-bg-muted)" transform="rotate(-12 25 41)"/><path d="m46 52 14 16-19 7 5-23Z" stroke="var(--color-text-secondary)" strokeWidth="2"/><rect x="86" y="12" width="50" height="50" rx="15" fill="var(--color-art-soft)" transform="rotate(8 86 12)"/><circle cx="108" cy="38" r="10" stroke="var(--color-text-secondary)" strokeWidth="2"/><path d="M108 29v18m-5-14h8m-8 10h8" stroke="var(--color-text-secondary)" strokeWidth="2"/><rect x="22" y="146" width="62" height="62" rx="18" fill="var(--color-bg-muted)" transform="rotate(10 22 146)"/><path d="m49 164 12 7-12 8-12-8 12-7Zm-12 13 12 8 12-8" stroke="var(--color-text-secondary)" strokeWidth="2"/><circle cx="305" cy="115" r="75" fill="var(--color-art-soft)"/><circle cx="305" cy="115" r="59" fill="var(--color-text)"/><path d="m276 105 8-8 8 8m-16 20 8 8 8-8m22-20 8-8 8 8m-16 20 8 8 8-8" stroke="var(--color-art-bright)" strokeWidth="3" strokeLinecap="round"/><path d="M302 96v38" stroke="var(--color-art-bright)" strokeWidth="3"/><circle cx="187" cy="68" r="4" fill="var(--color-art-line)"/><circle cx="170" cy="172" r="6" fill="var(--color-art-line)"/><path d="M381 37v16m-8-8h16" stroke="var(--color-accent)" strokeWidth="2"/><path d="m373 187 4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Z" fill="var(--color-art-line)"/></svg></div>;
}

export function App() {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: 1 });
  const { data: wallet } = useWalletClient();
  const walletIdentity = `${address ?? ""}:${chainId ?? ""}`;
  const walletIdentityRef = useRef(walletIdentity);
  walletIdentityRef.current = walletIdentity;
  const [addressInput, setAddressInput] = useState("");
  const [target, setTarget] = useState<Address | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [readProgress, setReadProgress] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<TokenFilters>({ ...EMPTY_FILTERS });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sale, setSale] = useState<Sale | null>(null);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [standard, setStandard] = useState(false);
  const [deepSearch, setDeepSearch] = useState(false);
  const [extraToken, setExtraToken] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [extraTokens, setExtraTokens] = useState<Address[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const viewRef = useRef({ target, state, loading });
  viewRef.current = { target, state, loading };
  const controller = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const actionRef = useRef(false);
  const saleTrigger = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(new Map<string, SaleResult>());
  const outcomesRef = useRef(new Map<string, Exclude<SaleResult, { kind: "pending" }>>());
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const busy = planning || executing || claiming !== null;
  const ownsTarget = !!address && !!target && address.toLowerCase() === target.toLowerCase();
  const canSell = isConnected && ownsTarget && chainId === chain.id;

  const runScan = useCallback(async (account: Address, extras: Address[] = [], deep = false) => {
    if (!client) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = ++requestRef.current;
    const current = () => requestRef.current === request && !abort.signal.aborted;
    setTarget(account);
    setLoading(true);
    setLoadError(null);
    setAddressError(null);
    setNotice("");
    setSelected(new Set());
    setState(null);
    setReadProgress("Checking pending transactions…");
    const pending = storedPending(account);
    pendingRef.current = pending;
    setPendingCount(pending.size);
    const attachResults = (next: WalletState): WalletState => ({ ...next, tokens: next.tokens.map((t) => ({ ...t,
      result: pending.get(t.address.toLowerCase()), previousResult: outcomesRef.current.get(`${account.toLowerCase()}:${t.address.toLowerCase()}`),
    })) });
    try {
      const reconciled = await Promise.all([...pending].map(async ([key, result]) => [key, await resolveBatchPending(client, walletRef.current, account, key as Address, result)] as const));
      if (!current()) return;
      const updates = new Map<string, SaleResult>();
      for (const [key, result] of reconciled) {
        if (result?.kind === "pending") { pending.set(key, result); updates.set(key, result); }
        else {
          pending.delete(key);
          const completed = result ?? { kind: "unsold" as const, reason: "Approval confirmed. No sale was submitted; review the sweep to continue." };
          updates.set(key, completed);
          outcomesRef.current.set(`${account.toLowerCase()}:${key}`, completed);
        }
      }
      persistPending(account, updates);
      setPendingCount(pending.size);
      const next = await scanWallet(client, account, { signal: abort.signal, deep, extraTokens: [...extras, ...pending.keys() as Iterable<Address>],
        progress: (text) => { if (current()) setReadProgress(text); },
        onUpdate: (update) => { if (current()) setState(attachResults(update)); },
      });
      if (current()) setState(attachResults(next));
    } catch (error) {
      if (current()) setLoadError(`Unable to complete the scan. ${errorText(error)}`);
    } finally {
      if (current()) { setLoading(false); setReadProgress(""); }
    }
  }, [client]);

  useEffect(() => {
    if (!address || !client) return;
    setAddressInput(address);
    setSale(null);
    setPlanning(false);
    const view = viewRef.current;
    // Connecting an address already being inspected does not invalidate its inventory or picks.
    // Every selected balance and quote is checked again in the sale review.
    if (view.target?.toLowerCase() === address.toLowerCase() && (view.state || view.loading) && pendingRef.current.size === 0) return;
    setFilters({ ...EMPTY_FILTERS });
    setExtraTokens([]);
    setDeepSearch(false);
    void runScan(address);
  }, [address, client, runScan]);
  useEffect(() => () => { controller.current?.abort(); requestRef.current++; }, []);

  const stopScan = () => {
    controller.current?.abort();
    requestRef.current++;
    setLoading(false);
    setReadProgress("");
    setState((previous) => previous ? { ...previous, complete: false } : previous);
    setNotice("Scan stopped. Completed routes can be reviewed; scan again to check the remaining tokens.");
  };
  const tokens = useMemo(() => state?.tokens ?? [], [state]);
  const shown = useMemo(() => filterTokens(tokens, filters), [tokens, filters]);
  const chosen = useMemo(() => tokens.filter((t) => selected.has(t.address.toLowerCase()) && t.sellable && !t.result), [tokens, selected]);
  const net = chosen.reduce((sum, t) => sum + feeSplit(t.expectedImd).net, 0n);
  const hiddenSelected = chosen.filter((t) => !shown.some((s) => s.address.toLowerCase() === t.address.toLowerCase())).length;
  const knownUsd = tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);
  const unpriced = tokens.filter((t) => t.usdValue == null).length;
  const ready = tokens.filter((t) => t.sellable && !t.result).length;
  const toggle = (key: string) => setSelected((previous) => { const next = new Set(previous); if (next.has(key.toLowerCase())) next.delete(key.toLowerCase()); else next.add(key.toLowerCase()); return next; });

  const submitScan = (event: FormEvent) => {
    event.preventDefault();
    if (actionRef.current) return;
    if (!isAddress(addressInput.trim(), { strict: false }) || /^0x0{40}$/i.test(addressInput.trim())) {
      setAddressError("Enter a valid Ethereum wallet address, starting with 0x.");
      document.getElementById("wallet-address")?.focus();
      return;
    }
    const account = getAddress(addressInput.trim());
    if (target?.toLowerCase() !== account.toLowerCase()) { setExtraTokens([]); setFilters({ ...EMPTY_FILTERS }); }
    void runScan(account, target?.toLowerCase() === account.toLowerCase() ? extraTokens : [], deepSearch);
  };
  const startSale = async () => {
    if (!client || !address || !canSell || !chosen.length || actionRef.current) return;
    actionRef.current = true;
    const identity = walletIdentity;
    saleTrigger.current = document.activeElement as HTMLElement;
    if (loading) stopScan();
    setPlanning(true);
    setNotice("");
    try {
      const plan = await planBatchSale(client, address, chosen, wallet, !standard);
      if (walletIdentityRef.current === identity) setSale({ plan, progress: null, error: null });
    } catch (error) { if (walletIdentityRef.current === identity) setNotice(`Unable to prepare the sweep. ${errorText(error)}`); }
    finally { actionRef.current = false; if (walletIdentityRef.current === identity) setPlanning(false); }
  };
  const confirmSale = async () => {
    if (!sale || !client || !wallet || !address || !canSell || actionRef.current) return;
    actionRef.current = true;
    setExecuting(true);
    const identity = walletIdentity;
    const account = address;
    const applyResults = (results: Map<string, SaleResult>) => {
      for (const [key, result] of results) {
        if (result.kind !== "pending") outcomesRef.current.set(`${account.toLowerCase()}:${key}`, result);
      }
      if (walletIdentityRef.current !== identity) return;
      for (const [key, result] of results) {
        if (result.kind === "pending") pendingRef.current.set(key, result);
        else pendingRef.current.delete(key);
      }
      setPendingCount(pendingRef.current.size);
      setState((previous) => previous ? { ...previous, tokens: previous.tokens.map((t) => results.has(t.address.toLowerCase()) ? { ...t, result: results.get(t.address.toLowerCase()) } : t) } : previous);
    };
    setSale((previous) => previous ? { ...previous, error: null, progress: { step: "sign", batch: 1, batches: previous.plan.batch?.batches ?? 1 } } : previous);
    try {
      const results = await executeBatchSale(wallet, client, account, sale.plan, (progress) => {
        if (walletIdentityRef.current === identity) setSale((previous) => previous ? { ...previous, progress } : previous);
      }, applyResults);
      applyResults(results);
      if (walletIdentityRef.current !== identity) return;
      const sold = [...results.values()].filter((r) => r.kind === "sold");
      const afterFee = sold.reduce((sum, r) => sum + (r.kind === "sold" ? feeSplit(r.imdOut).net : 0n), 0n);
      setNotice(sold.length ? `Sweep confirmed: ${sold.length} token${sold.length === 1 ? "" : "s"}, ${fmtAmount(afterFee)} IMD received after fees. Scan again for fresh balances.${sold.length < results.size ? " Some tokens were not sold; check their details." : ""}` : "No sale is confirmed. Check token details and your wallet before retrying.");
      setSelected(new Set());
      setSale(null);
    } catch (error) { if (walletIdentityRef.current === identity) setSale((previous) => previous ? { ...previous, progress: null, error: `Sweep stopped. ${errorText(error)}` } : previous); }
    finally { actionRef.current = false; setExecuting(false); }
  };
  const onClaim = async (token: SwarmToken) => {
    if (!wallet || !client || !address || !canSell || actionRef.current) return;
    actionRef.current = true;
    const identity = walletIdentity;
    setClaiming(token.address);
    try {
      await claimRefund(wallet, client, address, token.address);
      if (walletIdentityRef.current === identity) { setNotice(`Refund of ${token.symbol} claimed. Scan again to update balances.`); setState((previous) => previous ? { ...previous, tokens: previous.tokens.map((t) => t.address === token.address ? { ...t, heldRefund: 0n } : t) } : previous); }
    } catch (error) { if (walletIdentityRef.current === identity) setNotice(`Unable to claim the refund. ${errorText(error)}`); }
    finally { actionRef.current = false; if (walletIdentityRef.current === identity) setClaiming(null); }
  };
  const addToken = (event: FormEvent) => {
    event.preventDefault();
    if (!target || !isAddress(extraToken.trim(), { strict: false }) || /^0x0{40}$/i.test(extraToken.trim())) { setExtraError("Enter a valid ERC-20 contract address."); return; }
    const extras = [...new Set([...extraTokens, getAddress(extraToken.trim())])];
    setExtraTokens(extras); setExtraError(null); setExtraToken(""); void runScan(target, extras, deepSearch);
  };

  return <><div id="page">
    <a href="#workspace" className="skip-link">Skip to wallet scanner</a>
    <header className="top"><a className="brand" href="./" aria-label="SweepDust home"><img src="./favicon.svg" alt="" width="32" height="32" /><span>SweepDust</span></a><nav aria-label="Main navigation"><a className="how-link" href="#how-it-works">How it works</a><span className="network"><span className="status-dot" />Ethereum</span><ConnectSheet /></nav></header>
    <main>
      <section className="intro"><div className="intro-copy"><h1>Turn wallet dust<br />into <span>IMD.</span></h1><p>Small balances deserve a second life. Find your Ethereum tokens and sweep the ones you choose.</p><div className="product-facts"><span><Icon name="layers" size={16} />Batch your sales</span><span><Icon name="shield" size={16} />2% fee on proceeds</span></div></div><SweepArt /></section>
      <section className="scanner" id="workspace" aria-labelledby="scan-heading"><div className="scan-heading"><h2 id="scan-heading"><Icon name="wallet" />Start with a wallet</h2><span className="quiet">Scan free. Connect to sell.</span></div><form className="scan-form" onSubmit={submitScan} noValidate><label className="address-field" htmlFor="wallet-address"><span className="sr-only">Ethereum wallet address</span><input id="wallet-address" name="wallet-address" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Ethereum wallet address · 0x…" value={addressInput} onChange={(e) => { setAddressInput(e.target.value); if (addressError) setAddressError(null); }} aria-invalid={!!addressError} aria-describedby={addressError ? "address-error" : undefined} disabled={busy} /></label><button className={`btn ${canSell && chosen.length > 0 || isConnected && chainId !== chain.id ? "btn-secondary" : "btn-primary"}`} type="submit" disabled={loading || busy}>{loading ? <><span className="spinner" />Scanning…</> : <><span>Scan wallet</span><Icon name="arrow" size={18} /></>}</button>{loading && <button className="btn btn-secondary" type="button" onClick={stopScan}>Stop scan</button>}</form>{addressError && <p id="address-error" className="field-error" role="alert">{addressError}</p>}
      <div className={`scan-status${loadError ? " error" : ""}`} role="status" aria-live="polite">{loading ? <><span className="status-dot" />{readProgress}</> : loadError || notice || (state ? <><Icon name="check" size={16} />{state.complete ? "Scan complete" : "Scan complete with coverage limits"} · {ready} routes ready{state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}</> : <><Icon name="shield" size={16} />Your tokens stay in your wallet until you confirm a sale.</>)}</div></section>
      {pendingCount > 0 && <div className="pending-banner"><Icon name="info" /><p>{pendingCount} token{pendingCount === 1 ? " has" : "s have"} an unresolved wallet transaction. They stay locked against repeat sales. Scan the same wallet again to check confirmations.</p></div>}
      {state && <div className="wallet-overview"><div><span className="quiet">Wallet</span><a className="mono" href={`${EXPLORER_URL}/address/${target}`} target="_blank" rel="noreferrer">{target ? short(target) : ""}<Icon name="external" size={14} /></a></div><div><span className="quiet">Priced holdings at scan</span><strong>{fmtUsd(knownUsd)}{unpriced > 0 && <span className="quiet"> + {unpriced} unpriced</span>}</strong></div><div><span className="quiet">Live routes</span><strong>{ready} <span className="quiet">of {tokens.length} tokens</span></strong></div></div>}
      <div className="workbench"><TokenList tokens={shown} allTokens={tokens} filters={filters} onFilters={setFilters} selected={selected} onToggle={toggle} onSelectShown={() => setSelected((previous) => new Set([...previous, ...shown.filter((t) => t.sellable && !t.result && !t.unverified).map((t) => t.address.toLowerCase())]))} onClear={() => setSelected(new Set())} onClaim={onClaim} claiming={claiming} busy={busy} canClaim={canSell} scanned={state !== null} loading={loading} error={loadError || (state && !state.indexed && tokens.length === 0 ? "The token index is unavailable. Retry the scan." : null)} />
      <aside className="sweep-summary" aria-labelledby="sweep-heading"><div className="summary-title"><h2 id="sweep-heading">Your sweep</h2><Icon name="layers" /></div><p className="quiet">{chosen.length} token{chosen.length === 1 ? "" : "s"} selected{hiddenSelected ? ` · ${hiddenSelected} hidden by filters` : ""}</p><div className="receive"><span>Estimated receive</span><strong>≈ {fmtPreview(net)} <span>IMD</span></strong><span className="quiet">{state?.pricing && chosen.length ? `≈ ${fmtUsd(usdValue(net, state.pricing))}` : "After the 2% treasury fee"}</span></div><dl className="summary-details"><div><dt>Service fee</dt><dd>2% of proceeds</dd></div><div><dt>Slippage limit</dt><dd>3%</dd></div><div><dt>Network gas</dt><dd>Paid in ETH</dd></div></dl><button className="btn btn-primary review-button" onClick={() => void startSale()} disabled={!canSell || busy || chosen.length === 0}>{planning ? <><span className="spinner" />Checking sweep…</> : <>Review sweep{chosen.length ? ` (${chosen.length})` : ""}<Icon name="arrow" size={18} /></>}</button><p className="summary-hint">{!isConnected ? "Connect your wallet above when you’re ready to sell." : !ownsTarget ? "Connect the wallet you scanned to sell its tokens." : chainId !== 1 ? "Switch your wallet to Ethereum to sell." : chosen.length ? "Review amounts and wallet confirmations before selling." : "Select tokens with a live route to get started."}</p><details className="batch-options"><summary>Wallet confirmation options</summary><label className="check-setting"><input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} disabled={busy} /><span>Use standard confirmations</span></label><p>Automatic mode groups approvals and sales when your wallet already supports atomic calls. Standard mode uses individual token approvals, one batch authorization, and one sale transaction per 20 tokens.</p></details></aside></div>
      {target && <details className="coverage"><summary>Scan coverage &amp; deeper search</summary><div className="deep-search"><label className="check-setting"><input type="checkbox" checked={deepSearch} onChange={(e) => setDeepSearch(e.target.checked)} disabled={loading || busy} /><span>Search all candidate routes</span></label><p>Quick scans check the six shortest, liquidity-ranked v4 paths and up to four smaller partial amounts, plus standard v2/v3 markets. Known pools are quoted at the current block. Deeper searches update recent pool events and also check the remaining paths and smaller balances; large wallets can take several minutes.</p><button className="btn btn-secondary" type="button" disabled={loading || busy} onClick={() => void runScan(target, extraTokens, deepSearch)}>Rescan {deepSearch ? "all candidate routes" : "quick routes"}</button></div><p>ERC-20 holdings come from Ethereum Blockscout, supplemented by the bundled Swarm launch history. Balances are verified on chain. New, unindexed or nonstandard tokens may be missing; NFTs and native ETH are excluded.</p><p>Routes search Uniswap v2, v3 and v4. Other exchanges, split routes and custom hook data are not supported. A quote is checked again before selling. Indexed USD values can differ from sale proceeds.</p>{state && <p>Balances at Ethereum block {state.blockNumber.toString()}. {state.balancesRead} of {state.discovered} candidate balances verified.{state.pricingError ? ` ${state.pricingError}` : ""}</p>}{state && state.warnings.length > 0 && <ul>{state.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}<form onSubmit={addToken} className="add-token-form"><label htmlFor="extra-token">Add a missing token contract<input id="extra-token" name="extra-token" autoComplete="off" spellCheck={false} placeholder="ERC-20 contract address · 0x…" value={extraToken} aria-invalid={!!extraError} aria-describedby={extraError ? "extra-error" : undefined} onChange={(e) => setExtraToken(e.target.value)} disabled={loading || busy} /></label><button className="btn btn-secondary" type="submit" disabled={loading || busy}>Add &amp; rescan</button></form>{extraError && <p className="field-error" id="extra-error" role="alert">{extraError}</p>}</details>}
      <section className="how" id="how-it-works" aria-labelledby="how-heading"><div className="how-heading"><h2 id="how-heading">A little dust. More possibility.</h2><p>No registration. No new token. Just a clearer way to sell the balances you already own.</p></div><ol><li><span className="step-number">1</span><div><h3>Find your dust</h3><p>Scan an Ethereum wallet. Filter tokens by USD value and check live sell routes.</p></div></li><li><span className="step-number">2</span><div><h3>Choose your sweep</h3><p>Select the tokens to sell. Review exact amounts, fees and wallet confirmations.</p></div></li><li><span className="step-number">3</span><div><h3>Receive IMD</h3><p>Selected sales are grouped into batches. Each batch completes together or reverts together.</p></div></li></ol></section>
      <section className="questions" aria-labelledby="questions-heading"><h2 id="questions-heading">Good to know</h2><details><summary>Can every token be sold?</summary><p>Every indexed ERC-20 token is checked, including tokens outside Swarm. A sale needs sufficient liquidity on a supported route. Unpriced tokens remain visible. A token with no usable route stays in your wallet.</p></details><details><summary>How many wallet confirmations will I need?</summary><p>A wallet that already supports atomic calls can confirm approvals and a sale together, once per batch of up to 20 tokens. Other wallets still need a first approval for each token that has no sufficient Permit2 allowance. Router authorizations share one signature per batch, followed by one combined sale. The review shows the current estimate.</p></details><details><summary>What if a sale fails?</summary><p>Every batch is atomic: if one of its swaps fails, all sales in that transaction revert. Input tokens remain in the wallet and no sale fee is charged. Network gas can still be spent, and earlier batches or separate approvals may already have completed. Unconfirmed transactions are locked until their receipts can be checked.</p></details><details><summary>Where do the proceeds and fee go?</summary><p>IMD goes to the wallet that sent the sale. A 2% fee goes to the existing project treasury. Minimum gross proceeds are 3% below the reviewed quote for each token. You can inspect the exact amounts and destination in the review.</p></details></section>
    </main><footer className="foot"><a className="brand" href="./"><img src="./favicon.svg" alt="" width="24" height="24" /><span>SweepDust</span></a><p>Make room for what’s next.</p><div><a href={`${EXPLORER_URL}/token/${IMD_ADDRESS}`} target="_blank" rel="noreferrer">IMD contract<Icon name="external" size={14} /></a><a href={`${EXPLORER_URL}/address/${SWARM_EXIT_ADDRESS}`} target="_blank" rel="noreferrer">Legacy refunds<Icon name="external" size={14} /></a><a href={SITE_URL}>sweepdust.sites.imd.fun</a></div></footer>
    </div>{sale && <ConfirmDialog plan={sale.plan} pricing={state?.pricing ?? null} progress={sale.progress} error={sale.error} returnFocus={saleTrigger.current} onConfirm={() => void confirmSale()} onClose={() => { if (!actionRef.current) setSale(null); }} />}</>;
}
