import { getStoredOtaPreviewUrl } from './ota-preview'

const MOBILE_OTA_URL = import.meta.env.VITE_BRANCH_CONTINUE_MOBILE_OTA_URL?.trim()
const MOBILE_OTA_RELEASE_ID = import.meta.env.VITE_BRANCH_CONTINUE_MOBILE_OTA_RELEASE_ID?.trim()
const MOBILE_OTA_MANIFEST = 'branch-continue-mobile-ota.json'
const MOBILE_OTA_RELEASE_KEY = 'branch-continue:mobile-ota-release-id'
const CHECK_TIMEOUT_MS = 1800
const CHECK_INTERVAL_MS = 60_000

interface MobileOtaManifest {
  app: string
  entrypoint: string
  releaseId?: string
  files?: Array<{ path?: string; bytes?: number; sha256?: string }>
}

export type MobileOtaAction =
  | { type: 'none'; releaseId?: string }
  | { type: 'redirect'; url: string; releaseId?: string }
  | { type: 'reload'; url: string; releaseId: string }

export function startMobileOtaRedirect(): void {
  if (typeof window === 'undefined') return

  const previewUrl = normalizeDirectoryUrl(getStoredOtaPreviewUrl())
  if (previewUrl) {
    if (isMobileClientRuntime(previewUrl) && !isCurrentLocation(previewUrl)) {
      window.location.replace(previewUrl.href)
    }
    return
  }

  const targetUrl = normalizeDirectoryUrl(MOBILE_OTA_URL)
  if (!targetUrl || !isMobileClientRuntime(targetUrl)) return

  let checking = false

  const checkForUpdate = () => {
    if (checking || shouldDeferUpdateApply()) return
    checking = true

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

    fetch(new URL(MOBILE_OTA_MANIFEST, targetUrl), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (manifest) => {
        if (!(await validateRemoteMobileBundle(targetUrl, manifest, controller.signal))) return

        const action = resolveMobileOtaAction({
          targetUrl: targetUrl.href,
          currentUrl: window.location.href,
          manifest,
          loadedReleaseId: MOBILE_OTA_RELEASE_ID,
          storedReleaseId: readStoredReleaseId(),
        })

        if (action.releaseId) storeReleaseId(action.releaseId)
        if (action.type === 'redirect' || action.type === 'reload') {
          window.location.replace(action.url)
        }
      })
      .catch(() => {
        // The embedded bundle remains the offline fallback when ZeroTier or the OTA host is unavailable.
      })
      .finally(() => {
        checking = false
        window.clearTimeout(timeout)
      })
  }

  checkForUpdate()
  const interval = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS)
  window.addEventListener('online', checkForUpdate)
  window.addEventListener('focus', checkForUpdate)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.addEventListener('beforeunload', () => window.clearInterval(interval), { once: true })
}

export function resolveMobileOtaAction({
  targetUrl,
  currentUrl,
  manifest,
  loadedReleaseId,
  storedReleaseId,
}: {
  targetUrl: string | null | undefined
  currentUrl: string
  manifest: unknown
  loadedReleaseId?: string | null
  storedReleaseId?: string | null
}): MobileOtaAction {
  const target = normalizeDirectoryUrl(targetUrl)
  if (!target || !isMobileOtaManifest(manifest)) return { type: 'none' }

  const releaseId = normalizeReleaseId(manifest.releaseId)
  if (!isLocationUnderTarget(currentUrl, target)) {
    return { type: 'redirect', url: urlWithOtaRelease(target.href, releaseId), releaseId }
  }

  const currentReleaseId = normalizeReleaseId(loadedReleaseId) ?? normalizeReleaseId(storedReleaseId)
  if (releaseId && currentReleaseId && releaseId !== currentReleaseId) {
    return { type: 'reload', url: urlWithOtaRelease(currentUrl, releaseId), releaseId }
  }

  return { type: 'none', releaseId }
}

function normalizeDirectoryUrl(value?: string | null): URL | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function isCurrentLocation(targetUrl: URL): boolean {
  return isLocationUnderTarget(window.location.href, targetUrl)
}

function isLocationUnderTarget(currentUrl: string, targetUrl: URL): boolean {
  try {
    const current = new URL(currentUrl)
    return current.origin === targetUrl.origin && current.pathname.startsWith(targetUrl.pathname)
  } catch {
    return false
  }
}

function isMobileClientRuntime(targetUrl: URL): boolean {
  try {
    if (isCurrentLocation(targetUrl)) return true
    if (!isTauriRuntime()) return false
    if (isMobileUserAgent()) return true
    return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 900px)').matches
  } catch {
    return false
  }
}

function isTauriRuntime(): boolean {
  const global = globalThis as typeof globalThis & { isTauri?: unknown }
  const win = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }
  return Boolean(global.isTauri || win.__TAURI__ || win.__TAURI_INTERNALS__)
}

function isMobileUserAgent(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent)
}

function shouldDeferUpdateApply(): boolean {
  if (document.visibilityState === 'hidden') return true

  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  return Boolean(active.closest('input, textarea, select, [contenteditable="true"]'))
}

function isMobileOtaManifest(value: unknown): value is MobileOtaManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as { app?: unknown; entrypoint?: unknown; files?: unknown }
  if (manifest.app !== 'branch-continue' || manifest.entrypoint !== 'index.html') return false
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) return false
  return manifest.files.some((file) => {
    if (!file || typeof file !== 'object') return false
    return (file as { path?: unknown }).path === manifest.entrypoint
  })
}

async function validateRemoteMobileBundle(baseUrl: URL, manifest: unknown, signal: AbortSignal): Promise<boolean> {
  if (!isMobileOtaManifest(manifest)) return false

  const files = manifest.files ?? []
  const requiredPaths = new Set<string>([manifest.entrypoint])
  for (const file of files) {
    const filePath = file.path?.trim()
    if (!filePath) continue
    if (/\.(js|css|wasm)$/i.test(filePath)) requiredPaths.add(filePath)
    if (requiredPaths.size >= 8) break
  }

  for (const filePath of requiredPaths) {
    if (!(await canFetchBundleFile(baseUrl, filePath, signal))) return false
  }

  return true
}

async function canFetchBundleFile(baseUrl: URL, filePath: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(new URL(filePath, baseUrl), {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
    return response.ok
  } catch {
    return false
  }
}

function normalizeReleaseId(value?: string | null): string | undefined {
  const releaseId = value?.trim()
  return releaseId || undefined
}

function urlWithOtaRelease(value: string, releaseId?: string): string {
  if (!releaseId) return value
  const url = new URL(value)
  url.searchParams.set('ota', releaseId)
  url.hash = ''
  return url.href
}

function readStoredReleaseId(): string | null {
  try {
    return window.localStorage.getItem(MOBILE_OTA_RELEASE_KEY)
  } catch {
    return null
  }
}

function storeReleaseId(releaseId: string): void {
  try {
    window.localStorage.setItem(MOBILE_OTA_RELEASE_KEY, releaseId)
  } catch {
    // Ignore persistence failures.
  }
}
