import { useCallback, useEffect, useRef, useState } from 'react'
import { LoroDoc, UndoManager } from 'loro-crdt'
import type { QuickNoteCreateRequest, SourceNote } from '../../core/quicknote/types'
import type { EditorState, SetEditorState } from './editor-session-shared'
import { areTagsEqual, normalizeDraftTags } from './editor-session-shared'

interface UseEditorDraftOptions {
  editor: EditorState | null
  editorRef: React.RefObject<EditorState | null>
  setEditorState: SetEditorState
  sourceSelected: boolean
  createNote: (request: QuickNoteCreateRequest) => Promise<SourceNote>
  updateNote: (noteId: string, request: QuickNoteCreateRequest) => Promise<SourceNote>
}

interface UseEditorDraftResult {
  saving: boolean
  saveError: string | null
  autoSaveEnabled: boolean
  canUndo: boolean
  canRedo: boolean
  autoSaveTimerRef: React.RefObject<number | null>
  clearSaveError: () => void
  markEditorDirty: (patch: Partial<EditorState>) => void
  commitDraftTitle: (title: string) => void
  commitDraftTimestamp: (timestamp: string | null) => void
  commitDraftBody: (body: string) => void
  commitDraftTags: (tags: string[]) => void
  flushAutoSave: () => Promise<boolean>
  handleUndo: () => void
  handleRedo: () => void
  handleSaveIndicatorClick: () => void
  toggleAutoSave: () => void
}

