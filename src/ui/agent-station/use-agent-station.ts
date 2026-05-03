import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createStationCommandStore,
  type StationCommand,
  type StationCommandContext,
  type StationCommandStore,
  type StationCommandStoreSnapshot,
} from '@master-orch/client'
import type { SearchCommandAction } from '../components/SearchModal'

const DEFAULT_MASTER_ORCH_URL = 'http://127.0.0.1:43110'
const DEFAULT_APP_ID = 'branch-continue'
const DEFAULT_BASE_BRANCH = 'master'
const DEFAULT_POLL_MS = 1500

interface AgentStationContext {
  sourcePath?: string
}

const EMPTY_SNAPSHOT: StationCommandStoreSnapshot = {
  status: 'idle',
  commands: [],
  state: {},
  error: null,
}

export function useAgentStationCommands(context: AgentStationContext): SearchCommandAction[] {
  const contextRef = useRef(context)
  contextRef.current = context

  const [commandStore, setCommandStore] = useState<StationCommandStore | null>(null)
  const [snapshot, setSnapshot] = useState<StationCommandStoreSnapshot>(
    () => EMPTY_SNAPSHOT,
  )

  useEffect(() => {
    if (!isAgentStationEnabled()) {
      setSnapshot(EMPTY_SNAPSHOT)
      return undefined
    }

    const store = createStationCommandStore({
      appId: envValue(import.meta.env.VITE_MASTER_ORCH_APP_ID, DEFAULT_APP_ID),
      baseUrl: envValue(import.meta.env.VITE_MASTER_ORCH_URL, DEFAULT_MASTER_ORCH_URL),
      deploymentId: optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_DEPLOYMENT_ID),
      token: optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_TOKEN),
      intervalMs: envNumber(import.meta.env.VITE_MASTER_ORCH_POLL_MS, DEFAULT_POLL_MS),
      context: () => buildStationContext(contextRef.current),
    })

    setCommandStore(store)
    const unsubscribe = store.subscribe(setSnapshot)
    const stop = store.start()
    setSnapshot(store.getSnapshot())

    return () => {
      unsubscribe()
      stop()
      store.destroy()
    }
  }, [])

  useEffect(() => {
    if (!commandStore) return
    void commandStore.refresh({ reason: 'app-context' })
  }, [commandStore, context.sourcePath])

  return useMemo(
    () => snapshot.commands.map(toSearchCommandAction),
    [snapshot.commands],
  )
}

function toSearchCommandAction(command: StationCommand): SearchCommandAction {
  return {
    id: command.id,
    label: command.title,
    hint: command.subtitle,
    group: command.group,
    keywords: commandKeywords(command),
    disabled: command.enabled === false,
    run: () => {
      void command.run()
    },
  }
}

function commandKeywords(command: StationCommand): string[] {
  return [
    command.id,
    command.scope,
    command.subtitle,
    ...(command.keywords ?? []),
  ].filter((keyword): keyword is string => Boolean(keyword))
}

function buildStationContext(context: AgentStationContext): StationCommandContext {
  const baseBranch = optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_BASE_BRANCH) ?? DEFAULT_BASE_BRANCH
  const targetBranch = optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_TARGET_BRANCH) ?? baseBranch
  const applyTo = optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_APPLY_TO)

  return {
    route: routeNow(),
    sourcePath: context.sourcePath,
    baseBranch,
    targetBranch,
    ...(applyTo ? { applyTo } : {}),
  }
}

function routeNow(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function isAgentStationEnabled(): boolean {
  return import.meta.env.VITE_MASTER_ORCH_DISABLED !== '1'
}

function envValue(value: string | undefined, fallback: string): string {
  return optionalEnvValue(value) ?? fallback
}

function optionalEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
