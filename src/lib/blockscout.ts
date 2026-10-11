// Reads a wallet's history from a keyless Blockscout instance through its `/api/v2` routes.
// Lists come newest first, 50 rows a page, with a cursor in `next_page_params`.
// The public instances allow about 180 v2 requests a minute per client, and only a handful of
// legacy `/api?module=account` calls an hour, so the legacy route is used for one thing only:
// the very first transaction of a wallet whose read was stopped before it reached the start.
import type { Chain } from './chains'
import type { ChainHistory, Coverage, InternalTx, TokenTx, Tx } from './metrics'

export const PAGE_SIZE = 50
/** A single explorer request is abandoned after this long. */
export const REQUEST_TIMEOUT_MS = 20000
/** The first-transaction lookup after a stopped read is given this long; the visitor is waiting. */
export const FIRST_TX_TIMEOUT_MS = 8000
/** Partial histories are reported to the page at most this often per chain. */
export const PARTIAL_INTERVAL_MS = 2000
type ListName = 'transactions' | 'token-transfers' | 'internal-transactions'

export type Progress = (chainName: string, message: string) => void
export type Partial = (history: ChainHistory) => void

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

/** Back off and retry on 429 and 5xx, honouring the explorer's reset header when it sends one. */
async function getJson<T>(url: string, signal?: AbortSignal, retries = 4, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const res = await fetch(url, { signal: combined, headers: { accept: 'application/json' } }).catch((e: unknown) => {
      if (signal?.aborted) throw e
      throw new Error(timeout.aborted ? 'the explorer did not answer in time' : 'network error')
    })
    if (res.ok) return (await res.json()) as T
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status}`)
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const retryAfter = Number(res.headers.get('retry-after')) * 1000
    const wait = reset > 0 ? reset + 250 : retryAfter > 0 ? retryAfter : 1500 * 2 ** attempt
    await sleep(Math.min(wait, 20000), signal)
  }
}

interface Page<T> {
  items: T[]
  next_page_params: Record<string, string | number> | null
}

interface ListResult<T> {
  rows: T[]
  /** True when the explorer still had rows when paging ended. */
  truncated: boolean
  /** Why paging ended early: the visitor stopped it, or the explorer failed part way. */
  cutBy: 'stopped' | 'explorer' | null
}

/**
 * Page one list until the explorer reports no next page. There is no page cap: a long history
 * is read in full unless the visitor stops the read, in which case the rows so far are kept.
 * An explorer failure after some rows were read also keeps the rows and reports the cut.
 */
async function pageAll<T>(
  chain: Chain,
  address: string,
  list: ListName,
  signal: AbortSignal | undefined,
  onPage: (rows: T[]) => void,
): Promise<ListResult<T>> {
  const rows: T[] = []
  let cursor: Record<string, string | number> | null = null
  for (;;) {
    if (signal?.aborted) return { rows, truncated: true, cutBy: 'stopped' }
    const qs: string = cursor
      ? '?' +
        Object.entries(cursor)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    let data: Page<T>
    try {
      data = await getJson<Page<T>>(`${chain.explorer}/api/v2/addresses/${address}/${list}${qs}`, signal)
    } catch (e) {
      if (signal?.aborted || isAbort(e)) return { rows, truncated: true, cutBy: 'stopped' }
      // An address the explorer has never seen answers 404: that is an empty history, not a failure.
      if (rows.length === 0 && e instanceof Error && e.message === 'HTTP 404') return { rows, truncated: false, cutBy: null }
      if (rows.length === 0) throw e
      return { rows, truncated: true, cutBy: 'explorer' }
    }
    rows.push(...(data.items ?? []))
    onPage(rows)
    cursor = data.next_page_params
    if (!cursor) return { rows, truncated: false, cutBy: null }
  }
}

interface Party {
  hash: string
}
interface RawTx {
  hash: string
  timestamp: string | null
  from: Party | null
  to: Party | null
  value: string
  gas_used: string | null
  gas_price: string | null
  fee?: { value: string | null } | null
  status: 'ok' | 'error' | null
  result?: string
}
interface RawInternal {
  transaction_hash: string
  timestamp: string | null
  from: Party | null
  to: Party | null
  value: string
  success: boolean
}
interface RawToken {
  transaction_hash: string
  timestamp: string | null
  from: Party | null
  to: Party | null
  total?: { value?: string | null; decimals?: string | null } | null
  token?: { address_hash?: string; symbol?: string | null; decimals?: string | null } | null
}
interface Counters {
  transactions_count?: string
  token_transfers_count?: string
}
interface Stats {
  coin_price?: string | null
}
interface LegacyFirst {
  result?: Array<{ timeStamp: string }> | string | null
}

const num = (s: string | undefined | null): number | null => {
  if (s === undefined || s === null || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const unix = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000)
/** Pending rows have no timestamp and no block; they have no place on a timeline, so they are dropped. */
const mined = <R extends { timestamp: string | null }>(rows: R[]): Array<R & { timestamp: string }> =>
  rows.filter((r): r is R & { timestamp: string } => typeof r.timestamp === 'string' && r.timestamp !== '')

/** One legacy call for the oldest transaction; the legacy route has a tiny hourly quota. */
async function firstTransactionTime(chain: Chain, address: string): Promise<number | null> {
  try {
    const url = `${chain.explorer}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1`
    const data = await getJson<LegacyFirst>(url, undefined, 0, FIRST_TX_TIMEOUT_MS)
    const first = Array.isArray(data.result) ? data.result[0] : undefined
    return first ? Number(first.timeStamp) || null : null
  } catch {
    return null
  }
}

const toTxs = (rows: RawTx[]): Tx[] =>
  mined(rows).map((r) => ({
    hash: r.hash,
    timestamp: unix(r.timestamp),
    from: r.from?.hash ?? '',
    to: r.to?.hash ?? '',
    value: r.value ?? '0',
    gasUsed: r.gas_used ?? '0',
    gasPrice: r.gas_price ?? '0',
    fee: r.fee?.value ?? null,
    isError: r.status === 'error' || (!!r.result && r.result !== 'success' && r.result !== 'pending'),
  }))

const toInternals = (rows: RawInternal[]): InternalTx[] =>
  mined(rows)
    .filter((r) => r.success !== false)
    .map((r) => ({
      hash: r.transaction_hash,
      timestamp: unix(r.timestamp),
      from: r.from?.hash ?? '',
      to: r.to?.hash ?? '',
      value: r.value ?? '0',
    }))

const toTokenTxs = (rows: RawToken[]): TokenTx[] =>
  mined(rows).map((r) => ({
    hash: r.transaction_hash,
    timestamp: unix(r.timestamp),
    from: r.from?.hash ?? '',
    to: r.to?.hash ?? '',
    value: r.total?.value ?? '0',
    decimals: Number(r.total?.decimals ?? r.token?.decimals) || 0,
    symbol: r.token?.symbol ?? '',
    contract: r.token?.address_hash ?? '',
  }))

/**
 * Read one chain. `progress` receives short status lines; `partial`, when given, receives the
 * history read so far every couple of seconds so a long read can be shown while it runs.
 * Stopping the read through `signal` keeps the rows read so far and marks the coverage as cut.
 */
export async function readChain(
  chain: Chain,
  address: string,
  progress: Progress,
  signal?: AbortSignal,
  partial?: Partial,
): Promise<ChainHistory> {
  const empty: Coverage = {
    txTotal: null,
    tokenTotal: null,
    txFetched: 0,
    tokenFetched: 0,
    internalFetched: 0,
    internalsUnavailable: false,
    truncated: false,
    cutBy: null,
  }
  try {
    progress(chain.name, 'Connecting')
    const [counters, stats] = await Promise.all([
      getJson<Counters>(`${chain.explorer}/api/v2/addresses/${address}/counters`, signal, 2).catch(() => ({}) as Counters),
      getJson<Stats>(`${chain.explorer}/api/v2/stats`, signal, 1).catch(() => ({}) as Stats),
    ])
    const txTotal = num(counters.transactions_count)
    const tokenTotal = num(counters.token_transfers_count)
    const coinPriceUsd = num(stats.coin_price)

    // The three lists page in parallel. Each keeps its rows in one array so a partial
    // snapshot can be built from all three at any moment.
    const current = { tx: [] as RawTx[], tok: [] as RawToken[], int: [] as RawInternal[] }
    let lastPartial = 0
    const snapshot = (cut: Coverage['cutBy'], internalsUnavailable: boolean): ChainHistory => {
      const txs = toTxs(current.tx)
      const tokenTxs = toTokenTxs(current.tok)
      const internals = toInternals(current.int)
      return {
        chainId: chain.id,
        txs,
        internals,
        tokenTxs,
        coverage: {
          txTotal,
          tokenTotal,
          txFetched: txs.length,
          tokenFetched: tokenTxs.length,
          internalFetched: internals.length,
          internalsUnavailable,
          truncated: cut !== null,
          cutBy: cut,
        },
        firstSeenHint: null,
        coinPriceUsd,
        error: null,
      }
    }
    const report = () => {
      const txt = `${current.tx.length.toLocaleString()}${txTotal && txTotal > current.tx.length ? ` of ${txTotal.toLocaleString()}` : ''} transactions`
      const tok = `${current.tok.length.toLocaleString()}${tokenTotal && tokenTotal > current.tok.length ? ` of ${tokenTotal.toLocaleString()}` : ''} token transfers`
      progress(chain.name, `${txt}, ${tok} read`)
      const now = Date.now()
      if (partial && now - lastPartial >= PARTIAL_INTERVAL_MS) {
        lastPartial = now
        partial(snapshot('stopped', false))
      }
    }
    const [txRes, tokRes, intRes] = await Promise.all([
      pageAll<RawTx>(chain, address, 'transactions', signal, (rows) => {
        current.tx = rows
        report()
      }),
      pageAll<RawToken>(chain, address, 'token-transfers', signal, (rows) => {
        current.tok = rows
        report()
      }),
      // Internal transfers are slow to index for busy wallets; the read goes on without them.
      pageAll<RawInternal>(chain, address, 'internal-transactions', signal, (rows) => {
        current.int = rows
      }).catch((e: unknown) => {
        if (signal?.aborted || isAbort(e)) return { rows: [], truncated: true, cutBy: 'stopped' } as ListResult<RawInternal>
        return null
      }),
    ])

    const cuts = [txRes.cutBy, tokRes.cutBy, intRes?.cutBy ?? null]
    const cutBy: Coverage['cutBy'] = cuts.includes('stopped') ? 'stopped' : cuts.includes('explorer') ? 'explorer' : null
    const history = snapshot(cutBy, intRes === null)

    if (cutBy !== null && history.txs.length > 0) {
      progress(chain.name, 'Looking up the first transaction')
      history.firstSeenHint = await firstTransactionTime(chain, address)
    }

    progress(chain.name, cutBy === 'stopped' ? 'Stopped' : 'Done')
    return history
  } catch (err) {
    const message = isAbort(err) ? 'the read was stopped before it connected' : err instanceof Error ? err.message : String(err)
    progress(chain.name, `Unavailable (${message})`)
    return {
      chainId: chain.id,
      txs: [],
      internals: [],
      tokenTxs: [],
      coverage: empty,
      firstSeenHint: null,
      coinPriceUsd: null,
      error: message,
    }
  }
}
