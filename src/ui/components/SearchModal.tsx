import { Command } from 'master-cmdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuickNoteSearchHit } from '../../core/quicknote/types'

export interface SearchCommandAction {
  id: string
  label: string
  hint?: string
  keywords?: string[]
  group?: string
  disabled?: boolean
  run: () => void
}

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onSearch: (query: string) => Promise<QuickNoteSearchHit[]>
  onSelect: (hit: QuickNoteSearchHit) => void
  commandActions: SearchCommandAction[]
}

export function SearchModal({ open, onClose, onSearch, onSelect, commandActions }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<QuickNoteSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const openRef = useRef(open)

  const groupedActions = useMemo(() => {
    const groups = new Map<string, SearchCommandAction[]>()
    for (const action of commandActions) {
      if (action.disabled) continue
      const groupName = action.group ?? 'Commands'
      const existing = groups.get(groupName) ?? []
      existing.push(action)
      groups.set(groupName, existing)
    }
    return Array.from(groups.entries())
  }, [commandActions])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    setLoading(false)
  }, [open])

  const handleSearchChange = useCallback(
    async (nextQuery: string, signal?: AbortSignal) => {
      setQuery(nextQuery)
      if (!openRef.current) return
      if (!nextQuery.trim()) {
        requestIdRef.current += 1
        setResults([])
        setLoading(false)
        setError(null)
        return
      }

      const currentRequest = requestIdRef.current + 1
      requestIdRef.current = currentRequest
      setLoading(true)
      setError(null)

      try {
        const nextResults = await onSearch(nextQuery)
        if (signal?.aborted || requestIdRef.current !== currentRequest || !openRef.current) return
        setResults(nextResults)
      } catch (nextError) {
        if (signal?.aborted || requestIdRef.current !== currentRequest || !openRef.current) return
        setError(nextError instanceof Error ? nextError.message : String(nextError))
        setResults([])
      } finally {
        if (!signal?.aborted && requestIdRef.current === currentRequest && openRef.current) {
          setLoading(false)
        }
      }
    },
    [onSearch],
  )

  const handleActionSelect = useCallback(
    (action: SearchCommandAction) => {
      action.run()
      onClose()
    },
    [onClose],
  )

  const handleResultSelect = useCallback(
    (hit: QuickNoteSearchHit) => {
      onSelect(hit)
      onClose()
    },
    [onClose, onSelect],
  )

  const hasSearch = query.trim().length > 0
  const showNotes = hasSearch && !error && results.length > 0

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      overlayClassName="search-overlay"
      contentClassName="search-modal"
      label="Command palette"
      description="Run commands and search notes."
      pointerBehavior="split"
    >
      <Command.Input
        className="search-input"
        value={query}
        onValueChange={handleSearchChange}
        placeholder="Type a command or search notes..."
        autoFocus
      />

      <Command.List className="search-results">
        {groupedActions.map(([groupName, actions], groupIndex) => (
          <div key={groupName}>
            {groupIndex > 0 && <Command.Separator className="search-separator" />}
            <Command.Group heading={groupName}>
              {actions.map((action) => (
                <Command.Item
                  key={action.id}
                  className="search-result search-result-command"
                  value={`${action.label} ${action.id}`}
                  keywords={action.keywords}
                  onSelect={() => handleActionSelect(action)}
                >
                  <div className="search-result-copy">
                    <div className="search-result-heading">
                      <span className="search-result-title">{action.label}</span>
                      {action.hint && <span className="search-result-line">{action.hint}</span>}
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          </div>
        ))}

        {showNotes && <Command.Separator className="search-separator" />}
        {showNotes && (
          <Command.Group heading={`Notes (${results.length})`}>
            {results.map((result) => (
              <Command.Item
                key={result.id}
                className="search-result"
                value={`${result.id} ${result.note.title} ${result.preview}`}
                keywords={[
                  `line ${result.lineNumber}`,
                  result.note.timestamp ?? '',
                  ...result.note.tags,
                ]}
                onSelect={() => handleResultSelect(result)}
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
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {loading && <Command.Loading className="search-empty">searching notes…</Command.Loading>}
        {error && <p className="search-empty">{error}</p>}
        <Command.Empty className="search-empty">No matching commands or notes.</Command.Empty>
      </Command.List>
    </Command.Dialog>
  )
}
