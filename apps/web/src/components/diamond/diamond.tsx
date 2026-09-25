type DiamondProps = {
  className: string
  x: number
  y: number
  radius: number
}

export function Diamond({ className, x, y, radius }: DiamondProps) {
  return (
    <path
      className={className}
      d={`M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`}
    />
  )
}
