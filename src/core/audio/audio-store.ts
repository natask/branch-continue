const DB_NAME = 'branch-continue-audio'
const STORE_NAME = 'captures'
const TRANSCRIPT_STORE_NAME = 'transcripts'
const DB_VERSION = 2
const AUDIO_URI_PREFIX = 'branch-continue-audio://'
const RECORDINGS_DIR = 'recordings'
const TRANSCRIPT_FILE_SUFFIX = '.transcript.md'

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

export interface SaveAudioTranscriptSegmentInput {
  sourcePath?: string
  audio: SaveAudioCaptureResult
  text: string
  offsetMs: number
  languageCode: string
  sessionId: string
  segmentIndex: number
  createdAt: string
  durationMs?: number
}

export interface AudioTranscriptSegment {
  id: string
  audioUri: string
  transcriptUri?: string
  text: string
  offsetMs: number
  label: string
  createdAt: string
  languageCode: string
  sessionId: string
  segmentIndex: number
  durationMs?: number
  storage?: AudioCaptureStorage
}

export interface AudioCaptureReference {
  key: string
  uri: string
  kind: AudioCaptureStorage
  id?: string
  href?: string
  label: string
}

interface AndroidAudioCaptureFileResult {
  uri?: string
  relativePath?: string
}

interface AndroidAudioCaptureContentResult {
  base64?: string
  mimeType?: string
  metadataJson?: string | null
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
  if (record.sourcePath && isAndroidContentSourcePath(record.sourcePath) && await isTauriRuntime()) {
    try {
      return await saveAndroidContentAudioCapture(record, record.sourcePath)
    } catch (error) {
      if (isAndroidAudioCaptureBridgeUnavailable(error)) {
        throw new Error('Android audio file storage is not available in this mobile shell. Rebuild and reinstall the mobile shell so recordings can be written beside the source file.')
      }
      throw error
    }
  }

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

