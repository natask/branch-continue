import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StationCommand, StationCommandContext, StationDeployment } from '@master-orch/client'
import { useMasterOrchStation } from '@master-orch/client/react'
import {
  clearOtaPreviewTarget,
  getStoredOtaPreviewDeploymentId,
  getStoredOtaPreviewUrl,
  otaPreviewUrlFromDeployment,
  storeOtaPreviewTarget,
} from '../../core/platform/ota-preview'
import type { SearchCommandAction } from '../components/SearchModal'

const DEFAULT_MASTER_ORCH_URL = 'https://orch.main.lan'
const DEFAULT_MASTER_ORCH_DASHBOARD_URL = 'https://orch.main.lan/dashboard?appId=branch-continue'
const MOBILE_MASTER_ORCH_URL = 'http://10.147.17.10:43110'
const MOBILE_MASTER_ORCH_DASHBOARD_URL = 'http://10.147.17.10:43110/dashboard?appId=branch-continue'
const DEFAULT_MASTER_ORCH_PORT = '43110'
const DEFAULT_APP_ID = 'branch-continue'
const DEFAULT_BASE_BRANCH = 'master'
const DEFAULT_POLL_MS = 1500
const MASTER_ORCH_AVAILABILITY_RETRY_MS = 2500

type MasterOrchAvailability = 'unknown' | 'checking' | 'available' | 'unavailable'

let masterOrchAvailability: MasterOrchAvailability = 'unknown'
let masterOrchAvailabilityPromise: Promise<MasterOrchAvailability> | null = null
const masterOrchAvailabilityListeners = new Set<(availability: MasterOrchAvailability) => void>()

interface AgentStationContext {
  sourcePath?: string
  surface?: 'web' | 'desktop' | 'mobile'
}

interface AgentStationOptions {
  useAgentation?: boolean
}

interface AgentStationIntegration {
  actions: SearchCommandAction[]
  element: ReactNode | null
}

interface PreviewReadyNotice {
  id: string
  title: string
  body: string
  deploymentId?: string | null
  deployment?: StationDeployment | null
}

interface RawInboxNotice extends PreviewReadyNotice {
  kind?: string
  createdAt?: string
}

