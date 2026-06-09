import type { SourceNote } from '../../core/quicknote/types'

export interface AgentPromptMatch {
  agent: string
  prompt: string
  lineIndex: number
  line: string
}

export interface AgentLaunchSummary {
  status: 'launched' | 'offline' | 'failed'
  dashboardUrl: string
  runId?: string
  runUrl?: string
  ticketId?: string
  commentId?: string
  reason?: string
}

export function extractLatestAgentPrompt(body: string): AgentPromptMatch | null {
  const lines = body.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    const matches = Array.from(line.matchAll(/(^|\s)@([a-zA-Z][\w-]*)(?:\s+([^@]+))?/g))
    const match = matches[matches.length - 1]
    if (!match) continue

    const agent = match[2]?.trim() ?? ''
    if (!agent) continue
    const prompt = (match[3]?.trim() || line.trim()).trim()
    if (!prompt) continue
    return { agent, prompt, lineIndex: index, line }
  }

  return null
}

export function shortAgentTitle(prompt: string, maxLength = 58): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Agent response'
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function buildAgentResponseBody(input: {
  agent?: string
  prompt: string
  sourceNote: SourceNote
  sourceBody: string
  launch: AgentLaunchSummary
}): string {
  const sourceLabel = describeSourceNote(input.sourceNote)
  const lines = [
    'Agent response link',
    '',
    ...(input.agent ? [`Agent: @${input.agent}`] : []),
    `Prompt: ${input.prompt}`,
    `Source note: ${sourceLabel}`,
    '',
    ...describeLaunch(input.launch),
    '',
    'Captured source context:',
    fence(input.sourceBody.trim() || input.sourceNote.preview || sourceLabel),
  ]

  return lines.join('\n')
}

function describeLaunch(launch: AgentLaunchSummary): string[] {
  if (launch.status === 'launched') {
    return [
      'Status: launched',
      ...(launch.runId ? [`Run: ${launch.runId}`] : []),
      ...(launch.runUrl ? [`Run link: ${launch.runUrl}`] : []),
      ...(launch.ticketId ? [`Ticket: ${launch.ticketId}`] : []),
      ...(launch.commentId ? [`Comment: ${launch.commentId}`] : []),
      `Station: ${launch.dashboardUrl}`,
    ]
  }

  if (launch.status === 'offline') {
    return [
      'Status: not launched',
      `Reason: ${launch.reason ?? 'Master Orch is not available.'}`,
      `Station: ${launch.dashboardUrl}`,
    ]
  }

  return [
    'Status: launch failed',
    `Reason: ${launch.reason ?? 'Unknown error'}`,
    `Station: ${launch.dashboardUrl}`,
  ]
}

function describeSourceNote(note: SourceNote): string {
  const title = note.title.trim()
  if (title) return `${title} (${note.id})`
  if (note.timestamp) return `${note.timestamp} (${note.id})`
  return note.id
}

function fence(value: string): string {
  return ['```', value, '```'].join('\n')
}
