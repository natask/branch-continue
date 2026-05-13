const DB_NAME = 'branch-continue-audio'
const STORE_NAME = 'captures'
const DB_VERSION = 1
const AUDIO_URI_PREFIX = 'branch-continue-audio://'
const RECORDINGS_DIR = 'recordings'

export type AudioCaptureStorage = 'file' | 'indexed-db'
export type AudioCaptureSegmentStartReason = 'start' | 'auto' | 'manual' | 'language-switch'

export interface AudioCaptureMetadata {
  sessionId: string
  segmentIndex: number
  offsetMs: number
  languageCode: string
  segmentStartReason: AudioCaptureSegmentStartReason
  final: boolean
}

export interface AudioCaptureRecord {
  id: string
  blob: Blob
  mimeType: string
  createdAt: string
  durationMs: number
  uri?: string
  path?: string
  relativePath?: string
  storage?: AudioCaptureStorage
  metadata?: AudioCaptureMetadata
}

export interface SaveAudioCaptureInput {
  id: string
  blob: Blob
  mimeType: string
  createdAt: string
  durationMs: number
  sourcePath?: string
  metadata?: AudioCaptureMetadata
}

export interface SaveAudioCaptureResult {
  id: string
  mimeType: string
  createdAt: string
  durationMs: number
  uri: string
  storage: AudioCaptureStorage
  path?: string
  relativePath?: string
  metadata?: AudioCaptureMetadata
}

export interface AudioCaptureReference {
  key: string
  uri: string
  kind: AudioCaptureStorage
  id?: string
  href?: string
  label: string
}

