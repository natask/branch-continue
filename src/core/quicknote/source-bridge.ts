const TAURI_SOURCE_KEY = 'branch-continue:tauri-source-path'
const TAURI_SOURCE_STATE_FILE = 'source-state.json'
const HANDLE_DB_NAME = 'branch-continue-source-db'
const HANDLE_STORE = 'source'
const HANDLE_KEY = 'browser-handle'
const DEFAULT_TAURI_SOURCE_PATH = import.meta.env.VITE_DEFAULT_SOURCE_PATH?.trim() ?? ''
const DEFAULT_RELATIVE_PATHS = [
  ['sync', 'o.org'],
  ['sync', 'quicknote.org'],
  ['sync', 'QuickNote.org'],
  ['sync', 'markor', 'o.org'],
  ['sync', 'markor', 'quicknote.org'],
  ['sync', 'markor', 'QuickNote.org'],
  ['Documents', 'sync', 'o.org'],
  ['Documents', 'sync', 'quicknote.org'],
  ['Documents', 'sync', 'QuickNote.org'],
  ['Documents', 'sync', 'markor', 'o.org'],
  ['Documents', 'sync', 'markor', 'quicknote.org'],
  ['Documents', 'sync', 'markor', 'QuickNote.org'],
]

type SourceMode = 'direct' | 'download'

interface SelectedSource {
  kind: 'tauri'
  path: string
  label: string
  mode: SourceMode
}

interface SelectedHandleSource {
  kind: 'filesystem-handle'
  path: string
  label: string
  mode: SourceMode
  handle: FileSystemFileHandle
}

interface SelectedUploadSource {
  kind: 'upload'
  path: string
  label: string
  mode: SourceMode
  content: string
}

type ActiveSource = SelectedSource | SelectedHandleSource | SelectedUploadSource

type BrowserFilePicker = (options?: {
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: Array<{
    description?: string
    accept?: Record<string, string[]>
  }>
}) => Promise<FileSystemFileHandle[]>

interface WindowWithFilePicker extends Window {
  showOpenFilePicker?: BrowserFilePicker
}

export class SourceSelectionCancelledError extends Error {
  constructor() {
    super('File selection cancelled.')
    this.name = 'SourceSelectionCancelledError'
  }
}

export interface SourceSummary {
  path: string
  label: string
  writable: boolean
  mode: SourceMode
}

export class SourceFileUnavailableError extends Error {
  readonly summary: SourceSummary

  constructor(summary: SourceSummary) {
    super(`Source file is no longer available: ${summary.path}`)
    this.name = 'SourceFileUnavailableError'
    this.summary = summary
  }
}

export class SourceFileConflictError extends Error {
  constructor() {
    super('The source file changed on another device or in another app. Reload it before saving again.')
    this.name = 'SourceFileConflictError'
  }
}

export interface SelectedFileResult {
  summary: SourceSummary
  content: string
}

export interface SourceBridge {
  selectFile(): Promise<SelectedFileResult>
  restoreLastSelection(): Promise<SelectedFileResult | null>
  read(): Promise<SelectedFileResult>
  write(content: string, expectedContent?: string): Promise<void>
  summary(): SourceSummary | null
  startWatching(onChanged: () => void): void
  stopWatching(): void
}

const FILE_WATCH_INTERVAL_MS = 2000

