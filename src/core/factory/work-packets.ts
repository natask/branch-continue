export type WorkPacketKind =
  | 'implementation'
  | 'workflow'
  | 'status'
  | 'knowledge'
  | 'drill'
  | 'question'
  | 'decision'

export type WorkPacketPhase =
  | 'intake'
  | 'plan'
  | 'test-design'
  | 'implement'
  | 'validate'
  | 'deploy'
  | 'feedback'
  | 'done'

export type WorkPacketStatus = 'open' | 'running' | 'blocked' | 'verified' | 'done'
export type WorkPacketPriority = 'critical' | 'high' | 'normal' | 'low'

export interface WorkPacket {
  id: string
  title: string
  summary: string
  source: string
  kind: WorkPacketKind
  phase: WorkPacketPhase
  status: WorkPacketStatus
  priority: WorkPacketPriority
  createdAt: string
  updatedAt: string
  nextAction: string
  acceptanceCriteria: string[]
  verification: string[]
  evidence: string[]
}

export interface FactoryStateSummary {
  total: number
  active: number
  blocked: number
  verified: number
  done: number
  nextPacket: WorkPacket | null
}

export const WORK_PACKET_PHASES: WorkPacketPhase[] = [
  'intake',
  'plan',
  'test-design',
  'implement',
  'validate',
  'deploy',
  'feedback',
  'done',
]

const IMPLEMENTATION_KEYWORDS = [
  'build',
  'implement',
  'fix',
  'delete',
  'keyboard',
  'shortcut',
  'command',
  'input',
]

const WORKFLOW_KEYWORDS = [
  'plan',
  'test',
  'validate',
  'agent',
  'workflow',
  'fabro',
  'openspec',
  'execute',
]

const STATUS_KEYWORDS = [
  'ongoing',
  'current',
  'status',
  'track',
  'dashboard',
  'factory',
  'deployment',
  'deployments',
]

const DRILL_KEYWORDS = [
  'drill',
  'forget',
  'remember',
  'knowledge',
  'recall',
  'learn',
  'important',
]

export function createFactorySeedPackets(now = new Date().toISOString()): WorkPacket[] {
  return [
    createPacket({
      id: 'factory-keyboard-shortcuts',
      title: 'Preserve native editing shortcuts',
      summary: 'Focused text controls keep native caret/editing commands; the command palette opens only outside editable focus.',
      source: 'user-intent:keyboard',
      kind: 'implementation',
      phase: 'test-design',
      status: 'running',
      priority: 'critical',
      nextAction: 'Add regression tests and scope palette handlers away from editable targets.',
      acceptanceCriteria: [
        'Cmd+K opens the palette outside editable controls.',
        'Cmd+K and Ctrl+K do not open the palette inside inputs, textareas, contenteditable nodes, or role=textbox.',
      ],
      verification: ['pnpm test', 'manual keyboard QA in editor fields'],
      evidence: [],
      now,
    }),
    createPacket({
      id: 'factory-work-packet-contract',
      title: 'Define plan-test-implement-validate packets',
      summary: 'One durable packet represents intake, plan, test-design, implementation, validation, deployment, and feedback.',
      source: 'user-intent:factory-loop',
      kind: 'workflow',
      phase: 'plan',
      status: 'open',
      priority: 'high',
      nextAction: 'Stabilize the packet shape and phase transitions in code.',
      acceptanceCriteria: [
        'Packets expose current phase, status, next action, acceptance, verification, and evidence.',
        'Implementation work is distinguishable from knowledge and drill work.',
      ],
      verification: ['pnpm test'],
      evidence: [],
      now,
    }),
    createPacket({
      id: 'factory-status-surface',
      title: 'Show ongoing factory work in the app',
      summary: 'The user can ask what is ongoing and see active packets, next actions, validation state, and deployment feedback.',
      source: 'user-intent:status',
      kind: 'status',
      phase: 'implement',
      status: 'running',
      priority: 'high',
      nextAction: 'Render a compact in-app factory panel backed by persisted packet state.',
      acceptanceCriteria: [
        'Factory state is visible without leaving Branch Continue.',
        'The panel defaults to current work and allows drilling into details.',
      ],
      verification: ['pnpm build', 'manual UI smoke check'],
      evidence: [],
      now,
    }),
    createPacket({
      id: 'factory-knowledge-loop',
      title: 'Split voice thinking into threads and drills',
      summary: 'Rambling voice/text input becomes task, question, decision, knowledge, or drill packets instead of disappearing in chat.',
      source: 'user-intent:knowledge-loop',
      kind: 'drill',
      phase: 'plan',
      status: 'open',
      priority: 'normal',
      nextAction: 'Classify captured intent into separate packets and mark recall items separately from implementation tasks.',
      acceptanceCriteria: [
        'A single spoken intent can produce more than one packet.',
        'Recall/drill items are not treated as implementation todos.',
      ],
      verification: ['pnpm test'],
      evidence: [],
      now,
    }),
  ]
}