export function useAgentStation(
  context: AgentStationContext,
  options: AgentStationOptions = {},
): AgentStationIntegration {
  const contextRef = useRef(context)
  contextRef.current = context
  const [stationAvailability, setStationAvailability] = useState(masterOrchAvailability)

  const stationConfigured = isAgentStationEnabled()
  const stationSurface = context.surface ?? currentSurface()
  const masterOrchUrl = resolveMasterOrchUrl()
  const masterOrchDashboardUrl = resolveMasterOrchDashboardUrl(masterOrchUrl)
  const agentationEnabled = stationConfigured && options.useAgentation !== false && isAgentationEnabled()
  const station = useMasterOrchStation({
    enabled: stationConfigured,
    appId: envValue(import.meta.env.VITE_MASTER_ORCH_APP_ID, DEFAULT_APP_ID),
    apiBaseUrl: masterOrchUrl,
    dashboardUrl: masterOrchDashboardUrl,
    deploymentId: optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_DEPLOYMENT_ID),
    token: optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_TOKEN),
    intervalMs: envNumber(import.meta.env.VITE_MASTER_ORCH_POLL_MS, DEFAULT_POLL_MS),
    context: () => buildStationContext({ ...contextRef.current, surface: stationSurface }),
    agentation: agentationEnabled,
    initialAgentationVisible: agentationEnabled,
    agentationProps: {
      className: 'agent-station-agentation',
      copyToClipboard: false,
    },
  })
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(() => new Set())
  const [noticeError, setNoticeError] = useState<string | null>(null)
  const [previewOverrideUrl, setPreviewOverrideUrl] = useState(() => getStoredOtaPreviewUrl())
  const [previewOverrideDeploymentId, setPreviewOverrideDeploymentId] = useState(() => getStoredOtaPreviewDeploymentId())
  const [dashboardFrameOpen, setDashboardFrameOpen] = useState(false)

  const showDashboardFrame = useCallback(() => {
    setDashboardFrameOpen(true)
  }, [stationSurface])

  const closeDashboardFrame = useCallback(() => {
    setDashboardFrameOpen(false)
  }, [])

  useEffect(() => {
    if (!stationConfigured) return undefined
    const unsubscribe = subscribeMasterOrchAvailability(setStationAvailability)
    void ensureMasterOrchAvailability(masterOrchUrl, { force: true })
    const retry = window.setInterval(() => {
      if (masterOrchAvailability === 'available' || masterOrchAvailability === 'checking') return
      void ensureMasterOrchAvailability(masterOrchUrl, { force: true })
    }, MASTER_ORCH_AVAILABILITY_RETRY_MS)
    return () => {
      window.clearInterval(retry)
      unsubscribe()
    }
  }, [masterOrchUrl, stationConfigured])

  const selectDeployment = useCallback((deployment: StationDeployment, fallbackUrl?: string | null): void => {
    const url = storeOtaPreviewTarget(deployment, fallbackUrl, stationSurface)
    if (!url) return
    setPreviewOverrideUrl(url)
    setPreviewOverrideDeploymentId(deployment.id)
  }, [])

  const returnToCurrent = useCallback((): void => {
    clearOtaPreviewTarget()
    setPreviewOverrideUrl(null)
    setPreviewOverrideDeploymentId(null)
    setNoticeError(null)
  }, [])

  const acceptDeployment = useCallback(
    async (deploymentId?: string | null) => {
      if (!deploymentId) return
      setNoticeError(null)
      try {
        await station.client.acceptDeployment(deploymentId)
        await station.refresh({ reason: 'preview-accept', deploymentId })
      } catch (error) {
        setNoticeError(errorMessage(error))
      }
    },
    [station],
  )

  const applyDeployment = useCallback(
    async (deploymentId?: string | null) => {
      if (!deploymentId) return
      setNoticeError(null)
      try {
        await station.client.applyDeployment(deploymentId)
        await station.refresh({ reason: 'preview-apply', deploymentId })
      } catch (error) {
        setNoticeError(errorMessage(error))
      }
    },
    [station],
  )

  const actions = useMemo(
    () => {
      const stationActions = station.commands.map(toSearchCommandAction)
      const localActions = deploymentSwitchActions(
        station.snapshot.state,
        previewOverrideUrl,
        stationSurface,
        selectDeployment,
        returnToCurrent,
      )
      const statusActions = masterOrchStatusActions({
        configured: stationConfigured,
        availability: stationAvailability,
        url: masterOrchUrl,
        dashboardUrl: masterOrchDashboardUrl,
        error: station.snapshot.error,
        onShowDashboard: showDashboardFrame,
      })

      return [...statusActions, ...localActions, ...stationActions]
    },
    [masterOrchDashboardUrl, masterOrchUrl, previewOverrideUrl, returnToCurrent, selectDeployment, showDashboardFrame, station.commands, station.snapshot.error, station.snapshot.state, stationAvailability, stationConfigured, stationSurface],
  )
  const previewNotice = useMemo(
    () => latestPreviewReadyNotice(station.snapshot.state, dismissedNoticeIds, stationSurface),
    [dismissedNoticeIds, station.snapshot.state, stationSurface],
  )
  const notification = useMemo(
    () =>
      previewNotice && !previewOverrideUrl && !dashboardFrameOpen
        ? createPreviewReadyToast({
            notice: previewNotice,
            surface: stationSurface,
            error: noticeError,
            onDismiss: () =>
              setDismissedNoticeIds((current) => {
                setNoticeError(null)
                const next = new Set(current)
                next.add(previewNotice.id)
                return next
              }),
            onOpen: () => {
              const url = deploymentOpenUrl(previewNotice.deployment, previewNotice.body, stationSurface)
              if (url) window.open(url, '_blank', 'noopener,noreferrer')
            },
            onSwitch: () => {
              const url = storeOtaPreviewTarget(
                previewNotice.deployment ?? { deploymentId: previewNotice.deploymentId },
                previewNotice.body,
                stationSurface,
              )
              if (!url) {
                setNoticeError('No switchable preview URL was recorded for this deployment.')
                return
              }
              setPreviewOverrideUrl(url)
              setPreviewOverrideDeploymentId(previewNotice.deploymentId ?? null)
            },
            onCurrent: returnToCurrent,
            onAccept: () => acceptDeployment(previewNotice.deploymentId),
            onApply: () => applyDeployment(previewNotice.deploymentId),
          })
        : null,
    [acceptDeployment, applyDeployment, dashboardFrameOpen, noticeError, previewNotice, previewOverrideUrl, returnToCurrent, selectDeployment, station, stationSurface],
  )
  const previewFrame = useMemo(
    () =>
      previewOverrideUrl
        ? createDeploymentPreviewFrame({
            url: previewOverrideUrl,
            deploymentId: previewOverrideDeploymentId,
            error: noticeError,
            onOpen: () => window.open(previewOverrideUrl, '_blank', 'noopener,noreferrer'),
            onCurrent: returnToCurrent,
            onAccept: () => acceptDeployment(previewOverrideDeploymentId),
            onApply: () => applyDeployment(previewOverrideDeploymentId),
          })
        : null,
    [acceptDeployment, applyDeployment, noticeError, previewOverrideDeploymentId, previewOverrideUrl, returnToCurrent],
  )
  const dashboardFrame = useMemo(
    () =>
      dashboardFrameOpen
        ? createDashboardFrame({
            url: masterOrchDashboardUrl,
            onClose: closeDashboardFrame,
          })
        : null,
    [closeDashboardFrame, dashboardFrameOpen, masterOrchDashboardUrl],
  )

  return {
    actions,
    element: createElement(Fragment, null, station.element, previewFrame, dashboardFrame, notification),
  }
}

