import { describe, expect, it } from 'vitest'
import { resolveAdjacentEditorSection } from '../src/ui/lib/editor-section-nav'

describe('resolveAdjacentEditorSection', () => {
  it('walks title, timestamp, tags, and body when timestamp exists', () => {
    expect(resolveAdjacentEditorSection('body', 'previous', true)).toBe('tags')
    expect(resolveAdjacentEditorSection('tags', 'previous', true)).toBe('timestamp')
    expect(resolveAdjacentEditorSection('timestamp', 'previous', true)).toBe('title')
    expect(resolveAdjacentEditorSection('title', 'next', true)).toBe('timestamp')
    expect(resolveAdjacentEditorSection('timestamp', 'next', true)).toBe('tags')
    expect(resolveAdjacentEditorSection('tags', 'next', true)).toBe('body')
  })

  it('skips timestamp when the note does not have one', () => {
    expect(resolveAdjacentEditorSection('body', 'previous', false)).toBe('tags')
    expect(resolveAdjacentEditorSection('tags', 'previous', false)).toBe('title')
    expect(resolveAdjacentEditorSection('title', 'next', false)).toBe('tags')
  })

  it('returns null past the ends of the sequence', () => {
    expect(resolveAdjacentEditorSection('title', 'previous', true)).toBeNull()
    expect(resolveAdjacentEditorSection('body', 'next', true)).toBeNull()
  })
})