export function createSourceBridge(): SourceBridge {
  let active: ActiveSource | null = null
  let watchTimer: ReturnType<typeof setInterval> | null = null
  let lastKnownContentHash: string | null = null

  function stopWatchTimer() {
    if (watchTimer !== null) {
      clearInterval(watchTimer)
      watchTimer = null
    }
    lastKnownContentHash = null
  }

  async function simpleHash(text: string): Promise<string> {
    // Compare all text. Sparse fingerprints miss equal-length edits from sync.
    return text
  }

  async function clearCurrentSource(source: ActiveSource): Promise<void> {
    if (active !== source) return

    active = null
    stopWatchTimer()

    if (source.kind === 'tauri') {
      await clearPersistedTauriSourcePath()
      return
    }

    if (source.kind === 'filesystem-handle') {
      await clearPersistedBrowserHandle()
    }
  }

  async function handleSourceAccessError(source: ActiveSource, error: unknown): Promise<never> {
    if (isSourceAccessLostError(error)) {
      const summary = toSummary(source)
      await clearCurrentSource(source)
      throw new SourceFileUnavailableError(summary)
    }

    throw error
  }

  return {
    async selectFile(): Promise<SelectedFileResult> {
      if (await isTauriRuntime()) {
        const selected = await selectTauriFile()
        if (!selected) {
          throw new SourceSelectionCancelledError()
        }

        let content: string
        try {
          content = await readTauriFile(selected.path)
        } catch (error) {
          if (isMissingSourceError(error)) {
            await clearPersistedTauriSourcePath()
            throw new SourceFileUnavailableError(toSummary(selected))
          }
          throw error
        }
        active = selected
        await persistTauriSourcePath(selected.path)
        return { summary: toSummary(selected), content }
      }

      const picker = getBrowserFilePicker()
      if (picker) {
        let picked: FileSystemFileHandle[]
        try {
          picked = await picker({
            multiple: false,
            types: [
              {
                description: 'Org and text files',
                accept: {
                  'text/plain': ['.org', '.txt', '.md'],
                },
              },
            ],
            excludeAcceptAllOption: false,
          })
        } catch (error) {
          if (isPickerCancelled(error)) {
            throw new SourceSelectionCancelledError()
          }
          throw error
        }

        const handle = picked[0]
        if (!handle) {
          throw new SourceSelectionCancelledError()
        }

        let file: File
        try {
          file = await handle.getFile()
        } catch (error) {
          if (isMissingSourceError(error)) {
            await clearPersistedBrowserHandle()
            const label = handle.name || 'Selected file'
            throw new SourceFileUnavailableError({
              path: label,
              label,
              writable: true,
              mode: 'direct',
            })
          }
          if (isBrowserHandleAccessBlocked(error)) {
            await clearPersistedBrowserHandle()
            const upload = await selectUploadSource()
            if (!upload) {
              throw new SourceSelectionCancelledError()
            }
            active = upload.source
            return { summary: toSummary(upload.source), content: upload.content }
          }
          throw error
        }
        const selected: SelectedHandleSource = {
          kind: 'filesystem-handle',
          path: file.name,
          label: file.name,
          mode: 'direct',
          handle,
        }

        active = selected
        await persistBrowserHandle(handle)
        return { summary: toSummary(selected), content: await file.text() }
      }

      const upload = await selectUploadSource()
      if (!upload) {
        throw new SourceSelectionCancelledError()
      }

      active = upload.source
      await clearPersistedBrowserHandle()
      return { summary: toSummary(upload.source), content: upload.content }
    },

    async restoreLastSelection(): Promise<SelectedFileResult | null> {
      if (await isTauriRuntime()) {
        const pathApi = await import('@tauri-apps/api/path')
        const candidatePaths = await buildTauriCandidatePaths(pathApi)

        for (const path of candidatePaths) {
          try {
            const selected: SelectedSource = {
              kind: 'tauri',
              path,
              label: fileName(path),
              mode: 'direct',
            }
            const content = await readTauriFile(path)
            active = selected
            await persistTauriSourcePath(path)
            return { summary: toSummary(selected), content }
          } catch {
            // Try next candidate.
          }
        }

        await clearPersistedTauriSourcePath()
        return null
      }

      const handle = await loadPersistedBrowserHandle()
      if (!handle) return null

      try {
        const file = await handle.getFile()
        const selected: SelectedHandleSource = {
          kind: 'filesystem-handle',
          path: file.name,
          label: file.name,
          mode: 'direct',
          handle,
        }
        active = selected
        return { summary: toSummary(selected), content: await file.text() }
      } catch {
        await clearPersistedBrowserHandle()
        return null
      }
    },

    async read(): Promise<SelectedFileResult> {
      if (!active) {
        throw new Error('No file selected. Choose a file first.')
      }

      if (active.kind === 'tauri') {
        const source = active
        try {
          const content = await readTauriFile(source.path)
          return { summary: toSummary(source), content }
        } catch (error) {
          return handleSourceAccessError(source, error)
        }
      }

      if (active.kind === 'filesystem-handle') {
        const source = active
        try {
          const file = await source.handle.getFile()
          const nextSource: SelectedHandleSource = {
            ...source,
            path: file.name,
            label: file.name,
          }
          active = nextSource
          return { summary: toSummary(nextSource), content: await file.text() }
        } catch (error) {
          return handleSourceAccessError(source, error)
        }
      }

      return { summary: toSummary(active), content: active.content }
    },

    async write(content: string, expectedContent?: string): Promise<void> {
      if (!active) {
        throw new Error('No file selected. Choose a file first.')
      }

      if (active.kind === 'tauri') {
        const source = active
        try {
          if (expectedContent !== undefined && await readTauriFile(source.path) !== expectedContent) {
            throw new SourceFileConflictError()
          }
          if (active !== source) throw new SourceFileConflictError()
          await writeTauriFile(source.path, content)
          return
        } catch (error) {
          return handleSourceAccessError(source, error)
        }
      }

      if (active.kind === 'filesystem-handle') {
        const source = active
        try {
          if (expectedContent !== undefined && await (await source.handle.getFile()).text() !== expectedContent) {
            throw new SourceFileConflictError()
          }
          if (active !== source) throw new SourceFileConflictError()
          const writable = await source.handle.createWritable()
          await writable.write(content)
          await writable.close()
          return
        } catch (error) {
          return handleSourceAccessError(source, error)
        }
      }

      triggerDownload(active.label, content)
      active = {
        ...active,
        content,
      }
    },

    summary(): SourceSummary | null {
      if (!active) return null
      return toSummary(active)
    },

    startWatching(onChanged: () => void): void {
      stopWatchTimer()

      watchTimer = setInterval(async () => {
        const source = active
        if (!source) return

        try {
          if (source.kind === 'tauri') {
            const content = await readTauriFile(source.path)
            const hash = await simpleHash(content)
            if (lastKnownContentHash === null) {
              lastKnownContentHash = hash
              return
            }
            if (hash !== lastKnownContentHash) {
              lastKnownContentHash = hash
              onChanged()
            }
            return
          }

          if (source.kind === 'filesystem-handle') {
            const file = await source.handle.getFile()
            const content = await file.text()
            if (lastKnownContentHash === null) {
              lastKnownContentHash = content
              return
            }
            if (content !== lastKnownContentHash) {
              lastKnownContentHash = content
              onChanged()
            }
            return
          }

          // Upload mode: no external file to watch.
        } catch (error) {
          if (isSourceAccessLostError(error)) {
            onChanged()
          }
        }
      }, FILE_WATCH_INTERVAL_MS)
    },

    stopWatching(): void {
      stopWatchTimer()
    },
  }
}

