export function fmtEth(v: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(v)
  let digits = 4
  if (abs >= 1000) digits = 0
  else if (abs >= 10) digits = 2
  else if (abs < 0.001 && abs > 0) digits = 6
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : ''
  return `${sign}${s} ETH`
}

export function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  const s = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  })
  return v < 0 ? `−${s}` : s
}

export function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function fmtMonthYear(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Compact axis label for ETH amounts. */
export function fmtAxis(v: number): string {
  const abs = Math.abs(v)
  let s: string
  if (abs >= 1e6) s = `${(abs / 1e6).toFixed(1)}M`
  else if (abs >= 1e3) s = `${(abs / 1e3).toFixed(1)}k`
  else if (abs >= 10) s = abs.toFixed(0)
  else if (abs >= 1) s = abs.toFixed(1)
  else if (abs === 0) s = '0'
  else s = abs.toPrecision(2)
  return v < 0 ? `−${s}` : s
}
