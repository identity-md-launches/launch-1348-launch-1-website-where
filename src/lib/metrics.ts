// Pure metric computation. No network, no DOM, so it can be unit tested in node.
import type { ChainId } from './chains'

export interface Tx {
  hash: string
  /** Unix seconds. */
  timestamp: number
  from: string
  to: string
  /** Wei, as a decimal string. */
  value: string
  gasUsed: string
  gasPrice: string
  /** Total fee in wei when the explorer reports it; falls back to gasUsed × gasPrice. */
  fee?: string | null
  isError: boolean
}

export interface InternalTx {
  hash: string
  timestamp: number
  from: string
  to: string
  value: string
}

export interface TokenTx {
  hash: string
  timestamp: number
  from: string
  to: string
  value: string
  decimals: number
  symbol: string
  contract: string
}

export interface Coverage {
  /** Totals reported by the explorer's counters, when available. */
  txTotal: number | null
  tokenTotal: number | null
  txFetched: number
  tokenFetched: number
  internalFetched: number
  /** True when the explorer could not return internal transfers; sells paid out through contracts are then missed. */
  internalsUnavailable?: boolean
  /** True when any list hit its page cap before the explorer ran out of rows. */
  truncated: boolean
}

export interface ChainHistory {
  chainId: ChainId
  txs: Tx[]
  internals: InternalTx[]
  tokenTxs: TokenTx[]
  coverage: Coverage
  /** Timestamp of the wallet's first transaction when the list was cut and the explorer could say. */
  firstSeenHint?: number | null
  /** Current native coin price in USD from the explorer, or null when unavailable. */
  coinPriceUsd: number | null
  /** Set when the explorer could not be read; the other fields are then empty. */
  error: string | null
}

export interface SeriesPoint {
  /** Unix seconds (start of the day bucket). */
  t: number
  gas: number
  buy: number
  sell: number
  pnl: number
}

export interface Metrics {
  /** Unix seconds of the first activity, or null when nothing was found. */
  firstSeen: number | null
  gasEth: number
  buyEth: number
  sellEth: number
  pnlEth: number
  txCount: number
  tradeCount: number
  series: SeriesPoint[]
}

const WEI = 1e18

export function weiToEth(wei: string): number {
  if (!wei) return 0
  // Split to keep precision for very large values before dividing.
  try {
    const b = BigInt(wei)
    const whole = b / 1000000000000000000n
    const frac = b % 1000000000000000000n
    return Number(whole) + Number(frac) / WEI
  } catch {
    return Number(wei) / WEI
  }
}

export function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

interface TxEvent {
  hash: string
  t: number
  ethOut: number
  ethIn: number
  gas: number
  tokensIn: boolean
  tokensOut: boolean
}

/**
 * Collapse the raw lists into one event per transaction hash.
 *
 * Definitions used across the dashboard:
 * - Gas spent: gasUsed × gasPrice for every transaction the wallet signed (sent).
 * - Token buy: a transaction in which the wallet paid native ETH and received an ERC-20 token.
 *   Buy volume is the ETH paid.
 * - Token sell: a transaction in which the wallet sent an ERC-20 token and received native ETH
 *   (directly or through an internal transfer). Sell volume is the ETH received.
 * - Profit/loss: sell volume − buy volume − gas spent. Realized, in ETH; holdings are not priced.
 */
export function buildEvents(wallet: string, history: Pick<ChainHistory, 'txs' | 'internals' | 'tokenTxs'>): TxEvent[] {
  const events = new Map<string, TxEvent>()
  const get = (hash: string, t: number): TxEvent => {
    let e = events.get(hash)
    if (!e) {
      e = { hash, t, ethOut: 0, ethIn: 0, gas: 0, tokensIn: false, tokensOut: false }
      events.set(hash, e)
    }
    if (t && (!e.t || t < e.t)) e.t = t
    return e
  }
  for (const tx of history.txs) {
    const e = get(tx.hash, tx.timestamp)
    const fromWallet = same(tx.from, wallet)
    if (fromWallet) {
      e.gas += tx.fee ? weiToEth(tx.fee) : weiToEth(tx.gasUsed) * weiToEth(tx.gasPrice) * WEI
      if (!tx.isError) e.ethOut += weiToEth(tx.value)
    }
    if (!tx.isError && same(tx.to, wallet) && !fromWallet) e.ethIn += weiToEth(tx.value)
  }
  for (const it of history.internals) {
    const e = get(it.hash, it.timestamp)
    if (same(it.to, wallet) && !same(it.from, wallet)) e.ethIn += weiToEth(it.value)
    else if (same(it.from, wallet) && !same(it.to, wallet)) e.ethOut += weiToEth(it.value)
  }
  for (const tt of history.tokenTxs) {
    const e = get(tt.hash, tt.timestamp)
    if (same(tt.to, wallet)) e.tokensIn = true
    if (same(tt.from, wallet)) e.tokensOut = true
  }
  return [...events.values()].sort((a, b) => a.t - b.t)
}

const DAY = 86400

export function computeMetrics(wallet: string, histories: ChainHistory[]): Metrics {
  const events = histories
    .filter((h) => !h.error)
    .flatMap((h) => buildEvents(wallet, h))
    .sort((a, b) => a.t - b.t)

  let gas = 0
  let buy = 0
  let sell = 0
  let trades = 0
  const series: SeriesPoint[] = []
  let firstSeen: number | null = null
  for (const h of histories) {
    if (!h.error && h.firstSeenHint && (firstSeen === null || h.firstSeenHint < firstSeen)) firstSeen = h.firstSeenHint
  }

  for (const e of events) {
    if (e.t && (firstSeen === null || e.t < firstSeen)) firstSeen = e.t
    gas += e.gas
    if (e.tokensIn && e.ethOut > 0) {
      buy += e.ethOut
      trades++
    }
    if (e.tokensOut && e.ethIn > 0) {
      sell += e.ethIn
      trades++
    }
    const bucket = Math.floor(e.t / DAY) * DAY
    const point: SeriesPoint = { t: bucket, gas, buy, sell, pnl: sell - buy - gas }
    const last = series[series.length - 1]
    if (last && last.t === bucket) series[series.length - 1] = point
    else series.push(point)
  }

  return {
    firstSeen,
    gasEth: gas,
    buyEth: buy,
    sellEth: sell,
    pnlEth: sell - buy - gas,
    txCount: events.length,
    tradeCount: trades,
    series,
  }
}

export interface AgeParts {
  years: number
  months: number
  days: number
}

export function walletAge(firstSeen: number, now: number): AgeParts {
  const a = new Date(firstSeen * 1000)
  const b = new Date(now * 1000)
  let years = b.getUTCFullYear() - a.getUTCFullYear()
  let months = b.getUTCMonth() - a.getUTCMonth()
  let days = b.getUTCDate() - a.getUTCDate()
  if (days < 0) {
    months--
    const prevMonth = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0))
    days += prevMonth.getUTCDate()
  }
  if (months < 0) {
    years--
    months += 12
  }
  return { years, months, days }
}

export function formatAge(parts: AgeParts): string {
  const bits: string[] = []
  if (parts.years) bits.push(`${parts.years} ${parts.years === 1 ? 'year' : 'years'}`)
  if (parts.months) bits.push(`${parts.months} ${parts.months === 1 ? 'month' : 'months'}`)
  if (!parts.years && (parts.days || !parts.months)) bits.push(`${parts.days} ${parts.days === 1 ? 'day' : 'days'}`)
  return bits.join(', ')
}

export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim())
}
