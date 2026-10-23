import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SourceFileUnavailableError,
  SourceFileConflictError,
  createSourceBridge,
} from '../src/core/quicknote/source-bridge'

const tauri = vi.hoisted(() => ({
  isTauri: false,
  openResult: '/tmp/quicknote.org' as string | null,
  readTextFile: vi.fn(),
  readFile: vi.fn(),
  writeTextFile: vi.fn(),
  homeDir: vi.fn(),
  join: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => tauri.isTauri,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: () => Promise.resolve(tauri.openResult),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: tauri.readTextFile,
  readFile: tauri.readFile,
  writeTextFile: tauri.writeTextFile,
}))

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: tauri.homeDir,
  join: tauri.join,
}))

function textFile(name: string, text: string, lastModified = 1): File {
  return {
    name,
    lastModified,
    text: () => Promise.resolve(text),
  } as File
}

function installPicker(handle: FileSystemFileHandle) {
  const showOpenFilePicker = vi.fn().mockResolvedValue([handle])
  vi.stubGlobal('window', {
    showOpenFilePicker,
  })
  return showOpenFilePicker
}

function installInputFile(file: File | null) {
  const listeners = new Map<string, () => void>()
  const input = {
    type: '',
    accept: '',
    style: { display: '' },
    files: file ? [file] : [],
    addEventListener: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener)
    }),
    click: vi.fn(() => {
      listeners.get(file ? 'change' : 'cancel')?.()
    }),
    remove: vi.fn(),
  }
  const document = {
    createElement: vi.fn(() => input),
    body: {
      appendChild: vi.fn(),
    },
  }

  vi.stubGlobal('document', document)
  return { document, input }
}

function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  }
  vi.stubGlobal('localStorage', localStorage)
  return localStorage
}

const missingTauriFileError = () => new Error('No such file or directory (os error 2)')

