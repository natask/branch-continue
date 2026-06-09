import { describe, expect, it } from 'vitest'
import type { PageEvent } from '../src/core/events/types'
import {
  buildAnchorContext,
  findAgentMentions,
  latestAgentMention,
  projectAgenticMarkdown,
} from '../src/ui/agentic-markdown/agentic-markdown-model'

describe('agentic markdown model', () => {
  it('finds inline agent requests with location data', () => {
    const text = ['first @critic inspect this', '', '@researcher find prior art'].join('\n')

    const mentions = findAgentMentions(text)

    expect(mentions).toHaveLength(2)
    expect(mentions[0]?.agent).toBe('critic')
    expect(mentions[0]?.prompt).toBe('inspect this')
    expect(mentions[0]?.lineIndex).toBe(0)
    expect(latestAgentMention(text)?.agent).toBe('researcher')
  })

  it('uses the paragraph around the mention as anchor context', () => {
    const text = [
      'Earlier paragraph.',
      '',
      'This is the paragraph that matters.',
      '@agent explain this',
      'It has the context needed.',
    ].join('\n')
    const mention = latestAgentMention(text)

    expect(mention).not.toBeNull()
    const anchor = buildAnchorContext(text, mention!)

    expect(anchor.quote).toBe('@agent explain this')
    expect(anchor.context).toContain('This is the paragraph that matters.')
    expect(anchor.context).toContain('It has the context needed.')
    expect(anchor.context).not.toContain('Earlier paragraph.')
  })

  it('projects document text and anchored agent threads from events', () => {
    const events: PageEvent[] = [
      event('document.text.changed', { text: 'hello\n@agent help' }, 1),
      event('anchor.created', { anchorId: 'anchor_1', quote: '@agent help', context: 'hello\n@agent help' }, 2),
      event('thread.created', { threadId: 'thread_1', anchorId: 'anchor_1' }, 3),
      event('agent.requested', { threadId: 'thread_1', agent: 'agent', prompt: 'help' }, 4),
      event('agent.response.created', { threadId: 'thread_1', response: 'done', runUrl: 'https://run' }, 5),
    ]

    const projection = projectAgenticMarkdown(events)

    expect(projection.documentText).toBe('hello\n@agent help')
    expect(projection.threads).toHaveLength(1)
    expect(projection.threads[0]?.agent).toBe('agent')
    expect(projection.threads[0]?.status).toBe('responded')
    expect(projection.threads[0]?.response).toBe('done')
  })

  it('projects thread details even when same-tick events are read out of creation order', () => {
    const events: PageEvent[] = [
      event('thread.created', { threadId: 'thread_1', anchorId: 'anchor_1' }, 1),
      event('agent.requested', { threadId: 'thread_1', agent: 'agent', prompt: 'help' }, 2),
      event('anchor.created', { anchorId: 'anchor_1', quote: '@agent help', context: 'context' }, 3),
      event('agent.response.created', { threadId: 'thread_1', response: 'done' }, 4),
    ]

    const projection = projectAgenticMarkdown(events)

    expect(projection.threads[0]?.quote).toBe('@agent help')
    expect(projection.threads[0]?.context).toBe('context')
    expect(projection.threads[0]?.agent).toBe('agent')
    expect(projection.threads[0]?.response).toBe('done')
  })
})

function event(type: string, payload: Record<string, unknown>, timestamp: number): PageEvent {
  return {
    id: `${type}-${timestamp}`,
    type,
    pageId: 'agentic-markdown:default',
    payload,
    actor: 'test',
    timestamp,
  }
}
