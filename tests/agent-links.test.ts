import { describe, expect, it } from 'vitest'
import {
  buildAgentResponseBody,
  extractLatestAgentPrompt,
  shortAgentTitle,
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
  it('extracts the latest standalone @ prompt', () => {
    const match = extractLatestAgentPrompt('notes\n@first\nmore notes\n  @what do you think  ')

    expect(match?.prompt).toBe('what do you think')
    expect(match?.lineIndex).toBe(3)
  })

  it('ignores empty or inline mentions', () => {
    expect(extractLatestAgentPrompt('email me @later')).toBeNull()
    expect(extractLatestAgentPrompt('@   ')).toBeNull()
  })

  it('creates a compact response-note title', () => {
    expect(shortAgentTitle('  what   do you think  ')).toBe('what do you think')
    expect(shortAgentTitle('a'.repeat(80), 10)).toBe('aaaaaaa...')
  })

  it('writes station links into the response body', () => {
    const body = buildAgentResponseBody({
      prompt: 'what do you think',
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
    expect(body).toContain('Run link: https://orch.main.lan/logs/run-1')
    expect(body).toContain('source context')
  })
})