describe('source bridge stale source handling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    tauri.isTauri = false
    tauri.openResult = '/tmp/quicknote.org'
    tauri.readTextFile.mockReset()
    tauri.readFile.mockReset()
    tauri.writeTextFile.mockReset()
    tauri.homeDir.mockReset()
    tauri.join.mockReset()
  })

  it('refuses to overwrite a source changed by device sync', async () => {
    tauri.isTauri = true
    installLocalStorage()
    tauri.readTextFile.mockResolvedValueOnce('original').mockResolvedValue('remote edit')
    const bridge = createSourceBridge()
    await bridge.selectFile()
    await expect(bridge.write('local edit', 'original')).rejects.toBeInstanceOf(SourceFileConflictError)
    expect(tauri.writeTextFile).not.toHaveBeenCalled()
    expect(bridge.summary()).not.toBeNull()
  })

  it('writes when the expected source still matches', async () => {
    tauri.isTauri = true
    installLocalStorage()
    tauri.readTextFile.mockResolvedValue('original')
    const bridge = createSourceBridge()
    await bridge.selectFile()
    await bridge.write('local edit', 'original')
    expect(tauri.writeTextFile).toHaveBeenCalledWith('/tmp/quicknote.org', 'local edit')
  })

  it('detects equal-length edits away from the old fingerprint positions', async () => {
    vi.useFakeTimers()
    tauri.isTauri = true
    installLocalStorage()
    tauri.readTextFile.mockResolvedValue('abcdefghij')
    const bridge = createSourceBridge()
    await bridge.selectFile()
    const changed = vi.fn()
    bridge.startWatching(changed)
    await vi.advanceTimersByTimeAsync(2000)
    tauri.readTextFile.mockResolvedValue('abXdefghij')
    await vi.advanceTimersByTimeAsync(2000)
    expect(changed).toHaveBeenCalledOnce()
    bridge.stopWatching()
  })

  it('detects browser file changes when modified timestamps match', async () => {
    vi.useFakeTimers()
    const getFile = vi.fn().mockResolvedValue(textFile('quicknote.org', 'original', 1))
    installPicker({ kind: 'file', getFile } as unknown as FileSystemFileHandle)
    const bridge = createSourceBridge()
    await bridge.selectFile()
    const changed = vi.fn()
    bridge.startWatching(changed)
    await vi.advanceTimersByTimeAsync(2000)
    getFile.mockResolvedValue(textFile('quicknote.org', 'modified', 1))
    await vi.advanceTimersByTimeAsync(2000)
    expect(changed).toHaveBeenCalledOnce()
    bridge.stopWatching()
  })

  it('clears the active source when a browser file handle no longer resolves', async () => {
    const handle = {
      kind: 'file',
      getFile: vi
        .fn()
        .mockResolvedValueOnce(textFile('quicknote.org', '* Note\nbody'))
        .mockRejectedValue(new DOMException('file not found', 'NotFoundError')),
    } as unknown as FileSystemFileHandle
    installPicker(handle)

    const bridge = createSourceBridge()

    const selected = await bridge.selectFile()
    expect(selected.summary.path).toBe('quicknote.org')

    await expect(bridge.read()).rejects.toBeInstanceOf(SourceFileUnavailableError)
    expect(bridge.summary()).toBeNull()
    await expect(bridge.read()).rejects.toThrow('No file selected')
  })

  it('notifies the watcher when the active browser source disappears', async () => {
    vi.useFakeTimers()

    const handle = {
      kind: 'file',
      getFile: vi
        .fn()
        .mockResolvedValueOnce(textFile('quicknote.org', '* Note\nbody'))
        .mockRejectedValue(new DOMException('file not found', 'NotFoundError')),
    } as unknown as FileSystemFileHandle
    installPicker(handle)

    const bridge = createSourceBridge()
    await bridge.selectFile()

    const onChanged = vi.fn()
    bridge.startWatching(onChanged)

    await vi.advanceTimersByTimeAsync(2000)

    expect(onChanged).toHaveBeenCalledTimes(1)
    bridge.stopWatching()
  })

  it('treats a missing browser source during selection as unavailable', async () => {
    const handle = {
      kind: 'file',
      name: 'quicknote.org',
      getFile: vi.fn().mockRejectedValue(new DOMException('file not found', 'NotFoundError')),
    } as unknown as FileSystemFileHandle
    installPicker(handle)

    const bridge = createSourceBridge()

    await expect(bridge.selectFile()).rejects.toBeInstanceOf(SourceFileUnavailableError)
    expect(bridge.summary()).toBeNull()
  })

  it('falls back to upload mode when browser file handles are blocked', async () => {
    const handle = {
      kind: 'file',
      name: 'quicknote.org',
      getFile: vi.fn().mockRejectedValue(
        new DOMException(
          'The request is not allowed by the user agent or the platform in the current context.',
          'NotAllowedError',
        ),
      ),
    } as unknown as FileSystemFileHandle
    installPicker(handle)
    installInputFile(textFile('fallback.org', '* Fallback\nbody'))

    const bridge = createSourceBridge()

    await expect(bridge.selectFile()).resolves.toMatchObject({
      summary: {
        path: 'fallback.org',
        writable: false,
        mode: 'download',
      },
      content: '* Fallback\nbody',
    })
  })

  it('uses upload mode on mobile browsers even when file handles exist', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })
    const handle = {
      kind: 'file',
      name: 'quicknote.org',
      getFile: vi.fn(),
    } as unknown as FileSystemFileHandle
    const showOpenFilePicker = installPicker(handle)
    installInputFile(textFile('mobile.org', '* Mobile\nbody'))

    const bridge = createSourceBridge()

    await expect(bridge.selectFile()).resolves.toMatchObject({
      summary: {
        path: 'mobile.org',
        writable: false,
        mode: 'download',
      },
      content: '* Mobile\nbody',
    })
    expect(showOpenFilePicker).not.toHaveBeenCalled()
  })

  it('treats Tauri os error 2 reads as a missing active source', async () => {
    tauri.isTauri = true
    installLocalStorage()
    tauri.readTextFile
      .mockResolvedValueOnce('* Note\nbody')
      .mockRejectedValue(missingTauriFileError())
    tauri.readFile.mockRejectedValue(missingTauriFileError())

    const bridge = createSourceBridge()

    await expect(bridge.selectFile()).resolves.toMatchObject({
      summary: { path: '/tmp/quicknote.org' },
    })

    await expect(bridge.read()).rejects.toBeInstanceOf(SourceFileUnavailableError)
    expect(bridge.summary()).toBeNull()
  })

  it('treats Tauri os error 2 during selection as unavailable', async () => {
    tauri.isTauri = true
    installLocalStorage()
    tauri.readTextFile.mockRejectedValue(missingTauriFileError())
    tauri.readFile.mockRejectedValue(missingTauriFileError())

    const bridge = createSourceBridge()

    await expect(bridge.selectFile()).rejects.toBeInstanceOf(SourceFileUnavailableError)
    expect(bridge.summary()).toBeNull()
  })

  it('treats Tauri os error 2 writes as a missing active source', async () => {
    tauri.isTauri = true
    installLocalStorage()
    tauri.readTextFile.mockResolvedValue('* Note\nbody')
    tauri.writeTextFile.mockRejectedValue(missingTauriFileError())

    const bridge = createSourceBridge()
    await bridge.selectFile()

    await expect(bridge.write('* Next\nbody')).rejects.toBeInstanceOf(SourceFileUnavailableError)
    expect(bridge.summary()).toBeNull()
  })

  it('does not restore a saved Tauri source path when every candidate is missing', async () => {
    const localStorage = installLocalStorage({
      'branch-continue:tauri-source-path': '/tmp/moved.org',
    })
    tauri.isTauri = true
    tauri.homeDir.mockResolvedValue('/Users/tester')
    tauri.join.mockImplementation((...parts: string[]) => Promise.resolve(parts.join('/')))
    tauri.readTextFile.mockRejectedValue(missingTauriFileError())
    tauri.readFile.mockRejectedValue(missingTauriFileError())

    const bridge = createSourceBridge()

    await expect(bridge.restoreLastSelection()).resolves.toBeNull()
    expect(bridge.summary()).toBeNull()
    expect(localStorage.removeItem).toHaveBeenCalledWith('branch-continue:tauri-source-path')
  })
})
