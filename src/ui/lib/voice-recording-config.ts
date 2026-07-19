export type VoiceRecordingTranscriptionMode = 'chirp3' | 'off'
export type VoiceTranscriptInsertMode = 'append' | 'replace-selection'

export interface VoiceRecordingConfig {
  languageCode: string
  spokenLanguageCodes: string[]
  transcriptionPrompt: string
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

const PREVIOUS_VOICE_TRANSCRIPTION_PROMPT = [
  'Transcribe this personal voice note faithfully.',
  'The speaker uses English and Amharic and may switch naturally between them.',
  'Preserve the language and script actually spoken; do not translate.',
  'Preserve names and technical terms as spoken.',
  'Use normal punctuation and output only the transcript with no commentary or newlines.',
].join(' ')

export const DEFAULT_VOICE_TRANSCRIPTION_PROMPT = [
  'Transcribe this personal voice note faithfully.',
  'The speaker uses English and Amharic and may switch naturally between them.',
  'Preserve the language and script actually spoken; do not translate.',
  'The speaker commonly uses a technical and academic register, especially computer science, software, systems, engineering, mathematics, frequency-domain concepts, and technical analogies.',
  'Prefer contextually correct technical terms, notation, acronyms, proper names, and mathematical vocabulary over phonetically similar everyday words, but do not invent jargon that was not spoken.',
  'Use normal punctuation and output only the transcript with no commentary or newlines.',
].join(' ')

export const DEFAULT_VOICE_RECORDING_CONFIG: VoiceRecordingConfig = {
  languageCode: 'en-US',
  spokenLanguageCodes: PRIMARY_VOICE_LANGUAGE_OPTIONS.map((option) => option.code),
  transcriptionPrompt: DEFAULT_VOICE_TRANSCRIPTION_PROMPT,
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
    spokenLanguageCodes: normalizeSpokenLanguageCodes(record.spokenLanguageCodes, languageCode),
    transcriptionPrompt: normalizeTranscriptionPrompt(record.transcriptionPrompt),
    transcriptionMode,
    projectId: stringOrDefault(record.projectId, DEFAULT_VOICE_RECORDING_CONFIG.projectId),
    location: stringOrDefault(record.location, DEFAULT_VOICE_RECORDING_CONFIG.location),
    model: normalizeChirpModel(record.model),
    serviceAccountKeyPath: stringOrDefault(record.serviceAccountKeyPath, ''),
    insertMode,
  }
}

function normalizeTranscriptionPrompt(value: unknown): string {
  if (typeof value !== 'string' || value === PREVIOUS_VOICE_TRANSCRIPTION_PROMPT) {
    return DEFAULT_VOICE_TRANSCRIPTION_PROMPT
  }
  return value
}

function normalizeSpokenLanguageCodes(value: unknown, fallbackLanguageCode: string): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_VOICE_RECORDING_CONFIG.spokenLanguageCodes
  }

  const supportedCodes = new Set(VOICE_LANGUAGE_OPTIONS.map((option) => option.code))
  const normalized = value
    .filter((code): code is string => typeof code === 'string')
    .map((code) => code.trim())
    .filter((code, index, codes) => supportedCodes.has(code) && codes.indexOf(code) === index)
    .slice(0, 3)

  return normalized.length > 0 ? normalized : [fallbackLanguageCode]
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
