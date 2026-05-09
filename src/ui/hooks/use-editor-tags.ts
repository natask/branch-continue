import { useCallback } from 'react'
import type React from 'react'
import type { EditorState, SetEditorState } from './editor-session-shared'
import { resolveAdjacentEditorSection } from '../lib/editor-section-nav'
import type { EditorCaretPlacement } from './use-editor-focus'

interface UseEditorTagsOptions {
  editorRef: React.RefObject<EditorState | null>
  setEditorState: SetEditorState
  updateCurrent: (updater: (current: EditorState) => EditorState) => void
  markEditorDirty: (patch: Partial<EditorState>) => void
  commitDraftTags: (tags: string[]) => void
  tagInputEnteredFromBodyRef: React.RefObject<boolean>
  focusBody: (placement?: EditorCaretPlacement) => void
  focusTagInput: (placement?: EditorCaretPlacement) => void
  focusTimestamp: (placement?: EditorCaretPlacement) => void
  focusTitle: (placement?: EditorCaretPlacement) => void
}

interface UseEditorTagsResult {
  removeTag: (tag: string) => void
  startEditingTag: (index: number) => void
  updateEditingTagValue: (value: string) => void
  commitTagEdit: () => void
  cancelTagEdit: () => void
  handleEditingTagKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  handleTagInputChange: (value: string) => void
  handleTagInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function useEditorTags({
  editorRef,
  setEditorState,
  updateCurrent,
  markEditorDirty,
  commitDraftTags,
  tagInputEnteredFromBodyRef,
  focusBody,
  focusTagInput,
  focusTimestamp,
  focusTitle,
}: UseEditorTagsOptions): UseEditorTagsResult {
  const moveFromTags = useCallback(
    (direction: 'previous' | 'next') => {
      const current = editorRef.current
      if (!current) return

      const destination = resolveAdjacentEditorSection('tags', direction, Boolean(current.timestamp))
      if (!destination) return

      const placement: EditorCaretPlacement = direction === 'previous' ? 'end' : 'start'
      updateCurrent((existing) => ({
        ...existing,
        editingTagIndex: null,
        editingTagValue: '',
        editingTitle: destination === 'title',
        editingTimestamp: destination === 'timestamp',
      }))

      if (destination === 'title') {
        focusTitle(placement)
        return
      }
      if (destination === 'timestamp') {
        focusTimestamp(placement)
        return
      }
      focusBody(placement)
    },
    [editorRef, focusBody, focusTimestamp, focusTitle, updateCurrent],
  )

  const removeTag = useCallback(
    (tag: string) => {
      const current = editorRef.current
      if (!current) return

      const nextTags = current.tags.filter((existing) => existing !== tag)
      if (nextTags.length === current.tags.length) return

      markEditorDirty({ tags: nextTags })
      commitDraftTags(nextTags)
    },
    [commitDraftTags, editorRef, markEditorDirty],
  )

  const startEditingTag = useCallback(
    (index: number) => {
      const current = editorRef.current
      if (!current) return
      setEditorState({
        ...current,
        editingTagIndex: index,
        editingTagValue: `#${current.tags[index] ?? ''}`,
      })
    },
    [editorRef, setEditorState],
  )

  const updateEditingTagValue = useCallback(
    (value: string) => {
      const current = editorRef.current
      if (!current || current.editingTagIndex === null) return

      setEditorState({ ...current, editingTagValue: value })
    },
    [editorRef, setEditorState],
  )

  const commitTagEdit = useCallback(() => {
    const current = editorRef.current
    if (!current || current.editingTagIndex === null) return

    const rawValue = current.editingTagValue.trim()
    const value = rawValue.replace(/^#/, '').trim()
    const nextTags = [...current.tags]
    let tagsChanged = false

    if (!rawValue.startsWith('#') || !value) {
      nextTags.splice(current.editingTagIndex, 1)
      tagsChanged = true
    } else if (value && !current.tags.includes(value)) {
      nextTags[current.editingTagIndex] = value
      tagsChanged = true
    }

    if (!tagsChanged) {
      setEditorState({ ...current, editingTagIndex: null, editingTagValue: '' })
      return
    }

    markEditorDirty({ tags: nextTags, editingTagIndex: null, editingTagValue: '' })
    commitDraftTags(nextTags)
  }, [commitDraftTags, editorRef, markEditorDirty, setEditorState])

  const cancelTagEdit = useCallback(() => {
    updateCurrent((current) => ({ ...current, editingTagIndex: null, editingTagValue: '' }))
  }, [updateCurrent])

  const handleEditingTagKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const current = editorRef.current
      if (!current || current.editingTagIndex === null) return

      if (event.key === 'Enter') {
        event.preventDefault()
        commitTagEdit()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        cancelTagEdit()
        return
      }

      if (isPreviousFieldShortcut(event)) {
        event.preventDefault()
        commitTagEdit()
        moveFromTags('previous')
        return
      }

      if (isNextFieldShortcut(event)) {
        event.preventDefault()
        commitTagEdit()
        moveFromTags('next')
        return
      }

    },
    [cancelTagEdit, commitTagEdit, moveFromTags],
  )

