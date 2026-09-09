import type { AutomationTag } from '../automation-presentation.ts'
import { Diamond } from './diamond.tsx'

export const AUTOMATION_MARK_RADIUS = 26 / 3

/** The project page's Automation evidence diamond, with an optional status glyph. */
export function AutomationMark({
  stage,
  glyph,
  x,
  y,
}: {
  stage: AutomationTag['stage']
  glyph?: string
  x: number
  y: number
}) {
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

/** The same Automation diamond as an inline legend mark. */
export function InlineAutomationMark({ stage }: { stage: AutomationTag['stage'] }) {
  return (
    <svg
      className="inline-automation-mark"
      viewBox="-10 -10 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <AutomationMark stage={stage} x={0} y={0} />
    </svg>
  )
}
