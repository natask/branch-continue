export interface SourceNote {
  id: string
  offset: number
  sourcePath: string
  startLine: number
  endLine: number
  rawHeadline: string
  title: string
  timestamp: string | null
  tags: string[]
  body: string
  preview: string
}

export interface QuickNoteSearchHit {
  id: string
  noteId: string
  lineNumber: number
  preview: string
  matchText: string
  note: SourceNote
}

export interface QuickNoteCreateRequest {
  title?: string
  timestamp?: string
  tags?: string[]
  body: string
}

export interface QuickNoteCreateResponse {
  entry: SourceNote
}

export interface QuickNoteEntriesResponse {
  entries: SourceNote[]
  totalCount: number
  offset: number
  limit: number
  sourcePath: string
}

export interface ProjectRecord {
  slug: string
  name: string
  path: string
  ticketCount: number
  updatedAt: string
}

export interface TicketRecord {
  id: string
  title: string
  project: string
  path: string
  status: 'proposed'
  type: 'implementation_prompt'
  sourceNoteId: string
  sourceStartLine: number
  sourceEndLine: number
  promotedAt: string
}

export interface PromotionRequest {
  note: SourceNote
  projectSlug?: string
  projectName?: string
  ticketTitle?: string
  synthesis?: string
}

export interface PromotionResponse {
  project: ProjectRecord
  ticket: TicketRecord
}
