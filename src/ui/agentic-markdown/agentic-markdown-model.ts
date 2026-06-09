import type { PageEvent } from '../../core/events/types'

export const AGENTIC_MARKDOWN_PAGE_ID = 'agentic-markdown:default'

export const INITIAL_AGENTIC_MARKDOWN = `# Agentic markdown

Write normally. When a thought needs help, call an agent inline:

@agent find prior art for event-sourced writing tools

The request becomes an anchored thread. The document, thread, request, response, and status all come from the event log.`

export interface AgentMention {
  agent: string
  prompt: string
  lineIndex: number
  line: string
  lineStart: number
  mentionStart: number
  mentionEnd: number
}

export interface AgenticThread {
  id: string
  anchorId: string
  agent: string
  prompt: string
  quote: string
  context: string
  status: 'requested' | 'responded' | 'resolved'
  response?: string
  runUrl?: string
  createdAt: number
  updatedAt: number
}

export interface AgenticProjection {
  documentText: string
  threads: AgenticThread[]
  eventCount: number
}

export function findAgentMentions(text: string): AgentMention[] {
  const mentions: AgentMention[] = []
  let offset = 0

  for (const [lineIndex, line] of text.split('\n').entries()) {
    const matcher = /(^|\s)@([a-zA-Z][\w-]*)(?:\s+(.+))?/g
    for (const match of line.matchAll(matcher)) {
      const leading = match[1] ?? ''
      const agent = match[2]?.trim() ?? ''
      const prompt = (match[3]?.trim() || line.trim()).trim()
      if (!agent || !prompt) continue
      const start = offset + (match.index ?? 0) + leading.length
      mentions.push({
        agent,
        prompt,
        lineIndex,
        line,
        lineStart: offset,
        mentionStart: start,
        mentionEnd: start + match[0].trimStart().length,
      })
    }
    offset += line.length + 1
  }

  return mentions
}

export function latestAgentMention(text: string): AgentMention | null {
  const mentions = findAgentMentions(text)
  return mentions[mentions.length - 1] ?? null
}

export function buildAnchorContext(text: string, mention: AgentMention): { quote: string; context: string } {
  const paragraphs = text.split(/\n{2,}/)
  let offset = 0
  for (const paragraph of paragraphs) {
    const start = offset
    const end = start + paragraph.length
    if (mention.mentionStart >= start && mention.mentionStart <= end) {
      return {
        quote: mention.line.trim(),
        context: paragraph.trim() || mention.line.trim(),
      }
    }
    offset = end + 2
  }

  return {
    quote: mention.line.trim(),
    context: mention.line.trim(),
  }
}

export function projectAgenticMarkdown(events: PageEvent[]): AgenticProjection {
  let documentText = INITIAL_AGENTIC_MARKDOWN
  const anchors = new Map<string, { quote: string; context: string }>()
  const threads = new Map<string, AgenticThread>()
  const pendingRequests = new Map<string, { agent: string; prompt: string; timestamp: number }>()
  const pendingResponses = new Map<string, { response?: string; runUrl?: string; timestamp: number }>()
  const pendingResolved = new Set<string>()

  for (const event of events) {
    if (event.type === 'document.text.changed') {
      const text = stringPayload(event, 'text')
      if (text !== null) documentText = text
      continue
    }

    if (event.type === 'anchor.created') {
      const anchorId = stringPayload(event, 'anchorId')
      if (!anchorId) continue
      anchors.set(anchorId, {
        quote: stringPayload(event, 'quote') ?? '',
        context: stringPayload(event, 'context') ?? '',
      })
      for (const thread of threads.values()) {
        if (thread.anchorId !== anchorId) continue
        const anchor = anchors.get(anchorId) ?? { quote: '', context: '' }
        threads.set(thread.id, {
          ...thread,
          quote: anchor.quote,
          context: anchor.context,
          updatedAt: Math.max(thread.updatedAt, event.timestamp),
        })
      }
      continue
    }

    if (event.type === 'thread.created') {
      const threadId = stringPayload(event, 'threadId')
      const anchorId = stringPayload(event, 'anchorId')
      if (!threadId || !anchorId) continue
      const anchor = anchors.get(anchorId) ?? { quote: '', context: '' }
      const request = pendingRequests.get(threadId)
      const response = pendingResponses.get(threadId)
      threads.set(threadId, {
        id: threadId,
        anchorId,
        agent: request?.agent ?? '',
        prompt: request?.prompt ?? '',
        quote: anchor.quote,
        context: anchor.context,
        status: pendingResolved.has(threadId) ? 'resolved' : response ? 'responded' : 'requested',
        response: response?.response,
        runUrl: response?.runUrl,
        createdAt: event.timestamp,
        updatedAt: Math.max(event.timestamp, request?.timestamp ?? 0, response?.timestamp ?? 0),
      })
      continue
    }

    if (event.type === 'agent.requested') {
      const threadId = stringPayload(event, 'threadId')
      if (!threadId) continue
      const existing = threads.get(threadId)
      if (!existing) {
        pendingRequests.set(threadId, {
          agent: stringPayload(event, 'agent') ?? '',
          prompt: stringPayload(event, 'prompt') ?? '',
          timestamp: event.timestamp,
        })
        continue
      }
      threads.set(threadId, {
        ...existing,
        agent: stringPayload(event, 'agent') ?? existing.agent,
        prompt: stringPayload(event, 'prompt') ?? existing.prompt,
        status: 'requested',
        updatedAt: event.timestamp,
      })
      continue
    }

    if (event.type === 'agent.response.created') {
      const threadId = stringPayload(event, 'threadId')
      if (!threadId) continue
      const existing = threads.get(threadId)
      if (!existing) {
        pendingResponses.set(threadId, {
          response: stringPayload(event, 'response') ?? undefined,
          runUrl: stringPayload(event, 'runUrl') ?? undefined,
          timestamp: event.timestamp,
        })
        continue
      }
      threads.set(threadId, {
        ...existing,
        response: stringPayload(event, 'response') ?? existing.response,
        runUrl: stringPayload(event, 'runUrl') ?? existing.runUrl,
        status: 'responded',
        updatedAt: event.timestamp,
      })
      continue
    }

    if (event.type === 'thread.resolved') {
      const threadId = stringPayload(event, 'threadId')
      if (!threadId) continue
      const existing = threads.get(threadId)
      if (!existing) {
        pendingResolved.add(threadId)
        continue
      }
      threads.set(threadId, {
        ...existing,
        status: 'resolved',
        updatedAt: event.timestamp,
      })
    }
  }

  return {
    documentText,
    threads: Array.from(threads.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    eventCount: events.length,
  }
}

export function createLocalAgentResponse(input: {
  agent: string
  prompt: string
  quote: string
  context: string
  stationStatus: string
}): string {
  return [
    `@${input.agent} request captured.`,
    '',
    `Prompt: ${input.prompt}`,
    `Station: ${input.stationStatus}`,
    '',
    'Anchor:',
    input.quote,
    '',
    'Context sent:',
    input.context,
  ].join('\n')
}

function stringPayload(event: PageEvent, key: string): string | null {
  const value = event.payload[key]
  return typeof value === 'string' ? value : null
}
