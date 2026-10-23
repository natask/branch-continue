import type { QuickNoteCreateRequest } from '../../core/quicknote/types'
import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import type { SourceNote } from '../../core/quicknote/types'
import {
  editorForBranch,
  editorFromNote,
  type EditorState,
  type OpenEditorOptions,
  type UseEditorSessionOptions,
} from './editor-session-shared'
import { useEditorDraft } from './use-editor-draft'
import { useEditorFields } from './use-editor-fields'
import { useEditorFocus } from './use-editor-focus'
import { useEditorTags } from './use-editor-tags'

export type { EditorState } from './editor-session-shared'

export interface UseEditorSessionResult {
  editor: EditorState | null
  editorOpen: boolean
  /** Returns the synchronous editor ref, including changes made during an awaited save. */
  getCurrentEditor: () => EditorState | null
  /** Refreshes persisted source identity without replacing in-progress editor fields. */
  syncSource: (source: SourceNote, sessionKey: number) => boolean
  saving: boolean
  saveError: string | null
  autoSaveEnabled: boolean
  canUndo: boolean
  canRedo: boolean
  bodyRef: React.RefObject<HTMLTextAreaElement | null>
  titleInputRef: React.RefObject<HTMLInputElement | null>
  timestampInputRef: React.RefObject<HTMLInputElement | null>
  tagInputRef: React.RefObject<HTMLInputElement | null>
  openNoteEditor: (note: SourceNote, options?: OpenEditorOptions) => void
  openBranchEditor: (source?: SourceNote | null) => void
  closeEditor: () => void
  flushAutoSave: (actor?: QuickNoteCreateRequest['actor']) => Promise<boolean>
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
  handleTitleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  beginTimestampEdit: () => void
  stopTimestampEdit: () => void
  submitTimestampEdit: () => void
  moveTimestampEditToTitle: () => void
  updateTimestamp: (timestamp: string) => void
  handleTimestampKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
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
  beforeBranch,
  afterBranch,
}: UseEditorSessionOptions): UseEditorSessionResult {
  const [editor, setEditor] = useState<EditorState | null>(null)

  const editorRef = useRef<EditorState | null>(null)
  const editorSessionCounterRef = useRef(1)
  const tagInputEnteredFromBodyRef = useRef(false)
  const preferTagFocusRef = useRef(false)
  const suppressNextBodyFocusRef = useRef(false)

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

  const syncSource = useCallback((source: SourceNote, sessionKey: number): boolean => {
    const current = editorRef.current
    if (!current || current.sessionKey !== sessionKey) return false
    setEditorState({ ...current, source })
    return true
  }, [setEditorState])

  const nextSessionKey = useCallback(() => {
    const key = editorSessionCounterRef.current
    editorSessionCounterRef.current += 1
    return key
  }, [])

  const focus = useEditorFocus({ editor, preferTagFocusRef, suppressNextBodyFocusRef })

  const draft = useEditorDraft({
    editor,
    editorRef,
    setEditorState,
    sourceSelected,
    createNote,
    updateNote,
  })

  const openNoteEditor = useCallback(
    (note: SourceNote, options?: OpenEditorOptions) => {
      draft.clearSaveError()
      preferTagFocusRef.current = false
      suppressNextBodyFocusRef.current = options?.focusBody === false
      if (suppressNextBodyFocusRef.current) {
        const activeElement = typeof document !== 'undefined' ? document.activeElement : null
        if (activeElement instanceof HTMLElement && activeElement.closest('.note-editor')) {
          activeElement.blur()
        }
      }
      setEditorState(editorFromNote(note, nextSessionKey()))
    },
    [draft, nextSessionKey, preferTagFocusRef, setEditorState, suppressNextBodyFocusRef],
  )

  const openBranchEditor = useCallback((source?: SourceNote | null) => {
    draft.clearSaveError()
    setEditorState(editorForBranch(nextSessionKey(), source ?? null))
  }, [draft, nextSessionKey, setEditorState])

  const closeEditor = useCallback(() => {
    void (async () => {
      const ok = await draft.flushAutoSave()
      if (!ok) return
      draft.clearSaveError()
      setEditorState(null)
    })()
  }, [draft, setEditorState])

  const handleBranchFromEditor = useCallback(async () => {
    const current = editorRef.current
    if (!current) return

    const canBranch = await beforeBranch?.()
    if (canBranch === false) return

    const ok = await draft.flushAutoSave()
    if (!ok) return

    const branchSource = editorRef.current?.source ?? current.source ?? null
    openBranchEditor(branchSource)
    afterBranch?.()
  }, [afterBranch, beforeBranch, draft, openBranchEditor])

  const fields = useEditorFields({
    editorRef,
    setEditorState,
    updateCurrent,
    markEditorDirty: draft.markEditorDirty,
    commitDraftTitle: draft.commitDraftTitle,
    commitDraftTimestamp: draft.commitDraftTimestamp,
    commitDraftBody: draft.commitDraftBody,
    focusBody: focus.focusBody,
    focusTitle: focus.focusTitle,
    focusTimestamp: focus.focusTimestamp,
    focusTagInput: focus.focusTagInput,
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
    focusBody: focus.focusBody,
    focusTagInput: focus.focusTagInput,
    focusTimestamp: focus.focusTimestamp,
    focusTitle: focus.focusTitle,
  })

  return {
    editor,
    editorOpen,
    getCurrentEditor: () => editorRef.current,
    syncSource,
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
    handleTitleKeyDown: fields.handleTitleKeyDown,
    beginTimestampEdit: fields.beginTimestampEdit,
    stopTimestampEdit: fields.stopTimestampEdit,
    submitTimestampEdit: fields.submitTimestampEdit,
    moveTimestampEditToTitle: fields.moveTimestampEditToTitle,
    updateTimestamp: fields.updateTimestamp,
    handleTimestampKeyDown: fields.handleTimestampKeyDown,
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
