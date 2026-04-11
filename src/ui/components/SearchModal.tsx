// Search modal — Cmd+K activated search overlay

import { useState, useCallback, useRef, useEffect } from 'react'
import type { PageMeta } from '../../core/page/types'
import type { SearchResult } from '../../core/search/types'

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onSearch: (query: string) => SearchResult<PageMeta>[]
  onSelect: (id: string) => void
}

export function SearchModal({ open, onClose, onSearch, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult<PageMeta>[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value
      setQuery(q)
      setResults(onSearch(q))
    },
    [onSearch],
  )

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id)
      onClose()
    },
    [onSelect, onClose],
  )

  if (!open) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          onChange={handleChange}
          placeholder="Search pages..."
        />
        <div className="search-results">
          {results.map((r) => (
            <button
              key={r.item.id}
              className="search-result"
              onClick={() => handleSelect(r.item.id)}
            >
              <span className="search-result-title">{r.item.title}</span>
              <span className="search-result-score">{(r.score * 100).toFixed(0)}%</span>
            </button>
          ))}
          {query && results.length === 0 && (
            <p className="search-empty">No results found.</p>
          )}
        </div>
      </div>
    </div>
  )
}
