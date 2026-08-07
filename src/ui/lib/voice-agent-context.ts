import {
  extractAudioCaptureReferences,
  loadAudioCaptureSession,
  loadAudioTranscriptSegments,
  type AudioTranscriptSegment,
} from '../../core/audio/audio-store'

export const DEFAULT_RECOGNIZED_VOICE_AGENT_PROMPT = [
  'Analyze this recognized voice note.',
  'Extract its durable intent, identify the concrete problem or decision, and propose the smallest useful next action.',
].join(' ')

export interface RecognizedVoiceAgentContext {
  transcript: string
  audioReferences: string[]
  segmentCount: number
}

export async function loadRecognizedVoiceAgentContext(
  body: string,
  sourcePath: string,
  liveTranscript = '',
): Promise<RecognizedVoiceAgentContext> {
  const all = extractAudioCaptureReferences(body)
  const fileReferences = all.filter((reference) => reference.kind === 'file')
  const references = (fileReferences.length > 0 ? fileReferences : all).slice(0, 1)
  const records = []
  const loadedUris = new Set<string>()

  for (const reference of references) {
    const loaded = await loadAudioCaptureSession(reference, sourcePath).catch(() => [])
    for (const record of loaded) {
      const uri = record.uri ?? record.relativePath ?? record.path ?? record.id
      if (loadedUris.has(uri)) continue
      loadedUris.add(uri)
      records.push(record)
    }
  }

  const segments = records.length > 0
    ? await loadAudioTranscriptSegments(records, sourcePath).catch(() => [])
    : []

  return {
    transcript: mergeRecognizedVoiceTranscript(segments, liveTranscript),
    audioReferences: references.map((reference) => reference.uri),
    segmentCount: segments.length,
  }
}

export function mergeRecognizedVoiceTranscript(
  segments: Pick<AudioTranscriptSegment, 'text' | 'offsetMs' | 'segmentIndex'>[],
  liveTranscript = '',
): string {
  const ordered = [...segments]
    .sort((a, b) => a.offsetMs - b.offsetMs || a.segmentIndex - b.segmentIndex)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
  const live = liveTranscript.trim()
  if (live) ordered.push(live)

  let combined = ''
  for (const text of ordered) {
    if (!combined) {
      combined = text
      continue
    }
    const normalizedCombined = normalizeTranscriptForComparison(combined)
    const normalizedText = normalizeTranscriptForComparison(text)
    // Browser recognition often has the same words as the persisted Chirp
    // segments but with cleaner spacing. Prefer that complete copy when the
    // normalized text is identical.
    if (normalizedCombined === normalizedText) {
      combined = text
      continue
    }
    if (normalizedCombined.includes(normalizedText)) continue
    if (normalizedText.includes(normalizedCombined)) {
      combined = text
      continue
    }
    combined = `${combined}\n\n${text}`
  }
  return combined
}

function normalizeTranscriptForComparison(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function appendRecognizedVoiceContext(documentText: string, transcript: string): string {
  const document = documentText.trim()
  const recognized = transcript.trim()
  if (!recognized) return documentText
  return [document, 'Recognized voice transcript:', recognized].filter(Boolean).join('\n\n')
}
