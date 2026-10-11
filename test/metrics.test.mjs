// Unit tests for the pure metric and chart-scale code. Run: npm test (Node 22.6+ strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvents, computeMetrics, formatAge, isAddress, walletAge, weiToEth } from '../src/lib/metrics.ts'
import { chartHeight, yScale } from '../src/lib/chart.ts'

const W = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const O = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const DAY = 86400
const tx = (o) => ({ hash: '0x1', timestamp: 1_700_000_000, from: W, to: O, value: '0', gasUsed: '21000', gasPrice: '1000000000', fee: null, isError: false, ...o })
const token = (o) => ({ hash: '0x1', timestamp: 1_700_000_000, from: O, to: W, value: '1', decimals: 18, symbol: 'T', contract: O, ...o })
const cov = { txTotal: null, tokenTotal: null, txFetched: 0, tokenFetched: 0, internalFetched: 0, truncated: false, cutBy: null }
const history = (o) => ({ chainId: 'ethereum', txs: [], internals: [], tokenTxs: [], coverage: cov, firstSeenHint: null, coinPriceUsd: null, error: null, ...o })

test('weiToEth keeps precision on big values', () => {
  assert.equal(weiToEth('1000000000000000000'), 1)
  assert.equal(weiToEth('123456789000000000000000'), 123456.789)
  assert.equal(weiToEth(''), 0)
})

test('gas is charged only on transactions the wallet signed', () => {
  const m = computeMetrics(W, [history({ txs: [tx({}), tx({ hash: '0x2', from: O, to: W })] })])
  assert.equal(m.gasEth, 21000 * 1e-9)
  assert.equal(m.signedCount, 1)
  assert.equal(m.txCount, 2)
})

test('signedCount excludes incoming token transfers the wallet never signed', () => {
  const m = computeMetrics(W, [history({ txs: [tx({})], tokenTxs: [token({ hash: '0x9' }), token({ hash: '0x8' })] })])
  assert.equal(m.txCount, 3)
  assert.equal(m.signedCount, 1)
})

test('a buy is ETH out plus a token in, in the same transaction', () => {
  const m = computeMetrics(W, [history({ txs: [tx({ value: '2000000000000000000' })], tokenTxs: [token({})] })])
  assert.equal(m.buyEth, 2)
  assert.equal(m.sellEth, 0)
  assert.equal(m.tradeCount, 1)
  assert.ok(m.pnlEth < -1.99)
})

test('a sell is a token out plus ETH in through an internal transfer', () => {
  const h = history({
    txs: [tx({})],
    internals: [{ hash: '0x1', timestamp: 1_700_000_000, from: O, to: W, value: '500000000000000000' }],
    tokenTxs: [token({ from: W, to: O })],
  })
  const m = computeMetrics(W, [h])
  assert.equal(m.sellEth, 0.5)
  assert.equal(m.buyEth, 0)
})

test('events with no timestamp count in totals but never become a 1970 point', () => {
  const h = history({ txs: [tx({ hash: '0x1', timestamp: 0 }), tx({ hash: '0x2', timestamp: 1_700_000_000 })] })
  const m = computeMetrics(W, [h])
  assert.equal(m.signedCount, 2)
  assert.equal(m.series.length, 1)
  assert.equal(m.series[0].t, Math.floor(1_700_000_000 / DAY) * DAY)
  assert.equal(m.firstSeen, 1_700_000_000)
  assert.equal(buildEvents(W, h).filter((e) => e.t === 0).length, 1)
})

test('series buckets by UTC day and is cumulative', () => {
  const h = history({ txs: [tx({ hash: '0x1', timestamp: 1_700_000_000 }), tx({ hash: '0x2', timestamp: 1_700_000_100 }), tx({ hash: '0x3', timestamp: 1_700_100_000 })] })
  const m = computeMetrics(W, [h])
  assert.equal(m.series.length, 2)
  assert.ok(m.series[1].gas > m.series[0].gas)
})

test('a chain with an error contributes nothing, and firstSeenHint wins when older', () => {
  const m = computeMetrics(W, [history({ txs: [tx({})], firstSeenHint: 1_500_000_000 }), history({ chainId: 'base', error: 'HTTP 500', txs: [tx({ hash: '0x7' })] })])
  assert.equal(m.firstSeen, 1_500_000_000)
  assert.equal(m.signedCount, 1)
})

test('wallet age arithmetic', () => {
  const age = walletAge(Date.UTC(2015, 8, 28) / 1000, Date.UTC(2026, 9, 11) / 1000)
  assert.deepEqual(age, { years: 11, months: 0, days: 13 })
  assert.equal(formatAge(age), '11 years')
  assert.equal(formatAge({ years: 0, months: 0, days: 0 }), '0 days')
})

test('isAddress', () => {
  assert.ok(isAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
  assert.ok(!isAddress('d8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
  assert.ok(!isAddress('0x123'))
})

test('y-axis ticks start at zero and a flat zero series has no invented scale', () => {
  assert.deepEqual(yScale([0, 0.05, 0.1215]).ticks, [0, 0.06075, 0.1215])
  assert.equal(yScale([0, 0.05, 0.1215]).yMin, 0)
  assert.deepEqual(yScale([0, 0, 0]), { yMin: 0, yMax: 1, ticks: [0] })
  const neg = yScale([0, -0.2, -0.1372])
  assert.equal(neg.ticks[0], -0.2)
  assert.equal(neg.ticks[2], 0)
  assert.ok(neg.yMin < -0.2)
})

test('chart height follows width within bounds', () => {
  assert.equal(chartHeight(288), 180)
  assert.equal(chartHeight(500), 200)
  assert.equal(chartHeight(1000), 260)
})
