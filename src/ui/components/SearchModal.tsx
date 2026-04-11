import { useEffect, useRef, useState } from 'react'
import type { QuickNoteSearchHit } from '../../core/quicknote/types'

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onSearch: (query: string) => Promise<QuickNoteSearchHit[]>
  onSelect: (hit: QuickNoteSearchHit) => void
}

export function SearchModal({ open, onClose, onSearch, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<QuickNoteSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    setLoading(false)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      setError(null)
      return undefined
    }

    const currentRequest = requestIdRef.current + 1
    requestIdRef.current = currentRequest
    setLoading(true)
    setError(null)

    const timer = window.setTimeout(async () => {
      try {
        const nextResults = await onSearch(query)
        if (requestIdRef.current !== currentRequest) return
        setResults(nextResults)
      } catch (nextError) {
        if (requestIdRef.current !== currentRequest) return
        setError(nextError instanceof Error ? nextError.message : String(nextError))
        setResults([])
      } finally {
        if (requestIdRef.current === currentRequest) {
          setLoading(false)
        }
      }
    }, 120)

    return () => window.clearTimeout(timer)
  }, [onSearch, open, query])

  if (!open) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault()
              onSelect(results[0])
            }
          }}
          placeholder="Search the selected file..."
        />

        <div className="search-results">
          {loading && <p className="search-empty">searching…</p>}
          {!loading &&
            results.map((result) => (
              <button
                key={result.id}
                className="search-result"
                onClick={() => onSelect(result)}
              >
                <div className="search-result-copy">
                  <div className="search-result-heading">
                    <span className="search-result-title">{result.note.title}</span>
                    <span className="search-result-line">L{result.lineNumber}</span>
                  </div>
                  <div className="search-result-meta">
                    {result.note.timestamp && <span>{result.note.timestamp}</span>}
                    {result.note.tags.length > 0 && (
                      <span>{result.note.tags.map((tag) => `#${tag}`).join(' ')}</span>
                    )}
                  </div>
                  <p className="search-result-preview">{result.preview}</p>
                </div>
              </button>
            ))}

          {!loading && error && <p className="search-empty">{error}</p>}
          {!loading && !error && query && results.length === 0 && (
            <p className="search-empty">No matches found.</p>
          )}
          {!loading && !query && <p className="search-empty">Type to search the source file.</p>}
        </div>
      </div>
    </div>
  )
}