export function useAgentStationCommands(
  context: AgentStationContext,
  options: AgentStationOptions = {},
): SearchCommandAction[] {
  return useAgentStation(context, options).actions
}

function toSearchCommandAction(command: StationCommand): SearchCommandAction {
  return {
    id: command.id,
    label: command.title,
    hint: command.subtitle,
    group: command.group,
    keywords: commandKeywords(command),
    disabled: command.enabled === false,
    run: () => command.run(),
  }
}

function masterOrchStatusActions({
  configured,
  availability,
  url,
  dashboardUrl,
  error,
  onShowDashboard,
}: {
  configured: boolean
  availability: MasterOrchAvailability
  url: string
  dashboardUrl: string
  error?: unknown
  onShowDashboard: () => void
}): SearchCommandAction[] {
  if (!configured) {
    return [
      {
        id: 'master-orch-station-disabled',
        label: 'Station: Disabled',
        hint: 'VITE_MASTER_ORCH_DISABLED=1',
        group: 'Station',
        keywords: ['master orch', 'station', 'disabled'],
        run: () => undefined,
      },
    ]
  }

  const dashboardActions: SearchCommandAction[] = [
    {
      id: 'master-orch-show-dashboard-in-app',
      label: 'Station: Show Branch Continue Orch In App',
      hint: dashboardUrl,
      group: 'Station',
      keywords: ['master orch', 'station', 'dashboard', 'orch', 'in app', dashboardUrl, url],
      run: onShowDashboard,
    },
    {
      id: 'master-orch-open-dashboard-browser',
      label: 'Station: Open Branch Continue Orch In Browser',
      hint: dashboardUrl,
      group: 'Station',
      keywords: ['master orch', 'station', 'dashboard', 'orch', 'browser', 'external', dashboardUrl, url],
      run: () => {
        window.open(dashboardUrl, '_blank', 'noopener,noreferrer')
      },
    },
  ]

  if (availability === 'available' && !error) {
    return dashboardActions
  }

  const checking = availability === 'checking' || availability === 'unknown'
  return [
    ...dashboardActions,
    {
      id: 'master-orch-station-offline',
      label: checking ? 'Station: Connecting To Server' : 'Station: Server Offline',
      hint: error ? errorMessage(error) : `${url}/health did not respond. Start Master Orch with npm run server in ../master-orch.`,
      group: 'Station',
      disabled: true,
      keywords: ['master orch', 'station', 'server', checking ? 'connecting' : 'offline', url],
      run: () => undefined,
    },
  ]
}