function toSummary(source: ActiveSource): SourceSummary {
  return {
    path: source.path,
    label: source.label,
    writable: source.mode === 'direct',
    mode: source.mode,
  }
}

function getBrowserFilePicker(): BrowserFilePicker | undefined {
  if (typeof window === 'undefined') return undefined
  if (shouldUseUploadInputPicker()) return undefined

  const picker = (window as WindowWithFilePicker).showOpenFilePicker
  return picker ? picker.bind(window) : undefined
}

function fileName(path: string): string {
  const normalized = path.split('\\').join('/')
  const parts = normalized.split('/')
  const lastSegment = parts[parts.length - 1] || path
  const decodedSegment = safeDecodeURIComponent(lastSegment)
  const uriTail = decodedSegment.split('/').pop() || decodedSegment
  const colonTail = uriTail.split(':').pop() || uriTail
  return colonTail || path
}

function isPickerCancelled(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('cancel') ||
    normalized.includes('aborted') ||
    normalized.includes('abort')
  )
}

async function isTauriRuntime(): Promise<boolean> {
  try {
    const core = await import('@tauri-apps/api/core')
    return core.isTauri()
  } catch {
    return false
  }
}

async function selectTauriFile(): Promise<SelectedSource | null> {
  const dialog = await import('@tauri-apps/plugin-dialog')
  const pathApi = await import('@tauri-apps/api/path')
  const mobilePlatform = detectMobilePlatform()
  let defaultPath: string | undefined

  if (mobilePlatform === 'android') {
    try {
      return await selectAndroidSourceFile()
    } catch (error) {
      if (isPickerCancelled(error)) return null
      if (!isAndroidSourceBridgeUnavailable(error)) {
        throw error
      }
    }
  }

  // Mobile pickers do not reliably use directory-style default paths.
  if (mobilePlatform === 'other') {
    try {
      defaultPath = await pathApi.homeDir()
    } catch {
      defaultPath = undefined
    }
  }

  const dialogOptions: Parameters<typeof dialog.open>[0] = {
    multiple: false,
    directory: false,
    defaultPath,
    pickerMode: 'document',
    // Android SAF paths are more reliable with copied files; iOS can use scoped access.
    fileAccessMode: mobilePlatform === 'android' ? 'copy' : 'scoped',
  }

  // Keep Android picker unfiltered so SAF providers don't disable .org files.
  if (mobilePlatform !== 'android') {
    dialogOptions.filters = [
      {
        name: 'Org and text files',
        extensions: ['org', 'txt', 'md'],
      },
    ]
  }

  const result = await dialog.open(dialogOptions)

  if (!result || Array.isArray(result)) {
    return null
  }

  return {
    kind: 'tauri',
    path: result,
    label: fileName(result),
    mode: 'direct',
  }
}

