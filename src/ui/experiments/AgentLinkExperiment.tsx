import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { SearchModal, type SearchCommandAction } from '../components/SearchModal'
import { TimeMachine } from '../components/TimeMachine'
import { useAgentStation } from '../agent-station/use-agent-station'
import { isCommandPaletteOpenShortcut } from '../lib/keyboard-shortcuts'
import type { QuickNoteSearchHit, SourceNote } from '../../core/quicknote/types'

type LinkThreadStatus = 'running' | 'ready'
type LinkMessageRole = 'user' | 'agent'

interface LinkMessage {
  id: string
  role: LinkMessageRole
  body: string
  timestamp: string
}

interface AgentLinkThread {
  id: string
  token: string
  title: string
  sourceExcerpt: string
  status: LinkThreadStatus
  createdAt: string
  messages: LinkMessage[]
}

interface StoredAgentLinkExperiment {
  pageBody: string
  threads: AgentLinkThread[]
  activeThreadId: string | null
}

const STORAGE_KEY = 'branch-continue:agent-link-experiment:v1'
const SOURCE_PATH = 'branch-continue://single-page-agent-links'

const INITIAL_PAGE_BODY = `This is one Branch Continue page, not a separate app.

The thing to test is whether a thought can hold a small link-like reference and still keep moving. The reference is @agent/search-001.

Click the reference, continue the chat behind it, then come back to the page without expanding the whole agent result inline.`

const INITIAL_THREADS: AgentLinkThread[] = [
  {
    id: 'agent-search-001',
    token: '@agent/search-001',
    title: 'Search link contract',
    sourceExcerpt: 'What should an @agent/search link keep behind the page?',
    status: 'ready',
    createdAt: '19:40',
    messages: [
      {
        id: 'agent-search-001-user-0',
        role: 'user',
        timestamp: '19:40',
        body: 'Search for the product contract behind a link-like agent reference.',
      },
      {
        id: 'agent-search-001-agent-0',
        role: 'agent',
        timestamp: '19:41',
        body: 'The page should keep only the compact token. The continuation behind it owns the prompt, working notes, status, and later results.',
      },
    ],
  },
]

