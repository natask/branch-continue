export type VoiceRecordingTranscriptionMode = 'chirp3' | 'off'
export type VoiceTranscriptInsertMode = 'append' | 'replace-selection'

export interface VoiceRecordingConfig {
  languageCode: string
  transcriptionMode: VoiceRecordingTranscriptionMode
  projectId: string
  location: string
  model: string
  serviceAccountKeyPath: string
  insertMode: VoiceTranscriptInsertMode
}

export const VOICE_RECORDING_CONFIG_KEY = 'branch-continue:voice-recording-config:v1'
export const CHIRP_3_MODEL = 'chirp_3'
export const CHIRP_2_MODEL = 'chirp_2'

export const VOICE_TRANSCRIPTION_MODEL_OPTIONS = [
  { model: CHIRP_3_MODEL, label: 'Chirp 3 (Speech-to-Text V2)' },
  { model: CHIRP_2_MODEL, label: 'Chirp 2 (legacy)' },
]

export const VOICE_LANGUAGE_OPTIONS = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'am-ET', label: 'Amharic' },
  { code: 'ti-ET', label: 'Tigrinya' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
]

export const PRIMARY_VOICE_LANGUAGE_OPTIONS = [
  { code: 'en-US', label: 'English', shortLabel: 'EN', flag: '🇺🇸' },
  { code: 'am-ET', label: 'Amharic', shortLabel: 'AM', flag: '🇪🇹' },
]

export const DEFAULT_VOICE_RECORDING_CONFIG: VoiceRecordingConfig = {
  languageCode: 'en-US',
  transcriptionMode: 'chirp3',
  projectId: import.meta.env.VITE_GCP_PROJECT_ID?.trim() || '',
  location: import.meta.env.VITE_GCP_LOCATION?.trim() || 'us',
  model: normalizeChirpModel(import.meta.env.VITE_CHIRP_MODEL),
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
  const languageCode = stringOrDefault(record.languageCode, DEFAULT_VOICE_RECORDING_CONFIG.languageCode)
  const transcriptionMode = normalizeTranscriptionMode(record.transcriptionMode)
  const insertMode = normalizeInsertMode(record.insertMode)

  return {
    languageCode,
    transcriptionMode,
    projectId: stringOrDefault(record.projectId, DEFAULT_VOICE_RECORDING_CONFIG.projectId),
    location: stringOrDefault(record.location, DEFAULT_VOICE_RECORDING_CONFIG.location),
    model: normalizeChirpModel(record.model),
    serviceAccountKeyPath: stringOrDefault(record.serviceAccountKeyPath, ''),
    insertMode,
  }
}

export function voiceLanguageLabel(languageCode: string): string {
  return VOICE_LANGUAGE_OPTIONS.find((option) => option.code === languageCode)?.label ?? languageCode
}

export function voiceModelLabel(model: string): string {
  return VOICE_TRANSCRIPTION_MODEL_OPTIONS.find((option) => option.model === model)?.label ?? model
}

function normalizeTranscriptionMode(value: unknown): VoiceRecordingTranscriptionMode {
  if (value === 'chirp3' || value === 'off') return value
  if (value === 'native') return 'chirp3'
  return DEFAULT_VOICE_RECORDING_CONFIG.transcriptionMode
}

function normalizeChirpModel(value: unknown): string {
  if (value === CHIRP_3_MODEL || value === CHIRP_2_MODEL) return value
  return CHIRP_3_MODEL
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
