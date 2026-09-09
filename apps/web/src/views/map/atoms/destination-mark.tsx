/** The project page's destination halo and flag, shared by map headers and ledger endpoints. */
export function DestinationMark({ x, y }: { x: number; y: number }) {
  return (
    <g className="destination-mark">
      <circle className="destination-halo" cx={x} cy={y} r="18" />
      <text className="destination-glyph" x={x} y={y + 7} textAnchor="middle">
        ⚑
      </text>
    </g>
  )
}

/** The same destination mark in an HTML-sized SVG for accordion headers. */
export function InlineDestinationMark() {
  return (
    <svg className="fl-flag" viewBox="-20 -20 40 40" aria-hidden="true" focusable="false">
      <DestinationMark x={0} y={0} />
    </svg>
  )
}
