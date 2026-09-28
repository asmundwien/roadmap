import classNames from 'classnames'
import bind from 'classnames/bind'
import type { ChangeEventHandler, InputHTMLAttributes, ReactNode } from 'react'
import styles from './toggle.module.css'

const cx = bind.bind(styles)

export type ToggleProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | 'type'
  | 'role'
  | 'checked'
  | 'defaultChecked'
  | 'onChange'
  | 'children'
  | 'className'
  | 'aria-checked'
  | 'aria-busy'
> & {
  /** The confirmed off/on state, or the neutral position while an action is pending. */
  state: 'off' | 'pending' | 'on'
  /** Called with the next native checkbox value. Set `disabled` to prevent changes while pending. */
  onChange: ChangeEventHandler<HTMLInputElement>
  /** Visible label. Without children, supply `aria-label` or `aria-labelledby`. */
  children?: ReactNode
  className?: string
}

/** A controlled switch. Pending is announced as busy and never represented as an ARIA mixed switch. */
export function Toggle({ children, className, state, onChange, ...props }: ToggleProps) {
  return (
    <>
      <label className={classNames(cx('toggle', state), className)}>
        <input
          {...props}
          type="checkbox"
          role="switch"
          checked={state === 'on'}
          aria-checked={state === 'on'}
          aria-busy={state === 'pending' || undefined}
          onChange={onChange}
          className={cx('input')}
        />
        <span aria-hidden="true" className={cx('track')} />
        {children && <span className={cx('label')}>{children}</span>}
      </label>
      {state === 'pending' && (
        <span role="status" className={cx('status')}>
          Pending
        </span>
      )}
    </>
  )
}
