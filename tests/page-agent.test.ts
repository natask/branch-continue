import { describe, expect, it } from 'vitest'
import { applyPageAgentEdit, pageSystemPrompt, stripPageSystemPrompt, withPageSystemPrompt } from '../src/ui/lib/page-agent'
import { readConcepts, writeConcepts } from '../src/core/backbone/concepts'
import { appendAgentTask, extractLatestAgentTask, stripAgentMetadata } from '../src/ui/lib/agent-links'
import { stripConceptMetadata } from '../src/core/backbone/concepts'

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
  it('keeps newer ideas and instructions when only metadata changed during a request', () => {
    const base = appendAgentTask(withPageSystemPrompt('A rough sentence.', 'Keep my voice.'), {
      taskId: 'request_1', sessionId: 'note-agent:1', agent: 'agent', prompt: 'Refine',
      status: 'running', sourceKind: 'note', submittedAt: 'now',
    })
    const current = writeConcepts(withPageSystemPrompt(base, 'Use short sentences.'), [{
      id: 'idea', parentId: null, title: 'New idea', description: 'Added while running',
      sourceText: 'A rough sentence.', outcome: '', createdAt: 'now', updatedAt: 'now',
    }])
    const applied = applyPageAgentEdit(current, base, withPageSystemPrompt('A clear sentence.', 'Outdated agent instructions.'))!
    expect(pageSystemPrompt(applied)).toBe('Use short sentences.')
    expect(readConcepts(applied)[0]?.title).toBe('New idea')
    expect(extractLatestAgentTask(applied)?.taskId).toBe('request_1')
    expect(stripAgentMetadata(stripConceptMetadata(stripPageSystemPrompt(applied)))).toBe('A clear sentence.')
  })
  it('rejects prose conflicts even when hidden metadata also changed', () => {
    const base = withPageSystemPrompt('An earlier thought.', 'Keep my voice.')
    const current = withPageSystemPrompt('A new thought.', 'Use short sentences.')
    expect(applyPageAgentEdit(current, base, 'Agent suggestion.')).toBeNull()
  })
})
