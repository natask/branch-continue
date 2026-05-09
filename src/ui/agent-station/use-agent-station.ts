import { Fragment, createElement, useMemo, useRef, useState, type ReactNode } from 'react'
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

const DEFAULT_MASTER_ORCH_URL = 'http://127.0.0.1:43110'
const DEFAULT_MASTER_ORCH_PORT = '43110'
const DEFAULT_APP_ID = 'branch-continue'
const DEFAULT_BASE_BRANCH = 'master'
const DEFAULT_POLL_MS = 1500

interface AgentStationContext {
  sourcePath?: string
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

  const useAgentation = options.useAgentation !== false && isAgentationEnabled()
  const station = useMasterOrchStation({
    enabled: isAgentStationEnabled(),
    appId: envValue(import.meta.env.VITE_MASTER_ORCH_APP_ID, DEFAULT_APP_ID),
    baseUrl: resolveMasterOrchUrl(),
    deploymentId: optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_DEPLOYMENT_ID),
    token: optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_TOKEN),
    intervalMs: envNumber(import.meta.env.VITE_MASTER_ORCH_POLL_MS, DEFAULT_POLL_MS),
    context: () => buildStationContext(contextRef.current),
    agentation: useAgentation,
    initialAgentationVisible: useAgentation,
    agentationProps: {
      copyToClipboard: false,
    },
  })
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(() => new Set())
  const [noticeError, setNoticeError] = useState<string | null>(null)
  const [previewOverrideUrl, setPreviewOverrideUrl] = useState(() => getStoredOtaPreviewUrl())
  const [previewOverrideDeploymentId, setPreviewOverrideDeploymentId] = useState(() => getStoredOtaPreviewDeploymentId())

  const selectDeployment = (deployment: StationDeployment, fallbackUrl?: string | null): void => {
    const url = storeOtaPreviewTarget(deployment, fallbackUrl)
    if (!url) return
    setPreviewOverrideUrl(url)
    setPreviewOverrideDeploymentId(deployment.id)
  }

  const returnToCurrent = (): void => {
    clearOtaPreviewTarget()
    setPreviewOverrideUrl(null)
    setPreviewOverrideDeploymentId(null)
  }

  const actions = useMemo(
    () => {
      const stationActions = station.commands.map(toSearchCommandAction)
      const localActions = deploymentSwitchActions(
        station.snapshot.state,
        previewOverrideUrl,
        selectDeployment,
        returnToCurrent,
      )

      if (!station.snapshot.error) return [...localActions, ...stationActions]

      return [
        {
          id: 'master-orch-station-offline',
          label: 'Station: Server Offline',
          hint: errorMessage(station.snapshot.error),
          group: 'Station',
          keywords: ['master orch', 'station', 'server', 'offline', resolveMasterOrchUrl()],
          run: () => undefined,
        },
        ...localActions,
        ...stationActions,
      ]
    },
    [previewOverrideUrl, station.commands, station.snapshot.error, station.snapshot.state],
  )
  const previewNotice = useMemo(
    () => latestPreviewReadyNotice(station.snapshot.state, dismissedNoticeIds),
    [dismissedNoticeIds, station.snapshot.state],
  )
  const notification = useMemo(
    () =>
      previewNotice
        ? createPreviewReadyToast({
            notice: previewNotice,
            error: noticeError,
            onDismiss: () =>
              setDismissedNoticeIds((current) => {
                setNoticeError(null)
                const next = new Set(current)
                next.add(previewNotice.id)
                return next
              }),
            onOpen: () => {
              const url = deploymentOpenUrl(previewNotice.deployment, previewNotice.body)
              if (url) window.open(url, '_blank', 'noopener,noreferrer')
            },
            onSwitch: () => {
              const url = storeOtaPreviewTarget(
                previewNotice.deployment ?? { deploymentId: previewNotice.deploymentId },
                previewNotice.body,
              )
              if (!url) {
                setNoticeError('No switchable preview URL was recorded for this deployment.')
                return
              }
              setPreviewOverrideUrl(url)
              setPreviewOverrideDeploymentId(previewNotice.deploymentId ?? null)
            },
            onCurrent: returnToCurrent,
            onAccept: async () => {
              if (!previewNotice.deploymentId) return
              setNoticeError(null)
              try {
                await station.client.acceptDeployment(previewNotice.deploymentId)
                await station.refresh({ reason: 'preview-accept', deploymentId: previewNotice.deploymentId })
              } catch (error) {
                setNoticeError(errorMessage(error))
              }
            },
            onApply: async () => {
              if (!previewNotice.deploymentId) return
              setNoticeError(null)
              try {
                await station.client.applyDeployment(previewNotice.deploymentId)
                await station.refresh({ reason: 'preview-apply', deploymentId: previewNotice.deploymentId })
              } catch (error) {
                setNoticeError(errorMessage(error))
              }
            },
          })
        : null,
    [noticeError, previewNotice, station],
  )
  const previewFrame = useMemo(
    () =>
      previewOverrideUrl
        ? createDeploymentPreviewFrame({
            url: previewOverrideUrl,
            deploymentId: previewOverrideDeploymentId,
            onCurrent: returnToCurrent,
          })
        : null,
    [previewOverrideDeploymentId, previewOverrideUrl],
  )

  return {
    actions,
    element: createElement(Fragment, null, station.element, previewFrame, notification),
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

function latestPreviewReadyNotice(
  state: Record<string, unknown>,
  dismissedIds: Set<string>,
): PreviewReadyNotice | null {
  const inbox = Object.values((state.inbox ?? {}) as Record<string, RawInboxNotice>)
    .filter((item) => item?.id && !dismissedIds.has(item.id))
    .filter((item) => item.kind === 'preview_ready' || /preview ready/i.test(`${item.title ?? ''} ${item.body ?? ''}`))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))

  const notice = inbox[0]
  if (!notice) return null

  const deployments = (state.deployments ?? {}) as Record<string, StationDeployment>
  const deploymentId = notice.deploymentId ?? null
  return {
    id: notice.id,
    title: notice.title || 'Preview ready',
    body: notice.body || '',
    deploymentId,
    deployment: deploymentId ? deployments[deploymentId] ?? null : null,
  }
}

