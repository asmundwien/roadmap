import type { AutomationOverrideStage } from '@roadmap/contracts'
import { Diamond } from '../diamond/diamond.tsx'
import './automation-mark.css'

export const AUTOMATION_MARK_RADIUS = 26 / 3

type AutomationMarkProps =
  | {
      stage: AutomationOverrideStage
      glyph?: string
      variant: 'plot'
      x: number
      y: number
    }
  | {
      stage: AutomationOverrideStage
      variant: 'inline'
    }

/** Automation evidence at plot coordinates or wrapped for inline text. */
export function AutomationMark(props: AutomationMarkProps) {
  if (props.variant === 'inline') {
    return (
      <svg
        className="automation-mark-inline"
        viewBox="-10 -10 20 20"
        aria-hidden="true"
        focusable="false"
      >
        <AutomationMark stage={props.stage} variant="plot" x={0} y={0} />
      </svg>
    )
  }

  const { stage, glyph, x, y } = props
  return (
    <g className={`automation-mark stage-${stage}`}>
      <Diamond className="tag-face" x={x} y={y} radius={AUTOMATION_MARK_RADIUS} />
      {glyph !== undefined && (
        <text className="tag-glyph" x={x} y={y + 10 / 3} textAnchor="middle">
          {glyph}
        </text>
      )}
    </g>
  )
}
