export function Diamond({
  className,
  x,
  y,
  radius,
}: {
  className: string
  x: number
  y: number
  radius: number
}) {
  return (
    <path
      className={className}
      d={`M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`}
    />
  )
}
