import { useCallback } from 'react'
import type React from 'react'
import type { EditorState, SetEditorState } from './editor-session-shared'

interface UseEditorTagsOptions {
  editorRef: React.RefObject<EditorState | null>
  setEditorState: SetEditorState
  updateCurrent: (updater: (current: EditorState) => EditorState) => void
  markEditorDirty: (patch: Partial<EditorState>) => void
  commitDraftTags: (tags: string[]) => void
  tagInputEnteredFromBodyRef: React.RefObject<boolean>
  focusTagInput: () => void
  focusTimestamp: () => void
  focusTitle: () => void
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
  focusTagInput,
  focusTimestamp,
  focusTitle,
}: UseEditorTagsOptions): UseEditorTagsResult {
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

  const clearTagLine = useCallback(() => {
    const current = editorRef.current
    if (!current) return

    if (!current.tags.length && !current.tagInput && current.editingTagIndex === null) return

    markEditorDirty({
      tags: [],
      tagInput: '',
      editingTagIndex: null,
      editingTagValue: '',
    })
    commitDraftTags([])
  }, [commitDraftTags, editorRef, markEditorDirty])

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

      const input = event.currentTarget
      const value = current.editingTagValue
      const selectionStart = input.selectionStart ?? value.length
      const selectionEnd = input.selectionEnd ?? value.length

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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const sliced =
          selectionStart !== selectionEnd
            ? value.slice(0, selectionStart) + value.slice(selectionEnd)
            : value.slice(0, selectionStart)
        setEditorState({
          ...current,
          editingTagValue: value.startsWith('#') ? sliced || '#' : sliced,
        })
      }
    },
    [cancelTagEdit, commitTagEdit, editorRef, setEditorState],
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
      const input = event.currentTarget
      const selectionStart = input.selectionStart ?? value.length
      const selectionEnd = input.selectionEnd ?? value.length

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
          focusTagInput()
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()

        if (value.startsWith('#')) {
          const sliced =
            selectionStart !== selectionEnd
              ? value.slice(0, selectionStart) + value.slice(selectionEnd)
              : value.slice(0, selectionStart)
          setEditorState({ ...current, tagInput: sliced || '#' })
          return
        }

        clearTagLine()
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
      clearTagLine,
      commitDraftTags,
      editorRef,
      focusTagInput,
      focusTimestamp,
      focusTitle,
      markEditorDirty,
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