  if (sourcePath && isAndroidContentSourcePath(sourcePath) && isRelativeRecordingHref(reference.href ?? reference.uri) && await isTauriRuntime()) {
    return loadAndroidContentAudioCapture(reference, sourcePath)
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

export async function saveAudioTranscriptSegment(
  input: SaveAudioTranscriptSegmentInput,
): Promise<AudioTranscriptSegment | null> {
  const text = cleanTranscriptText(input.text)
  if (!text) return null

  const segment: AudioTranscriptSegment = {
    id: transcriptIdForAudioUri(input.audio.uri),
    audioUri: input.audio.uri,
    text,
    offsetMs: Math.max(0, Math.round(input.offsetMs)),
    label: formatTranscriptTime(input.offsetMs),
    createdAt: input.createdAt,
    languageCode: input.languageCode,
    sessionId: input.sessionId,
    segmentIndex: input.segmentIndex,
    durationMs: input.durationMs,
  }

  if (input.sourcePath && isAndroidContentSourcePath(input.sourcePath) && input.audio.relativePath && await isTauriRuntime()) {
    try {
      return await saveAndroidContentAudioTranscriptSegment(input, segment)
    } catch {
      return saveAudioTranscriptIndexedDb(segment)
    }
  }

  if (input.audio.storage === 'file' && input.audio.path && input.audio.relativePath && await isTauriRuntime()) {
    try {
      return await saveAudioTranscriptFile(input, segment)
    } catch {
      return saveAudioTranscriptIndexedDb(segment)
    }
  }

  return saveAudioTranscriptIndexedDb(segment)
}

export async function loadAudioTranscriptSegments(
  records: AudioCaptureRecord[],
  sourcePath?: string,
): Promise<AudioTranscriptSegment[]> {
  const segments = new Map<string, AudioTranscriptSegment>()

  for (const record of records) {
    const audioUri = audioUriForRecord(record)
    const fallback = transcriptFallbackForRecord(record, audioUri)

    if (record.storage === 'file') {
      const fileSegment = await loadAudioTranscriptFile(record, sourcePath, fallback).catch(() => null)
      if (fileSegment) segments.set(fileSegment.id, fileSegment)
    }

    const indexedSegment = await loadAudioTranscriptIndexedDb(audioUri).catch(() => null)
    if (indexedSegment && !segments.has(indexedSegment.id)) {
      segments.set(indexedSegment.id, indexedSegment)
    }
  }

  return Array.from(segments.values()).sort((a, b) => {
    return a.offsetMs - b.offsetMs || a.segmentIndex - b.segmentIndex || a.createdAt.localeCompare(b.createdAt)
  })
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

async function saveAndroidContentAudioCapture(
  record: SaveAudioCaptureInput,
  sourcePath: string,
): Promise<SaveAudioCaptureResult> {
  const extension = audioExtension(record.mimeType)
  const fileName = `${record.id}.${extension}`
  const relativePath = `${RECORDINGS_DIR}/${fileName}`
  const bytes = new Uint8Array(await record.blob.arrayBuffer())
  const metadataJson = record.metadata ? JSON.stringify(record.metadata, null, 2) : null
  const core = await import('@tauri-apps/api/core')
  const saved = await core.invoke<AndroidAudioCaptureFileResult>('android_save_audio_capture', {
    payload: {
      sourceUri: sourcePath,
      relativePath,
      mimeType: record.mimeType,
      base64: uint8ArrayToBase64(bytes),
      metadataJson,
    },
  })
  const savedRelativePath = saved.relativePath?.trim() || relativePath

  return {
    id: record.id,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
    durationMs: record.durationMs,
    uri: savedRelativePath,
    storage: 'file',
    path: saved.uri,
    relativePath: savedRelativePath,
    metadata: record.metadata,
  }
}

async function loadAndroidContentAudioCapture(
  reference: AudioCaptureReference,
  sourcePath: string,
): Promise<AudioCaptureRecord | null> {
  const relativePath = normalizeRelativeRecordingHref(reference.href ?? reference.uri)
  if (!relativePath) return null

  const core = await import('@tauri-apps/api/core')
  const loaded = await core.invoke<AndroidAudioCaptureContentResult>('android_read_audio_capture', {
    payload: {
      sourceUri: sourcePath,
      relativePath,
    },
  })
  if (!loaded.base64) return null

  const bytes = base64ToUint8Array(loaded.base64)
  const mimeType = loaded.mimeType?.trim() || inferAudioMimeType(relativePath)
  return {
    id: reference.key,
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    createdAt: '',
    durationMs: 0,
    uri: reference.uri,
    path: loaded.base64 ? relativePath : undefined,
    relativePath,
    storage: 'file',
    metadata: normalizeAudioCaptureMetadataJson(loaded.metadataJson),
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

async function saveAudioTranscriptFile(
  input: SaveAudioTranscriptSegmentInput,
  segment: AudioTranscriptSegment,
): Promise<AudioTranscriptSegment> {
  if (!input.audio.path || !input.audio.relativePath) {
    return saveAudioTranscriptIndexedDb(segment)
  }

  const fs = await import('@tauri-apps/plugin-fs')
  const transcriptPath = transcriptPathForAudioPath(input.audio.path)
  const transcriptUri = transcriptPathForAudioRelativePath(input.audio.relativePath)
  const bytes = new TextEncoder().encode(formatAudioTranscriptFile({ ...segment, transcriptUri }))
  await fs.writeFile(transcriptPath, bytes)

  return {
    ...segment,
    transcriptUri,
    storage: 'file',
  }
}

async function saveAndroidContentAudioTranscriptSegment(
  input: SaveAudioTranscriptSegmentInput,
  segment: AudioTranscriptSegment,
): Promise<AudioTranscriptSegment> {
  if (!input.audio.relativePath || !input.sourcePath) {
    return saveAudioTranscriptIndexedDb(segment)
  }

  const relativePath = transcriptPathForAudioRelativePath(input.audio.relativePath)
  const bytes = new TextEncoder().encode(formatAudioTranscriptFile({ ...segment, transcriptUri: relativePath }))
  const core = await import('@tauri-apps/api/core')
  const saved = await core.invoke<AndroidAudioCaptureFileResult>('android_save_audio_capture', {
    payload: {
      sourceUri: input.sourcePath,
      relativePath,
      mimeType: 'text/markdown',
      base64: uint8ArrayToBase64(bytes),
      metadataJson: null,
    },
  })
  const savedRelativePath = saved.relativePath?.trim() || relativePath

  return {
    ...segment,
    transcriptUri: savedRelativePath,
    storage: 'file',
  }
}

async function saveAudioTranscriptIndexedDb(segment: AudioTranscriptSegment): Promise<AudioTranscriptSegment> {
  const db = await openAudioDb()
  const stored: AudioTranscriptSegment = {
    ...segment,
    storage: 'indexed-db',
  }

  await transactionRequest(
    db.transaction(TRANSCRIPT_STORE_NAME, 'readwrite').objectStore(TRANSCRIPT_STORE_NAME).put(stored),
  )

  return stored
}

async function loadAudioTranscriptIndexedDb(audioUri: string): Promise<AudioTranscriptSegment | null> {
  const db = await openAudioDb()
  const record = await transactionRequest<AudioTranscriptSegment | undefined>(
    db.transaction(TRANSCRIPT_STORE_NAME, 'readonly').objectStore(TRANSCRIPT_STORE_NAME).get(transcriptIdForAudioUri(audioUri)),
  )
  return record ?? null
}

async function loadAudioTranscriptFile(
  record: AudioCaptureRecord,
  sourcePath: string | undefined,
  fallback: AudioTranscriptSegment,
): Promise<AudioTranscriptSegment | null> {
  if (sourcePath && isAndroidContentSourcePath(sourcePath) && record.relativePath && await isTauriRuntime()) {
    const transcriptUri = transcriptPathForAudioRelativePath(record.relativePath)
    const core = await import('@tauri-apps/api/core')
    const loaded = await core.invoke<AndroidAudioCaptureContentResult>('android_read_audio_capture', {
      payload: {
        sourceUri: sourcePath,
        relativePath: transcriptUri,
      },
    })
    if (!loaded.base64) return null
    return parseAudioTranscriptFile(uint8ArrayToText(base64ToUint8Array(loaded.base64)), fallback, transcriptUri, 'file')
  }

  if (!record.path) return null

  const fs = await import('@tauri-apps/plugin-fs')
  const transcriptPath = transcriptPathForAudioPath(record.path)
  const bytes = await fs.readFile(transcriptPath)
  return parseAudioTranscriptFile(
    uint8ArrayToText(bytes),
    fallback,
    record.relativePath ? transcriptPathForAudioRelativePath(record.relativePath) : transcriptPath,
    'file',
  )
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

function normalizeAudioCaptureMetadataJson(value: string | null | undefined): AudioCaptureMetadata | undefined {
  if (!value?.trim()) return undefined
  try {
    return normalizeAudioCaptureMetadata(JSON.parse(value))
  } catch {
    return undefined
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

function isRelativeRecordingHref(href: string): boolean {
  return Boolean(normalizeRelativeRecordingHref(href))
}

function normalizeRelativeRecordingHref(href: string): string | null {
  const normalized = normalizeAudioHref(href).split('\\').join('/').replace(/^\.\//, '')
  if (!normalized.toLowerCase().startsWith(`${RECORDINGS_DIR}/`)) return null
  if (normalized.includes('../')) return null
  return normalized
}

function isAndroidContentSourcePath(path: string): boolean {
  return path.trim().toLowerCase().startsWith('content://')
}

function isAndroidAudioCaptureBridgeUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('android_save_audio_capture') && (
      normalized.includes('not found') ||
      normalized.includes('unknown command') ||
      normalized.includes('command not found') ||
      normalized.includes('not allowed') ||
      normalized.includes('permission')
    )
  ) || normalized.includes('allow-android-save-audio-capture')
}

function isAbsoluteLikePath(path: string): boolean {
  return path.startsWith('file://') || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function fileLabel(path: string): string {
  const normalized = path.split('\\').join('/')
  return normalized.split('/').pop() || path
}

function audioUriForRecord(record: AudioCaptureRecord): string {
  if (record.uri?.trim()) return record.uri.trim()
  if (record.storage === 'indexed-db' && record.id) return audioCaptureUri(record.id)
  return record.relativePath ?? record.path ?? record.id
}

function transcriptFallbackForRecord(record: AudioCaptureRecord, audioUri: string): AudioTranscriptSegment {
  const offsetMs = record.metadata?.offsetMs ?? 0
  return {
    id: transcriptIdForAudioUri(audioUri),
    audioUri,
    text: '',
    offsetMs,
    label: formatTranscriptTime(offsetMs),
    createdAt: record.createdAt,
    languageCode: record.metadata?.languageCode ?? '',
    sessionId: record.metadata?.sessionId ?? '',
    segmentIndex: record.metadata?.segmentIndex ?? 0,
    durationMs: record.durationMs,
  }
}

function transcriptIdForAudioUri(audioUri: string): string {
  return `transcript:${audioUri}`
}

function transcriptPathForAudioPath(path: string): string {
  return `${stripAudioExtension(path)}${TRANSCRIPT_FILE_SUFFIX}`
}

function transcriptPathForAudioRelativePath(path: string): string {
  return `${stripAudioExtension(path)}${TRANSCRIPT_FILE_SUFFIX}`
}

function stripAudioExtension(path: string): string {
  return path.replace(/\.(webm|m4a|mp4|aac|ogg|opus|wav|mp3|flac)$/i, '')
}

function formatAudioTranscriptFile(segment: AudioTranscriptSegment): string {
  return [
    'Audio transcript:',
    `Audio: ${segment.audioUri}`,
    `Session: ${segment.sessionId || 'unknown'}`,
    `Segment: ${segment.segmentIndex + 1}`,
    `Language: ${segment.languageCode || 'unknown'}`,
    `Offset: ${formatTranscriptTime(segment.offsetMs)}`,
    `Created: ${segment.createdAt || new Date().toISOString()}`,
    '',
    `[${formatTranscriptTime(segment.offsetMs)}] ${segment.text}`,
    '',
  ].join('\n')
}

function parseAudioTranscriptFile(
  content: string,
  fallback: AudioTranscriptSegment,
  transcriptUri: string,
  storage: AudioCaptureStorage,
): AudioTranscriptSegment | null {
  const lines = content.split(/\r?\n/)
  const metadata = new Map<string, string>()
  let transcriptLine = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /^Audio transcript:?$/i.test(trimmed)) continue

    const cue = parseTranscriptCueLine(trimmed)
    if (cue) {
      transcriptLine = trimmed
      break
    }

    const metadataMatch = trimmed.match(/^([A-Za-z ]+):\s*(.*)$/)
    if (metadataMatch) {
      metadata.set(metadataMatch[1]!.trim().toLowerCase(), metadataMatch[2]!.trim())
      continue
    }

    transcriptLine = trimmed
    break
  }

  const cue = parseTranscriptCueLine(transcriptLine)
  const text = cleanTranscriptText(cue?.text ?? transcriptLine)
  if (!text) return null

  const offsetMs = cue?.timeMs ?? parseTranscriptTime(metadata.get('offset') ?? '') ?? fallback.offsetMs
  return {
    ...fallback,
    transcriptUri,
    text,
    offsetMs,
    label: formatTranscriptTime(offsetMs),
    createdAt: metadata.get('created') || fallback.createdAt,
    languageCode: metadata.get('language') || fallback.languageCode,
    sessionId: metadata.get('session') || fallback.sessionId,
    storage,
  }
}

function parseTranscriptCueLine(line: string): { timeMs: number; text: string } | null {
  const match = line.match(/^\[([^\]]+)]\s+(.+)$/)
  if (!match) return null
  const timeMs = parseTranscriptTime(match[1] ?? '')
  const text = cleanTranscriptText(match[2] ?? '')
  if (timeMs === null || !text) return null
  return { timeMs, text }
}

function parseTranscriptTime(value: string): number | null {
  const parts = value.split(':').map((part) => part.trim())
  if (parts.length < 2 || parts.length > 3) return null

  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null

  const [hoursOrMinutes, minutesOrSeconds, maybeSeconds] = numbers
  const totalSeconds = maybeSeconds === undefined
    ? (hoursOrMinutes * 60) + minutesOrSeconds
    : (hoursOrMinutes * 3600) + (minutesOrSeconds * 60) + maybeSeconds
  return Math.round(totalSeconds * 1000)
}

function formatTranscriptTime(offsetMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(offsetMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
  return `${minutes}:${seconds}`
}

function cleanTranscriptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function uint8ArrayToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
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
      if (!db.objectStoreNames.contains(TRANSCRIPT_STORE_NAME)) {
        db.createObjectStore(TRANSCRIPT_STORE_NAME, { keyPath: 'id' })
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