export function splitIntentIntoFactoryPackets(input: string, now = new Date().toISOString()): WorkPacket[] {
  const segments = splitIntent(input)
  return segments.map((segment, index) => {
    const kind = classifyIntentSegment(segment)
    const title = titleFromSegment(segment, kind)
    return createPacket({
      id: `factory-capture-${Date.parse(now).toString(36)}-${index + 1}`,
      title,
      summary: segment,
      source: 'captured-intent',
      kind,
      phase: kind === 'knowledge' || kind === 'drill' || kind === 'question' ? 'intake' : 'plan',
      status: 'open',
      priority: kind === 'implementation' ? 'high' : 'normal',
      nextAction: nextActionForKind(kind),
      acceptanceCriteria: acceptanceForKind(kind),
      verification: verificationForKind(kind),
      evidence: [],
      now,
    })
  })
}

export function summarizeFactoryState(packets: WorkPacket[]): FactoryStateSummary {
  const activePackets = packets.filter((packet) => isActivePacket(packet))
  return {
    total: packets.length,
    active: activePackets.length,
    blocked: packets.filter((packet) => packet.status === 'blocked').length,
    verified: packets.filter((packet) => packet.status === 'verified').length,
    done: packets.filter((packet) => packet.status === 'done').length,
    nextPacket: activePackets.sort(comparePacketPriority)[0] ?? null,
  }
}

export function advanceWorkPacketPhase(packet: WorkPacket, now = new Date().toISOString()): WorkPacket {
  const currentIndex = WORK_PACKET_PHASES.indexOf(packet.phase)
  const nextPhase = WORK_PACKET_PHASES[Math.min(currentIndex + 1, WORK_PACKET_PHASES.length - 1)] ?? 'done'
  return {
    ...packet,
    phase: nextPhase,
    status: statusForPhase(nextPhase),
    updatedAt: now,
    evidence: [
      ...packet.evidence,
      `${now}: advanced to ${nextPhase}`,
    ],
    nextAction: nextActionForPhase(nextPhase, packet.kind),
  }
}

export function normalizeFactoryPackets(value: unknown): WorkPacket[] {
  if (!Array.isArray(value)) return []
  return value.filter(isWorkPacket)
}

function createPacket(input: {
  id: string
  title: string
  summary: string
  source: string
  kind: WorkPacketKind
  phase: WorkPacketPhase
  status: WorkPacketStatus
  priority: WorkPacketPriority
  nextAction: string
  acceptanceCriteria: string[]
  verification: string[]
  evidence: string[]
  now: string
}): WorkPacket {
  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    source: input.source,
    kind: input.kind,
    phase: input.phase,
    status: input.status,
    priority: input.priority,
    createdAt: input.now,
    updatedAt: input.now,
    nextAction: input.nextAction,
    acceptanceCriteria: input.acceptanceCriteria,
    verification: input.verification,
    evidence: input.evidence,
  }
}

