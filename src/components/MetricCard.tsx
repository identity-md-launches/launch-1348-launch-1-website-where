import type { ReactNode } from 'react'

interface Props {
  label: string
  value: ReactNode
  detail?: ReactNode
  /** 'up' or 'down' adds a text cue beside a profit or loss, so color is never the only signal. */
  trend?: 'up' | 'down' | 'flat'
}

export function MetricCard({ label, value, detail, trend }: Props) {
  return (
    <div className="metric">
      <h3 className="metric-label">{label}</h3>
      <p className={`metric-value num${trend ? ` metric-${trend}` : ''}`}>
        {trend === 'up' && <span className="metric-trend">Profit</span>}
        {trend === 'down' && <span className="metric-trend">Loss</span>}
        {trend === 'up' || trend === 'down' ? ' ' : null}
        {value}
      </p>
      {detail && <p className="metric-detail">{detail}</p>}
    </div>
  )
}
