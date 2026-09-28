import cn from 'classnames'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Button } from '../button/button'
import styles from './modal.module.css'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  className?: string
}

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
