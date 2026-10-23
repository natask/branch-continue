import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  conceptDescendants, conceptSourceStatus, pageSentences, readConcepts, removeConcept,
  writeConcepts, type PageConcept,
} from '../../core/backbone/concepts'

export interface ConceptDepthPanelProps {
  pageId: string
  pageText: string
  onChange: (body: string) => void
}

const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, padding: 8, font: 'inherit', color: 'inherit', background: 'var(--bg, transparent)', border: '1px solid var(--border, #7775)', borderRadius: 6 }

export function ConceptDepthPanel({ pageId, pageText, onChange }: ConceptDepthPanelProps) {
  const concepts = useMemo(() => readConcepts(pageText), [pageText])
  const sentences = useMemo(() => pageSentences(pageText), [pageText])
  const [draft, setDraft] = useState<PageConcept | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  useEffect(() => { setDraft(null); setError(null); setOpened(false) }, [pageId])

  function createIdea(parentId: string | null = null) {
    const now = new Date().toISOString()
    setDraft({ id: crypto.randomUUID(), parentId, title: '', description: '', sourceText: '', outcome: '', createdAt: now, updatedAt: now })
    setError(null)
    setOpened(true)
  }

  function saveIdea() {
    if (!draft) return
    try {
      const saved = { ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() }
      const next = concepts.some((concept) => concept.id === saved.id)
        ? concepts.map((concept) => concept.id === saved.id ? saved : concept)
        : [...concepts, saved]
      onChange(writeConcepts(pageText, next))
      setDraft(null)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  function renderIdea(concept: PageConcept, ancestors = new Set<string>()): ReactNode {
    if (ancestors.has(concept.id)) return null
    const nextAncestors = new Set([...ancestors, concept.id])
    const status = conceptSourceStatus(concept, pageText)
    return <li key={concept.id} style={{ marginBlock: 12, listStyle: 'none' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn-secondary" onClick={() => { setDraft({ ...concept }); setError(null) }}>{concept.title}</button>
        <button type="button" className="btn-secondary" onClick={() => createIdea(concept.id)} aria-label={`Refine ${concept.title}`}>+ Refine</button>
      </div>
      {concept.description && <p style={{ whiteSpace: 'pre-wrap', marginBlock: 8 }}>{concept.description}</p>}
      {concept.sourceText && <blockquote style={{ margin: '8px 0', paddingLeft: 12, borderLeft: '2px solid #8886', whiteSpace: 'pre-wrap' }}>
        {concept.sourceText}
        <small style={{ display: 'block', opacity: 0.7 }}>{status === 'linked' ? 'Linked to current wording' : 'Source wording has changed — review the link'}</small>
      </blockquote>}
      {concept.outcome && <p style={{ whiteSpace: 'pre-wrap', marginBlock: 8 }}><strong>Outcome: </strong>{concept.outcome}</p>}
      <ul style={{ paddingLeft: 18, borderLeft: '1px solid #8884' }}>
        {concepts.filter((child) => child.parentId === concept.id).map((child) => renderIdea(child, nextAncestors))}
      </ul>
    </li>
  }

  const excludedParents = draft ? conceptDescendants(concepts, draft.id) : new Set<string>()
  return <section aria-label="Idea depth" style={{ marginBlock: 20, paddingBlock: 12, borderTop: '1px solid #8884', minWidth: 0 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <button type="button" className="btn-secondary" aria-expanded={opened} onClick={() => setOpened(!opened)}>Ideas{concepts.length ? ` (${concepts.length})` : ''}</button>
      <button type="button" className="btn-secondary" onClick={() => createIdea()}>+ Idea</button>
    </div>
    {opened && <>
      {concepts.length === 0 && !draft && <p>Capture the point behind the wording. Link it to a sentence, refine it into smaller ideas, and record the outcome.</p>}
      <ul style={{ padding: 0 }}>{concepts.filter((concept) => !concept.parentId || !concepts.some((parent) => parent.id === concept.parentId)).map((concept) => renderIdea(concept))}</ul>
      {draft && <form onSubmit={(event) => { event.preventDefault(); saveIdea() }} style={{ display: 'grid', gap: 12, marginBlock: 12 }}>
        <label>Abstract point<input autoFocus style={fieldStyle} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
        <label>Parent idea<select style={fieldStyle} value={draft.parentId ?? ''} onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })}>
          <option value="">Top level</option>
          {concepts.filter((concept) => !excludedParents.has(concept.id)).map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}
        </select></label>
        <label>Meaning<textarea rows={3} style={fieldStyle} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What does this idea mean, beyond its wording?" /></label>
        <label>Link a sentence<select style={fieldStyle} value={sentences.includes(draft.sourceText) ? draft.sourceText : ''} onChange={(event) => setDraft({ ...draft, sourceText: event.target.value })}>
          <option value="">Choose wording, or enter a passage below</option>
          {sentences.map((sentence, index) => <option key={index} value={sentence}>{sentence.length > 120 ? `${sentence.slice(0, 120)}…` : sentence}</option>)}
        </select></label>
        <label>Source passage<textarea rows={2} style={fieldStyle} value={draft.sourceText} onChange={(event) => setDraft({ ...draft, sourceText: event.target.value })} placeholder="A word, sentence, or passage from this note" /></label>
        {conceptSourceStatus(draft, pageText) === 'changed' && <p role="status" style={{ margin: 0 }}>This passage is absent from the current note. It remains attached for comparison.</p>}
        <label>Outcome<textarea rows={2} style={fieldStyle} value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} placeholder="How does the actual result relate to this idea?" /></label>
        {error && <p role="alert">{error}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="submit" className="btn-primary">Save idea</button>
          <button type="button" className="btn-secondary" onClick={() => { setDraft(null); setError(null) }}>Cancel</button>
          {concepts.some((concept) => concept.id === draft.id) && <button type="button" className="btn-secondary" onClick={() => { onChange(writeConcepts(pageText, removeConcept(concepts, draft.id))); setDraft(null) }}>Remove idea</button>}
        </div>
      </form>}
    </>}
  </section>
}