function latestPreviewReadyNotice(
  state: Record<string, unknown>,
  dismissedIds: Set<string>,
  surface: 'web' | 'desktop' | 'mobile',
): PreviewReadyNotice | null {
  const deployments = (state.deployments ?? {}) as Record<string, StationDeployment>
  const inbox = Object.values((state.inbox ?? {}) as Record<string, RawInboxNotice>)
    .filter((item) => item?.id && !dismissedIds.has(item.id))
    .filter((item) => item.kind === 'preview_ready' || /preview ready/i.test(`${item.title ?? ''} ${item.body ?? ''}`))
    .filter((item) => deploymentOpenUrl(item.deploymentId ? deployments[item.deploymentId] : null, item.body, surface))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))

  const notice = inbox[0]
  if (!notice) return null

  const deploymentId = notice.deploymentId ?? null
  return {
    id: notice.id,
    title: notice.title || 'Preview ready',
    body: notice.body || '',
    deploymentId,
    deployment: deploymentId ? deployments[deploymentId] ?? null : null,
  }
}

function deploymentOpenUrl(
  deployment?: StationDeployment | null,
  fallbackUrl?: string | null,
  surface: 'web' | 'desktop' | 'mobile' = 'web',
): string {
  return otaPreviewUrlFromDeployment(deployment, fallbackUrl, surface) ?? ''
}

function deploymentSwitchActions(
  state: Record<string, unknown>,
  previewOverrideUrl: string | null,
  surface: 'web' | 'desktop' | 'mobile',
  onSwitch: (deployment: StationDeployment, fallbackUrl?: string | null) => void,
  onCurrent: () => void,
): SearchCommandAction[] {
  const deployments = Object.values((state.deployments ?? {}) as Record<string, StationDeployment>)
    .filter((deployment) => deployment.appId === envValue(import.meta.env.VITE_MASTER_ORCH_APP_ID, DEFAULT_APP_ID))
    .filter((deployment) => deploymentOpenUrl(deployment, null, surface))
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')))
    .slice(0, 8)

  const actions = deployments.map((deployment) => {
    const url = deploymentOpenUrl(deployment, null, surface)
    return {
      id: `deployments.switch-local.${deployment.id}`,
      label: `Deployments: Switch To ${deployment.id}`,
      hint: [deployment.status, deployment.kind, url].filter(Boolean).join(' / '),
      group: 'Deployments',
      keywords: ['deployment', 'switch', 'preview', 'ota', deployment.id, deployment.status, deployment.kind].filter(
        Boolean,
      ) as string[],
      run: () => onSwitch(deployment),
    }
  })

  if (previewOverrideUrl) {
    actions.unshift({
      id: 'station.return-current-ota-channel',
      label: 'Deployments: Return To Current',
      hint: previewOverrideUrl,
      group: 'Deployments',
      keywords: ['current', 'ota', 'channel', 'return', 'preview'],
      run: onCurrent,
    })
  }

  return actions
}

