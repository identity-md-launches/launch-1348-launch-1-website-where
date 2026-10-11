import { useEffect, useMemo, useRef, useState } from 'react'
import { AddressForm } from './components/AddressForm'
import { LineChart } from './components/LineChart'
import { MetricCard } from './components/MetricCard'
import { CHAINS, CHAIN_BY_ID, type ChainId } from './lib/chains'
import { readChain } from './lib/blockscout'
import { computeMetrics, formatAge, walletAge, type ChainHistory } from './lib/metrics'
import { fmtDate, fmtEth, fmtInt, fmtUsd, shortAddress } from './lib/format'

type View = ChainId | 'all'

interface Result {
  address: string
  histories: ChainHistory[]
  /** True while the read is still running and the histories are partial snapshots. */
  reading: boolean
}

export default function App() {
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Result | null>(null)
  const [view, setView] = useState<View>('all')
  const abortRef = useRef<AbortController | null>(null)
  const runRef = useRef(0)
  const resultsRef = useRef<HTMLElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const start = async (address: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const run = ++runRef.current
    setBusy(true)
    setStopping(false)
    setResult(null)
    setProgress({})
    setView('all')
    // Snapshots arrive per chain while the read runs, so a long history shows as it is read.
    const live = new Map<ChainId, ChainHistory>()
    const histories = await Promise.all(
      CHAINS.map((chain) =>
        readChain(
          chain,
          address,
          (name, msg) => {
            if (runRef.current !== run) return
            if (import.meta.env.DEV) console.debug(`[walletscope] ${name}: ${msg}`)
            setProgress((p) => ({ ...p, [name]: msg }))
          },
          ac.signal,
          (h) => {
            if (runRef.current !== run) return
            live.set(h.chainId, h)
            setResult({ address, histories: CHAINS.flatMap((c) => live.get(c.id) ?? []), reading: true })
          },
        ),
      ),
    )
    // A newer read has replaced this one; its result is the one that counts.
    if (runRef.current !== run) return
    setResult({ address, histories, reading: false })
    setBusy(false)
    setStopping(false)
    requestAnimationFrame(() => resultsRef.current?.focus())
  }

  // Stopping aborts the explorer requests; the read resolves with what it has and the dashboard keeps it.
  const cancel = () => {
    abortRef.current?.abort()
    setStopping(true)
  }

  const selected = useMemo(() => {
    if (!result) return []
    return view === 'all' ? result.histories : result.histories.filter((h) => h.chainId === view)
  }, [result, view])

  const metrics = useMemo(() => (result ? computeMetrics(result.address, selected) : null), [result, selected])

  const ethPrice = useMemo(() => {
    const prices = selected.map((h) => h.coinPriceUsd).filter((p): p is number => p !== null && p > 0)
    return prices.length ? prices[0] : null
  }, [selected])

  const now = Math.floor(Date.now() / 1000)
  const usd = (eth: number) => (ethPrice ? ` · ${fmtUsd(eth * ethPrice)}` : '')

  // Coverage of the selected chains, for the card labels: are the lists complete, and how many rows were read?
  const answered = selected.filter((h) => !h.error)
  const allFailed = selected.length > 0 && answered.length === 0
  const cut = answered.some((h) => h.coverage.truncated) || (result?.reading ?? false)
  const txRead = answered.reduce((n, h) => n + h.coverage.txFetched, 0)
  const tokRead = answered.reduce((n, h) => n + h.coverage.tokenFetched, 0)
  const sumKnown = (pick: (h: ChainHistory) => number | null) =>
    answered.every((h) => pick(h) !== null) ? answered.reduce((n, h) => n + (pick(h) ?? 0), 0) : null
  const txTotal = sumKnown((h) => h.coverage.txTotal)
  const tokTotal = sumKnown((h) => h.coverage.tokenTotal)
  const readOf = (read: number, total: number | null, noun: string) =>
    total !== null && total > read ? `${fmtInt(read)} of ${fmtInt(total)} ${noun} read` : `${fmtInt(read)} ${noun} read, more remain`
  const newest = (base: string) => (cut ? `${base}, newest ${fmtInt(txRead)} transactions` : base)
  const emptyHistory = answered.length > 0 && metrics !== null && metrics.txCount === 0

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <div className="wrap masthead-row">
          <a className="wordmark" href="./" aria-label="Walletscope home">
            <svg className="wordmark-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
              <rect width="64" height="64" rx="14" fill="var(--color-surface-raised)" />
              <path
                d="M12 42 L24 30 L32 36 L44 20 L52 26"
                fill="none"
                stroke="var(--chart-sell)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="52" cy="26" r="5" fill="var(--color-accent-solid)" />
            </svg>
            Walletscope
          </a>
          <p className="masthead-note">Ethereum · Base · Robinhood Chain</p>
        </div>
      </header>

      <main id="main" className="wrap">
        <section className="intro" aria-labelledby="intro-title">
          <h1 id="intro-title" className="intro-title">
            Look up a wallet’s age, gas, trades and profit
          </h1>
          <p className="intro-lede">
            Paste an address. Walletscope reads it on Ethereum, Base and Robinhood Chain from their public explorers.
          </p>
          <AddressForm busy={busy} onSubmit={start} onCancel={cancel} />
        </section>

        <div className="status" role="status" aria-live="polite" aria-atomic="true">
          {busy && (
            <ul className="status-list">
              {stopping && <li>Stopping. The rows read so far stay on the dashboard.</li>}
              {CHAINS.map((c) => (
                <li key={c.id}>
                  <span className="status-chain">{c.name}</span> {progress[c.name] ?? 'Waiting'}
                </li>
              ))}
            </ul>
          )}
          {!busy && result && metrics && (
            <p>
              {allFailed
                ? `Could not reach the explorers for ${shortAddress(result.address)}.`
                : result.histories.some((h) => h.coverage.cutBy === 'stopped')
                  ? `Stopped reading ${shortAddress(result.address)}. The newest rows read so far are shown.`
                  : `Finished reading ${shortAddress(result.address)} on the chains that answered.`}
            </p>
          )}
        </div>

        {result && metrics && (
          <section className="dashboard" aria-labelledby="dash-title" ref={resultsRef} tabIndex={-1}>
            <div className="dash-head">
              <div>
                <h2 id="dash-title" className="dash-title">
                  <span className="num" title={result.address}>
                    {shortAddress(result.address)}
                  </span>
                </h2>
                <p className="dash-sub">
                  {view === 'all' ? 'All three chains combined' : `${CHAIN_BY_ID[view].name} only`}
                  {result.reading ? ' · still reading, newest rows first' : ''}
                  {ethPrice ? ` · USD at today’s ETH price ${fmtUsd(ethPrice)}` : ''}
                </p>
              </div>
              <div className="field field-inline">
                <label htmlFor="chain-select">Chain</label>
                <select id="chain-select" className="select" value={view} onChange={(e) => setView(e.target.value as View)}>
                  <option value="all">All chains</option>
                  {CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {allFailed ? (
              <div className="empty">
                <p className="empty-title">Could not read this address</p>
                <p className="empty-body">
                  {view === 'all'
                    ? 'No explorer answered. Check your connection and press Read history again.'
                    : `${CHAIN_BY_ID[view].name}’s explorer did not answer. Check your connection and press Read history again, or choose another chain above.`}
                </p>
              </div>
            ) : emptyHistory ? (
              <div className="empty">
                <p className="empty-title">No activity found</p>
                <p className="empty-body">
                  {view === 'all'
                    ? 'This address has no transactions or token transfers on Ethereum, Base or Robinhood Chain that the explorers could return.'
                    : `This address has no transactions or token transfers on ${CHAIN_BY_ID[view].name}. Choose another chain above.`}
                </p>
              </div>
            ) : (
              <>
                <div className="metrics">
                  <MetricCard
                    label="Wallet age"
                    value={metrics.firstSeen ? formatAge(walletAge(metrics.firstSeen, now)) : '—'}
                    detail={
                      metrics.firstSeen
                        ? `${cut && !answered.some((h) => h.firstSeenHint) ? 'Earliest read ' : 'First seen '}${fmtDate(metrics.firstSeen)}`
                        : undefined
                    }
                  />
                  <MetricCard
                    label={newest(cut ? 'Gas spent' : 'Total gas spent')}
                    value={fmtEth(metrics.gasEth)}
                    detail={
                      cut
                        ? `${readOf(txRead, txTotal, 'transactions')}${usd(metrics.gasEth)}`
                        : `Fees on ${fmtInt(metrics.signedCount)} transactions this wallet signed${usd(metrics.gasEth)}`
                    }
                  />
                  <MetricCard
                    label={newest('Token buy volume')}
                    value={fmtEth(metrics.buyEth)}
                    detail={cut ? `${readOf(tokRead, tokTotal, 'token transfers')}${usd(metrics.buyEth)}` : `ETH paid for tokens${usd(metrics.buyEth)}`}
                  />
                  <MetricCard
                    label={newest('Token sell volume')}
                    value={fmtEth(metrics.sellEth)}
                    detail={cut ? `${readOf(tokRead, tokTotal, 'token transfers')}${usd(metrics.sellEth)}` : `ETH received for tokens${usd(metrics.sellEth)}`}
                  />
                  <MetricCard
                    label={newest('Profit / loss')}
                    value={fmtEth(metrics.pnlEth, { sign: true })}
                    trend={metrics.pnlEth > 0 ? 'up' : metrics.pnlEth < 0 ? 'down' : 'flat'}
                    detail={`Sells − buys − gas, realized${usd(metrics.pnlEth)}`}
                  />
                </div>

                <div className="charts">
                  <LineChart
                    title="Gas spent over time"
                    description="Cumulative ETH paid in fees for transactions this wallet signed."
                    points={metrics.series}
                    field="gas"
                    color="var(--chart-gas)"
                  />
                  <LineChart
                    title="Token buy volume over time"
                    description="Cumulative ETH paid in transactions that delivered tokens to the wallet."
                    points={metrics.series}
                    field="buy"
                    color="var(--chart-buy)"
                  />
                  <LineChart
                    title="Token sell volume over time"
                    description="Cumulative ETH received in transactions where the wallet sent tokens."
                    points={metrics.series}
                    field="sell"
                    color="var(--chart-sell)"
                  />
                  <LineChart
                    title="Profit / loss over time"
                    description="Cumulative sells minus buys minus gas. Unsold holdings are not priced."
                    points={metrics.series}
                    field="pnl"
                    color="var(--chart-pnl)"
                  />
                </div>
              </>
            )}

            <CoverageNotes histories={selected} address={result.address} reading={result.reading} />

            <details className="method">
              <summary>How these numbers are calculated</summary>
              <ul>
                <li>
                  <strong>Wallet age</strong> counts from the earliest transaction, internal transfer or token transfer that
                  touched the address on the selected chain or chains.
                </li>
                <li>
                  <strong>Gas spent</strong> is gas used × gas price for every transaction the wallet signed. On Base and
                  Robinhood Chain the separate L1 data fee is not included.
                </li>
                <li>
                  <strong>Token buy volume</strong> is the ETH the wallet paid in transactions that also delivered an ERC-20
                  token to it. <strong>Token sell volume</strong> is the ETH it received, directly or through an internal
                  transfer, in transactions where it sent an ERC-20 token away. Token-for-token swaps with no ETH leg are
                  not counted.
                </li>
                <li>
                  <strong>Profit / loss</strong> is sell volume − buy volume − gas spent. It is realized and in ETH; tokens
                  still held are not priced. USD figures use the explorer’s current ETH price, not historical prices.
                </li>
                <li>
                  Data comes from the public Blockscout explorers for each chain, read directly in your browser, newest
                  rows first, until each list is exhausted. A long history takes a while because the explorers allow
                  about three pages a second; the dashboard updates as rows arrive, and Stop reading keeps what has been
                  read. While a list is incomplete, each card says how many rows it covers, and the wallet age is taken
                  from the explorer’s record of the first transaction when that lookup succeeds. Pending transactions
                  are not counted.
                </li>
              </ul>
            </details>
          </section>
        )}
      </main>

      <footer className="footer wrap">
        <p>Walletscope reads public explorer data in your browser. Nothing is stored.</p>
      </footer>
    </>
  )
}

