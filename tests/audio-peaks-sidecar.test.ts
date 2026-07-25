import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  audioCaptureUri,
  loadAudioCapturePeaks,
  normalizeAudioCapturePeaks,
  saveAudioCapturePeaks,
  type AudioCaptureRecord,
  type SaveAudioCaptureResult,
} from '../src/core/audio/audio-store'

interface FakeRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onupgradeneeded?: (() => void) | null
}

function settle<T>(compute: () => T): FakeRequest<T> {
  const request: FakeRequest<T> = {
    result: undefined as T,
    error: null,
    onsuccess: null,
    onerror: null,
  }
  queueMicrotask(() => {
    request.result = compute()
    request.onsuccess?.()
  })
  return request
}

/** Minimal stand-in for the pieces of IndexedDB that audio-store touches. */
function createFakeIndexedDb() {
  const stores = new Map<string, Map<string, { id: string }>>()
  const objectStore = (name: string) => {
    const store = stores.get(name) ?? new Map<string, { id: string }>()
    stores.set(name, store)
    return {
      put: (value: { id: string }) => settle(() => {
        store.set(value.id, value)
        return value.id
      }),
      get: (key: string) => settle(() => store.get(key)),
      getAll: () => settle(() => Array.from(store.values())),
    }
  }
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => objectStore(name),
    transaction: () => ({ objectStore }),
  }

  return {
    stores,
    open: () => {
      const request: FakeRequest<typeof db> = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      }
      queueMicrotask(() => {
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

const savedCapture: SaveAudioCaptureResult = {
  id: 'audio-peaks-1',
  mimeType: 'audio/webm;codecs=opus',
  createdAt: '2026-07-25T00:00:00.000Z',
  durationMs: 1_000,
  uri: audioCaptureUri('audio-peaks-1'),
  storage: 'indexed-db',
}

const storedRecord: AudioCaptureRecord = {
  id: 'audio-peaks-1',
  blob: new Blob([new Uint8Array([1])], { type: 'audio/webm' }),
  mimeType: 'audio/webm;codecs=opus',
  createdAt: '2026-07-25T00:00:00.000Z',
  durationMs: 1_000,
  uri: audioCaptureUri('audio-peaks-1'),
  storage: 'indexed-db',
}

let fakeIndexedDb: ReturnType<typeof createFakeIndexedDb>

beforeEach(() => {
  fakeIndexedDb = createFakeIndexedDb()
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb, configurable: true })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB')
})

describe('audio capture peaks sidecar', () => {
  it('round-trips a saved envelope for the recording it belongs to', async () => {
    const peaks = [0, 0.25, 0.5, 1]

    const saved = await saveAudioCapturePeaks({
      audio: savedCapture,
      peaksPerSecond: 20,
      durationMs: 1_000,
      peaks,
    })
    const loaded = await loadAudioCapturePeaks(storedRecord)

    expect(saved?.audioUri).toBe(savedCapture.uri)
    expect(loaded).toEqual({
      audioUri: savedCapture.uri,
      peaksPerSecond: 20,
      durationMs: 1_000,
      peaks,
    })
  })

  it('returns nothing for a recording with no sidecar', async () => {
    expect(await loadAudioCapturePeaks({ ...storedRecord, uri: audioCaptureUri('audio-missing') })).toBeNull()
  })

  it('refuses to store an envelope that cannot be placed on a timeline', async () => {
    expect(await saveAudioCapturePeaks({ audio: savedCapture, peaksPerSecond: 20, durationMs: 0, peaks: [0.5] })).toBeNull()
    expect(await saveAudioCapturePeaks({ audio: savedCapture, peaksPerSecond: 0, durationMs: 1_000, peaks: [0.5] })).toBeNull()
    expect(await saveAudioCapturePeaks({ audio: savedCapture, peaksPerSecond: 20, durationMs: 1_000, peaks: [] })).toBeNull()
    expect(fakeIndexedDb.stores.get('peaks')?.size ?? 0).toBe(0)
  })

  it('clamps values read back from a hand-edited sidecar', () => {
    expect(normalizeAudioCapturePeaks({
      audioUri: 'recordings/audio-1.webm',
      peaksPerSecond: 20.4,
      durationMs: 1_000.6,
      peaks: [-0.5, 4, 'loud', 0.25],
    })).toEqual({
      audioUri: 'recordings/audio-1.webm',
      peaksPerSecond: 20,
      durationMs: 1_001,
      peaks: [0.5, 1, 0, 0.25],
    })
  })
})
