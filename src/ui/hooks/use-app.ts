// Main application hook — initializes database, page service, and manages state

import { useState, useEffect, useCallback, useRef } from 'react'
import { LoroDoc } from 'loro-crdt'
import type { PageMeta } from '../../core/page/types'
import type { PageService } from '../../core/services/page-service'
import { getDatabase } from '../../core/services/db'
import { createPageService } from '../../core/services/page-service'
import { createWriter } from '../../core/events/writer'
import { getContent, getPageMeta } from '../../core/page/loro-schema'
import { createSearch } from '../../core/search'
import type { SearchEngine, SearchResult } from '../../core/search/types'

interface AppRuntime {
  service: PageService
  pages: PageMeta[]
}

let runtimePromise: Promise<AppRuntime> | null = null

function getAppRuntime(): Promise<AppRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      console.log('[init] starting database...')
      const db = await getDatabase()
      console.log('[init] database ready')
      const writer = createWriter(db)
      const service = createPageService(db, writer)
      const pages = await service.listPages()
      return { service, pages }
    })().catch((err) => {
      runtimePromise = null
      throw err
    })
  }
  return runtimePromise
}

export interface AppState {
  ready: boolean
  error: string | null
  pages: PageMeta[]
  activePageId: string | null
  activeDoc: LoroDoc | null
  activeContent: string
  activeTitle: string
}

export interface AppActions {
  createPage: (title?: string) => Promise<void>
  selectPage: (id: string) => Promise<void>
  updateContent: (content: string) => Promise<void>
  updateTitle: (title: string) => Promise<void>
  branchPage: () => Promise<void>
  searchPages: (query: string) => SearchResult<PageMeta>[]
}

export function useApp(): AppState & AppActions {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<PageMeta[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [activeDoc, setActiveDoc] = useState<LoroDoc | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [activeTitle, setActiveTitle] = useState('')

  const serviceRef = useRef<PageService | null>(null)
  const searchRef = useRef<SearchEngine<PageMeta> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { service, pages: allPages } = await getAppRuntime()
        serviceRef.current = service

        if (!cancelled) {
          setPages(allPages)
          searchRef.current = createSearch({
            items: allPages,
            getText: (p) => `${p.title} `,
            getId: (p) => p.id,
          })
          setReady(true)
        }
      } catch (err) {
        console.error('Failed to initialize database:', err)
        if (!cancelled) {
          setError(String(err))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const refreshPages = useCallback(async () => {
    if (!serviceRef.current) return
    const allPages = await serviceRef.current.listPages()
    setPages(allPages)
    searchRef.current?.update(allPages)
  }, [])

  const createPage = useCallback(async (title?: string) => {
    if (!serviceRef.current) return
    const { id, doc } = await serviceRef.current.createPage(title)
    await refreshPages()
    setActivePageId(id)
    setActiveDoc(doc)
    setActiveContent(getContent(doc))
    setActiveTitle(getPageMeta(doc).title)
  }, [refreshPages])

  const selectPage = useCallback(async (id: string) => {
    if (!serviceRef.current) return
    const doc = await serviceRef.current.loadPage(id)
    if (doc) {
      setActivePageId(id)
      setActiveDoc(doc)
      setActiveContent(getContent(doc))
      setActiveTitle(getPageMeta(doc).title)
    }
  }, [])

  const updateContent = useCallback(async (content: string) => {
    if (!serviceRef.current || !activeDoc) return
    setActiveContent(content)

    // Debounced save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (activeDoc && serviceRef.current) {
        await serviceRef.current.updateContent(activeDoc, content)
      }
    }, 500)
  }, [activeDoc])

  const updateTitle = useCallback(async (title: string) => {
    if (!serviceRef.current || !activeDoc) return
    setActiveTitle(title)
    await serviceRef.current.updateTitle(activeDoc, title)
    await refreshPages()
  }, [activeDoc, refreshPages])

  const branchPage = useCallback(async () => {
    if (!serviceRef.current || !activeDoc) return
    const parentTitle = getPageMeta(activeDoc).title
    const { id, doc } = await serviceRef.current.branchPage(activeDoc, `Branch of ${parentTitle}`)
    await refreshPages()
    setActivePageId(id)
    setActiveDoc(doc)
    setActiveContent(getContent(doc))
    setActiveTitle(getPageMeta(doc).title)
  }, [activeDoc, refreshPages])

  const searchPages = useCallback((query: string): SearchResult<PageMeta>[] => {
    if (!searchRef.current) return []
    return searchRef.current.search(query)
  }, [])

  return {
    ready,
    error,
    pages,
    activePageId,
    activeDoc,
    activeContent,
    activeTitle,
    createPage,
    selectPage,
    updateContent,
    updateTitle,
    branchPage,
    searchPages,
  }
}
