export const OTA_PREVIEW_URL_KEY = 'branch-continue:ota-preview-url'
export const OTA_PREVIEW_DEPLOYMENT_KEY = 'branch-continue:ota-preview-deployment'

interface OtaPreviewInput {
  id?: string | null
  runId?: string | null
  releaseId?: string | null
  mobileReleaseId?: string | null
  url?: string | null
  webUrl?: string | null
  bundleUrl?: string | null
  manifestUrl?: string | null
  mobileUrl?: string | null
  desktopUrl?: string | null
  surface?: string | null
  kind?: string | null
  entryUrls?: Record<string, string | null | undefined> | null
  urls?: Record<string, string | null | undefined> | null
  deploymentId?: string | null
  metadata?: Record<string, unknown> | null
}

export function otaPreviewUrlFromDeployment(input?: OtaPreviewInput | null, fallbackUrl?: string | null, surface = 'web'): string | null {
  if (!deploymentMatchesSurface(input, surface)) return null
  const mobileBase = canonicalMobileBaseUrl()
  if (surface === 'mobile' && mobileBase) {
    for (const value of mobileUrlCandidates(input)) {
      const url = normalizeHttpUrl(value)
      if (url && isUnderUrlBase(url, mobileBase)) return url
    }

    for (const value of deploymentUrlCandidates(input, fallbackUrl)) {
      const url = normalizeHttpUrl(value)
      if (url && isUnderUrlBase(url, mobileBase)) return url
    }

    const deploymentId = deploymentReleaseId(input)
    return deploymentId ? new URL(`previews/${encodeURIComponent(deploymentId)}/`, mobileBase).href : null
  }

  for (const value of surfaceUrlCandidates(input, fallbackUrl, surface)) {
    const url = normalizeHttpUrl(value)
    if (url) return url
  }

  return null
}

