import { useCallback, useEffect, useRef } from 'react'
import type { EditorState } from './editor-session-shared'

export type EditorCaretPlacement = 'start' | 'end'

interface UseEditorFocusOptions {
  editor: EditorState | null
  preferTagFocusRef: React.RefObject<boolean>
  suppressNextBodyFocusRef: React.RefObject<boolean>
}

export interface EditorFocusResult {
  bodyRef: React.RefObject<HTMLTextAreaElement | null>
  titleInputRef: React.RefObject<HTMLInputElement | null>
  timestampInputRef: React.RefObject<HTMLInputElement | null>
  tagInputRef: React.RefObject<HTMLInputElement | null>
  focusBody: (placement?: EditorCaretPlacement) => void
  focusTitle: (placement?: EditorCaretPlacement) => void
  focusTimestamp: (placement?: EditorCaretPlacement) => void
  focusTagInput: (placement?: EditorCaretPlacement) => void
}

export function useEditorFocus({
  editor,
  preferTagFocusRef,
  suppressNextBodyFocusRef,
}: UseEditorFocusOptions): EditorFocusResult {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const timestampInputRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)
  const lastBodyPrimedSessionRef = useRef<number | null>(null)

  const focusBody = useCallback((placement?: EditorCaretPlacement) => {
    requestAnimationFrame(() => focusInput(bodyRef.current, placement))
  }, [])

  const focusTitle = useCallback((placement?: EditorCaretPlacement) => {
    requestAnimationFrame(() => focusInput(titleInputRef.current, placement))
  }, [])

  const focusTimestamp = useCallback((placement?: EditorCaretPlacement) => {
    requestAnimationFrame(() => focusInput(timestampInputRef.current, placement))
  }, [])

  const focusTagInput = useCallback((placement?: EditorCaretPlacement) => {
    requestAnimationFrame(() => focusInput(tagInputRef.current, placement))
  }, [])

  useEffect(() => {
    if (!editor?.editing) return
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null
    const activeInsideEditor =
      activeElement instanceof HTMLElement && activeElement.closest('.note-editor') !== null

    if (editor.editingTitle) {
      if (activeElement === titleInputRef.current) return
      const timer = window.setTimeout(() => titleInputRef.current?.focus(), 40)
      return () => window.clearTimeout(timer)
    }
    if (editor.editingTimestamp) {
      if (activeElement === timestampInputRef.current) return
      const timer = window.setTimeout(() => timestampInputRef.current?.focus(), 40)
      return () => window.clearTimeout(timer)
    }
    if (preferTagFocusRef.current) {
      preferTagFocusRef.current = false
      if (activeElement === tagInputRef.current) return
      const timer = window.setTimeout(() => tagInputRef.current?.focus(), 40)
      return () => window.clearTimeout(timer)
    }

    const needsInitialBodyFocus = lastBodyPrimedSessionRef.current !== editor.sessionKey
    if (needsInitialBodyFocus) {
      lastBodyPrimedSessionRef.current = editor.sessionKey
      if (suppressNextBodyFocusRef.current) {
        suppressNextBodyFocusRef.current = false
        return
      }
      const timer = window.setTimeout(() => bodyRef.current?.focus(), 40)
      return () => window.clearTimeout(timer)
    }

    if (activeInsideEditor) return

    const timer = window.setTimeout(() => bodyRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [editor, preferTagFocusRef, suppressNextBodyFocusRef])

  return {
    bodyRef,
    titleInputRef,
    timestampInputRef,
    tagInputRef,
    focusBody,
    focusTitle,
    focusTimestamp,
    focusTagInput,
  }
}

function focusInput(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  placement?: EditorCaretPlacement,
): void {
  if (!element) return

  element.focus()
  if (!placement) return

  const position = placement === 'start' ? 0 : element.value.length
  element.setSelectionRange(position, position)
}
