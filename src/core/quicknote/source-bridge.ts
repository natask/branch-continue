const TAURI_SOURCE_KEY = 'branch-continue:tauri-source-path'
const HANDLE_DB_NAME = 'branch-continue-source-db'
const HANDLE_STORE = 'source'
const HANDLE_KEY = 'browser-handle'
const DEFAULT_TAURI_SOURCE_PATH = import.meta.env.VITE_DEFAULT_SOURCE_PATH?.trim() ?? ''
const LEGACY_DEFAULT_RELATIVE_PATHS = [
  ['sync', 'markor', 'quicknote.org'],
  ['sync', 'markor', 'QuickNote.org'],
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

export interface SelectedFileResult {
  summary: SourceSummary
  content: string
}

export interface SourceBridge {
  selectFile(): Promise<SelectedFileResult>
  restoreLastSelection(): Promise<SelectedFileResult | null>
  read(): Promise<SelectedFileResult>
  write(content: string): Promise<void>
  summary(): SourceSummary | null
}

export function createSourceBridge(): SourceBridge {
  let active: ActiveSource | null = null

  return {
    async selectFile(): Promise<SelectedFileResult> {
      if (await isTauriRuntime()) {
        const selected = await selectTauriFile()
        if (!selected) {
          throw new SourceSelectionCancelledError()
        }

        const content = await readTauriFile(selected.path)
        active = selected
        localStorage.setItem(TAURI_SOURCE_KEY, selected.path)
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

        const file = await handle.getFile()
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

      const file = await selectFileWithInput()
      if (!file) {
        throw new SourceSelectionCancelledError()
      }

      const content = await file.text()
      const selected: SelectedUploadSource = {
        kind: 'upload',
        path: file.name,
        label: file.name,
        mode: 'download',
        content,
      }

      active = selected
      await clearPersistedBrowserHandle()
      return { summary: toSummary(selected), content }
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
            localStorage.setItem(TAURI_SOURCE_KEY, path)
            return { summary: toSummary(selected), content }
          } catch {
            // Try next candidate.
          }
        }

        localStorage.removeItem(TAURI_SOURCE_KEY)
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
        const content = await readTauriFile(active.path)
        return { summary: toSummary(active), content }
      }

      if (active.kind === 'filesystem-handle') {
        const file = await active.handle.getFile()
        active = {
          ...active,
          path: file.name,
          label: file.name,
        }
        return { summary: toSummary(active), content: await file.text() }
      }

      return { summary: toSummary(active), content: active.content }
    },

    async write(content: string): Promise<void> {
      if (!active) {
        throw new Error('No file selected. Choose a file first.')
      }

      if (active.kind === 'tauri') {
        await writeTauriFile(active.path, content)
        return
      }

      if (active.kind === 'filesystem-handle') {
        const writable = await active.handle.createWritable()
        await writable.write(content)
        await writable.close()
        return
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
  return (window as WindowWithFilePicker).showOpenFilePicker
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

  try {
    defaultPath = await pathApi.homeDir()
  } catch {
    defaultPath = undefined
  }

  const dialogOptions: Parameters<typeof dialog.open>[0] = {
    multiple: false,
    directory: false,
    defaultPath,
    pickerMode: 'document',
    // Android SAF paths are more reliable with copied files; iOS can use scoped access.
    fileAccessMode: mobilePlatform === 'android' ? 'copy' : 'scoped',
  }

  // Android uses MIME-based filtering; include octet-stream for providers that classify .org as unknown.
  if (mobilePlatform === 'android') {
    dialogOptions.filters = [
      {
        name: 'Org and text files',
        extensions: ['text/plain', 'text/markdown', 'application/octet-stream'],
      },
    ]
  } else {
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

  if (DEFAULT_TAURI_SOURCE_PATH) {
    pushUnique(await resolveTauriPath(DEFAULT_TAURI_SOURCE_PATH, homePath, pathApi))
    pushUnique(await resolveDefaultSourceWithinLegacyRoot(DEFAULT_TAURI_SOURCE_PATH, homePath, pathApi))
  }

  if (homePath) {
    for (const relativePath of LEGACY_DEFAULT_RELATIVE_PATHS) {
      pushUnique(await pathApi.join(homePath, ...relativePath))
    }
  }

  // Last-used file is fallback only; startup should prefer the default source.
  pushUnique(localStorage.getItem(TAURI_SOURCE_KEY))

  return candidates
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
  const fs = await import('@tauri-apps/plugin-fs')
  await fs.writeTextFile(toTauriFsPath(path), content)
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

function detectMobilePlatform(): 'android' | 'ios' | 'other' {
  if (typeof navigator === 'undefined') {
    return 'other'
  }

  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('android')) return 'android'
  if (/iphone|ipad|ipod/.test(userAgent)) return 'ios'
  return 'other'
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
