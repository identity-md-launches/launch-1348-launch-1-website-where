// Pure chart scale helpers, kept out of the component so they can be unit tested in node.

export interface YScale {
  /** Domain bottom and top of the plot area, including the breathing room above and below the data. */
  yMin: number
  yMax: number
  /** Gridline values: the data floor (never above 0), the midpoint and the data ceiling; a flat zero series gets one line at 0. */
  ticks: number[]
}

/**
 * The gridlines sit on the data's own floor and ceiling so a cumulative series is read against
 * its zero line. Only the plot area gets 8% of padding; the labels never move off the real values.
 */
export function yScale(ys: number[]): YScale {
  // The domain always includes 0, so a loss-only profit series still shows its zero line.
  const lo = Math.min(0, ...ys)
  const hi = Math.max(0, ...ys)
  if (!(hi > lo)) return { yMin: 0, yMax: 1, ticks: [0] }
  const pad = (hi - lo) * 0.08
  return { yMin: lo < 0 ? lo - pad : 0, yMax: hi + pad, ticks: [lo, (lo + hi) / 2, hi] }
}

/** Chart height for a given rendered width: a 2.5:1 panel on wide cards, taller on narrow ones. */
export function chartHeight(width: number): number {
  return Math.round(Math.min(260, Math.max(180, width * 0.4)))
}