export function useEditorDraft({
  editor,
  editorRef,
  setEditorState,
  sourceSelected,
  createNote,
  updateNote,
}: UseEditorDraftOptions): UseEditorDraftResult {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const autoSaveTimerRef = useRef<number | null>(null)
  const draftDocRef = useRef<LoroDoc | null>(null)
  const undoManagerRef = useRef<UndoManager | null>(null)

  const clearSaveError = useCallback(() => {
    setSaveError(null)
  }, [])

  const updateUndoRedoAvailability = useCallback(() => {
    const undoManager = undoManagerRef.current
    setCanUndo(Boolean(undoManager?.canUndo()))
    setCanRedo(Boolean(undoManager?.canRedo()))
  }, [])

  const commitDraftTitle = useCallback(
    (title: string) => {
      const doc = draftDocRef.current
      if (!doc) return
      const draft = doc.getMap('draft')
      if ((draft.get('title') as string | undefined) === title) return
      draft.set('title', title)
      doc.commit({ origin: 'draft:title' })
      updateUndoRedoAvailability()
    },
    [updateUndoRedoAvailability],
  )

  const commitDraftTimestamp = useCallback(
    (timestamp: string | null) => {
      const doc = draftDocRef.current
      if (!doc) return
      const draft = doc.getMap('draft')
      const nextValue = timestamp ?? ''
      if ((draft.get('timestamp') as string | undefined) === nextValue) return
      draft.set('timestamp', nextValue)
      doc.commit({ origin: 'draft:timestamp' })
      updateUndoRedoAvailability()
    },
    [updateUndoRedoAvailability],
  )

  const commitDraftBody = useCallback(
    (body: string) => {
      const doc = draftDocRef.current
      if (!doc) return
      const draft = doc.getMap('draft')
      if ((draft.get('body') as string | undefined) === body) return
      draft.set('body', body)
      doc.commit({ origin: 'draft:body' })
      updateUndoRedoAvailability()
    },
    [updateUndoRedoAvailability],
  )

  const commitDraftTags = useCallback(
    (tags: string[]) => {
      const doc = draftDocRef.current
      if (!doc) return
      const draft = doc.getMap('draft')
      const current = normalizeDraftTags(draft.get('tags'))
      if (areTagsEqual(current, tags)) return
      draft.set('tags', [...tags])
      doc.commit({ origin: 'draft:tags' })
      updateUndoRedoAvailability()
    },
    [updateUndoRedoAvailability],
  )

  const markEditorDirty = useCallback(
    (patch: Partial<EditorState>) => {
      const current = editorRef.current
      if (!current) return
      setEditorState({
        ...current,
        ...patch,
        dirty: true,
        changeVersion: current.changeVersion + 1,
      })
    },
    [editorRef, setEditorState],
  )

  const applyDraftToEditor = useCallback(
    (markDirty: boolean) => {
      const doc = draftDocRef.current
      const current = editorRef.current
      if (!doc || !current) return

      const draft = doc.getMap('draft')
      const title = (draft.get('title') as string | undefined) ?? ''
      const rawTimestamp = (draft.get('timestamp') as string | undefined) ?? ''
      const body = (draft.get('body') as string | undefined) ?? ''
      const tags = normalizeDraftTags(draft.get('tags'))

      setEditorState({
        ...current,
        title,
        timestamp: rawTimestamp.trim() ? rawTimestamp : null,
        body,
        tags,
        editingTagIndex: null,
        editingTagValue: '',
        dirty: markDirty ? true : current.dirty,
        changeVersion: markDirty ? current.changeVersion + 1 : current.changeVersion,
      })
      updateUndoRedoAvailability()
    },
    [editorRef, setEditorState, updateUndoRedoAvailability],
  )

  const persistEditor = useCallback(
    async (snapshot: EditorState): Promise<boolean> => {
      if (!sourceSelected) return false

      const hasCreateContent =
        snapshot.body.trim().length > 0 ||
        snapshot.title.trim().length > 0 ||
        snapshot.tags.length > 0

      if (!snapshot.source && !hasCreateContent) {
        return true
      }

      setSaving(true)
      setSaveError(null)

      try {
        const requestBase: QuickNoteCreateRequest = {
          title: snapshot.title,
          timestamp: snapshot.timestamp ?? undefined,
          tags: snapshot.tags,
          body: snapshot.body,
        }
        const parentRef = snapshot.branchFrom?.noteUid ?? snapshot.branchFrom?.id

        const entry = snapshot.source
          ? await updateNote(snapshot.source.id, requestBase)
          : await createNote({
              ...requestBase,
              ...(parentRef ? { parentNoteId: parentRef } : {}),
            })

        const current = editorRef.current
        if (!current || current.sessionKey !== snapshot.sessionKey) {
          return true
        }

        setEditorState({
          ...current,
          source: entry,
          isNew: false,
          dirty: current.changeVersion === snapshot.changeVersion ? false : current.dirty,
        })
        return true
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setSaving(false)
      }
    },
    [createNote, editorRef, setEditorState, sourceSelected, updateNote],
  )

  const flushAutoSave = useCallback(async (): Promise<boolean> => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    if (saving) return false

    const current = editorRef.current
    if (!current || !current.dirty) return true

    return persistEditor({ ...current, tags: [...current.tags] })
  }, [editorRef, persistEditor, saving])

  const handleUndo = useCallback(() => {
    const undoManager = undoManagerRef.current
    if (!undoManager || !undoManager.canUndo()) return
    undoManager.undo()
    applyDraftToEditor(true)
  }, [applyDraftToEditor])

  const handleRedo = useCallback(() => {
    const undoManager = undoManagerRef.current
    if (!undoManager || !undoManager.canRedo()) return
    undoManager.redo()
    applyDraftToEditor(true)
  }, [applyDraftToEditor])

  useEffect(() => {
    if (!editor) {
      draftDocRef.current = null
      undoManagerRef.current = null
      setCanUndo(false)
      setCanRedo(false)
      return
    }

    const doc = new LoroDoc()
    const draft = doc.getMap('draft')
    draft.set('title', editor.title)
    draft.set('timestamp', editor.timestamp ?? '')
    draft.set('body', editor.body)
    draft.set('tags', [...editor.tags])
    doc.commit({ origin: 'draft:init' })

    const undoManager = new UndoManager(doc, {
      mergeInterval: 800,
      excludeOriginPrefixes: ['draft:init', 'draft:sync'],
    })
    undoManager.clear()

    draftDocRef.current = doc
    undoManagerRef.current = undoManager
    updateUndoRedoAvailability()

    return () => {
      undoManager.clear()
    }
  }, [editor?.sessionKey, editor?.title, editor?.timestamp, editor?.body, editor?.tags, updateUndoRedoAvailability])

  useEffect(() => {
    if (!autoSaveEnabled) return
    if (!editor || !sourceSelected || !editor.dirty || saving) return

    const hasCreateContent =
      editor.body.trim().length > 0 ||
      editor.title.trim().length > 0 ||
      editor.tags.length > 0

    if (!editor.source && !hasCreateContent) return

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
    }

    const snapshot: EditorState = { ...editor, tags: [...editor.tags] }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void persistEditor(snapshot)
    }, 500)

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [autoSaveEnabled, editor, persistEditor, saving, sourceSelected])

  const handleSaveIndicatorClick = useCallback(() => {
    const current = editorRef.current
    if (!current) return
    if (!autoSaveEnabled && current.dirty) {
      void flushAutoSave()
    }
  }, [autoSaveEnabled, editorRef, flushAutoSave])

  const toggleAutoSave = useCallback(() => {
    setAutoSaveEnabled((current) => !current)
  }, [])

  return {
    saving,
    saveError,
    autoSaveEnabled,
    canUndo,
    canRedo,
    autoSaveTimerRef,
    clearSaveError,
    markEditorDirty,
    commitDraftTitle,
    commitDraftTimestamp,
    commitDraftBody,
    commitDraftTags,
    flushAutoSave,
    handleUndo,
    handleRedo,
    handleSaveIndicatorClick,
    toggleAutoSave,
  }
}
