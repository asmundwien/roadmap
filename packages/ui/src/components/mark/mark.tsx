import classNames from 'classnames/bind'
import type { Variant } from '../variant'
import styles from './mark.module.css'

const cx = classNames.bind(styles)

export type MarkSize = 'large' | 'medium' | 'small'
export type MarkFill = 'solid' | 'half' | 'outline'
export type MarkCornerCount = 0 | 1 | 2 | 3 | 4

export type MarkProps = {
  accent?: Variant
  corners?: MarkCornerCount
  fill: MarkFill
  glyph?: string
  size: MarkSize
  variant: Variant
}

const SIZE_ATTRIBUTES = {
  large: { height: 32, width: 32, x: -16, y: -16 },
  medium: { height: 12, width: 12, x: -6, y: -6 },
  small: { height: '0.625em', width: '0.625em', x: '-0.3125em', y: '-0.3125em' },
} as const satisfies Record<
  MarkSize,
  { height: number | string; width: number | string; x: number | string; y: number | string }
>

/** Half the drawn width of a medium mark, for consumers that lay out around it. */
export const MEDIUM_MARK_EXTENT = SIZE_ATTRIBUTES.medium.width / 2

const FACE_PATH = 'M 0 -14.667 L 14.667 0 L 0 14.667 L -14.667 0 Z'
const HALF_PATH = 'M 0 -14.667 L 0 14.667 L -14.667 0 Z'

/**
 * A diamond mark with a closed presentational vocabulary. The mark owns its coordinate system;
 * SVG consumers translate a wrapper, HTML consumers place it inline. It carries no domain meaning:
 * callers map their own facts onto variant, fill, glyph, corners, and accent.
 *
 * Only the small size and the solid and outline fills change the root: the large and medium sizes
 * differ by attribute alone, and the half fill is drawn by its own path.
 */
export function Mark({ accent, corners = 0, fill, glyph, size, variant }: MarkProps) {
  return (
    <svg
      className={cx(
        'mark',
        variant,
        size === 'small' && 'small',
        fill !== 'half' && fill,
        accent !== undefined && `corner-${accent}`,
      )}
      viewBox="-16 -16 32 32"
      aria-hidden="true"
      focusable="false"
      {...SIZE_ATTRIBUTES[size]}
    >
      <path className={cx('face')} d={FACE_PATH} />
      {fill === 'half' && <path className={cx('half')} d={HALF_PATH} />}
      {glyph !== undefined && (
        <text className={cx('glyph')} x="0" y="4.4" textAnchor="middle">
          {glyph}
        </text>
      )}
      <MarkCorners count={corners} />
    </svg>
  )
}

type MarkCornersProps = { count: MarkCornerCount }

function MarkCorners({ count }: MarkCornersProps) {
  if (count === 0) return null
  return (
    <g>
      <path className={cx('corner')} d="M -9.333 -5.333 L 0 -14.667" />
      {count >= 2 && <path className={cx('corner')} d="M 5.333 -9.333 L 14.667 0" />}
      {count >= 3 && <path className={cx('corner')} d="M 9.333 5.333 L 0 14.667" />}
      {count === 4 && <path className={cx('corner')} d="M -5.333 9.333 L -14.667 0" />}
    </g>
  )
}
