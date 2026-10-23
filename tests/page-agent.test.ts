import { describe, expect, it } from 'vitest'
import { applyPageAgentEdit, pageSystemPrompt, stripPageSystemPrompt, withPageSystemPrompt } from '../src/ui/lib/page-agent'
import { readConcepts, writeConcepts } from '../src/core/backbone/concepts'

describe('portable page instructions and agent edits', () => {
  it('stores multiline instructions inside the note and keeps prose separate', () => {
    const prompt = 'Keep my voice.\nPreserve examples --> and Unicode: ሰላም'
    const note = withPageSystemPrompt('An idea.\nAnother line.', prompt)
    expect(pageSystemPrompt(note)).toBe(prompt)
    expect(stripPageSystemPrompt(note)).toBe('An idea.\nAnother line.')
    expect(withPageSystemPrompt(note, '')).toBe('An idea.\nAnother line.')
  })
  it('treats corrupt or non-string metadata as absent', () => {
    expect(pageSystemPrompt('<!-- backbone-page-system:v1 %bad -->')).toBe('')
    expect(pageSystemPrompt('<!-- backbone-page-system:v1 42 -->')).toBe('')
  })
  it('applies completed edits while preserving original page instructions and ideas', () => {
    const source = writeConcepts(withPageSystemPrompt('A rough sentence.', 'Keep my voice.'), [{
      id: 'idea', parentId: null, title: 'My meaning', description: 'A thought', sourceText: 'A rough sentence.', outcome: '', createdAt: 'now', updatedAt: 'now',
    }])
    const applied = applyPageAgentEdit(source, source, 'A clear sentence.')!
    expect(pageSystemPrompt(applied)).toBe('Keep my voice.')
    expect(readConcepts(applied)[0]?.id).toBe('idea')
    expect(applied).toContain('A clear sentence.')
  })
  it('rejects a late edit when the user changed this page', () => {
    expect(applyPageAgentEdit('A new thought.', 'An earlier thought.', 'Agent suggestion.')).toBeNull()
  })
})