function deploymentOpenUrl(deployment?: StationDeployment | null, fallbackUrl?: string | null): string {
  return otaPreviewUrlFromDeployment(deployment, fallbackUrl) ?? ''
}

function deploymentSwitchActions(
  state: Record<string, unknown>,
  previewOverrideUrl: string | null,
  onSwitch: (deployment: StationDeployment, fallbackUrl?: string | null) => void,
  onCurrent: () => void,
): SearchCommandAction[] {
  const deployments = Object.values((state.deployments ?? {}) as Record<string, StationDeployment>)
    .filter((deployment) => deployment.appId === envValue(import.meta.env.VITE_MASTER_ORCH_APP_ID, DEFAULT_APP_ID))
    .filter((deployment) => deploymentOpenUrl(deployment))
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')))
    .slice(0, 8)

  const actions = deployments.map((deployment) => {
    const url = deploymentOpenUrl(deployment)
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
  error,
  onDismiss,
  onOpen,
  onSwitch,
  onCurrent,
  onAccept,
  onApply,
}: {
  notice: PreviewReadyNotice
  error?: string | null
  onDismiss: () => void
  onOpen: () => void
  onSwitch: () => void
  onCurrent: () => void
  onAccept: () => void | Promise<unknown>
  onApply: () => void | Promise<unknown>
}): ReactNode {
  const previewUrl = deploymentOpenUrl(notice.deployment, notice.body)
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
      createElement('button', { type: 'button', disabled: !canOpen, onClick: onSwitch }, 'Switch'),
      createElement('button', { type: 'button', disabled: !canOpen, onClick: onOpen }, 'Open'),
      createElement('button', { type: 'button', disabled: !canManage, onClick: onAccept }, 'Accept'),
      createElement('button', { type: 'button', disabled: !canManage, onClick: onApply }, 'Apply'),
      previewOverrideActive
        ? createElement('button', { type: 'button', onClick: onCurrent }, 'Current')
        : null,
      createElement('button', { type: 'button', onClick: onDismiss, 'aria-label': 'Dismiss preview notification' }, 'Dismiss'),
    ),
  )
}

function createDeploymentPreviewFrame({
  url,
  deploymentId,
  onCurrent,
}: {
  url: string
  deploymentId?: string | null
  onCurrent: () => void
}): ReactNode {
  return createElement(
    'section',
    { className: 'deployment-preview-frame', 'aria-label': 'Selected deployment preview' },
    createElement(
      'div',
      { className: 'deployment-preview-bar' },
      createElement('strong', null, deploymentId ? `Viewing ${deploymentId}` : 'Viewing selected deployment'),
      createElement('span', null, url),
      createElement('button', { type: 'button', onClick: onCurrent }, 'Return To Current'),
    ),
    createElement('iframe', { src: url, title: deploymentId ? `Deployment ${deploymentId}` : 'Deployment preview' }),
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

function resolveMasterOrchUrl(): string {
  const explicit = optionalEnvValue(import.meta.env.VITE_MASTER_ORCH_URL)
  if (explicit) return explicit

  const otaUrl = optionalEnvValue(import.meta.env.VITE_BRANCH_CONTINUE_MOBILE_OTA_URL)
  const otaHostUrl = stationUrlForHost(otaUrl)
  if (otaHostUrl) return otaHostUrl

  if (typeof window !== 'undefined') {
    const locationHostUrl = stationUrlForHost(window.location.href)
    if (locationHostUrl) return locationHostUrl
  }

  return DEFAULT_MASTER_ORCH_URL
}

function stationUrlForHost(value?: string): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (isLoopbackHost(url.hostname)) return null
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
