import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  conceptDescendants, conceptSourceStatus, pageSentences, readConcepts, removeConcept,
  writeConcepts, type PageConcept,
} from '../../core/backbone/concepts'

export interface ConceptDepthPanelProps {
  pageId: string
  pageText: string
  initiallyOpen?: boolean
  hideToggle?: boolean
  onChange: (body: string) => void
}

export function ConceptDepthPanel({ pageId, pageText, onChange, initiallyOpen = false, hideToggle = false }: ConceptDepthPanelProps) {
  const concepts = useMemo(() => readConcepts(pageText), [pageText])
  const sentences = useMemo(() => pageSentences(pageText), [pageText])
  const [draft, setDraft] = useState<PageConcept | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(initiallyOpen)
  useEffect(() => { setDraft(null); setError(null); setOpened(initiallyOpen) }, [pageId, initiallyOpen])

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
    return <li key={concept.id} className="concept-item">
      <div className="concept-actions">
        <button type="button" className="btn-secondary" onClick={() => { setDraft({ ...concept }); setError(null) }}>{concept.title}</button>
        <button type="button" className="btn-secondary" onClick={() => createIdea(concept.id)} aria-label={`Refine ${concept.title}`}>+ Refine</button>
      </div>
      {concept.description && <p className="concept-description">{concept.description}</p>}
      {concept.sourceText && <blockquote className="concept-source">
        {concept.sourceText}
        <small className="concept-source-status">{status === 'linked' ? 'Linked to current wording' : 'Source wording has changed — review the link'}</small>
      </blockquote>}
      {concept.outcome && <p className="concept-description"><strong>Outcome: </strong>{concept.outcome}</p>}
      <ul className="concept-children">
        {concepts.filter((child) => child.parentId === concept.id).map((child) => renderIdea(child, nextAncestors))}
      </ul>
    </li>
  }

  const excludedParents = draft ? conceptDescendants(concepts, draft.id) : new Set<string>()
  return <section className="concept-depth-panel" aria-label="Idea depth">
    <div className="concept-actions">
      {!hideToggle && <button type="button" className="btn-secondary" aria-expanded={opened} onClick={() => setOpened(!opened)}>Ideas{concepts.length ? ` (${concepts.length})` : ''}</button>}
      <button type="button" className="btn-secondary" onClick={() => createIdea()}>+ Idea</button>
    </div>
    {opened && <>
      {concepts.length === 0 && !draft && <p>Capture the point behind the wording. Link it to a sentence, refine it into smaller ideas, and record the outcome.</p>}
      <ul className="concept-list">{concepts.filter((concept) => !concept.parentId || !concepts.some((parent) => parent.id === concept.parentId)).map((concept) => renderIdea(concept))}</ul>
      {draft && <form onSubmit={(event) => { event.preventDefault(); saveIdea() }} className="concept-form">
        <label>Abstract point<input autoFocus className="concept-field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
        <label>Parent idea<select className="concept-field" value={draft.parentId ?? ''} onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })}>
          <option value="">Top level</option>
          {concepts.filter((concept) => !excludedParents.has(concept.id)).map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}
        </select></label>
        <label>Meaning<textarea rows={3} className="concept-field" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What does this idea mean, beyond its wording?" /></label>
        <label>Link a sentence<select className="concept-field" value={sentences.includes(draft.sourceText) ? draft.sourceText : ''} onChange={(event) => setDraft({ ...draft, sourceText: event.target.value })}>
          <option value="">Choose wording, or enter a passage below</option>
          {sentences.map((sentence, index) => <option key={index} value={sentence}>{sentence.length > 120 ? `${sentence.slice(0, 120)}…` : sentence}</option>)}
        </select></label>
        <label>Source passage<textarea rows={2} className="concept-field" value={draft.sourceText} onChange={(event) => setDraft({ ...draft, sourceText: event.target.value })} placeholder="A word, sentence, or passage from this note" /></label>
        {conceptSourceStatus(draft, pageText) === 'changed' && <p role="status" style={{ margin: 0 }}>This passage is absent from the current note. It remains attached for comparison.</p>}
        <label>Outcome<textarea rows={2} className="concept-field" value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} placeholder="How does the actual result relate to this idea?" /></label>
        {error && <p role="alert">{error}</p>}
        <div className="concept-actions">
          <button type="submit" className="btn-primary">Save idea</button>
          <button type="button" className="btn-secondary" onClick={() => { setDraft(null); setError(null) }}>Cancel</button>
          {concepts.some((concept) => concept.id === draft.id) && <button type="button" className="btn-secondary" onClick={() => { onChange(writeConcepts(pageText, removeConcept(concepts, draft.id))); setDraft(null) }}>Remove idea</button>}
        </div>
      </form>}
    </>}
  </section>
}
