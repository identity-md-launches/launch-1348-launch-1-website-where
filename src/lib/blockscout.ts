// Reads a wallet's history from a keyless Blockscout instance through its `/api/v2` routes.
// Lists come newest first, 50 rows a page, with a cursor in `next_page_params`.
// The public instances allow about 180 v2 requests a minute per client, and only a handful of
// legacy `/api?module=account` calls an hour, so the legacy route is used for one thing only:
// the very first transaction of a wallet whose history is longer than the page caps.
import type { Chain } from './chains'
import type { ChainHistory, Coverage, InternalTx, TokenTx, Tx } from './metrics'

export const PAGE_SIZE = 50
/** Page caps bound the request budget; coverage reports when a list was cut. */
export const MAX_PAGES = { transactions: 20, 'token-transfers': 20, 'internal-transactions': 6 } as const
/** A single explorer request is abandoned after this long. */
export const REQUEST_TIMEOUT_MS = 20000
/** Paging of one list stops, and reports a cut, when a chain has been reading this long. */
export const CHAIN_BUDGET_MS = 60000
type ListName = keyof typeof MAX_PAGES

export type Progress = (chainName: string, message: string) => void

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

/** Back off and retry on 429 and 5xx, honouring the explorer's reset header when it sends one. */
async function getJson<T>(url: string, signal?: AbortSignal, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
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

async function pageAll<T>(
  chain: Chain,
  address: string,
  list: ListName,
  signal: AbortSignal | undefined,
  deadline: number,
  onPage: (count: number) => void,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  let cursor: Record<string, string | number> | null = null
  for (let page = 1; page <= MAX_PAGES[list]; page++) {
    if (page > 1 && Date.now() > deadline) return { rows, truncated: true }
    const qs: string = cursor
      ? '?' +
        Object.entries(cursor)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    const data: Page<T> = await getJson<Page<T>>(`${chain.explorer}/api/v2/addresses/${address}/${list}${qs}`, signal)
    rows.push(...(data.items ?? []))
    onPage(rows.length)
    cursor = data.next_page_params
    if (!cursor) return { rows, truncated: false }
  }
  return { rows, truncated: true }
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
const unix = (iso: string | null): number => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0)

/** One legacy call for the oldest transaction; the legacy route has a tiny hourly quota. */
async function firstTransactionTime(chain: Chain, address: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const url = `${chain.explorer}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1`
    const data = await getJson<LegacyFirst>(url, signal, 0)
    const first = Array.isArray(data.result) ? data.result[0] : undefined
    return first ? Number(first.timeStamp) || null : null
  } catch {
    return null
  }
}

export async function readChain(
  chain: Chain,
  address: string,
  progress: Progress,
  signal?: AbortSignal,
): Promise<ChainHistory> {
  const empty: Coverage = {
    txTotal: null,
    tokenTotal: null,
    txFetched: 0,
    tokenFetched: 0,
    internalFetched: 0,
    internalsUnavailable: false,
    truncated: false,
  }
  try {
    progress(chain.name, 'Connecting')
    const [counters, stats] = await Promise.all([
      getJson<Counters>(`${chain.explorer}/api/v2/addresses/${address}/counters`, signal, 1).catch(() => ({}) as Counters),
      getJson<Stats>(`${chain.explorer}/api/v2/stats`, signal, 1).catch(() => ({}) as Stats),
    ])
    // The three lists page in parallel; their combined page caps stay inside the v2 request budget.
    const counts = { tx: 0, tok: 0 }
    const report = () =>
      progress(chain.name, `${counts.tx.toLocaleString()} transactions, ${counts.tok.toLocaleString()} token transfers read`)
    const deadline = Date.now() + CHAIN_BUDGET_MS
    const [txRes, tokRes, intRes] = await Promise.all([
      pageAll<RawTx>(chain, address, 'transactions', signal, deadline, (n) => {
        counts.tx = n
        report()
      }),
      pageAll<RawToken>(chain, address, 'token-transfers', signal, deadline, (n) => {
        counts.tok = n
        report()
      }),
      // Internal transfers are slow to index for busy wallets; the read goes on without them.
      pageAll<RawInternal>(chain, address, 'internal-transactions', signal, deadline, () => undefined).catch(
        (e: unknown) => {
          if (signal?.aborted) throw e
          return null
        },
      ),
    ])

    const txs: Tx[] = txRes.rows.map((r) => ({
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
    const internals: InternalTx[] = (intRes?.rows ?? [])
      .filter((r) => r.success !== false)
      .map((r) => ({
        hash: r.transaction_hash,
        timestamp: unix(r.timestamp),
        from: r.from?.hash ?? '',
        to: r.to?.hash ?? '',
        value: r.value ?? '0',
      }))
    const tokenTxs: TokenTx[] = tokRes.rows.map((r) => ({
      hash: r.transaction_hash,
      timestamp: unix(r.timestamp),
      from: r.from?.hash ?? '',
      to: r.to?.hash ?? '',
      value: r.total?.value ?? '0',
      decimals: Number(r.total?.decimals ?? r.token?.decimals) || 0,
      symbol: r.token?.symbol ?? '',
      contract: r.token?.address_hash ?? '',
    }))

    const truncated = txRes.truncated || tokRes.truncated || (intRes?.truncated ?? false)
    let firstSeenHint: number | null = null
    if (truncated) {
      progress(chain.name, 'Looking up the first transaction')
      firstSeenHint = await firstTransactionTime(chain, address, signal)
    }

    progress(chain.name, 'Done')
    return {
      chainId: chain.id,
      txs,
      internals,
      tokenTxs,
      coverage: {
        txTotal: num(counters.transactions_count),
        tokenTotal: num(counters.token_transfers_count),
        txFetched: txs.length,
        tokenFetched: tokenTxs.length,
        internalFetched: internals.length,
        internalsUnavailable: intRes === null,
        truncated,
      },
      firstSeenHint,
      coinPriceUsd: num(stats.coin_price),
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
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
