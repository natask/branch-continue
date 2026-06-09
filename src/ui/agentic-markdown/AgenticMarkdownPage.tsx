import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAgentRouter } from '../../core/agents/router'
import { createLocalAgentRuntime } from '../../core/agents/local-runtime'
import { createEventPrimitives, type EventPrimitives, type PageEvent } from '../../core/events'
import { getDatabase } from '../../core/services/db'
import { useAgentStation } from '../agent-station/use-agent-station'
import { createAgentServiceRuntime } from '../agent-runtime/agent-service-runtime'
import { createMasterOrchAgentRuntime } from '../agent-runtime/master-orch-runtime'
import {
  AGENTIC_MARKDOWN_PAGE_ID,
  INITIAL_AGENTIC_MARKDOWN,
  buildAnchorContext,
  latestAgentMention,
  projectAgenticMarkdown,
} from './agentic-markdown-model'

const AUTOSAVE_MS = 650

export function AgenticMarkdownPage() {
  const station = useAgentStation({ sourcePath: 'agentic-markdown.md' })
  const [events, setEvents] = useState<PageEvent[]>([])
  const [eventStore, setEventStore] = useState<EventPrimitives | null>(null)
  const [documentText, setDocumentText] = useState(INITIAL_AGENTIC_MARKDOWN)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [status, setStatus] = useState('opening event log')
  const [running, setRunning] = useState(false)
  const initializedRef = useRef(false)
  const lastSavedTextRef = useRef(INITIAL_AGENTIC_MARKDOWN)
  const agentRouter = useMemo(
    () =>
      createAgentRouter({
        runtimes: [
          createAgentServiceRuntime(),
          createMasterOrchAgentRuntime(station),
          createLocalAgentRuntime(),
        ],
      }),
    [station],
  )

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    async function load() {
      const db = await getDatabase()
      const primitives = await createEventPrimitives(db)
      const existing = await primitives.reader.query({
        pageId: AGENTIC_MARKDOWN_PAGE_ID,
        limit: 1000,
      })

      if (existing.length === 0) {
        await primitives.writer.appendBatch([
          {
            type: 'document.created',
            pageId: AGENTIC_MARKDOWN_PAGE_ID,
            actor: 'system',
            payload: { title: 'Agentic markdown' },
          },
          {
            type: 'document.text.changed',
            pageId: AGENTIC_MARKDOWN_PAGE_ID,
            actor: 'system',
            payload: { text: INITIAL_AGENTIC_MARKDOWN },
          },
        ])
      }

      const loaded = await primitives.reader.query({
        pageId: AGENTIC_MARKDOWN_PAGE_ID,
        limit: 1000,
      })
      const projection = projectAgenticMarkdown(loaded)
      lastSavedTextRef.current = projection.documentText
      setEventStore(primitives)
      setEvents(loaded)
      setDocumentText(projection.documentText)
      setStatus('ready')
    }

    void load().catch((error) => {
      setStatus(`event log failed: ${errorMessage(error)}`)
    })
  }, [])

  const projection = useMemo(() => projectAgenticMarkdown(events), [events])
  const latestMention = useMemo(() => latestAgentMention(documentText), [documentText])
  const selectedThread = useMemo(
    () => projection.threads.find((thread) => thread.id === selectedThreadId) ?? projection.threads[0] ?? null,
    [projection.threads, selectedThreadId],
  )

  const reloadEvents = useCallback(async () => {
    if (!eventStore) return
    const next = await eventStore.reader.query({ pageId: AGENTIC_MARKDOWN_PAGE_ID, limit: 1000 })
    setEvents(next)
  }, [eventStore])

  useEffect(() => {
    if (!eventStore) return
    if (documentText === lastSavedTextRef.current) return
    const timer = window.setTimeout(() => {
      void (async () => {
        await eventStore.writer.append({
          type: 'document.text.changed',
          pageId: AGENTIC_MARKDOWN_PAGE_ID,
          actor: 'user',
          payload: { text: documentText },
        })
        lastSavedTextRef.current = documentText
        await reloadEvents()
        setStatus('saved')
      })().catch((error) => setStatus(`save failed: ${errorMessage(error)}`))
    }, AUTOSAVE_MS)

    setStatus('saving')
    return () => window.clearTimeout(timer)
  }, [documentText, eventStore, reloadEvents])

  const runLatestAgent = useCallback(async () => {
    if (!eventStore || !latestMention) {
      setStatus('write an @agent request first')
      return
    }

    setRunning(true)
    setStatus(`capturing @${latestMention.agent}`)
    try {
      if (documentText !== lastSavedTextRef.current) {
        await eventStore.writer.append({
          type: 'document.text.changed',
          pageId: AGENTIC_MARKDOWN_PAGE_ID,
          actor: 'user',
          payload: { text: documentText },
        })
        lastSavedTextRef.current = documentText
      }

      const anchorId = createId('anchor')
      const threadId = createId('thread')
      const requestId = createId('request')
      const { quote, context } = buildAnchorContext(documentText, latestMention)
      await eventStore.writer.appendBatch([
        {
          type: 'anchor.created',
          pageId: AGENTIC_MARKDOWN_PAGE_ID,
          actor: 'user',
          payload: {
            anchorId,
            quote,
            context,
            lineIndex: latestMention.lineIndex,
            mentionStart: latestMention.mentionStart,
            mentionEnd: latestMention.mentionEnd,
          },
        },
        {
          type: 'thread.created',
          pageId: AGENTIC_MARKDOWN_PAGE_ID,
          actor: 'user',
          payload: { threadId, anchorId },
        },
        {
          type: 'agent.requested',
          pageId: AGENTIC_MARKDOWN_PAGE_ID,
          actor: 'user',
          payload: {
            requestId,
            threadId,
            anchorId,
            agent: latestMention.agent,
            prompt: latestMention.prompt,
          },
        },
      ])

      const launch = await agentRouter.route({
        id: requestId,
        agentId: latestMention.agent,
        prompt: latestMention.prompt,
        source: '/agentic-markdown',
        context: {
          pageId: AGENTIC_MARKDOWN_PAGE_ID,
          anchorId,
          threadId,
          quote,
          localContext: context,
          documentText,
        },
        metadata: {
          source: 'agentic-markdown',
        },
      })
      await eventStore.writer.append({
        type: 'agent.response.created',
        pageId: AGENTIC_MARKDOWN_PAGE_ID,
        actor: `agent:${latestMention.agent}`,
        payload: {
          threadId,
          requestId,
          response: launch.response,
          runUrl: launch.runUrl,
          status: launch.status,
          runtimeId: launch.runtimeId,
          externalId: launch.externalId,
          error: launch.error,
        },
      })
      await reloadEvents()
      setSelectedThreadId(threadId)
      setStatus(launch.status === 'launched' ? 'agent launched' : `agent ${launch.status}`)
    } catch (error) {
      setStatus(`agent request failed: ${errorMessage(error)}`)
    } finally {
      setRunning(false)
    }
  }, [agentRouter, documentText, eventStore, latestMention, reloadEvents])

  const resolveSelectedThread = useCallback(async () => {
    if (!eventStore || !selectedThread) return
    await eventStore.writer.append({
      type: 'thread.resolved',
      pageId: AGENTIC_MARKDOWN_PAGE_ID,
      actor: 'user',
      payload: { threadId: selectedThread.id },
    })
    await reloadEvents()
    setStatus('thread resolved')
  }, [eventStore, reloadEvents, selectedThread])

  return (
    <main className="agentic-page">
      <header className="agentic-topbar">
        <div>
          <p className="agentic-kicker">local-first work substrate</p>
          <h1>Agentic markdown</h1>
        </div>
        <div className="agentic-actions">
          <span className="agentic-status">{status}</span>
          <button disabled={!latestMention || running} onClick={() => void runLatestAgent()} type="button">
            {running ? 'Running' : latestMention ? `Run @${latestMention.agent}` : 'No request'}
          </button>
        </div>
      </header>

      <section className="agentic-workbench">
        <div className="agentic-editor-shell" aria-label="Markdown editor">
          <div className="agentic-panel-head">
            <span>write</span>
            <small>{documentText.length} chars</small>
          </div>
          <textarea
            value={documentText}
            onChange={(event) => setDocumentText(event.target.value)}
            spellCheck
            aria-label="Agentic markdown editor"
          />
        </div>

        <div className="agentic-preview-shell" aria-label="Markdown preview">
          <div className="agentic-panel-head">
            <span>preview</span>
            <small>{projection.eventCount} events</small>
          </div>
          <article className="agentic-preview">{renderMarkdown(documentText)}</article>
        </div>

        <aside className="agentic-thread-shell" aria-label="Anchored threads">
          <div className="agentic-panel-head">
            <span>threads</span>
            <small>{projection.threads.length}</small>
          </div>
          <div className="agentic-thread-list">
            {projection.threads.length === 0 ? (
              <p className="agentic-empty">No threads yet. Type `@agent ...` in the page and run it.</p>
            ) : (
              projection.threads.map((thread) => (
                <button
                  className={`agentic-thread-card${thread.id === selectedThread?.id ? ' active' : ''}`}
                  key={thread.id}
                  onClick={() => setSelectedThreadId(thread.id)}
                  type="button"
                >
                  <span>@{thread.agent || 'agent'}</span>
                  <strong>{thread.prompt || 'Captured request'}</strong>
                  <em>{thread.status}</em>
                </button>
              ))
            )}
          </div>

          {selectedThread ? (
            <div className="agentic-thread-detail">
              <div className="agentic-quote">{selectedThread.quote}</div>
              <p>{selectedThread.response ?? 'Waiting for response event.'}</p>
              {selectedThread.runUrl ? (
                <a href={selectedThread.runUrl} target="_blank" rel="noreferrer">
                  open run
                </a>
              ) : null}
              <button
                disabled={selectedThread.status === 'resolved'}
                onClick={() => void resolveSelectedThread()}
                type="button"
              >
                Resolve
              </button>
            </div>
          ) : null}
        </aside>
      </section>

      <section className="agentic-event-log" aria-label="Event log">
        <div className="agentic-panel-head">
          <span>event log</span>
          <small>truth layer</small>
        </div>
        <div className="agentic-event-rows">
          {events.slice(-16).reverse().map((event) => (
            <div className="agentic-event-row" key={event.id}>
              <span>{event.type}</span>
              <strong>{event.actor}</strong>
              <code>{JSON.stringify(event.payload)}</code>
            </div>
          ))}
        </div>
      </section>

      {station.element}
    </main>
  )
}