function CoverageNotes({ histories, address, reading }: { histories: ChainHistory[]; address: string; reading: boolean }) {
  const notes = histories.flatMap((h) => {
    const chain = CHAIN_BY_ID[h.chainId]
    if (h.error) {
      return [
        <li key={h.chainId} className="coverage-item coverage-error">
          <span className="coverage-chain">{chain.name}</span> could not be read ({h.error}). Open the{' '}
          <a href={chain.addressUrl(address)} target="_blank" rel="noreferrer">
            address on {chain.name}’s explorer
          </a>{' '}
          or try again.
        </li>,
      ]
    }
    const c = h.coverage
    const parts: string[] = []
    parts.push(
      c.txTotal !== null && c.txTotal > c.txFetched
        ? `${fmtInt(c.txFetched)} of ${fmtInt(c.txTotal)} transactions`
        : `${fmtInt(c.txFetched)} transactions`,
    )
    parts.push(
      c.tokenTotal !== null && c.tokenTotal > c.tokenFetched
        ? `${fmtInt(c.tokenFetched)} of ${fmtInt(c.tokenTotal)} token transfers`
        : `${fmtInt(c.tokenFetched)} token transfers`,
    )
    const cutNote = reading
      ? ' Still reading, newest first.'
      : c.cutBy === 'stopped'
        ? ' Newest rows shown; the read was stopped before it reached the start.'
        : c.cutBy === 'explorer'
          ? ' Newest rows shown; the explorer stopped answering part way.'
          : ''
    return [
      <li key={h.chainId} className={`coverage-item${c.truncated ? ' coverage-partial' : ''}`}>
        <span className="coverage-chain">{chain.name}</span> {parts.join(', ')}.{cutNote}
        {c.internalsUnavailable ? ' Internal transfers were not returned, so ETH received through contracts is missing from sell volume.' : ''}
      </li>,
    ]
  })
  return (
    <ul className="coverage" aria-label="Data coverage by chain">
      {notes}
    </ul>
  )
}