async function selectAndroidSourceFile(): Promise<SelectedSource | null> {
  const selection = await invokeAndroidSourceFile<{
    uri?: string | null
    name?: string | null
  } | null>('android_select_source_file')

  const uri = selection?.uri?.trim()
  if (!uri) return null

  return {
    kind: 'tauri',
    path: uri,
    label: selection?.name?.trim() || fileName(uri),
    mode: 'direct',
  }
}

async function buildTauriCandidatePaths(pathApi: typeof import('@tauri-apps/api/path')): Promise<string[]> {
  const candidates: string[] = []
  const pushUnique = (value?: string | null) => {
    const next = value?.trim()
    if (!next) return
    if (!candidates.includes(next)) {
      candidates.push(next)
    }
  }

  let homePath: string | null = null
  try {
    homePath = await pathApi.homeDir()
  } catch {
    homePath = null
  }

  // Prefer the last explicit user selection. It is stored in both localStorage
  // and native app config so it survives switching between embedded and OTA origins.
  pushUnique(localStorage.getItem(TAURI_SOURCE_KEY))
  pushUnique(await loadPersistedTauriSourcePath())

  if (DEFAULT_TAURI_SOURCE_PATH) {
    pushUnique(await resolveTauriPath(DEFAULT_TAURI_SOURCE_PATH, homePath, pathApi))
    pushUnique(await resolveDefaultSourceWithinLegacyRoot(DEFAULT_TAURI_SOURCE_PATH, homePath, pathApi))
  }

  if (homePath) {
    for (const relativePath of DEFAULT_RELATIVE_PATHS) {
      pushUnique(await pathApi.join(homePath, ...relativePath))
    }
  }

  return candidates
}

async function persistTauriSourcePath(pathValue: string): Promise<void> {
  localStorage.setItem(TAURI_SOURCE_KEY, pathValue)

  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const pathApi = await import('@tauri-apps/api/path')
    const state = {
      path: pathValue,
      updatedAt: new Date().toISOString(),
    }

    for (const baseDir of tauriSourceStateBaseDirs(pathApi)) {
      try {
        await fs.writeTextFile(TAURI_SOURCE_STATE_FILE, JSON.stringify(state), { baseDir })
        return
      } catch {
        // Try the next app-private base directory.
      }
    }
  } catch {
    // localStorage remains the fallback for older shells and browser mode.
  }
}

async function loadPersistedTauriSourcePath(): Promise<string | null> {
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const pathApi = await import('@tauri-apps/api/path')
    for (const baseDir of tauriSourceStateBaseDirs(pathApi)) {
      try {
        const raw = await fs.readTextFile(TAURI_SOURCE_STATE_FILE, { baseDir })
        const parsed = JSON.parse(raw) as { path?: unknown }
        const pathValue = typeof parsed.path === 'string' ? parsed.path.trim() : ''
        if (pathValue) return pathValue
      } catch {
        // Try the next app-private base directory.
      }
    }
  } catch {
    // Ignore native persistence lookup failures.
  }

  return null
}

