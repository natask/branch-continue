import { useCallback, useEffect, useRef } from 'react'
import type { EditorState } from './editor-session-shared'

interface UseEditorFocusOptions {
  editor: EditorState | null
  preferTagFocusRef: React.RefObject<boolean>
}

export interface EditorFocusResult {
  bodyRef: React.RefObject<HTMLTextAreaElement | null>
  titleInputRef: React.RefObject<HTMLInputElement | null>
  timestampInputRef: React.RefObject<HTMLInputElement | null>
  tagInputRef: React.RefObject<HTMLInputElement | null>
  focusBody: () => void
  focusTitle: () => void
  focusTimestamp: () => void
  focusTagInput: () => void
}

export function useEditorFocus({ editor, preferTagFocusRef }: UseEditorFocusOptions): EditorFocusResult {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const timestampInputRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const focusBody = useCallback(() => {
    requestAnimationFrame(() => bodyRef.current?.focus())
  }, [])

  const focusTitle = useCallback(() => {
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }, [])

  const focusTimestamp = useCallback(() => {
    requestAnimationFrame(() => timestampInputRef.current?.focus())
  }, [])

  const focusTagInput = useCallback(() => {
    requestAnimationFrame(() => tagInputRef.current?.focus())
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
    if (editor.isNew && editor.tags.length === 0 && !editor.body) {
      if (activeElement === tagInputRef.current) return
      const timer = window.setTimeout(() => tagInputRef.current?.focus(), 40)
      return () => window.clearTimeout(timer)
    }
    if (preferTagFocusRef.current) {
      preferTagFocusRef.current = false
      if (activeElement === tagInputRef.current) return
      const timer = window.setTimeout(() => tagInputRef.current?.focus(), 40)
      return () => window.clearTimeout(timer)
    }

    if (activeInsideEditor) return

    const timer = window.setTimeout(() => bodyRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [editor, preferTagFocusRef])

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