export function AgentLinkExperiment() {
  const stored = useMemo(readStoredExperiment, [])
  const [pageBody, setPageBody] = useState(stored?.pageBody ?? INITIAL_PAGE_BODY)
  const [threads, setThreads] = useState(stored?.threads ?? INITIAL_THREADS)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    stored?.activeThreadId ?? INITIAL_THREADS[0]?.id ?? null,
  )
  const [activeNoteId, setActiveNoteId] = useState('single-page')
  const [searchOpen, setSearchOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(true)
  const [chatDraft, setChatDraft] = useState('')
  const station = useAgentStation({ sourcePath: SOURCE_PATH }, { useAgentation: false })
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads],
  )

  const notes = useMemo(() => buildExperimentNotes(pageBody, threads), [pageBody, threads])
  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? notes[0] ?? null,
    [activeNoteId, notes],
  )

  useEffect(() => {
    const snapshot: StoredAgentLinkExperiment = { pageBody, threads, activeThreadId }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // Ignore experiment persistence failures.
    }
  }, [activeThreadId, pageBody, threads])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isCommandPaletteOpenShortcut(event)) return
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      setSearchOpen(true)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const openThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId)
      setActiveNoteId(threadId)
      setEditorOpen(true)
    },
    [],
  )

  const ensureThreadForToken = useCallback(
    (token: string, excerpt?: string) => {
      const existing = threads.find((thread) => thread.token === token)
      if (existing) {
        openThread(existing.id)
        return
      }

      const thread = createThreadFromToken(token, excerpt ?? paragraphForToken(pageBody, token))
      setThreads((current) => [thread, ...current])
      openThread(thread.id)
      window.setTimeout(() => markThreadReady(thread.id), 520)
    },
    [openThread, pageBody, threads],
  )

  const createSearchLink = useCallback(
    (excerpt?: string) => {
      const nextIndex = nextSearchIndex(threads)
      const token = `@agent/search-${String(nextIndex).padStart(3, '0')}`
      const prompt = excerpt?.trim() || selectedText(bodyRef.current) || currentParagraph(bodyRef.current, pageBody)
      const thread = createThreadFromToken(token, prompt)
      setPageBody((current) => insertTokenIntoBody(current, token, bodyRef.current))
      setThreads((current) => [thread, ...current])
      openThread(thread.id)
      window.setTimeout(() => markThreadReady(thread.id), 520)
    },
    [openThread, pageBody, threads],
  )

  const markThreadReady = useCallback((threadId: string) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              status: 'ready',
              messages: [
                ...thread.messages,
                {
                  id: `${thread.id}-agent-${thread.messages.length}`,
                  role: 'agent',
                  timestamp: timestampNow(),
                  body: 'Search branch is ready. Keep chatting here; the single page only needs the link.',
                },
              ],
            }
          : thread,
      ),
    )
  }, [])

  const searchExperiment = useCallback(
    async (query: string): Promise<QuickNoteSearchHit[]> => {
      const normalized = query.trim().toLowerCase()
      if (!normalized) return []

      return notes
        .map((note, index) => {
          const haystack = `${note.title} ${note.body} ${note.tags.join(' ')}`.toLowerCase()
          if (!haystack.includes(normalized)) return null
          return {
            id: `agent-link-hit-${note.id}`,
            noteId: note.id,
            lineNumber: note.startLine,
            preview: note.preview,
            matchText: query,
            note,
            index,
          }
        })
        .filter((hit): hit is QuickNoteSearchHit & { index: number } => Boolean(hit))
        .sort((a, b) => a.index - b.index)
    },
    [notes],
  )

  const handleSearchSelect = useCallback(
    (hit: QuickNoteSearchHit) => {
      setActiveNoteId(hit.note.id)
      const thread = threads.find((candidate) => candidate.id === hit.note.id)
      if (thread) setActiveThreadId(thread.id)
      setEditorOpen(true)
    },
    [threads],
  )

  const commandActions = useMemo<SearchCommandAction[]>(
    () => [
      {
        id: 'agent-link-create-search',
        label: 'Agent Link: Create @agent/search',
        hint: 'Insert a link-like search branch into the page',
        group: 'Agent Links',
        keywords: ['agent', 'search', 'link', 'reference'],
        run: () => createSearchLink(),
      },
      {
        id: 'agent-link-open-page',
        label: 'Agent Link: Open Single Page',
        hint: SOURCE_PATH,
        group: 'Agent Links',
        keywords: ['page', 'single', 'editor'],
        run: () => {
          setActiveNoteId('single-page')
          setEditorOpen(true)
        },
      },
      {
        id: 'agent-link-open-active-thread',
        label: 'Agent Link: Continue Active Search',
        hint: activeThread?.token ?? 'No active thread',
        group: 'Agent Links',
        disabled: !activeThread,
        keywords: ['continue', 'thread', 'chat'],
        run: () => {
          if (activeThread) openThread(activeThread.id)
        },
      },
      {
        id: 'agent-link-reset',
        label: 'Agent Link: Reset Experiment',
        hint: 'Restore seeded single page',
        group: 'Agent Links',
        keywords: ['reset', 'demo', 'experiment'],
        run: () => {
          setPageBody(INITIAL_PAGE_BODY)
          setThreads(INITIAL_THREADS)
          setActiveThreadId(INITIAL_THREADS[0]?.id ?? null)
          setActiveNoteId('single-page')
          setEditorOpen(true)
          window.localStorage.removeItem(STORAGE_KEY)
        },
      },
      ...station.actions,
    ],
    [activeThread, createSearchLink, openThread, station.actions],
  )

  const sendMessage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!activeThread || !chatDraft.trim()) return

      const body = chatDraft.trim()
      const threadId = activeThread.id
      setChatDraft('')
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                status: 'running',
                messages: [
                  ...thread.messages,
                  {
                    id: `${thread.id}-user-${thread.messages.length}`,
                    role: 'user',
                    timestamp: timestampNow(),
                    body,
                  },
                ],
              }
            : thread,
        ),
      )

      window.setTimeout(() => {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  status: 'ready',
                  messages: [
                    ...thread.messages,
                    {
                      id: `${thread.id}-agent-${thread.messages.length}`,
                      role: 'agent',
                      timestamp: timestampNow(),
                      body: continuationReply(body),
                    },
                  ],
                }
              : thread,
          ),
        )
      }, 520)
    },
    [activeThread, chatDraft],
  )

  return (
    <div className="app agent-link-experiment">
      <header className="topbar">
        <div className="topbar-copy">
          <div className="topbar-kicker">Agent link experiment</div>
          <h1 className="topbar-title">Branch Continue</h1>
          <p className="topbar-path">{SOURCE_PATH}</p>
        </div>

        <div className="topbar-meta">
          <button className="topbar-search" onClick={() => createSearchLink()} type="button">
            Link Search
          </button>
          <button className="topbar-search" onClick={() => setEditorOpen(true)} type="button">
            Single Page
          </button>
          <button className="topbar-search topbar-search-strong" onClick={() => setSearchOpen(true)} type="button">
            Commands
          </button>
        </div>
      </header>

      <section className="lineage-strip">
        <button
          className="lineage-pill lineage-pill-parent"
          onClick={() => {
            setActiveNoteId('single-page')
            setEditorOpen(true)
          }}
          type="button"
        >
          Source: single page
        </button>
        <div className="lineage-children">
          <span className="lineage-label">Agent links</span>
          {threads.map((thread) => (
            <button
              key={thread.id}
              className={`lineage-pill${thread.id === activeThread?.id ? ' lineage-pill-active' : ''}`}
              onClick={() => openThread(thread.id)}
              type="button"
            >
              {thread.token}
            </button>
          ))}
        </div>
      </section>

      <TimeMachine
        notes={notes}
        activeNoteId={activeNote?.id ?? null}
        totalCount={notes.length}
        navigationEnabled={!searchOpen && !editorOpen}
        swipeUpNavTarget="previous"
        wheelNavDirection="natural"
        isMobile={false}
        showGestureTuner={false}
        onSelect={(note) => setActiveNoteId(note.id)}
        onOpen={(note) => {
          setActiveNoteId(note.id)
          const thread = threads.find((candidate) => candidate.id === note.id)
          if (thread) setActiveThreadId(thread.id)
          setEditorOpen(true)
        }}
        onBranch={(note) => createSearchLink(note.body || note.preview)}
      />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={searchExperiment}
        onSelect={handleSearchSelect}
        commandActions={commandActions}
      />

      {!editorOpen && <ExperimentCommandAccessBar onOpen={() => setSearchOpen(true)} />}
      {station.element}

      {editorOpen && (
        <AgentLinkEditor
          bodyRef={bodyRef}
          pageBody={pageBody}
          activeThread={activeThread}
          threads={threads}
          chatDraft={chatDraft}
          onBodyChange={setPageBody}
          onClose={() => setEditorOpen(false)}
          onOpenCommands={() => setSearchOpen(true)}
          onCreateSearchLink={() => createSearchLink()}
          onOpenToken={ensureThreadForToken}
          onDraftChange={setChatDraft}
          onSubmit={sendMessage}
        />
      )}
    </div>
  )
}

