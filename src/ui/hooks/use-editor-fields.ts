import { useCallback } from 'react'
import type React from 'react'
import type { EditorState, SetEditorState } from './editor-session-shared'

interface UseEditorFieldsOptions {
  editorRef: React.RefObject<EditorState | null>
  setEditorState: SetEditorState
  updateCurrent: (updater: (current: EditorState) => EditorState) => void
  markEditorDirty: (patch: Partial<EditorState>) => void
  commitDraftTitle: (title: string) => void
  commitDraftTimestamp: (timestamp: string | null) => void
  commitDraftBody: (body: string) => void
  focusTitle: () => void
  focusTimestamp: () => void
  focusTagInput: () => void
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
  beginTimestampEdit: () => void
  stopTimestampEdit: () => void
  submitTimestampEdit: () => void
  moveTimestampEditToTitle: () => void
  updateTimestamp: (timestamp: string) => void
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
  focusTitle,
  focusTimestamp,
  focusTagInput,
  preferTagFocusRef,
  handleBranchFromEditor,
}: UseEditorFieldsOptions): UseEditorFieldsResult {
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

      if (
        event.key === 'Backspace' &&
        event.currentTarget.selectionStart === 0 &&
        event.currentTarget.selectionEnd === 0
      ) {
        event.preventDefault()
        focusTagInput()
        return
      }

      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault()
        const textarea = event.currentTarget
        const { value, selectionStart, selectionEnd } = textarea
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
        let lineEnd = value.indexOf('\n', selectionEnd)
        if (lineEnd === -1) lineEnd = value.length
        else lineEnd += 1
        const body = value.slice(0, lineStart) + value.slice(lineEnd)
        updateBody(body)
        requestAnimationFrame(() => {
          textarea.selectionStart = lineStart
          textarea.selectionEnd = lineStart
        })
      }
    },
    [focusTagInput, handleBranchFromEditor, updateBody],
  )

  return {
    toggleEdit,
    beginTitleEdit,
    stopTitleEdit,
    submitTitleEdit,
    finishTitleEditToTags,
    updateTitle,
    beginTimestampEdit,
    stopTimestampEdit,
    submitTimestampEdit,
    moveTimestampEditToTitle,
    updateTimestamp,
    updateBody,
    handleBodyKeyDown,
  }
}
