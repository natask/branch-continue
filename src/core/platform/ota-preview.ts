export const OTA_PREVIEW_URL_KEY = 'branch-continue:ota-preview-url'
export const OTA_PREVIEW_DEPLOYMENT_KEY = 'branch-continue:ota-preview-deployment'

interface OtaPreviewInput {
  id?: string | null
  url?: string | null
  bundleUrl?: string | null
  manifestUrl?: string | null
  mobileUrl?: string | null
  entryUrls?: Record<string, string | null | undefined> | null
  urls?: Record<string, string | null | undefined> | null
  deploymentId?: string | null
  metadata?: Record<string, unknown> | null
}

export function otaPreviewUrlFromDeployment(input?: OtaPreviewInput | null, fallbackUrl?: string | null): string | null {
  const mobileBase = currentMobileBaseUrl()
  if (mobileBase) {
    for (const value of mobileUrlCandidates(input)) {
      const url = normalizeHttpUrl(value)
      if (url && isUnderUrlBase(url, mobileBase)) return url
    }

    for (const value of deploymentUrlCandidates(input, fallbackUrl)) {
      const url = normalizeHttpUrl(value)
      if (url && isUnderUrlBase(url, mobileBase)) return url
    }

    const deploymentId = input?.deploymentId ?? input?.id
    return deploymentId ? new URL(`previews/${encodeURIComponent(deploymentId)}/`, mobileBase).href : null
  }

  for (const value of [...mobileUrlCandidates(input), ...deploymentUrlCandidates(input, fallbackUrl)]) {
    const url = normalizeHttpUrl(value)
    if (url) return url
  }

  return null
}

export function getStoredOtaPreviewUrl(): string | null {
  if (typeof window === 'undefined') return null

  try {
    return normalizeHttpUrl(window.localStorage.getItem(OTA_PREVIEW_URL_KEY))
  } catch {
    return null
  }
}

export function getStoredOtaPreviewDeploymentId(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const value = window.localStorage.getItem(OTA_PREVIEW_DEPLOYMENT_KEY)?.trim()
    return value || null
  } catch {
    return null
  }
}

export function storeOtaPreviewTarget(input: OtaPreviewInput, fallbackUrl?: string | null): string | null {
  if (typeof window === 'undefined') return null

  const url = otaPreviewUrlFromDeployment(input, fallbackUrl)
  if (!url) return null

  window.localStorage.setItem(OTA_PREVIEW_URL_KEY, url)
  if (input.deploymentId) {
    window.localStorage.setItem(OTA_PREVIEW_DEPLOYMENT_KEY, input.deploymentId)
  }

  return url
}

export function clearOtaPreviewTarget(): void {
  if (typeof window === 'undefined') return

  window.localStorage.removeItem(OTA_PREVIEW_URL_KEY)
  window.localStorage.removeItem(OTA_PREVIEW_DEPLOYMENT_KEY)
}

function directoryUrlFromManifest(value?: string | null): string | null {
  const url = normalizeHttpUrl(value)
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (!parsed.pathname.endsWith('.json')) return parsed.href
    parsed.pathname = parsed.pathname.replace(/[^/]+$/, '')
    return parsed.href
  } catch {
    return null
  }
}

function deploymentUrlCandidates(input?: OtaPreviewInput | null, fallbackUrl?: string | null): Array<string | null | undefined> {
  return [input?.bundleUrl, input?.url, directoryUrlFromManifest(input?.manifestUrl), fallbackUrl]
}

function mobileUrlCandidates(input?: OtaPreviewInput | null): Array<string | null | undefined> {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const metadataEntryUrls = objectRecord(metadata.entryUrls)
  const metadataUrls = objectRecord(metadata.urls)
  const metadataDeviceUrls = objectRecord(metadata.deviceUrls)

  return [
    input?.mobileUrl,
    input?.entryUrls?.mobile,
    input?.urls?.mobile,
    stringValue(metadata.mobileUrl),
    metadataEntryUrls.mobile,
    metadataUrls.mobile,
    metadataDeviceUrls.mobile,
  ]
}

function currentMobileBaseUrl(): URL | null {
  if (typeof window === 'undefined') return null

  try {
    const url = new URL(window.location.href)
    const match = url.pathname.match(/^(.*\/mobile\/)/)
    if (!match) return null
    url.pathname = match[1]
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function isUnderUrlBase(value: string, base: URL): boolean {
  try {
    const url = new URL(value)
    return url.origin === base.origin && url.pathname.startsWith(base.pathname)
  } catch {
    return false
  }
}

function objectRecord(value: unknown): Record<string, string | null | undefined> {
  return value && typeof value === 'object' ? (value as Record<string, string | null | undefined>) : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeHttpUrl(value?: string | null): string | null {
  const raw = value?.trim()
  if (!raw) return null

  try {
    const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href
    const url = new URL(raw, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}