function AgentLinkEditor({
  bodyRef,
  pageBody,
  activeThread,
  threads,
  chatDraft,
  onBodyChange,
  onClose,
  onOpenCommands,
  onCreateSearchLink,
  onOpenToken,
  onDraftChange,
  onSubmit,
}: {
  bodyRef: RefObject<HTMLTextAreaElement | null>
  pageBody: string
  activeThread: AgentLinkThread | null
  threads: AgentLinkThread[]
  chatDraft: string
  onBodyChange: (body: string) => void
  onClose: () => void
  onOpenCommands: () => void
  onCreateSearchLink: () => void
  onOpenToken: (token: string) => void
  onDraftChange: (draft: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <article className="note-editor agent-link-editor">
      <div className="note-editor-shell">
        <div className="note-editor-header">
          <div className="note-editor-title-area">
            <h2 className="note-editor-title">Single page with agent links</h2>
          </div>
          <div className="note-editor-actions">
            <button className="btn-secondary" onClick={onOpenCommands} type="button">
              Commands
            </button>
            <button className="btn-primary" onClick={onCreateSearchLink} type="button">
              Link Search
            </button>
            <button className="btn-secondary" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="note-editor-tagline">
          <span className="tm-tag tm-tag--inline">single-page</span>
          <span className="tm-tag tm-tag--inline">agent-links</span>
          <span className="note-editor-position">{threads.length} links</span>
        </div>

        <div className="agent-link-editor-grid">
          <section className="agent-link-page-pane" aria-label="Single page body">
            <div className="agent-link-readable">
              {renderLinkedBody(pageBody, onOpenToken)}
            </div>
            <textarea
              ref={bodyRef}
              className="agent-link-page-input"
              value={pageBody}
              onChange={(event) => onBodyChange(event.target.value)}
              aria-label="Single page source"
            />
          </section>

          <ContinuationPane
            thread={activeThread}
            draft={chatDraft}
            onDraftChange={onDraftChange}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    </article>
  )
}

function ContinuationPane({
  thread,
  draft,
  onDraftChange,
  onSubmit,
}: {
  thread: AgentLinkThread | null
  draft: string
  onDraftChange: (draft: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  if (!thread) {
    return (
      <aside className="agent-link-thread-pane agent-link-thread-empty">
        <p>Click an @agent/search link to open its continuation.</p>
      </aside>
    )
  }

  return (
    <aside className="agent-link-thread-pane" aria-label="Agent continuation">
      <div className="agent-link-thread-head">
        <div>
          <span>{thread.token}</span>
          <h3>{thread.title}</h3>
        </div>
        <strong className={`agent-link-status agent-link-status-${thread.status}`}>{thread.status}</strong>
      </div>
      <p className="agent-link-source">{thread.sourceExcerpt}</p>
      <div className="agent-link-messages">
        {thread.messages.map((message) => (
          <div key={message.id} className={`agent-link-message agent-link-message-${message.role}`}>
            <span>{message.role === 'user' ? 'you' : 'search'}</span>
            <p>{message.body}</p>
            <time>{message.timestamp}</time>
          </div>
        ))}
        {thread.status === 'running' && (
          <div className="agent-link-message agent-link-message-agent">
            <span>search</span>
            <p>Working...</p>
          </div>
        )}
      </div>
      <form className="agent-link-chat-form" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          aria-label="Continue agent link"
        />
        <button className="btn-primary" type="submit">
          Send
        </button>
      </form>
    </aside>
  )
}

function ExperimentCommandAccessBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="command-access-bar" role="navigation" aria-label="Command access">
      <button className="command-access-button" onClick={onOpen} type="button">
        <span>Commands</span>
        <kbd>Cmd K</kbd>
      </button>
    </div>
  )
}

function renderLinkedBody(body: string, onOpenToken: (token: string) => void): ReactNode[] {
  const parts = body.split(/(@agent\/search-\d{3})/g)
  return parts.map((part, index) => {
    if (/^@agent\/search-\d{3}$/.test(part)) {
      return (
        <button key={`${part}-${index}`} className="agent-link-token" onClick={() => onOpenToken(part)} type="button">
          {part}
        </button>
      )
    }

    return <span key={`text-${index}`}>{part}</span>
  })
}

function buildExperimentNotes(pageBody: string, threads: AgentLinkThread[]): SourceNote[] {
  const pageNote: SourceNote = {
    id: 'single-page',
    noteUid: 'single-page',
    offset: 0,
    sourcePath: SOURCE_PATH,
    startLine: 1,
    endLine: lineCount(pageBody),
    rawHeadline: 'Single page with agent links',
    title: 'Single page with agent links',
    timestamp: null,
    tags: ['single-page', 'agent-links'],
    body: pageBody,
    preview: previewText(pageBody),
  }

  return [
    pageNote,
    ...threads.map((thread, index): SourceNote => ({
      id: thread.id,
      noteUid: thread.id,
      parentNoteId: 'single-page',
      offset: index + 1,
      sourcePath: SOURCE_PATH,
      startLine: 20 + index * 4,
      endLine: 22 + index * 4,
      rawHeadline: thread.title,
      title: thread.title,
      timestamp: thread.createdAt,
      tags: ['agent', 'search'],
      body: `${thread.token}\n\n${thread.sourceExcerpt}\n\n${thread.messages.map((message) => message.body).join('\n')}`,
      preview: `${thread.token} ${thread.sourceExcerpt}`,
    })),
  ]
}

function createThreadFromToken(token: string, excerpt: string): AgentLinkThread {
  return {
    id: token.replace('@agent/', 'agent-'),
    token,
    title: 'Search continuation',
    sourceExcerpt: excerpt.trim() || 'Search from the single page.',
    status: 'running',
    createdAt: timestampNow(),
    messages: [
      {
        id: `${token}-user-0`,
        role: 'user',
        timestamp: timestampNow(),
        body: excerpt.trim() || 'Search from this page reference.',
      },
    ],
  }
}

function insertTokenIntoBody(body: string, token: string, element: HTMLTextAreaElement | null): string {
  if (!element) return `${body.trimEnd()}\n\n${token}`
  const start = element.selectionStart
  const end = element.selectionEnd
  const spacerBefore = start > 0 && !/\s$/.test(body.slice(0, start)) ? ' ' : ''
  const spacerAfter = end < body.length && !/^\s/.test(body.slice(end)) ? ' ' : ''
  return `${body.slice(0, start)}${spacerBefore}${token}${spacerAfter}${body.slice(end)}`
}

function selectedText(element: HTMLTextAreaElement | null): string {
  if (!element || element.selectionStart === element.selectionEnd) return ''
  return element.value.slice(element.selectionStart, element.selectionEnd).trim()
}

function currentParagraph(element: HTMLTextAreaElement | null, fallback: string): string {
  if (!element) return previewText(fallback)
  const value = element.value
  const caret = element.selectionStart
  const start = value.lastIndexOf('\n\n', Math.max(0, caret - 1))
  const end = value.indexOf('\n\n', caret)
  return value
    .slice(start === -1 ? 0 : start + 2, end === -1 ? value.length : end)
    .replace(/@agent\/search-\d{3}/g, '')
    .trim()
}

function paragraphForToken(body: string, token: string): string {
  const index = body.indexOf(token)
  if (index < 0) return previewText(body)
  const start = body.lastIndexOf('\n\n', Math.max(0, index - 1))
  const end = body.indexOf('\n\n', index)
  return body.slice(start === -1 ? 0 : start + 2, end === -1 ? body.length : end).trim()
}

function nextSearchIndex(threads: AgentLinkThread[]): number {
  return threads.reduce((max, thread) => {
    const match = thread.token.match(/-(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
}

function continuationReply(body: string): string {
  if (/source|sources|compare|evidence/i.test(body)) {
    return 'I would bring back the short source list here, then let the page decide whether any result deserves promotion into the main text.'
  }
  if (/publish|page|web|preview/i.test(body)) {
    return 'That can become a separate artifact branch, but the page should still keep only the @agent/search link unless you promote it.'
  }
  return 'Captured. The continuation can keep working here without expanding the single page body.'
}

function readStoredExperiment(): StoredAgentLinkExperiment | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAgentLinkExperiment
    if (!parsed || typeof parsed.pageBody !== 'string' || !Array.isArray(parsed.threads)) return null
    return parsed
  } catch {
    return null
  }
}

function timestampNow(): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

function previewText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

function lineCount(value: string): number {
  return value.split('\n').length
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
}
