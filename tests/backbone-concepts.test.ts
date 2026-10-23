import { describe, expect, it } from 'vitest'
import {
  conceptDescendants, conceptSourceStatus, pageSentences, preserveConceptMetadata,
  readConcepts, removeConcept, stripConceptMetadata, writeConcepts, type PageConcept,
} from '../src/core/backbone/concepts'

function idea(id: string, parentId: string | null = null): PageConcept {
  return { id, parentId, title: id, description: '', sourceText: '', outcome: '', createdAt: '2026-10-22', updatedAt: '2026-10-22' }
}

describe('portable idea hierarchy', () => {
  it('round trips source passages containing comment terminators and Unicode inside the note', () => {
    const concept = { ...idea('point'), sourceText: 'Keep --> and ሀ and <tags> intact.', outcome: 'Observed result' }
    const body = 'Keep --> and ሀ and <tags> intact.\n'
    const serialized = writeConcepts(body, [concept])
    expect(readConcepts(serialized)).toEqual([concept])
    expect(stripConceptMetadata(serialized)).toBe(body)
    expect(serialized.match(/-->/g)).toHaveLength(2)
  })

  it('preserves the hierarchy when the visible note is edited', () => {
    const original = writeConcepts('Earlier wording', [idea('point')])
    const next = preserveConceptMetadata('New wording', original)
    expect(stripConceptMetadata(next)).toBe('New wording')
    expect(readConcepts(next)).toEqual([idea('point')])
    expect(readConcepts(writeConcepts(next, [idea('revised')]))).toEqual([idea('revised')])
  })

  it('rejects cycles, missing parents, and duplicate IDs', () => {
    expect(() => writeConcepts('', [idea('a', 'b'), idea('b', 'a')])).toThrow('ancestor')
    expect(() => writeConcepts('', [idea('a', 'missing')])).toThrow('parent')
    expect(() => writeConcepts('', [idea('a'), idea('a')])).toThrow('unique')
    expect(() => writeConcepts('', [{ ...idea('a'), title: ' ' }])).toThrow('name')
  })

  it('retains descendants when removing an intermediate abstraction', () => {
    const concepts = [idea('root'), idea('child', 'root'), idea('grandchild', 'child')]
    expect(conceptDescendants(concepts, 'child')).toEqual(new Set(['child', 'grandchild']))
    expect(removeConcept(concepts, 'child')).toEqual([idea('root'), idea('grandchild', 'root')])
  })

  it('flags source passages changed by later edits while keeping historical wording', () => {
    const concept = { ...idea('a'), sourceText: 'Original sentence.' }
    expect(conceptSourceStatus(concept, 'Original sentence. More text.')).toBe('linked')
    expect(conceptSourceStatus(concept, 'Revised sentence.')).toBe('changed')
    expect(conceptSourceStatus(idea('a'), 'Anything')).toBe('unlinked')
    expect(pageSentences(writeConcepts('One sentence. Two sentences!\nOne sentence.', [concept]))).toEqual(['One sentence.', 'Two sentences!'])
  })
})

it('offers note wording as source passages while hiding generated instructions and task records', () => {
  const body = [
    '<!-- backbone-page-system:v1 %22Hidden%20instructions.%22 -->',
    'A visible sentence.',
    '',
    '<!-- branch-continue-agent-task:start r1 -->',
    'Agent task: r1',
    'Session: hidden-session',
    'Status: completed',
    '<!-- branch-continue-agent-task:end r1 -->',
  ].join('\n')
  expect(pageSentences(body)).toEqual(['A visible sentence.'])
  expect(conceptSourceStatus({ ...idea('a'), sourceText: 'hidden-session' }, body)).toBe('changed')
})
