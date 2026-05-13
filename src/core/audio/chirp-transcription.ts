import type { VoiceRecordingConfig } from '../../ui/lib/voice-recording-config'

interface TranscribeAudioWithChirpOptions {
  blob: Blob
  mimeType: string
  config: VoiceRecordingConfig
}

interface ChirpTranscriptionResponse {
  transcript?: string
}

export async function transcribeAudioWithChirp({
  blob,
  mimeType,
  config,
}: TranscribeAudioWithChirpOptions): Promise<string> {
  if (config.transcriptionMode === 'off') return ''

  const audioBase64 = uint8ToBase64(new Uint8Array(await blob.arrayBuffer()))
  const payload = {
    audioBase64,
    languageCode: config.languageCode,
    transcriptionEngine: config.model || 'chirp_3',
    mimeType,
    projectId: config.projectId || undefined,
    location: config.location || undefined,
    model: config.model || 'chirp_3',
    serviceAccountKeyPath: config.serviceAccountKeyPath || undefined,
  }

  return transcribeViaTauri(payload)
}

async function transcribeViaTauri(payload: Record<string, unknown>): Promise<string> {
  const core = await import('@tauri-apps/api/core')
  if (!await core.isTauri()) {
    throw new Error('Chirp 3 transcription runs inside the installed desktop app.')
  }

  const result = await core.invoke<ChirpTranscriptionResponse>('transcribe_with_chirp', { payload })
  return normalizeTranscript(result.transcript)
}

function normalizeTranscript(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
