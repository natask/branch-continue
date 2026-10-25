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

export interface AgentChatTurn {
  sessionId: string
  agent: string
  prompt: string
  response: string
  launch?: AgentLaunchSummary
  runtimeSessionId?: string
}

export type AgentTaskStatus = 'running' | 'completed' | 'launched' | 'blocked' | 'failed'
export type AgentTaskSourceKind = 'note' | 'recognized-voice-note'

export interface AgentTaskRecord {
  taskId: string
  sessionId: string
  agent: string
  prompt: string
  status: AgentTaskStatus
  blockedReason?: 'page-changed'
  sourceKind: AgentTaskSourceKind
  submittedAt: string
  updatedAt?: string
  response?: string
  runtimeId?: string
  runtimeSessionId?: string
  recognizedTranscriptChars?: number
  launch?: AgentLaunchSummary
}

export interface AgentTaskProgress {
  sourceNoteId: string | null
  task: AgentTaskRecord | null
  phase: AgentTaskStatus | 'preparing'
  message: string
}

export function extractLatestAgentPrompt(body: string): AgentPromptMatch | null {
  const lines = maskAgentChatTurns(body).split('\n')
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

/** Turns the editor's visible agent composer into the same request shape as an inline mention. */
export function parseAgentRequestInput(input: string, lineIndex = 0): AgentPromptMatch | null {
  const clean = input.trim()
  if (!clean) return null
  const mention = clean.match(/^@([a-zA-Z][\w-]*)(?:\s+([\s\S]+))?$/)
  if (mention) {
    const prompt = mention[2]?.trim() ?? ''
    if (!prompt) return null
    return { agent: mention[1]!, prompt, lineIndex, line: clean }
  }
  return { agent: 'agent', prompt: clean, lineIndex, line: clean }
}

export function shortAgentTitle(prompt: string, maxLength = 58): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Agent response'
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

/** One source note owns one durable agent chat, just as it owns one voice note. */
export function agentChatSessionId(note: SourceNote, body = note.body): string {
  const existing = body.match(/^Agent chat:\s*\nSession:\s*(\S+)\s*$/im)?.[1]
  if (existing) return existing
  return `note-agent:${note.noteUid ?? note.id}`
}

export function extractAgentRuntimeSessionId(body: string): string | undefined {
  const matches = Array.from(body.matchAll(/^(?:Codex session|Runtime session):\s*(\S+)\s*$/gim))
  return matches[matches.length - 1]?.[1]
}

export function appendAgentChatTurn(body: string, turn: AgentChatTurn): string {
  const trimmed = body.trimEnd()
  const hasChat = /^Agent chat:$/im.test(trimmed)
  const lines = [
    ...(hasChat ? [] : ['Agent chat:', `Session: ${turn.sessionId}`, '']),
    ...(turn.runtimeSessionId && !extractAgentRuntimeSessionId(trimmed)
      ? [`Codex session: ${turn.runtimeSessionId}`, '']
      : []),
    '<!-- branch-continue-agent-turn:start -->',
    `User → @${turn.agent}: ${turn.prompt}`,
    `@${turn.agent} → User:`,
    turn.response.trim() || '(No response returned.)',
    ...describeTurnLaunch(turn.launch),
    '<!-- branch-continue-agent-turn:end -->',
  ]
  return [trimmed, lines.join('\n')].filter(Boolean).join('\n\n')
}

export function appendAgentTask(body: string, task: AgentTaskRecord): string {
  const trimmed = body.trimEnd()
  const hasChat = /^Agent chat:$/im.test(trimmed)
  const block = formatAgentTaskBlock(task)
  const lines = [
    ...(hasChat ? [] : ['Agent chat:', `Session: ${task.sessionId}`, '']),
    block,
  ]
  return [trimmed, lines.join('\n')].filter(Boolean).join('\n\n')
}

export function updateAgentTask(body: string, task: AgentTaskRecord): string {
  const pattern = agentTaskPattern(task.taskId)
  if (!pattern.test(body)) return appendAgentTask(body, task)
  return body.replace(pattern, formatAgentTaskBlock(task))
}

export function extractLatestAgentTask(body: string): AgentTaskRecord | null {
  const matches = Array.from(body.matchAll(AGENT_TASK_BLOCK_PATTERN))
  const match = matches[matches.length - 1]
  const taskId = match?.[1]
  const block = match?.[2]
  if (!taskId || !block) return null
  const status = taskField(block, 'Status')
  if (!isAgentTaskStatus(status)) return null
  const sourceLabel = taskField(block, 'Source')
  const agent = taskField(block, 'Agent').replace(/^@/, '')
  return {
    taskId,
    sessionId: taskField(block, 'Session'),
    agent,
    prompt: taskField(block, 'Prompt'),
    status,
    blockedReason: taskField(block, 'Blocked reason') === 'page-changed' ? 'page-changed' : undefined,
    sourceKind: sourceLabel === 'recognized voice note' ? 'recognized-voice-note' : 'note',
    submittedAt: taskField(block, 'Submitted'),
    updatedAt: taskField(block, 'Updated') || undefined,
    runtimeId: taskField(block, 'Runtime') || undefined,
    runtimeSessionId: taskField(block, 'Runtime session') || undefined,
    recognizedTranscriptChars: positiveInteger(taskField(block, 'Recognized transcript')),
    response: taskResponse(block, agent),
    launch: taskField(block, 'Run')
      ? {
          status: status === 'launched' ? 'launched' : status === 'failed' ? 'failed' : 'offline',
          dashboardUrl: '',
          runUrl: taskField(block, 'Run'),
        }
      : undefined,
  }
}

export function agentTaskStatusMessage(task: AgentTaskRecord): string {
  if (task.status === 'running') return `Running @${task.agent}: ${shortAgentTitle(task.prompt)}`
  if (task.status === 'launched') return `@${task.agent} launched. Its run link is saved in this note.`
  if (task.status === 'completed') return `@${task.agent} responded. The answer is saved in this note.`
  if (task.status === 'blocked') {
    if (task.blockedReason === 'page-changed') return 'Your note changed while Codex was running. Your edits were kept. Open Task details to see the proposed version.'
    return `@${task.agent} was saved, but no answering runtime was online. Start pnpm agent:runtime, then run it again.`
  }
  return `@${task.agent} failed. The runtime response is saved in this note.`
}

export function persistedAgentTaskProgress(
  body: string,
  sourceNoteId: string | null,
): AgentTaskProgress | null {
  const persistedTask = extractLatestAgentTask(body)
  if (!persistedTask) return null
  if (persistedTask.status === 'running') {
    const interruptedTask = { ...persistedTask, status: 'blocked' as const }
    return {
      sourceNoteId,
      task: interruptedTask,
      phase: 'blocked',
      message: 'This task was interrupted or its live status is unknown. Run it again to reconnect.',
    }
  }
  return {
    sourceNoteId,
    task: persistedTask,
    phase: persistedTask.status,
    message: agentTaskStatusMessage(persistedTask),
  }
}

function maskAgentChatTurns(body: string): string {
  return body
    .replace(
      /<!-- branch-continue-agent-turn:start -->[\s\S]*?<!-- branch-continue-agent-turn:end -->/g,
      (block) => block.replace(/[^\n]/g, ' '),
    )
    .replace(AGENT_TASK_BLOCK_PATTERN, (block) => block.replace(/[^\n]/g, ' '))
}

function describeTurnLaunch(launch: AgentLaunchSummary | undefined): string[] {
  if (!launch) return []
  return [
    ...(launch.runUrl ? [`Run: ${launch.runUrl}`] : []),
    ...(launch.commentId ? [`Comment: ${launch.commentId}`] : []),
    ...(launch.reason ? [`Runtime note: ${launch.reason}`] : []),
  ]
}

const AGENT_TASK_BLOCK_PATTERN = /<!-- branch-continue-agent-task:start ([A-Za-z0-9_-]+) -->\n([\s\S]*?)\n<!-- branch-continue-agent-task:end \1 -->/g

function formatAgentTaskBlock(task: AgentTaskRecord): string {
  const lines = [
    `<!-- branch-continue-agent-task:start ${task.taskId} -->`,
    `Agent task: ${task.taskId}`,
    `Session: ${task.sessionId}`,
    `Status: ${task.status}`,
    ...(task.blockedReason ? [`Blocked reason: ${task.blockedReason}`] : []),
    `Agent: @${task.agent}`,
    `Source: ${task.sourceKind === 'recognized-voice-note' ? 'recognized voice note' : 'note'}`,
    `Submitted: ${task.submittedAt}`,
    ...(task.updatedAt ? [`Updated: ${task.updatedAt}`] : []),
    `Prompt: ${task.prompt.replace(/\s+/g, ' ').trim()}`,
    ...(task.recognizedTranscriptChars
      ? [`Recognized transcript: ${task.recognizedTranscriptChars}`]
      : []),
    ...(task.runtimeId ? [`Runtime: ${task.runtimeId}`] : []),
    ...(task.runtimeSessionId ? [`Runtime session: ${task.runtimeSessionId}`] : []),
    ...(task.launch?.runUrl ? [`Run: ${task.launch.runUrl}`] : []),
    ...(task.launch?.commentId ? [`Comment: ${task.launch.commentId}`] : []),
    ...(task.launch?.reason ? [`Runtime note: ${task.launch.reason}`] : []),
    ...(task.response ? ['', '@' + task.agent + ' → User:', task.response.trim()] : []),
    `<!-- branch-continue-agent-task:end ${task.taskId} -->`,
  ]
  return lines.join('\n')
}

function agentTaskPattern(taskId: string): RegExp {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<!-- branch-continue-agent-task:start ${escaped} -->\\n[\\s\\S]*?\\n<!-- branch-continue-agent-task:end ${escaped} -->`)
}

function taskField(block: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return block.match(new RegExp(`^${escaped}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
}

function isAgentTaskStatus(value: string): value is AgentTaskStatus {
  return ['running', 'completed', 'launched', 'blocked', 'failed'].includes(value)
}

function positiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function taskResponse(block: string, agent: string): string | undefined {
  const marker = `@${agent} → User:`
  const markerIndex = block.indexOf(marker)
  if (markerIndex < 0) return undefined
  return block.slice(markerIndex + marker.length).trim() || undefined
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
      ...(launch.dashboardUrl ? [`Station: ${launch.dashboardUrl}`] : []),
    ]
  }

  if (launch.status === 'offline') {
    return [
      'Status: not launched',
      `Reason: ${launch.reason ?? 'No agent runtime is available.'}`,
      ...(launch.dashboardUrl ? [`Station: ${launch.dashboardUrl}`] : []),
    ]
  }

  return [
    'Status: launch failed',
    `Reason: ${launch.reason ?? 'Unknown error'}`,
    ...(launch.dashboardUrl ? [`Station: ${launch.dashboardUrl}`] : []),
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

export { stripAgentMetadata, preserveAgentMetadata } from '../../core/backbone/agent-metadata'
