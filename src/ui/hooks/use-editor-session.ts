import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import type { SourceNote } from '../../core/quicknote/types'
import { editorForBranch, editorFromNote, type EditorState, type UseEditorSessionOptions } from './editor-session-shared'
import { useEditorDraft } from './use-editor-draft'
import { useEditorFields } from './use-editor-fields'
import { useEditorFocus } from './use-editor-focus'
import { useEditorTags } from './use-editor-tags'

export type { EditorState } from './editor-session-shared'

export interface UseEditorSessionResult {
  editor: EditorState | null
  editorOpen: boolean
  saving: boolean
  saveError: string | null
  autoSaveEnabled: boolean
  canUndo: boolean
  canRedo: boolean
  bodyRef: React.RefObject<HTMLTextAreaElement | null>
  titleInputRef: React.RefObject<HTMLInputElement | null>
  timestampInputRef: React.RefObject<HTMLInputElement | null>
  tagInputRef: React.RefObject<HTMLInputElement | null>
  openNoteEditor: (note: SourceNote) => void
  openBranchEditor: (source?: SourceNote | null) => void
  closeEditor: () => void
  flushAutoSave: () => Promise<boolean>
  handleUndo: () => void
  handleRedo: () => void
  handleSaveIndicatorClick: () => void
  toggleAutoSave: () => void
  handleBranchFromEditor: () => Promise<void>
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
  removeTag: (tag: string) => void
  startEditingTag: (index: number) => void
  updateEditingTagValue: (value: string) => void
  commitTagEdit: () => void
  cancelTagEdit: () => void
  handleEditingTagKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  handleTagInputChange: (value: string) => void
  handleTagInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function useEditorSession({
  sourceSelected,
  createNote,
  updateNote,
}: UseEditorSessionOptions): UseEditorSessionResult {
  const [editor, setEditor] = useState<EditorState | null>(null)

  const editorRef = useRef<EditorState | null>(null)
  const editorSessionCounterRef = useRef(1)
  const tagInputEnteredFromBodyRef = useRef(false)
  const preferTagFocusRef = useRef(false)

  const editorOpen = editor !== null

  const setEditorState = useCallback((next: EditorState | null) => {
    editorRef.current = next
    setEditor(next)
  }, [])

  const updateCurrent = useCallback(
    (updater: (current: EditorState) => EditorState) => {
      const current = editorRef.current
      if (!current) return
      setEditorState(updater(current))
    },
    [setEditorState],
  )

  const nextSessionKey = useCallback(() => {
    const key = editorSessionCounterRef.current
    editorSessionCounterRef.current += 1
    return key
  }, [])

  const focus = useEditorFocus({ editor, preferTagFocusRef })

  const draft = useEditorDraft({
    editor,
    editorRef,
    setEditorState,
    sourceSelected,
    createNote,
    updateNote,
  })

  const openNoteEditor = useCallback(
    (note: SourceNote) => {
      draft.clearSaveError()
      setEditorState(editorFromNote(note, nextSessionKey()))
    },
    [draft, nextSessionKey, setEditorState],
  )

  const openBranchEditor = useCallback((source?: SourceNote | null) => {
    draft.clearSaveError()
    setEditorState(editorForBranch(nextSessionKey(), source ?? null))
  }, [draft, nextSessionKey, setEditorState])

  const closeEditor = useCallback(() => {
    if (draft.autoSaveTimerRef.current !== null) {
      window.clearTimeout(draft.autoSaveTimerRef.current)
      draft.autoSaveTimerRef.current = null
    }
    draft.clearSaveError()
    setEditorState(null)
  }, [draft, setEditorState])

  const handleBranchFromEditor = useCallback(async () => {
    const current = editorRef.current
    if (!current) return

    const ok = await draft.flushAutoSave()
    if (!ok) return

    const branchSource = editorRef.current?.source ?? current.source ?? null
    openBranchEditor(branchSource)
  }, [draft, openBranchEditor])

  const fields = useEditorFields({
    editorRef,
    setEditorState,
    updateCurrent,
    markEditorDirty: draft.markEditorDirty,
    commitDraftTitle: draft.commitDraftTitle,
    commitDraftTimestamp: draft.commitDraftTimestamp,
    commitDraftBody: draft.commitDraftBody,
    focusTitle: focus.focusTitle,
    focusTimestamp: focus.focusTimestamp,
    focusTagInput: focus.focusTagInput,
    tagInputEnteredFromBodyRef,
    preferTagFocusRef,
    handleBranchFromEditor,
  })

  const tags = useEditorTags({
    editorRef,
    setEditorState,
    updateCurrent,
    markEditorDirty: draft.markEditorDirty,
    commitDraftTags: draft.commitDraftTags,
    tagInputEnteredFromBodyRef,
    focusTagInput: focus.focusTagInput,
    focusTimestamp: focus.focusTimestamp,
    focusTitle: focus.focusTitle,
  })

  return {
    editor,
    editorOpen,
    saving: draft.saving,
    saveError: draft.saveError,
    autoSaveEnabled: draft.autoSaveEnabled,
    canUndo: draft.canUndo,
    canRedo: draft.canRedo,
    bodyRef: focus.bodyRef,
    titleInputRef: focus.titleInputRef,
    timestampInputRef: focus.timestampInputRef,
    tagInputRef: focus.tagInputRef,
    openNoteEditor,
    openBranchEditor,
    closeEditor,
    flushAutoSave: draft.flushAutoSave,
    handleUndo: draft.handleUndo,
    handleRedo: draft.handleRedo,
    handleSaveIndicatorClick: draft.handleSaveIndicatorClick,
    toggleAutoSave: draft.toggleAutoSave,
    handleBranchFromEditor,
    toggleEdit: fields.toggleEdit,
    beginTitleEdit: fields.beginTitleEdit,
    stopTitleEdit: fields.stopTitleEdit,
    submitTitleEdit: fields.submitTitleEdit,
    finishTitleEditToTags: fields.finishTitleEditToTags,
    updateTitle: fields.updateTitle,
    beginTimestampEdit: fields.beginTimestampEdit,
    stopTimestampEdit: fields.stopTimestampEdit,
    submitTimestampEdit: fields.submitTimestampEdit,
    moveTimestampEditToTitle: fields.moveTimestampEditToTitle,
    updateTimestamp: fields.updateTimestamp,
    updateBody: fields.updateBody,
    handleBodyKeyDown: fields.handleBodyKeyDown,
    removeTag: tags.removeTag,
    startEditingTag: tags.startEditingTag,
    updateEditingTagValue: tags.updateEditingTagValue,
    commitTagEdit: tags.commitTagEdit,
    cancelTagEdit: tags.cancelTagEdit,
    handleEditingTagKeyDown: tags.handleEditingTagKeyDown,
    handleTagInputChange: tags.handleTagInputChange,
    handleTagInputKeyDown: tags.handleTagInputKeyDown,
  }
}
