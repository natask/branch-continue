/** Ideas live inside their note so copying/syncing the note carries the hierarchy. */
export interface PageConcept {
  id: string
  parentId: string | null
  title: string
  description: string
  sourceText: string
  outcome: string
  createdAt: string
  updatedAt: string
}

const BLOCK = /(?:\n\n)?<!-- backbone-concepts:v1\n([\s\S]*?)\n-->/g

function isConcept(value: unknown): value is PageConcept {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['id', 'title', 'description', 'sourceText', 'outcome', 'createdAt', 'updatedAt']
    .every((key) => typeof record[key] === 'string')
    && (record.parentId === null || typeof record.parentId === 'string')
}

export function readConcepts(body: string): PageConcept[] {
  const matches = [...body.matchAll(new RegExp(BLOCK))]
  const match = matches[matches.length - 1]
  if (!match) return []
  let payload: unknown
  try { payload = JSON.parse(match[1]) } catch { return [] }
  if (!Array.isArray(payload) || !payload.every(isConcept)) return []
  const ids = new Set<string>()
  for (const concept of payload) {
    if (!concept.id || ids.has(concept.id)) return []
    ids.add(concept.id)
  }
  return payload
}

export function stripConceptMetadata(body: string): string {
  return body.replace(new RegExp(BLOCK), '')
}

export function writeConcepts(body: string, concepts: PageConcept[]): string {
  validateConceptHierarchy(concepts)
  const visible = stripConceptMetadata(body)
  if (concepts.length === 0) return visible
  // Escape angle brackets to keep arbitrary quoted source text inside the comment.
  const json = JSON.stringify(concepts, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return `${visible}\n\n<!-- backbone-concepts:v1\n${json}\n-->`
}

export function preserveConceptMetadata(visibleBody: string, originalBody: string): string {
  const blocks = [...originalBody.matchAll(new RegExp(BLOCK))].map((match) => match[0])
  return stripConceptMetadata(visibleBody) + blocks.join('')
}

export function validateConceptHierarchy(concepts: PageConcept[]): void {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]))
  if (byId.size !== concepts.length) throw new Error('Each idea must have a unique ID.')
  for (const concept of concepts) {
    if (!concept.title.trim()) throw new Error('Give the idea a name.')
    const visited = new Set([concept.id])
    let parentId = concept.parentId
    while (parentId !== null) {
      if (visited.has(parentId)) throw new Error('An idea cannot be its own ancestor.')
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) throw new Error('The parent idea no longer exists.')
      parentId = parent.parentId
    }
  }
}

export function conceptDescendants(concepts: PageConcept[], id: string): Set<string> {
  const descendants = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const concept of concepts) {
      if (concept.parentId && descendants.has(concept.parentId) && !descendants.has(concept.id)) {
        descendants.add(concept.id)
        changed = true
      }
    }
  }
  return descendants
}

/** Removing a node preserves its refinements by attaching them to its parent. */
export function removeConcept(concepts: PageConcept[], id: string): PageConcept[] {
  const parentId = concepts.find((concept) => concept.id === id)?.parentId ?? null
  return concepts.filter((concept) => concept.id !== id)
    .map((concept) => concept.parentId === id ? { ...concept, parentId } : concept)
}

export function conceptSourceStatus(concept: PageConcept, pageText: string): 'unlinked' | 'linked' | 'changed' {
  if (!concept.sourceText) return 'unlinked'
  return stripConceptMetadata(pageText).includes(concept.sourceText) ? 'linked' : 'changed'
}

export function pageSentences(pageText: string): string[] {
  return [...new Set(stripConceptMetadata(pageText).split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim()).filter(Boolean))]
}