function createPreviewReadyToast({
  notice,
  surface,
  error,
  onDismiss,
  onOpen,
  onSwitch,
  onCurrent,
  onAccept,
  onApply,
}: {
  notice: PreviewReadyNotice
  surface: 'web' | 'desktop' | 'mobile'
  error?: string | null
  onDismiss: () => void
  onOpen: () => void
  onSwitch: () => void
  onCurrent: () => void
  onAccept: () => void | Promise<unknown>
  onApply: () => void | Promise<unknown>
}): ReactNode {
  const previewUrl = deploymentOpenUrl(notice.deployment, notice.body, surface)
  const canOpen = Boolean(previewUrl)
  const canManage = Boolean(notice.deploymentId)
  const previewOverrideActive = Boolean(getStoredOtaPreviewUrl())
  return createElement(
    'div',
    { className: 'station-notice', role: 'status', 'aria-live': 'polite' },
    createElement(
      'div',
      { className: 'station-notice-copy' },
      createElement('strong', null, notice.title),
      createElement('span', null, notice.deploymentId || 'Preview deployment is ready'),
      error ? createElement('em', null, error) : null,
    ),
    createElement(
      'div',
      { className: 'station-notice-actions' },
      createElement('button', { type: 'button', disabled: !canOpen, onClick: onSwitch }, 'Test'),
      createElement('button', { type: 'button', disabled: !canOpen, onClick: onOpen }, 'Open'),
      createElement('button', { type: 'button', disabled: !canManage, onClick: onAccept }, 'Accept'),
      createElement('button', { type: 'button', disabled: !canManage, onClick: onApply }, 'Apply'),
      previewOverrideActive
        ? createElement('button', { type: 'button', onClick: onCurrent }, 'Revert')
        : null,
      createElement('button', { type: 'button', onClick: onDismiss, 'aria-label': 'Dismiss preview notification' }, 'Dismiss'),
    ),
  )
}

function createDeploymentPreviewFrame({
  url,
  deploymentId,
  error,
  onOpen,
  onCurrent,
  onAccept,
  onApply,
}: {
  url: string
  deploymentId?: string | null
  error?: string | null
  onOpen: () => void
  onCurrent: () => void
  onAccept: () => void | Promise<unknown>
  onApply: () => void | Promise<unknown>
}): ReactNode {
  const canManage = Boolean(deploymentId)
  return createElement(
    'section',
    { className: 'deployment-preview-frame', 'aria-label': 'Selected deployment preview' },
    createElement(
      'div',
      { className: 'deployment-preview-bar deployment-preview-bar--control' },
      createElement(
        'div',
        { className: 'deployment-preview-copy' },
        createElement('span', { className: 'deployment-preview-kicker' }, 'Testing deployment'),
        createElement('strong', null, deploymentId || 'selected deployment'),
        createElement('span', null, url),
        error ? createElement('em', null, error) : null,
      ),
      createElement(
        'div',
        { className: 'deployment-preview-actions' },
        createElement('button', { type: 'button', onClick: onOpen }, 'Open'),
        createElement('button', { type: 'button', disabled: !canManage, onClick: onAccept }, 'Accept'),
        createElement('button', { type: 'button', disabled: !canManage, onClick: onApply }, 'Apply'),
        createElement('button', { type: 'button', className: 'deployment-preview-revert', onClick: onCurrent }, 'Revert'),
      ),
    ),
    createElement('iframe', { src: url, title: deploymentId ? `Deployment ${deploymentId}` : 'Deployment preview' }),
  )
}

