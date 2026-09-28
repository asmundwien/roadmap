import cn from 'classnames'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Button } from '../button/button'
import styles from './modal.module.css'

/** Props for a controlled native modal dialog. */
export type ModalProps = {
  /** Whether to show the dialog; the caller must update this after `onClose`. */
  open: boolean
  /** Called for the Close button, Escape key, or a pointer release on the backdrop. */
  onClose: () => void
  /** Text displayed as the heading and used to label the dialog for assistive technology. */
  title: string
  children: ReactNode
  className?: string
}

/**
 * Shows a native modal dialog while `open` is true. Restores the previously focused element
 * when it closes, if that element is still connected.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) return
    const previousFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={cn(styles.modal, className)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onPointerUp={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose()
        }
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      </header>
      {children}
    </dialog>
  )
}
