import type { VoiceRecordingConfig } from '../../ui/lib/voice-recording-config'

interface TranscribeAudioWithChirpOptions {
  blob: Blob
  mimeType: string
  config: VoiceRecordingConfig
}

export interface ChirpTranscriptionWord {
  text: string
  startMs: number
  endMs: number
}

export interface ChirpTranscriptionResult {
  transcript: string
  words: ChirpTranscriptionWord[]
}

interface ChirpTranscriptionResponse {
  transcript?: unknown
  words?: unknown
}

export async function transcribeAudioWithChirp({
  blob,
  mimeType,
  config,
}: TranscribeAudioWithChirpOptions): Promise<ChirpTranscriptionResult> {
  if (config.transcriptionMode === 'off') return { transcript: '', words: [] }

  const audioBase64 = uint8ToBase64(new Uint8Array(await blob.arrayBuffer()))
  const payload = {
    audioBase64,
    languageCode: config.languageCode,
    languageCodes: config.spokenLanguageCodes,
    customPrompt: config.transcriptionPrompt,
    transcriptionEngine: config.model || 'chirp_3',
    mimeType,
    projectId: config.projectId || undefined,
    location: config.location || undefined,
    model: config.model || 'chirp_3',
    serviceAccountKeyPath: config.serviceAccountKeyPath || undefined,
  }

  return transcribeViaTauri(payload)
}

async function transcribeViaTauri(payload: Record<string, unknown>): Promise<ChirpTranscriptionResult> {
  const core = await import('@tauri-apps/api/core')
  if (!await core.isTauri()) {
    throw new Error('Chirp 3 transcription runs inside the installed desktop app.')
  }

  const result = await core.invoke<ChirpTranscriptionResponse>('transcribe_with_chirp', { payload })
  return normalizeChirpTranscriptionResponse(result)
}

export function normalizeChirpTranscriptionResponse(value: unknown): ChirpTranscriptionResult {
  if (!isRecord(value)) return { transcript: '', words: [] }
  const transcript = typeof value.transcript === 'string' ? value.transcript.trim() : ''
  const words = Array.isArray(value.words)
    ? value.words.flatMap((word): ChirpTranscriptionWord[] => {
      if (!isRecord(word) || typeof word.text !== 'string') return []
      const text = word.text.trim()
      const startMs = finiteMilliseconds(word.startMs)
      const endMs = finiteMilliseconds(word.endMs)
      if (!text || startMs === null) return []
      return [{ text, startMs, endMs: Math.max(startMs, endMs ?? startMs) }]
    })
    : []
  return { transcript, words }
}

function finiteMilliseconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