async function clearPersistedTauriSourcePath(): Promise<void> {
  localStorage.removeItem(TAURI_SOURCE_KEY)

  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const pathApi = await import('@tauri-apps/api/path')
    for (const baseDir of tauriSourceStateBaseDirs(pathApi)) {
      try {
        await fs.remove(TAURI_SOURCE_STATE_FILE, { baseDir })
      } catch {
        // Missing state files are fine.
      }
    }
  } catch {
    // Ignore native persistence cleanup failures.
  }
}

function tauriSourceStateBaseDirs(pathApi: typeof import('@tauri-apps/api/path')) {
  return [
    pathApi.BaseDirectory.AppConfig,
    pathApi.BaseDirectory.AppData,
    pathApi.BaseDirectory.AppLocalData,
  ]
}

async function resolveTauriPath(
  value: string,
  homePath: string | null,
  pathApi: typeof import('@tauri-apps/api/path'),
): Promise<string> {
  if (value.startsWith('~/')) {
    if (!homePath) return value
    const suffix = value.slice(2)
    if (!suffix) return homePath
    const segments = suffix.split('/').filter(Boolean)
    return pathApi.join(homePath, ...segments)
  }

  return value
}

async function resolveDefaultSourceWithinLegacyRoot(
  value: string,
  homePath: string | null,
  pathApi: typeof import('@tauri-apps/api/path'),
): Promise<string | null> {
  if (!homePath) return null
  if (value.includes('/') || value.includes('\\')) return null
  return pathApi.join(homePath, 'sync', 'markor', value)
}

async function readTauriFile(path: string): Promise<string> {
  if (isAndroidContentUri(path)) {
    try {
      const response = await invokeAndroidSourceFile<{ content: string }>(
        'android_read_source_file',
        { payload: { uri: path } },
      )
      return response.content
    } catch (error) {
      if (!isAndroidSourceBridgeUnavailable(error)) {
        throw error
      }
    }
  }

  const fs = await import('@tauri-apps/plugin-fs')
  const fsPath = toTauriFsPath(path)
  try {
    return await fs.readTextFile(fsPath)
  } catch {
    const binary = await fs.readFile(fsPath)
    return decodeTextBytes(binary)
  }
}

async function writeTauriFile(path: string, content: string): Promise<void> {
  if (isAndroidContentUri(path)) {
    try {
      await invokeAndroidSourceFile('android_write_source_file', {
        payload: { uri: path, content },
      })
      return
    } catch (error) {
      if (!isAndroidSourceBridgeUnavailable(error)) {
        throw error
      }
    }
  }

  const fs = await import('@tauri-apps/plugin-fs')
  await fs.writeTextFile(toTauriFsPath(path), content)
}

async function invokeAndroidSourceFile<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core')
  return core.invoke<T>(command, args)
}

function decodeTextBytes(binary: Uint8Array): string {
  const decoders = [
    new TextDecoder('utf-8', { fatal: true }),
    new TextDecoder('utf-16le', { fatal: true }),
    new TextDecoder('utf-16be', { fatal: true }),
  ]

  for (const decoder of decoders) {
    try {
      return decoder.decode(binary)
    } catch {
      // Try the next encoding.
    }
  }

  // Last fallback: if bytes look textual, decode as permissive UTF-8.
  if (looksLikeText(binary)) {
    return new TextDecoder('utf-8').decode(binary)
  }

  throw new Error('Selected file is not valid UTF text. Pick a .org/.txt/.md text file.')
}

function triggerDownload(fileNameValue: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileNameValue
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function selectUploadSource(): Promise<{ source: SelectedUploadSource; content: string } | null> {
  const file = await selectFileWithInput()
  if (!file) return null

  const content = await file.text()
  return {
    source: {
      kind: 'upload',
      path: file.name,
      label: file.name,
      mode: 'download',
      content,
    },
    content,
  }
}

function selectFileWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.org,.txt,.md,text/plain'
    input.style.display = 'none'
    document.body.appendChild(input)

    const cleanup = () => {
      input.remove()
    }

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0] ?? null
        cleanup()
        resolve(file)
      },
      { once: true },
    )

    input.addEventListener(
      'cancel',
      () => {
        cleanup()
        resolve(null)
      },
      { once: true },
    )

    input.click()
  })
}