function renderMarkdown(markdown: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const lines = markdown.split('\n')
  let listItems: string[] = []
  let codeLines: string[] = []
  let inCode = false

  function flushList(key: string) {
    if (listItems.length === 0) return
    nodes.push(
      <ul key={key}>
        {listItems.map((item, index) => (
          <li key={`${key}-${index}`}>{renderInline(item)}</li>
        ))}
      </ul>,
    )
    listItems = []
  }

  function flushCode(key: string) {
    if (codeLines.length === 0) return
    nodes.push(<pre key={key}>{codeLines.join('\n')}</pre>)
    codeLines = []
  }

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        flushCode(`code-${index}`)
        inCode = false
      } else {
        flushList(`list-before-code-${index}`)
        inCode = true
      }
      return
    }

    if (inCode) {
      codeLines.push(line)
      return
    }

    if (/^\s*[-*]\s+/.test(line)) {
      listItems.push(line.replace(/^\s*[-*]\s+/, ''))
      return
    }

    flushList(`list-${index}`)
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('### ')) {
      nodes.push(<h3 key={index}>{renderInline(trimmed.slice(4))}</h3>)
    } else if (trimmed.startsWith('## ')) {
      nodes.push(<h2 key={index}>{renderInline(trimmed.slice(3))}</h2>)
    } else if (trimmed.startsWith('# ')) {
      nodes.push(<h1 key={index}>{renderInline(trimmed.slice(2))}</h1>)
    } else {
      nodes.push(<p key={index}>{renderInline(trimmed)}</p>)
    }
  })

  flushList('list-final')
  flushCode('code-final')
  return nodes
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(@[a-zA-Z][\w-]*)/g
  let lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index))
    nodes.push(
      <mark className="agentic-mention" key={`${match[0]}-${index}`}>
        {match[0]}
      </mark>,
    )
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
