import { useCallback } from 'react'
import type React from 'react'
import type { EditorState, SetEditorState } from './editor-session-shared'
import { resolveAdjacentEditorSection, resolveBodyCaretLineMove } from '../lib/editor-section-nav'
import type { EditorCaretPlacement } from './use-editor-focus'

interface UseEditorFieldsOptions {
  editorRef: React.RefObject<EditorState | null>
  setEditorState: SetEditorState
  updateCurrent: (updater: (current: EditorState) => EditorState) => void
  markEditorDirty: (patch: Partial<EditorState>) => void
  commitDraftTitle: (title: string) => void
  commitDraftTimestamp: (timestamp: string | null) => void
  commitDraftBody: (body: string) => void
  focusBody: (placement?: EditorCaretPlacement) => void
  focusTitle: (placement?: EditorCaretPlacement) => void
  focusTimestamp: (placement?: EditorCaretPlacement) => void
  focusTagInput: (placement?: EditorCaretPlacement) => void
  preferTagFocusRef: React.RefObject<boolean>
  handleBranchFromEditor: () => Promise<void>
}

interface UseEditorFieldsResult {
  toggleEdit: () => void
  beginTitleEdit: () => void
  stopTitleEdit: () => void
  submitTitleEdit: () => void
  finishTitleEditToTags: () => void
  updateTitle: (title: string) => void
  handleTitleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  beginTimestampEdit: () => void
  stopTimestampEdit: () => void
  submitTimestampEdit: () => void
  moveTimestampEditToTitle: () => void
  updateTimestamp: (timestamp: string) => void
  handleTimestampKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  updateBody: (body: string) => void
  handleBodyKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

export function useEditorFields({
  editorRef,
  setEditorState,
  updateCurrent,
  markEditorDirty,
  commitDraftTitle,
  commitDraftTimestamp,
  commitDraftBody,
  focusBody,
  focusTitle,
  focusTimestamp,
  focusTagInput,
  preferTagFocusRef,
  handleBranchFromEditor,
}: UseEditorFieldsOptions): UseEditorFieldsResult {
  const moveFromSection = useCallback(
    (currentSection: 'title' | 'timestamp' | 'body', direction: 'previous' | 'next') => {
      const current = editorRef.current
      if (!current) return

      const destination = resolveAdjacentEditorSection(currentSection, direction, Boolean(current.timestamp))
      if (!destination) return

      const placement: EditorCaretPlacement = direction === 'previous' ? 'end' : 'start'
      setEditorState({
        ...current,
        editingTitle: destination === 'title',
        editingTimestamp: destination === 'timestamp',
        editingTagIndex: null,
        editingTagValue: '',
      })

      if (destination === 'title') {
        focusTitle(placement)
        return
      }
      if (destination === 'timestamp') {
        focusTimestamp(placement)
        return
      }
      if (destination === 'tags') {
        preferTagFocusRef.current = true
        focusTagInput(placement)
        return
      }
      focusBody(placement)
    },
    [
      editorRef,
      focusBody,
      focusTagInput,
      focusTimestamp,
      focusTitle,
      preferTagFocusRef,
      setEditorState,
    ],
  )

  const toggleEdit = useCallback(() => {
    updateCurrent((current) => ({ ...current, editing: !current.editing }))
  }, [updateCurrent])

  const beginTitleEdit = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTitle: true }))
  }, [updateCurrent])

  const stopTitleEdit = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTitle: false }))
  }, [updateCurrent])

  const submitTitleEdit = useCallback(() => {
    const current = editorRef.current
    if (!current) return
    if (current.timestamp) {
      setEditorState({ ...current, editingTitle: false, editingTimestamp: true })
      focusTimestamp()
      return
    }
    setEditorState({ ...current, editingTitle: false })
    focusTagInput()
  }, [editorRef, focusTagInput, focusTimestamp, setEditorState])

  const finishTitleEditToTags = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTitle: false }))
    focusTagInput()
  }, [focusTagInput, updateCurrent])

  const updateTitle = useCallback(
    (title: string) => {
      markEditorDirty({ title })
      commitDraftTitle(title)
    },
    [commitDraftTitle, markEditorDirty],
  )

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submitTitleEdit()
        return
      }

      if (isNextFieldShortcut(event)) {
        event.preventDefault()
        moveFromSection('title', 'next')
        return
      }

      if (isPreviousFieldShortcut(event)) {
        event.preventDefault()
        moveFromSection('title', 'previous')
      }
    },
    [moveFromSection, submitTitleEdit],
  )

  const beginTimestampEdit = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTimestamp: true }))
  }, [updateCurrent])

  const stopTimestampEdit = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTimestamp: false }))
  }, [updateCurrent])

  const submitTimestampEdit = useCallback(() => {
    preferTagFocusRef.current = true
    updateCurrent((current) => ({ ...current, editingTimestamp: false }))
    focusTagInput()
  }, [focusTagInput, preferTagFocusRef, updateCurrent])

  const moveTimestampEditToTitle = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTimestamp: false, editingTitle: true }))
    focusTitle()
  }, [focusTitle, updateCurrent])

  const updateTimestamp = useCallback(
    (timestamp: string) => {
      markEditorDirty({ timestamp })
      commitDraftTimestamp(timestamp)
    },
    [commitDraftTimestamp, markEditorDirty],
  )

  const handleTimestampKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submitTimestampEdit()
        return
      }

      if (isPreviousFieldShortcut(event)) {
        event.preventDefault()
        moveFromSection('timestamp', 'previous')
        return
      }

      if (isNextFieldShortcut(event)) {
        event.preventDefault()
        moveFromSection('timestamp', 'next')
        return
      }

      if (event.key === 'Backspace' && !event.currentTarget.value) {
        event.preventDefault()
        moveFromSection('timestamp', 'previous')
      }
    },
    [moveFromSection, submitTimestampEdit],
  )

  const updateBody = useCallback(
    (body: string) => {
      markEditorDirty({ body })
      commitDraftBody(body)
    },
    [commitDraftBody, markEditorDirty],
  )

  const handleBodyKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleBranchFromEditor()
        return
      }

      const sectionMoveDirection = resolveFieldShortcutDirection(event)
      if (sectionMoveDirection) {
        const textarea = event.currentTarget
        const nextCaret = resolveBodyCaretLineMove({
          value: textarea.value,
          selectionStart: textarea.selectionStart,
          selectionEnd: textarea.selectionEnd,
          direction: sectionMoveDirection,
        })
        event.preventDefault()
        if (nextCaret === null) {
          if (sectionMoveDirection === 'previous') moveFromSection('body', 'previous')
          return
        }
        textarea.setSelectionRange(nextCaret, nextCaret)
        return
      }

      if (
        event.key === 'Backspace' &&
        event.currentTarget.selectionStart === 0 &&
        event.currentTarget.selectionEnd === 0
      ) {
        event.preventDefault()
        focusTagInput()
        return
      }

    },
    [focusTagInput, handleBranchFromEditor, moveFromSection],
  )

  return {
    toggleEdit,
    beginTitleEdit,
    stopTitleEdit,
    submitTitleEdit,
    finishTitleEditToTags,
    updateTitle,
    handleTitleKeyDown,
    beginTimestampEdit,
    stopTimestampEdit,
    submitTimestampEdit,
    moveTimestampEditToTitle,
    updateTimestamp,
    handleTimestampKeyDown,
    updateBody,
    handleBodyKeyDown,
  }
}

function isPreviousFieldShortcut(event: React.KeyboardEvent<HTMLElement>): boolean {
  return isFieldShortcut(event, 'p')
}

function isNextFieldShortcut(event: React.KeyboardEvent<HTMLElement>): boolean {
  return isFieldShortcut(event, 'n')
}

function resolveFieldShortcutDirection(event: React.KeyboardEvent<HTMLElement>): 'previous' | 'next' | null {
  if (isPreviousFieldShortcut(event)) return 'previous'
  if (isNextFieldShortcut(event)) return 'next'
  return null
}

function isFieldShortcut(event: React.KeyboardEvent<HTMLElement>, key: 'p' | 'n'): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === key
}