export function getStoredOtaPreviewUrl(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const url = normalizeHttpUrl(window.localStorage.getItem(OTA_PREVIEW_URL_KEY))
    const mobileBase = canonicalMobileBaseUrl()
    if (!url || !mobileBase || isUnderUrlBase(url, mobileBase)) return url

    const deploymentId = getStoredOtaPreviewDeploymentId()
    if (!deploymentId) return null

    return new URL(`previews/${encodeURIComponent(deploymentId)}/`, mobileBase).href
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

export function storeOtaPreviewTarget(input: OtaPreviewInput, fallbackUrl?: string | null, surface = 'web'): string | null {
  if (typeof window === 'undefined') return null

  const url = otaPreviewUrlFromDeployment(input, fallbackUrl, surface)
  if (!url) return null

  window.localStorage.setItem(OTA_PREVIEW_URL_KEY, url)
  const deploymentId = input.deploymentId ?? input.id
  if (deploymentId) {
    window.localStorage.setItem(OTA_PREVIEW_DEPLOYMENT_KEY, deploymentId)
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
  return [...webUrlCandidates(input, fallbackUrl), ...mobileUrlCandidates(input)]
}

function deploymentSurface(input?: OtaPreviewInput | null): string | null {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const explicit = input?.surface?.trim().toLowerCase() || stringValue(metadata.surface)?.trim().toLowerCase()
  if (explicit) return explicit

  const kind = `${input?.kind ?? ''} ${stringValue(metadata.kind) ?? ''}`.toLowerCase()
  if (/mobile|android|ios/.test(kind)) return 'mobile'
  if (/desktop|tauri|app/.test(kind)) return 'desktop'
  if (/web|pages|site/.test(kind)) return 'web'

  if (hasSurfaceSpecificCandidate(input, 'mobile')) return 'mobile'
  if (hasSurfaceSpecificCandidate(input, 'desktop')) return 'desktop'
  if (hasSurfaceSpecificCandidate(input, 'web')) return 'web'

  return null
}

function deploymentMatchesSurface(input?: OtaPreviewInput | null, surface = 'web'): boolean {
  const explicit = deploymentSurface(input)
  if (explicit) return explicit === surface
  if (surface === 'mobile') return mobileUrlCandidates(input).some((value) => Boolean(normalizeHttpUrl(value)))
  if (surface === 'desktop') return desktopUrlCandidates(input).some((value) => Boolean(normalizeHttpUrl(value)))
  return webUrlCandidates(input).some((value) => Boolean(normalizeHttpUrl(value)))
}

function surfaceUrlCandidates(
  input?: OtaPreviewInput | null,
  fallbackUrl?: string | null,
  surface = 'web',
): Array<string | null | undefined> {
  if (surface === 'mobile') return mobileUrlCandidates(input)
  if (surface === 'desktop') return desktopUrlCandidates(input)
  return webUrlCandidates(input, fallbackUrl)
}

function webUrlCandidates(input?: OtaPreviewInput | null, fallbackUrl?: string | null): Array<string | null | undefined> {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const metadataEntryUrls = objectRecord(metadata.entryUrls)
  const metadataUrls = objectRecord(metadata.urls)
  const metadataDeviceUrls = objectRecord(metadata.deviceUrls)

  return [
    input?.webUrl,
    input?.entryUrls?.web,
    input?.urls?.web,
    stringValue(metadata.webUrl),
    metadataEntryUrls.web,
    metadataUrls.web,
    metadataDeviceUrls.web,
    input?.url,
    input?.bundleUrl,
    fallbackUrl,
  ]
}

function hasSurfaceSpecificCandidate(input: OtaPreviewInput | null | undefined, surface: string): boolean {
  if (!input) return false
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const entryUrls = input.entryUrls ?? {}
  const urls = input.urls ?? {}
  const metadataEntryUrls = objectRecord(metadata.entryUrls)
  const metadataUrls = objectRecord(metadata.urls)
  const metadataDeviceUrls = objectRecord(metadata.deviceUrls)

  if (surface === 'mobile') {
    if (input.mobileReleaseId || stringValue(metadata.mobileReleaseId)) return true
    return [
      input.mobileUrl,
      entryUrls.mobile,
      urls.mobile,
      stringValue(metadata.mobileUrl),
      metadataEntryUrls.mobile,
      metadataUrls.mobile,
      metadataDeviceUrls.mobile,
      input.url,
      input.bundleUrl,
      input.manifestUrl,
    ].some((value) => urlLooksLikeSurface(value, 'mobile'))
  }

  if (surface === 'desktop') {
    return [
      input.desktopUrl,
      entryUrls.desktop,
      urls.desktop,
      stringValue(metadata.desktopUrl),
      metadataEntryUrls.desktop,
      metadataUrls.desktop,
      metadataDeviceUrls.desktop,
      input.manifestUrl,
      input.url,
      input.bundleUrl,
    ].some((value) => urlLooksLikeSurface(value, 'desktop'))
  }

  return [
    input.webUrl,
    entryUrls.web,
    urls.web,
    stringValue(metadata.webUrl),
    metadataEntryUrls.web,
    metadataUrls.web,
    metadataDeviceUrls.web,
  ].some((value) => Boolean(normalizeHttpUrl(value)))
}

function urlLooksLikeSurface(value: string | null | undefined, surface: string): boolean {
  const url = normalizeHttpUrl(value)
  if (!url) return false
  try {
    const path = new URL(url).pathname.toLowerCase()
    if (surface === 'mobile') return path.includes('/mobile/') || path.includes('/android/') || path.includes('/ios/')
    if (surface === 'desktop') return path.includes('/desktop/') || path.includes('/app/')
    return false
  } catch {
    return false
  }
}

function desktopUrlCandidates(input?: OtaPreviewInput | null): Array<string | null | undefined> {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const metadataEntryUrls = objectRecord(metadata.entryUrls)
  const metadataUrls = objectRecord(metadata.urls)
  const metadataDeviceUrls = objectRecord(metadata.deviceUrls)

  return [
    input?.desktopUrl,
    input?.entryUrls?.desktop,
    input?.urls?.desktop,
    stringValue(metadata.desktopUrl),
    metadataEntryUrls.desktop,
    metadataUrls.desktop,
    metadataDeviceUrls.desktop,
    directoryUrlFromManifest(input?.manifestUrl),
  ]
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

function deploymentReleaseId(input?: OtaPreviewInput | null): string | null {
  const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  return (
    input?.mobileReleaseId ??
    input?.releaseId ??
    stringValue(metadata.mobileReleaseId) ??
    stringValue(metadata.releaseId) ??
    input?.runId ??
    input?.deploymentId ??
    input?.id ??
    null
  )
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

function canonicalMobileBaseUrl(): URL | null {
  return currentMobileBaseUrl() ?? normalizeDirectoryUrl(import.meta.env.VITE_BRANCH_CONTINUE_MOBILE_OTA_URL)
}

function normalizeDirectoryUrl(value?: string | null): URL | null {
  const url = normalizeHttpUrl(value)
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (!parsed.pathname.endsWith('/')) parsed.pathname = `${parsed.pathname}/`
    parsed.search = ''
    parsed.hash = ''
    return parsed
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
