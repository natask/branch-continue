export type AgentRuntimeKind = 'local' | 'master-orch' | 'model' | 'search' | 'custom'

export interface AgentDefinition {
  id: string
  label: string
  purpose: string
  runtimeHint?: AgentRuntimeKind
  instructions?: string
  allowedActions?: string[]
}

export interface AgentWorkContext {
  pageId: string
  anchorId: string
  threadId: string
  quote: string
  localContext: string
  documentText: string
  threadHistory?: AgentThreadTurn[]
}

export interface AgentThreadTurn {
  actor: string
  body: string
  createdAt?: number
}

export interface AgentWorkRequest {
  id: string
  agentId: string
  prompt: string
  source: string
  context: AgentWorkContext
  metadata?: Record<string, unknown>
}

export interface AgentWorkResult {
  runtimeId: string
  status: 'completed' | 'launched' | 'failed'
  response: string
  runUrl?: string
  externalId?: string
  error?: string
}

export interface AgentRuntime {
  id: string
  label: string
  kind: AgentRuntimeKind
  available(): boolean
  canHandle(request: AgentWorkRequest, agent: AgentDefinition): boolean
  submit(request: AgentWorkRequest, agent: AgentDefinition): Promise<AgentWorkResult>
}

export interface AgentRouter {
  route(request: AgentWorkRequest): Promise<AgentWorkResult>
}
