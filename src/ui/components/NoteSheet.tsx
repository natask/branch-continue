import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface NoteSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}

/** A native modal keeps keyboard focus and background interaction inside the sheet. */
export function NoteSheet({ open, title, onClose, children, className = '' }: NoteSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    dialog.querySelector<HTMLElement>('textarea, select, input:not([type="hidden"])')?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`note-sheet ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }}
      onKeyDown={(event) => {
        // Background editor shortcuts must not act through a modal sheet.
        event.stopPropagation()
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )].filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          closeRef.current()
        }
      }}
    >
      <header className="note-sheet-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="note-sheet-close" aria-label="Done" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="note-sheet-content">{children}</div>
    </dialog>,
    document.body,
  )
}
