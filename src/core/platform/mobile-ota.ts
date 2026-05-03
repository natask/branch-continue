const MOBILE_OTA_URL = import.meta.env.VITE_BRANCH_CONTINUE_MOBILE_OTA_URL?.trim()
const MOBILE_OTA_MANIFEST = 'branch-continue-mobile-ota.json'
const CHECK_TIMEOUT_MS = 1800

export function startMobileOtaRedirect(): void {
  if (!MOBILE_OTA_URL || typeof window === 'undefined') return

  const targetUrl = normalizeDirectoryUrl(MOBILE_OTA_URL)
  if (!targetUrl || isCurrentLocation(targetUrl)) return

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  fetch(new URL(MOBILE_OTA_MANIFEST, targetUrl), {
    cache: 'no-store',
    signal: controller.signal,
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((manifest) => {
      if (!isMobileOtaManifest(manifest)) return
      window.location.replace(targetUrl.href)
    })
    .catch(() => {
      // The embedded bundle remains the offline fallback when ZeroTier or the OTA host is unavailable.
    })
    .finally(() => window.clearTimeout(timeout))
}

function normalizeDirectoryUrl(value: string): URL | null {
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
  return window.location.origin === targetUrl.origin && window.location.pathname.startsWith(targetUrl.pathname)
}

function isMobileOtaManifest(value: unknown): value is { app: string; entrypoint: string } {
  if (!value || typeof value !== 'object') return false
  const manifest = value as { app?: unknown; entrypoint?: unknown }
  return manifest.app === 'branch-continue' && manifest.entrypoint === 'index.html'
}
