import './destination-mark.css'

type DestinationMarkProps = { variant: 'plot'; x: number; y: number } | { variant: 'header' }

/** The destination halo and flag at plot coordinates or wrapped for HTML contexts. */
export function DestinationMark(props: DestinationMarkProps) {
  if (props.variant !== 'plot') {
    return (
      <svg
        className={`destination-mark-${props.variant}`}
        viewBox="-20 -20 40 40"
        aria-hidden="true"
        focusable="false"
      >
        <DestinationMark variant="plot" x={0} y={0} />
      </svg>
    )
  }

  const { x, y } = props
  return (
    <g className="destination-mark">
      <circle className="destination-halo" cx={x} cy={y} r="18" />
      <text className="destination-glyph" x={x} y={y + 7} textAnchor="middle">
        ⚑
      </text>
    </g>
  )
}