async function persistBrowserHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openHandleDb()
  if (!db) return

  await new Promise<void>((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY)
  })
}

async function loadPersistedBrowserHandle(): Promise<FileSystemFileHandle | null> {
  const db = await openHandleDb()
  if (!db) return null

  return new Promise((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    tx.onerror = () => resolve(null)
    const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY)
    req.onsuccess = () => {
      const handle = req.result
      resolve(isFileSystemFileHandle(handle) ? handle : null)
    }
    req.onerror = () => resolve(null)
  })
}

async function clearPersistedBrowserHandle(): Promise<void> {
  const db = await openHandleDb()
  if (!db) return

  await new Promise<void>((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY)
  })
}

function openHandleDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function isFileSystemFileHandle(value: unknown): value is FileSystemFileHandle {
  return typeof value === 'object' && value !== null && 'kind' in value && 'getFile' in value
}

function isMissingSourceError(error: unknown): boolean {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'NotFoundError'
  ) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('notfound') ||
    normalized.includes('not found') ||
    normalized.includes('no such file') ||
    normalized.includes('enoent') ||
    normalized.includes('os error 2') ||
    normalized.includes('could not be found') ||
    normalized.includes('does not exist') ||
    normalized.includes('cannot find')
  )
}

function isSourceAccessLostError(error: unknown): boolean {
  return isMissingSourceError(error) || isBrowserHandleAccessBlocked(error)
}

function isBrowserHandleAccessBlocked(error: unknown): boolean {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  ) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('not allowed by the user agent') ||
    normalized.includes('not allowed by the platform') ||
    (normalized.includes('current context') && normalized.includes('not allowed')) ||
    normalized.includes('permission denied') ||
    normalized.includes('not permitted') ||
    normalized.includes('user activation')
  )
}

function shouldUseUploadInputPicker(): boolean {
  return isMobileBrowser() || !isTopLevelWindow()
}

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent?.toLowerCase() ?? ''
  const platform = navigator.platform?.toLowerCase() ?? ''
  const maxTouchPoints = navigator.maxTouchPoints ?? 0
  return (
    /android|iphone|ipad|ipod|mobile/.test(userAgent) ||
    (platform === 'macintel' && maxTouchPoints > 1)
  )
}

function isTopLevelWindow(): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.self === window.top
  } catch {
    return false
  }
}

function detectMobilePlatform(): 'android' | 'ios' | 'other' {
  if (typeof navigator === 'undefined') {
    return 'other'
  }

  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('android')) return 'android'
  if (/iphone|ipad|ipod/.test(userAgent)) return 'ios'
  return 'other'
}

function isAndroidContentUri(path: string): boolean {
  return detectMobilePlatform() === 'android' && path.toLowerCase().startsWith('content://')
}

function isAndroidSourceBridgeUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('android source') && normalized.includes('only available on android') ||
    normalized.includes('android_select_source_file') && normalized.includes('not found') ||
    normalized.includes('android_read_source_file') && normalized.includes('not found') ||
    normalized.includes('android_write_source_file') && normalized.includes('not found') ||
    normalized.includes('command not found') ||
    normalized.includes('plugin not found')
  )
}

function looksLikeText(binary: Uint8Array): boolean {
  if (binary.length === 0) return true

  let nonTextCount = 0
  const sampleSize = Math.min(binary.length, 4096)

  for (let index = 0; index < sampleSize; index += 1) {
    const byte = binary[index]
    const isControl = byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d
    if (isControl || byte === 0x00) {
      nonTextCount += 1
    }
  }

  // Allow a small number of control bytes while still treating as text.
  return nonTextCount / sampleSize < 0.03
}

function toTauriFsPath(path: string): string | URL {
  if (!path.toLowerCase().startsWith('file://')) {
    return path
  }

  try {
    return new URL(path)
  } catch {
    return path
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
