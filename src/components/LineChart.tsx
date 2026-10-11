import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { SeriesPoint } from '../lib/metrics'
import { chartHeight, yScale } from '../lib/chart'
import { fmtAxis, fmtDate, fmtEth } from '../lib/format'

export type SeriesKey = 'gas' | 'buy' | 'sell' | 'pnl'

interface Props {
  title: string
  description: string
  points: SeriesPoint[]
  field: SeriesKey
  /** CSS color token for the line, e.g. `var(--chart-gas)`. */
  color: string
}

const DEFAULT_W = 640
const PAD = { top: 16, right: 16, bottom: 34, left: 56 }

/**
 * Cumulative line chart drawn as inline SVG. The viewBox is set to the figure's measured width,
 * so one SVG unit is one CSS pixel and the 12px tick labels and 2.5px stroke render at their
 * declared size at every viewport. The figure carries the accessible name and a text summary.
 */
export function LineChart({ title, description, points, field, color }: Props) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const figureRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(DEFAULT_W)

  useLayoutEffect(() => {
    const el = figureRef.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (inner > 0) setWidth(Math.round(inner))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (points.length === 0) {
    return (
      <figure className="chart" ref={figureRef}>
        <figcaption>
          <h3 className="chart-title">{title}</h3>
          <p className="chart-desc">{description}</p>
        </figcaption>
        <p className="chart-empty">No activity to chart on this chain.</p>
      </figure>
    )
  }

  const W = width
  const H = chartHeight(width)
  const xs = points.map((p) => p.t)
  const ys = points.map((p) => p[field])
  const x0 = xs[0]
  const x1 = xs[xs.length - 1]
  const { yMin, yMax, ticks } = yScale(ys)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const sy = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * innerH

  // Step line: a cumulative value holds until the next event, and extends to today.
  const now = Math.floor(Date.now() / 1000)
  const endT = Math.max(x1, now)
  const sxEnd = (t: number) => PAD.left + ((t - x0) / Math.max(1, endT - x0)) * innerW
  const path =
    points
      .map((p, i) => {
        const x = sxEnd(p.t)
        const y = sy(p[field])
        if (i === 0) return `M${x.toFixed(1)},${y.toFixed(1)}`
        const prevY = sy(points[i - 1][field])
        return `L${x.toFixed(1)},${prevY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ') + ` L${(PAD.left + innerW).toFixed(1)},${sy(ys[ys.length - 1]).toFixed(1)}`

  const zeroY = sy(0)
  const latest = ys[ys.length - 1]
  const hovered = hover === null ? null : points[hover]

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = ((e.clientX - rect.left) / rect.width) * W
    const t = x0 + ((rel - PAD.left) / innerW) * Math.max(1, endT - x0)
    let idx = 0
    for (let i = 0; i < points.length; i++) if (points[i].t <= t) idx = i
    setHover(idx)
  }

  return (
    <figure className="chart" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`} ref={figureRef}>
      <figcaption>
        <h3 className="chart-title" id={`${id}-title`}>
          {title}
        </h3>
        <p className="chart-desc">{description}</p>
      </figcaption>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`${title}, cumulative over time. Latest value ${fmtEth(latest)}.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ ['--line' as string]: color }}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} />
            <text className="chart-tick" x={PAD.left - 8} y={sy(v)} textAnchor="end" dominantBaseline="middle">
              {fmtAxis(v)}
            </text>
          </g>
        ))}
        {yMin < 0 && <line className="chart-zero" x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} />}
        <text className="chart-tick" x={PAD.left} y={H - 10} textAnchor="start">
          {fmtDate(x0)}
        </text>
        <text className="chart-tick" x={W - PAD.right} y={H - 10} textAnchor="end">
          {fmtDate(endT)}
        </text>
        <path className="chart-line" d={path} />
        {hovered && (
          <g>
            <line
              className="chart-cursor"
              x1={sxEnd(hovered.t)}
              x2={sxEnd(hovered.t)}
              y1={PAD.top}
              y2={PAD.top + innerH}
            />
            <circle className="chart-dot" cx={sxEnd(hovered.t)} cy={sy(hovered[field])} r="4" />
          </g>
        )}
      </svg>
      <p className="chart-summary" id={`${id}-summary`}>
        {hovered ? (
          <>
            <span className="chart-summary-date">{fmtDate(hovered.t)}</span> <span className="num">{fmtEth(hovered[field])}</span>
          </>
        ) : (
          <>
            <span className="chart-summary-date">Today</span> <span className="num">{fmtEth(latest)}</span>
          </>
        )}
      </p>
    </figure>
  )
}