function createDashboardFrame({
  url,
  onClose,
}: {
  url: string
  onClose: () => void
}): ReactNode {
  return createElement(
    'section',
    { className: 'deployment-preview-frame station-dashboard-frame', 'aria-label': 'Branch Continue Orch dashboard' },
    createElement(
      'div',
      { className: 'deployment-preview-bar' },
      createElement(
        'div',
        { className: 'deployment-preview-copy' },
        createElement('span', { className: 'deployment-preview-kicker' }, 'Dashboard'),
        createElement('strong', null, 'Branch Continue Orch'),
        createElement('span', null, url),
      ),
      createElement(
        'div',
        { className: 'deployment-preview-actions' },
        createElement('button', { type: 'button', onClick: onClose }, 'Close Dashboard'),
      ),
    ),
    createElement('iframe', { src: url, title: 'Branch Continue Orch dashboard' }),
  )
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

function isAgentationEnabled(): boolean {
  return import.meta.env.VITE_MASTER_ORCH_AGENTATION !== '0'
}

function subscribeMasterOrchAvailability(listener: (availability: MasterOrchAvailability) => void): () => void {
  masterOrchAvailabilityListeners.add(listener)
  listener(masterOrchAvailability)
  return () => masterOrchAvailabilityListeners.delete(listener)
}

function setMasterOrchAvailability(availability: MasterOrchAvailability): void {
  masterOrchAvailability = availability
  for (const listener of masterOrchAvailabilityListeners) {
    listener(availability)
  }
}

function ensureMasterOrchAvailability(
  baseUrl: string,
  options: { force?: boolean } = {},
): Promise<MasterOrchAvailability> {
  if (!options.force && (masterOrchAvailability === 'available' || masterOrchAvailability === 'unavailable')) {
    return Promise.resolve(masterOrchAvailability)
  }
  if (masterOrchAvailabilityPromise) return masterOrchAvailabilityPromise

  setMasterOrchAvailability('checking')
  masterOrchAvailabilityPromise = probeMasterOrch(baseUrl).then((available) => {
    const availability = available ? 'available' : 'unavailable'
    setMasterOrchAvailability(availability)
    masterOrchAvailabilityPromise = null
    return availability
  })
  return masterOrchAvailabilityPromise
}

async function probeMasterOrch(baseUrl: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return false

  try {
    const response = await window.fetch(joinStationUrl(baseUrl, '/health'), {
      method: 'GET',
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

function joinStationUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function resolveMasterOrchUrl(): string {
  const explicit = optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_URL)
  if (explicit) return explicit

  if (isMobileOtaRuntime()) return MOBILE_MASTER_ORCH_URL

  const otaUrl = optionalEnvValue(import.meta.env.VITE_BRANCH_CONTINUE_MOBILE_OTA_URL)
  const otaHostUrl = stationUrlForHost(otaUrl)
  if (otaHostUrl) return otaHostUrl

  if (typeof window !== 'undefined') {
    const locationHostUrl = stationUrlForHost(window.location.href)
    if (locationHostUrl) return locationHostUrl
  }

  return DEFAULT_MASTER_ORCH_URL
}

function resolveMasterOrchDashboardUrl(baseUrl: string): string {
  const explicit = optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_DASHBOARD_URL)
  if (explicit) return explicit

  if (isMobileOtaRuntime()) return MOBILE_MASTER_ORCH_DASHBOARD_URL

  try {
    const url = new URL(baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/dashboard`.replace(/^\/\//, '/')
    url.search = new URLSearchParams({ appId: envValue(import.meta.env.VITE_MASTER_ORCH_APP_ID, DEFAULT_APP_ID) }).toString()
    url.hash = ''
    return url.href
  } catch {
    return DEFAULT_MASTER_ORCH_DASHBOARD_URL
  }
}

function isMobileOtaRuntime(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(window.location.href)
    return url.pathname === '/mobile' || url.pathname.startsWith('/mobile/')
  } catch {
    return false
  }
}

function currentSurface(): 'web' | 'desktop' | 'mobile' {
  if (isMobileOtaRuntime()) return 'mobile'
  if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return 'desktop'
  return 'web'
}

function stationUrlForHost(value?: string): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (isLoopbackHost(url.hostname)) return null
    if (url.hostname === 'branch-continue.main.lan') return DEFAULT_MASTER_ORCH_URL
    return `http://${url.hostname}:${DEFAULT_MASTER_ORCH_PORT}`
  } catch {
    return null
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unavailable')
}
