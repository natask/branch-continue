import { describe, expect, it } from 'vitest'
import {
  agentChatSessionId,
  agentTaskStatusMessage,
  appendAgentTask,
  appendAgentChatTurn,
  buildAgentResponseBody,
  extractLatestAgentPrompt,
  extractLatestAgentTask,
  extractAgentRuntimeSessionId,
  parseAgentRequestInput,
  persistedAgentTaskProgress,
  shortAgentTitle,
  updateAgentTask,
} from '../src/ui/lib/agent-links'
import type { SourceNote } from '../src/core/quicknote/types'

const NOTE: SourceNote = {
  id: 'qn-test',
  noteUid: 'qnuid-test',
  offset: 0,
  sourcePath: 'quicknote.org',
  startLine: 1,
  endLine: 4,
  rawHeadline: 'Test [2026-05-11 Mon 10:00:00 +0000]',
  title: 'Test',
  timestamp: '[2026-05-11 Mon 10:00:00 +0000]',
  tags: [],
  body: 'body',
  preview: 'body',
}

describe('agent link helpers', () => {
  it('extracts the latest inline @agent prompt', () => {
    const match = extractLatestAgentPrompt('notes\n@first\nmore notes\nask @critic what do you think')

    expect(match?.agent).toBe('critic')
    expect(match?.prompt).toBe('what do you think')
    expect(match?.lineIndex).toBe(3)
  })

  it('uses the containing line when an inline mention has no trailing prompt', () => {
    const match = extractLatestAgentPrompt('email me @later')

    expect(match?.agent).toBe('later')
    expect(match?.prompt).toBe('email me @later')
  })

  it('ignores empty mentions', () => {
    expect(extractLatestAgentPrompt('@   ')).toBeNull()
  })

  it('accepts a direct note-scoped request with an optional agent role', () => {
    expect(parseAgentRequestInput('Find the durable ideas', 7)).toMatchObject({
      agent: 'agent',
      prompt: 'Find the durable ideas',
      lineIndex: 7,
    })
    expect(parseAgentRequestInput('@critic pressure-test this')).toMatchObject({
      agent: 'critic',
      prompt: 'pressure-test this',
    })
    expect(parseAgentRequestInput('@critic')).toBeNull()
  })

  it('creates a compact response-note title', () => {
    expect(shortAgentTitle('  what   do you think  ')).toBe('what do you think')
    expect(shortAgentTitle('a'.repeat(80), 10)).toBe('aaaaaaa...')
  })

  it('writes station links into the response body', () => {
    const body = buildAgentResponseBody({
      prompt: 'what do you think',
      agent: 'critic',
      sourceNote: NOTE,
      sourceBody: 'source context',
      launch: {
        status: 'launched',
        dashboardUrl: 'https://orch.main.lan/dashboard',
        runId: 'run-1',
        runUrl: 'https://orch.main.lan/logs/run-1',
      },
    })

    expect(body).toContain('Prompt: what do you think')
    expect(body).toContain('Agent: @critic')
    expect(body).toContain('Run link: https://orch.main.lan/logs/run-1')
    expect(body).toContain('source context')
  })

  it('keeps every turn in the source note\'s single chat session', () => {
    const sessionId = agentChatSessionId(NOTE)
    const first = appendAgentChatTurn('source text', {
      sessionId,
      agent: 'critic',
      prompt: 'review this',
      response: 'The opening is clear.',
      runtimeSessionId: '019fc-session',
    })
    const second = appendAgentChatTurn(first, {
      sessionId,
      agent: 'critic',
      prompt: 'what should change?',
      response: 'Shorten the ending.',
    })

    expect(sessionId).toBe('note-agent:qnuid-test')
    expect(second.match(/^Agent chat:$/gm)).toHaveLength(1)
    expect(second.match(/^Session: note-agent:qnuid-test$/gm)).toHaveLength(1)
    expect(second).toContain('The opening is clear.')
    expect(second).toContain('Shorten the ending.')
    expect(extractAgentRuntimeSessionId(second)).toBe('019fc-session')
    expect(extractLatestAgentPrompt(second)?.prompt).not.toBe('what should change?')
  })

  it('persists a running task before replacing it with an inspectable result', () => {
    const running = {
      taskId: 'request_voice_1',
      sessionId: agentChatSessionId(NOTE),
      agent: 'agent',
      prompt: 'Extract the durable intent',
      status: 'running' as const,
      sourceKind: 'recognized-voice-note' as const,
      submittedAt: '2026-08-07T10:00:00.000Z',
      recognizedTranscriptChars: 420,
    }
    const pendingBody = appendAgentTask('source text', running)
    const completedBody = updateAgentTask(pendingBody, {
      ...running,
      status: 'completed',
      updatedAt: '2026-08-07T10:00:02.000Z',
      runtimeId: 'local-codex',
      runtimeSessionId: 'codex-session-voice-1',
      response: 'The durable intent is to ship one reliable slice.',
    })

    expect(pendingBody).toContain('Status: running')
    expect(completedBody.match(/Agent task: request_voice_1/g)).toHaveLength(1)
    expect(completedBody).toContain('Status: completed')
    expect(completedBody).toContain('Runtime: local-codex')
    expect(extractLatestAgentTask(completedBody)).toMatchObject({
      taskId: 'request_voice_1',
      status: 'completed',
      sourceKind: 'recognized-voice-note',
      recognizedTranscriptChars: 420,
      response: 'The durable intent is to ship one reliable slice.',
    })
    expect(agentTaskStatusMessage(extractLatestAgentTask(completedBody)!)).toContain('responded')
    expect(extractAgentRuntimeSessionId(completedBody)).toBe('codex-session-voice-1')
    expect(extractLatestAgentPrompt(completedBody)).toBeNull()
  })

  it('makes an offline captured task actionable', () => {
    expect(agentTaskStatusMessage({
      taskId: 'request_offline_1',
      sessionId: agentChatSessionId(NOTE),
      agent: 'agent',
      prompt: 'Analyze this note',
      status: 'blocked',
      sourceKind: 'note',
      submittedAt: '2026-08-07T10:00:00.000Z',
    })).toContain('pnpm agent:runtime')
  })

  it('does not present a reloaded orphaned task as live running work', () => {
    const body = appendAgentTask('source text', {
      taskId: 'request_interrupted_1',
      sessionId: agentChatSessionId(NOTE),
      agent: 'agent',
      prompt: 'Analyze this note',
      status: 'running',
      sourceKind: 'note',
      submittedAt: '2026-08-07T10:00:00.000Z',
    })

    expect(persistedAgentTaskProgress(body, NOTE.id)).toMatchObject({
      sourceNoteId: NOTE.id,
      phase: 'blocked',
      task: { taskId: 'request_interrupted_1', status: 'blocked' },
    })
  })
})