export function createAudioCaptureId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `audio-${crypto.randomUUID()}`
  }

  return `audio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function audioCaptureUri(id: string): string {
  return `${AUDIO_URI_PREFIX}${id}`
}

export function extractAudioCaptureIds(body: string): string[] {
  const ids = new Set<string>()
  const pattern = new RegExp(`${escapeRegex(AUDIO_URI_PREFIX)}([A-Za-z0-9_-]+)`, 'g')
  for (const match of body.matchAll(pattern)) {
    const id = match[1]
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

export function extractAudioCaptureReferences(body: string): AudioCaptureReference[] {
  const references = new Map<string, AudioCaptureReference>()

  for (const id of extractAudioCaptureIds(body)) {
    const uri = audioCaptureUri(id)
    references.set(`indexed-db:${id}`, {
      key: `indexed-db:${id}`,
      uri,
      kind: 'indexed-db',
      id,
      label: id,
    })
  }

  const audioLinePattern = /^Audio recording:\s+(.+)$/gim
  for (const match of body.matchAll(audioLinePattern)) {
    const href = normalizeAudioHref(match[1] ?? '')
    addHrefReference(references, href)
  }

  const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g
  for (const match of body.matchAll(markdownLinkPattern)) {
    const href = normalizeAudioHref(match[1] ?? '')
    addHrefReference(references, href)
  }

  return Array.from(references.values())
}

export function firstFileAudioReference(body: string): AudioCaptureReference | null {
  return extractAudioCaptureReferences(body).find((reference) => reference.kind === 'file') ?? null
}

export async function saveAudioCapture(record: SaveAudioCaptureInput): Promise<SaveAudioCaptureResult> {
  if (!record.sourcePath || !canUseFileCaptureStorage(record.sourcePath)) {
    return saveAudioCaptureIndexedDb(record)
  }

  if (!await isTauriRuntime()) {
    return saveAudioCaptureIndexedDb(record)
  }

  return saveAudioCaptureFile(record, record.sourcePath)
}

export async function loadAudioCapture(id: string): Promise<AudioCaptureRecord | null> {
  const db = await openAudioDb()
  const record = await transactionRequest<AudioCaptureRecord | undefined>(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id),
  )
  return record ?? null
}

export async function loadAudioCaptureReference(
  reference: AudioCaptureReference,
  sourcePath?: string,
): Promise<AudioCaptureRecord | null> {
  if (reference.kind === 'indexed-db') {
    return reference.id ? loadAudioCapture(reference.id) : null
  }

  const path = await resolveAudioReferencePath(reference.href ?? reference.uri, sourcePath)
  if (!path) return null

  const fs = await import('@tauri-apps/plugin-fs')
  const bytes = await fs.readFile(toLocalPathString(path))
  const mimeType = inferAudioMimeType(path)
  const metadata = await readAudioCaptureMetadata(path)
  return {
    id: reference.key,
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    createdAt: '',
    durationMs: 0,
    uri: reference.uri,
    path,
    relativePath: reference.href,
    storage: 'file',
    metadata,
  }
}

async function saveAudioCaptureFile(
  record: SaveAudioCaptureInput,
  sourcePath: string,
): Promise<SaveAudioCaptureResult> {
  const fs = await import('@tauri-apps/plugin-fs')
  const pathApi = await import('@tauri-apps/api/path')
  const sourceDir = await pathApi.dirname(toLocalPathString(sourcePath))
  const recordingsDir = await pathApi.join(sourceDir, RECORDINGS_DIR)
  const extension = audioExtension(record.mimeType)
  const fileName = `${record.id}.${extension}`
  const filePath = await pathApi.join(recordingsDir, fileName)
  const bytes = new Uint8Array(await record.blob.arrayBuffer())

  await fs.mkdir(recordingsDir, { recursive: true })
  await fs.writeFile(filePath, bytes)
  if (record.metadata) {
    const metadataPath = `${filePath}.json`
    const metadataBytes = new TextEncoder().encode(JSON.stringify(record.metadata, null, 2))
    await fs.writeFile(metadataPath, metadataBytes)
  }

  return {
    id: record.id,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
    durationMs: record.durationMs,
    uri: `${RECORDINGS_DIR}/${fileName}`,
    storage: 'file',
    path: filePath,
    relativePath: `${RECORDINGS_DIR}/${fileName}`,
    metadata: record.metadata,
  }
}

async function saveAudioCaptureIndexedDb(record: SaveAudioCaptureInput): Promise<SaveAudioCaptureResult> {
  const db = await openAudioDb()
  const stored: AudioCaptureRecord = {
    id: record.id,
    blob: record.blob,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
    durationMs: record.durationMs,
    uri: audioCaptureUri(record.id),
    storage: 'indexed-db',
    metadata: record.metadata,
  }

  await transactionRequest(
    db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(stored),
  )

  return {
    id: record.id,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
    durationMs: record.durationMs,
    uri: audioCaptureUri(record.id),
    storage: 'indexed-db',
    metadata: record.metadata,
  }
}

async function readAudioCaptureMetadata(path: string): Promise<AudioCaptureMetadata | undefined> {
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const bytes = await fs.readFile(`${path}.json`)
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return normalizeAudioCaptureMetadata(parsed)
  } catch {
    return undefined
  }
}

function normalizeAudioCaptureMetadata(value: unknown): AudioCaptureMetadata | undefined {
  if (!isRecord(value)) return undefined
  const segmentStartReason = value.segmentStartReason
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.segmentIndex !== 'number' ||
    typeof value.offsetMs !== 'number' ||
    typeof value.languageCode !== 'string' ||
    typeof value.final !== 'boolean' ||
    (segmentStartReason !== 'start' && segmentStartReason !== 'auto' && segmentStartReason !== 'manual' && segmentStartReason !== 'language-switch')
  ) {
    return undefined
  }

  return {
    sessionId: value.sessionId,
    segmentIndex: value.segmentIndex,
    offsetMs: value.offsetMs,
    languageCode: value.languageCode,
    segmentStartReason,
    final: value.final,
  }
}

async function resolveAudioReferencePath(href: string, sourcePath?: string): Promise<string | null> {
  const cleanHref = href.trim()
  if (!cleanHref) return null
  if (isAbsoluteLikePath(cleanHref)) return cleanHref
  if (!sourcePath || !canUseFileCaptureStorage(sourcePath) || !await isTauriRuntime()) return null

  const pathApi = await import('@tauri-apps/api/path')
  const sourceDir = await pathApi.dirname(toLocalPathString(sourcePath))
  return pathApi.join(sourceDir, cleanHref)
}

function addHrefReference(references: Map<string, AudioCaptureReference>, href: string): void {
  if (!href) return

  if (href.startsWith(AUDIO_URI_PREFIX)) {
    const id = href.slice(AUDIO_URI_PREFIX.length)
    if (!id) return
    references.set(`indexed-db:${id}`, {
      key: `indexed-db:${id}`,
      uri: href,
      kind: 'indexed-db',
      id,
      label: id,
    })
    return
  }

  if (!isAudioFileHref(href)) return
  const key = `file:${href}`
  references.set(key, {
    key,
    uri: href,
    kind: 'file',
    href,
    label: fileLabel(href),
  })
}

function normalizeAudioHref(value: string): string {
  const trimmed = value.trim().replace(/^<(.+)>$/, '$1')
  const markdownMatch = trimmed.match(/^\[[^\]]*\]\(([^)]+)\)/)
  const href = (markdownMatch?.[1] ?? trimmed).trim()
  if (href.startsWith(AUDIO_URI_PREFIX)) return href
  if (href.startsWith('file://')) return href
  if (/^[A-Za-z]:[\\/]/.test(href) || href.startsWith('/')) return href
  return href.split(/\s+/)[0] ?? ''
}

function canUseFileCaptureStorage(sourcePath: string): boolean {
  const normalized = sourcePath.trim().toLowerCase()
  return Boolean(normalized) && !normalized.startsWith('content://') && (
    normalized.startsWith('file://') ||
    sourcePath.includes('/') ||
    sourcePath.includes('\\')
  )
}

function isAudioFileHref(href: string): boolean {
  const normalized = href.toLowerCase()
  return (
    normalized.startsWith(`${RECORDINGS_DIR}/`) ||
    normalized.startsWith(`./${RECORDINGS_DIR}/`) ||
    normalized.startsWith('file://') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(href)
  ) && /\.(webm|m4a|mp4|aac|ogg|opus|wav|mp3|flac)$/i.test(normalized)
}

function isAbsoluteLikePath(path: string): boolean {
  return path.startsWith('file://') || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function fileLabel(path: string): string {
  const normalized = path.split('\\').join('/')
  return normalized.split('/').pop() || path
}

function audioExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase()
  if (lower.includes('mp4') || lower.includes('aac')) return 'm4a'
  if (lower.includes('ogg')) return 'ogg'
  if (lower.includes('wav')) return 'wav'
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3'
  if (lower.includes('flac')) return 'flac'
  return 'webm'
}

function inferAudioMimeType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4'
  if (lower.endsWith('.aac')) return 'audio/aac'
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.flac')) return 'audio/flac'
  return 'audio/webm'
}

function toLocalPathString(path: string): string {
  if (!path.toLowerCase().startsWith('file://')) return path
  try {
    return decodeURIComponent(new URL(path).pathname)
  } catch {
    return path
  }
}

async function isTauriRuntime(): Promise<boolean> {
  try {
    const core = await import('@tauri-apps/api/core')
    return core.isTauri()
  } catch {
    return false
  }
}

function openAudioDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Audio storage is not available in this environment.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open audio storage.'))
  })
}

function transactionRequest<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Audio storage request failed.'))
  })
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
