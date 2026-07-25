export type VoiceRecordingTranscriptionMode = 'chirp3' | 'off'
export type VoiceTranscriptInsertMode = 'append' | 'replace-selection'

export interface VoiceRecordingConfig {
  schemaVersion: 2
  transcriptionPrompt: string
  transcriptionMode: VoiceRecordingTranscriptionMode
  projectId: string
  location: string
  serviceAccountKeyPath: string
  insertMode: VoiceTranscriptInsertMode
}

export const VOICE_RECORDING_CONFIG_KEY = 'branch-continue:voice-recording-config:v1'

export const DEFAULT_VOICE_TRANSCRIPTION_PROMPT = [
  'This voice note may contain English and Amharic.',
  'Preserve the language and script actually spoken; do not translate.',
  'The speaker may use engineering or mathematical terms, acronyms, and proper names; use that context only to resolve ambiguous words, and do not invent technical vocabulary.',
  'Use normal punctuation and output only the transcript.',
].join(' ')

export const DEFAULT_VOICE_RECORDING_CONFIG: VoiceRecordingConfig = {
  schemaVersion: 2,
  transcriptionPrompt: DEFAULT_VOICE_TRANSCRIPTION_PROMPT,
  transcriptionMode: 'chirp3',
  projectId: import.meta.env.VITE_GCP_PROJECT_ID?.trim() || '',
  location: import.meta.env.VITE_GCP_LOCATION?.trim() || 'us',
  serviceAccountKeyPath: '',
  insertMode: 'append',
}

export function resolveInitialVoiceRecordingConfig(): VoiceRecordingConfig {
  if (typeof window === 'undefined') return DEFAULT_VOICE_RECORDING_CONFIG

  try {
    const raw = window.localStorage.getItem(VOICE_RECORDING_CONFIG_KEY)
    if (!raw) return DEFAULT_VOICE_RECORDING_CONFIG
    return normalizeVoiceRecordingConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_VOICE_RECORDING_CONFIG
  }
}

export function persistVoiceRecordingConfig(config: VoiceRecordingConfig): void {
  try {
    window.localStorage.setItem(VOICE_RECORDING_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Local storage can be disabled; recording should still work for this session.
  }
}

export function normalizeVoiceRecordingConfig(value: unknown): VoiceRecordingConfig {
  const record = isRecord(value) ? value : {}

  return {
    schemaVersion: 2,
    transcriptionPrompt: record.schemaVersion === 2
      ? stringOrDefault(record.transcriptionPrompt, DEFAULT_VOICE_TRANSCRIPTION_PROMPT)
      : DEFAULT_VOICE_TRANSCRIPTION_PROMPT,
    transcriptionMode: normalizeTranscriptionMode(record.transcriptionMode),
    projectId: stringOrDefault(record.projectId, DEFAULT_VOICE_RECORDING_CONFIG.projectId),
    location: stringOrDefault(record.location, DEFAULT_VOICE_RECORDING_CONFIG.location),
    serviceAccountKeyPath: stringOrDefault(record.serviceAccountKeyPath, ''),
    insertMode: normalizeInsertMode(record.insertMode),
  }
}

function normalizeTranscriptionMode(value: unknown): VoiceRecordingTranscriptionMode {
  if (value === 'chirp3' || value === 'off') return value
  if (value === 'native') return 'chirp3'
  return DEFAULT_VOICE_RECORDING_CONFIG.transcriptionMode
}

function normalizeInsertMode(value: unknown): VoiceTranscriptInsertMode {
  if (value === 'append' || value === 'replace-selection') return value
  return DEFAULT_VOICE_RECORDING_CONFIG.insertMode
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