function splitIntent(input: string): string[] {
  const normalized = input
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []

  const numbered = normalized
    .split(/(?=\b\d+[.)]\s+)/g)
    .map((segment) => segment.replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean)

  if (numbered.length > 1) return numbered

  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z"]|I\b|Why\b|How\b|What\b|Maybe\b|Actually\b)/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function classifyIntentSegment(segment: string): WorkPacketKind {
  const text = segment.toLowerCase()
  if (hasKeyword(text, DRILL_KEYWORDS)) return 'drill'
  if (text.includes('?') || /\bwhy\b|\bhow\b|\bwhat\b/.test(text)) return 'question'
  if (/\bdecision\b|\bdecide\b|\bshould\b|\bcanonical\b/.test(text)) return 'decision'
  if (hasKeyword(text, STATUS_KEYWORDS)) return 'status'
  if (hasKeyword(text, WORKFLOW_KEYWORDS)) return 'workflow'
  if (hasKeyword(text, IMPLEMENTATION_KEYWORDS)) return 'implementation'
  return 'knowledge'
}

function titleFromSegment(segment: string, kind: WorkPacketKind): string {
  const cleaned = segment
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = cleaned.length > 72 ? `${cleaned.slice(0, 69).trim()}...` : cleaned
  if (clipped) return clipped
  return `${kind[0]?.toUpperCase() ?? 'W'}${kind.slice(1)} packet`
}

function nextActionForKind(kind: WorkPacketKind): string {
  switch (kind) {
    case 'implementation':
      return 'Write tests, implement the narrow change, then run verification.'
    case 'workflow':
      return 'Name the phases, gates, and verification evidence before implementation.'
    case 'status':
      return 'Surface current state, next action, owner, and verification status.'
    case 'drill':
      return 'Turn the knowledge into recall prompts and check it later.'
    case 'question':
      return 'Answer or route the question, then decide whether it creates work.'
    case 'decision':
      return 'Record the decision, alternatives, and the test that proves it was right.'
    case 'knowledge':
      return 'Capture the claim and link it to source context.'
  }
}

function acceptanceForKind(kind: WorkPacketKind): string[] {
  switch (kind) {
    case 'drill':
      return ['The remembered item has a prompt and a follow-up check.']
    case 'status':
      return ['The user can answer what is ongoing without reading raw logs.']
    case 'workflow':
      return ['Plan, test-design, implementation, and validation are distinct phases.']
    default:
      return ['The packet has a clear next action and verification path.']
  }
}

function verificationForKind(kind: WorkPacketKind): string[] {
  if (kind === 'implementation') return ['pnpm test', 'pnpm build']
  if (kind === 'status') return ['manual UI smoke check']
  return ['artifact review']
}

function nextActionForPhase(phase: WorkPacketPhase, kind: WorkPacketKind): string {
  switch (phase) {
    case 'intake':
      return nextActionForKind(kind)
    case 'plan':
      return 'Write the implementation plan and name the files to change.'
    case 'test-design':
      return 'Generate tests and manual QA before implementation.'
    case 'implement':
      return 'Make the smallest scoped code change.'
    case 'validate':
      return 'Run verification and attach evidence.'
    case 'deploy':
      return 'Package or deploy only when requested and smoke-check the result.'
    case 'feedback':
      return 'Capture user or deployment feedback as new work.'
    case 'done':
      return 'No next action.'
  }
}

function statusForPhase(phase: WorkPacketPhase): WorkPacketStatus {
  if (phase === 'done') return 'done'
  if (phase === 'validate') return 'verified'
  return phase === 'feedback' ? 'verified' : 'running'
}

function isActivePacket(packet: WorkPacket): boolean {
  return packet.status === 'open' || packet.status === 'running' || packet.status === 'blocked'
}

function comparePacketPriority(a: WorkPacket, b: WorkPacket): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.localeCompare(b.createdAt)
}

function priorityRank(priority: WorkPacketPriority): number {
  switch (priority) {
    case 'critical':
      return 0
    case 'high':
      return 1
    case 'normal':
      return 2
    case 'low':
      return 3
  }
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function isWorkPacket(value: unknown): value is WorkPacket {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.summary === 'string' &&
    typeof record.source === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.phase === 'string' &&
    typeof record.status === 'string' &&
    typeof record.priority === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    typeof record.nextAction === 'string' &&
    Array.isArray(record.acceptanceCriteria) &&
    Array.isArray(record.verification) &&
    Array.isArray(record.evidence)
  )
}