  const handleTagInputChange = useCallback(
    (value: string) => {
      const current = editorRef.current
      if (!current) return

      if (value.length > 0) {
        tagInputEnteredFromBodyRef.current = false
      }

      setEditorState({ ...current, tagInput: value })
    },
    [editorRef, setEditorState, tagInputEnteredFromBodyRef],
  )

  const handleTagInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const current = editorRef.current
      if (!current) return
      const value = current.tagInput

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const trimmedValue = value.trim()
        const tagValue = trimmedValue.replace(/^#/, '')
        if (tagValue && !current.tags.includes(tagValue)) {
          tagInputEnteredFromBodyRef.current = false
          const nextTags = [...current.tags, tagValue]
          markEditorDirty({ tags: nextTags, tagInput: '' })
          commitDraftTags(nextTags)
          focusTagInput()
        } else if (!trimmedValue) {
          tagInputEnteredFromBodyRef.current = false
          focusBody()
        } else if (/^#\s*$/.test(value)) {
          setEditorState({ ...current, tagInput: '#' })
          focusTagInput()
        } else {
          tagInputEnteredFromBodyRef.current = false
          setEditorState({ ...current, tagInput: '' })
          focusTagInput()
        }
        return
      }

      if (event.key === 'Backspace' && !value) {
        tagInputEnteredFromBodyRef.current = false
        event.preventDefault()
        if (current.tags.length > 0) {
          const lastIndex = current.tags.length - 1
          const lastTag = current.tags[lastIndex]
          setEditorState({
            ...current,
            editingTagIndex: lastIndex,
            editingTagValue: `#${lastTag}`,
          })
        } else if (current.timestamp) {
          setEditorState({ ...current, editingTimestamp: true })
          focusTimestamp()
        } else {
          setEditorState({ ...current, editingTitle: true })
          focusTitle()
        }
        return
      }

      if (isPreviousFieldShortcut(event)) {
        tagInputEnteredFromBodyRef.current = false
        event.preventDefault()
        moveFromTags('previous')
        return
      }

      if (isNextFieldShortcut(event)) {
        tagInputEnteredFromBodyRef.current = false
        event.preventDefault()
        moveFromTags('next')
        return
      }

      if (value.startsWith('#')) {
        if (event.key === 'Backspace' && value.trim() === '#') {
          event.preventDefault()
          setEditorState({ ...current, tagInput: '' })
          return
        }

        if (event.key === 'Backspace' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          setEditorState({ ...current, tagInput: '#' })
        }
      }
    },
    [
      commitDraftTags,
      editorRef,
      focusBody,
      focusTagInput,
      focusTimestamp,
      focusTitle,
      markEditorDirty,
      moveFromTags,
      setEditorState,
      tagInputEnteredFromBodyRef,
    ],
  )

  return {
    removeTag,
    startEditingTag,
    updateEditingTagValue,
    commitTagEdit,
    cancelTagEdit,
    handleEditingTagKeyDown,
    handleTagInputChange,
    handleTagInputKeyDown,
  }
}

function isPreviousFieldShortcut(event: React.KeyboardEvent<HTMLElement>): boolean {
  return isFieldShortcut(event, 'p')
}

function isNextFieldShortcut(event: React.KeyboardEvent<HTMLElement>): boolean {
  return isFieldShortcut(event, 'n')
}

function isFieldShortcut(event: React.KeyboardEvent<HTMLElement>, key: 'p' | 'n'): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === key
}
