// Event store types
// Ported from moav2 — simplified for page-centric model

export interface PageEvent {
  id: string
  type: string
  pageId?: string
  payload: Record<string, unknown>
  actor: string
  parentEventId?: string
  lamportClock?: number
  timestamp: number
}

export type NewPageEvent = Omit<PageEvent, 'id' | 'timestamp'>

export interface EventQueryOpts {
  type?: string
  pageId?: string
  actor?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}

// Segregated capability interfaces (ISP)
export interface EventWriter {
  append(event: NewPageEvent): Promise<PageEvent>
  appendBatch(events: NewPageEvent[]): Promise<PageEvent[]>
}

export interface EventReader {
  query(opts?: EventQueryOpts): Promise<PageEvent[]>
  getById(id: string): Promise<PageEvent | null>
  count(type?: string): Promise<number>
}

export interface EventPrimitives {
  writer: EventWriter
  reader: EventReader
}
