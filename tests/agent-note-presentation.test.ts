import { describe, expect, it } from 'vitest'
import { appendAgentChatTurn, appendAgentTask, extractAgentRuntimeSessionId, extractLatestAgentTask, preserveAgentMetadata, stripAgentMetadata, type AgentTaskRecord } from '../src/ui/lib/agent-links'
import { applyPageAgentEdit, pageSystemPrompt, stripPageSystemPrompt, withPageSystemPrompt } from '../src/ui/lib/page-agent'
import { readConcepts, stripConceptMetadata, writeConcepts } from '../src/core/backbone/concepts'

const task: AgentTaskRecord = {
  taskId: 'task-1', sessionId: 'note-agent:page-1', agent: 'agent', prompt: 'Refine the note.', status: 'completed', sourceKind: 'note', submittedAt: '2026-10-23T00:00:00Z', runtimeId: 'local-codex', runtimeSessionId: 'codex-1', response: 'Improved clarity.',
}

describe('agent metadata stays in storage and out of note prose', () => {
  it('hides task envelopes and fields while keeping ordinary similar prose', () => {
    const prose = 'My note.\nStatus: I am ready.\nSession: a discussion.'
    expect(stripAgentMetadata(appendAgentTask(prose, task))).toBe(prose)
    expect(stripAgentMetadata('Agent chat:\nSession: a discussion.')).toBe('Agent chat:\nSession: a discussion.')
  })
  it('preserves multiple tasks, legacy turns, and runtime session IDs after editing', () => {
    const original = appendAgentTask(appendAgentChatTurn('My note.', { sessionId: 'note-agent:page-1', agent: 'agent', prompt: 'Think', response: 'An answer.', runtimeSessionId: 'codex-legacy' }), task)
    expect(stripAgentMetadata(original)).toBe('My note.')
    const updated = preserveAgentMetadata('My edited note.', original)
    expect(stripAgentMetadata(updated)).toBe('My edited note.')
    expect(extractLatestAgentTask(updated)?.taskId).toBe('task-1')
    expect(extractAgentRuntimeSessionId(updated)).toBe('codex-1')
    expect(updated).toContain('An answer.')
    expect(updated).toContain('Session: note-agent:page-1')
    expect(updated).toContain('Codex session: codex-legacy')
  })
  it('keeps user trailing newlines editable and does not duplicate metadata', () => {
    const original = appendAgentTask('Text.', task)
    const once = preserveAgentMetadata('Text.\n\n\n', original)
    expect(stripAgentMetadata(once)).toBe('Text.\n\n\n')
    expect(preserveAgentMetadata(once, original)).toBe(once)
    expect(once.match(/agent-task:start/g)).toHaveLength(1)
  })
  it('preserves user text after an agent block and leaves incomplete records inspectable', () => {
    expect(stripAgentMetadata(appendAgentTask('Before.', task) + '\n\nAfter.')).toBe('Before.\n\nAfter.')
    const incomplete = 'Text.\n<!-- branch-continue-agent-task:start broken -->\nStatus: running'
    expect(stripAgentMetadata(incomplete)).toBe(incomplete)
  })
  it('keeps audio refs, ideas, page instructions and prior tasks across Codex replacement', () => {
    const audio = 'Audio recording: recordings/page-1.webm'
    const withIdea = writeConcepts(withPageSystemPrompt(`A rough note.\n${audio}`, 'Keep my voice.'), [{
      id: 'idea', parentId: null, title: 'Meaning', description: '', sourceText: 'A rough note.', outcome: '', createdAt: 'now', updatedAt: 'now',
    }])
    const source = appendAgentTask(withIdea, task)
    const changed = applyPageAgentEdit(source, source, `A clear note.\n${audio}`)!
    expect(stripAgentMetadata(stripConceptMetadata(stripPageSystemPrompt(changed)))).toBe(`A clear note.\n${audio}`)
    expect(pageSystemPrompt(changed)).toBe('Keep my voice.')
    expect(readConcepts(changed)[0]?.id).toBe('idea')
    expect(extractLatestAgentTask(changed)?.runtimeSessionId).toBe('codex-1')
  })
})
