export const VOICE_TRANSCRIPT_HEADING = 'Voice transcript:'

export interface VoiceTranscriptCue {
  uri: string
  timeMs: number
  label: string
  text: string
}

export function appendVoiceTranscriptSegment(body: string, segment: string): string {
  const cleanSegment = cleanVoiceTranscriptSegment(segment)
  if (!cleanSegment) return body

  const trimmedBody = body.trimEnd()
  if (!trimmedBody) return `${VOICE_TRANSCRIPT_HEADING}\n${cleanSegment}`

  if (trimmedBody.includes(VOICE_TRANSCRIPT_HEADING)) {
    return `${trimmedBody}\n${cleanSegment}`
  }

  return `${trimmedBody}\n\n${VOICE_TRANSCRIPT_HEADING}\n${cleanSegment}`
}

export function appendAudioCaptureReference(body: string, uri: string): string {
  const cleanUri = uri.trim()
  if (!cleanUri) return body

  // A recording session is represented by exactly one note reference. Older
  // versions appended every MediaRecorder chunk; collapse those lines while
  // retaining the first (canonical) recording for backwards compatibility.
  const existingLines = body.trimEnd().split('\n')
  const firstAudioIndex = existingLines.findIndex((line) => /^\s*Audio recording:\s+/i.test(line))
  if (firstAudioIndex >= 0) {
    const withoutDuplicateAudioLines = existingLines.filter((line, index) => {
      if (!/^\s*Audio recording:\s+/i.test(line)) return true
      return index === firstAudioIndex
    })
    return withoutDuplicateAudioLines.join('\n').trimEnd()
  }

  const trimmedBody = body.trimEnd()
  const line = formatAudioCaptureReferenceLine(cleanUri)
  return trimmedBody ? `${trimmedBody}\n\n${line}` : line
}

export function upsertAudioCaptureReference(body: string, uri: string): string {
  const cleanUri = uri.trim()
  if (!cleanUri) return body

  const nextLines = body
    .trimEnd()
    .split('\n')
    .filter((line) => !/^\s*Audio recording:\s+/i.test(line))
  const withoutOldReferences = nextLines.join('\n').trimEnd()
  const line = formatAudioCaptureReferenceLine(cleanUri)
  return withoutOldReferences ? `${withoutOldReferences}\n\n${line}` : line
}

export function appendVoiceTranscriptAfterAudioCaptureReference(
  body: string,
  uri: string,
  segment: string,
  offsetMs?: number,
): string {
  const cleanUri = uri.trim()
  const cleanSegment = formatVoiceTranscriptSegment(segment, offsetMs)
  if (!cleanUri || !cleanSegment) return body

  const lines = body.trimEnd().split('\n')
  const lineIndex = lines.findIndex((line) => line.includes(cleanUri))
  if (lineIndex < 0) return appendVoiceTranscriptSegment(body, cleanSegment)

  if (lines[lineIndex + 1]?.trim() === VOICE_TRANSCRIPT_HEADING) {
    let insertIndex = lineIndex + 2
    while (insertIndex < lines.length) {
      const line = lines[insertIndex]?.trim() ?? ''
      if (!line || /^Audio recording:/i.test(line)) break
      insertIndex += 1
    }
    lines.splice(insertIndex, 0, cleanSegment)
    return lines.join('\n')
  }

  lines.splice(lineIndex + 1, 0, VOICE_TRANSCRIPT_HEADING, cleanSegment)
  return lines.join('\n')
}

export function cleanVoiceTranscriptSegment(segment: string): string {
  return segment.replace(/\s+/g, ' ').trim()
}

export function formatVoiceTranscriptSegment(segment: string, offsetMs?: number): string {
  const cleanSegment = cleanVoiceTranscriptSegment(segment)
  if (!cleanSegment) return ''
  if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) return cleanSegment
  return `[${formatTranscriptTime(offsetMs)}] ${cleanSegment}`
}

export function extractVoiceTranscriptCues(body: string): VoiceTranscriptCue[] {
  const cues: VoiceTranscriptCue[] = []
  let currentUri = ''

  for (const line of body.split('\n')) {
    const audioMatch = line.match(/^\s*Audio recording:\s+(.+)$/i)
    if (audioMatch) {
      currentUri = normalizeAudioReferenceText(audioMatch[1] ?? '')
      continue
    }

    if (!currentUri) continue
    const cue = parseTranscriptCueLine(line)
    if (!cue) continue
    cues.push({ uri: currentUri, ...cue })
  }

  return cues
}

function formatAudioCaptureReferenceLine(uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return `Audio recording: ${uri}`
  return `Audio recording: [${audioCaptureLabel(uri)}](${uri})`
}

function normalizeAudioReferenceText(value: string): string {
  const trimmed = value.trim().replace(/^<(.+)>$/, '$1')
  const markdownMatch = trimmed.match(/^\[[^\]]*\]\(([^)]+)\)/)
  return (markdownMatch?.[1] ?? trimmed).trim().split(/\s+/)[0] ?? ''
}

function parseTranscriptCueLine(line: string): Omit<VoiceTranscriptCue, 'uri'> | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s+(.+)$/)
  if (!match) return null
  const label = match[1]?.trim() ?? ''
  const text = match[2]?.trim() ?? ''
  const timeMs = parseVoiceTranscriptTime(label)
  if (!text || timeMs === null) return null
  return { timeMs, label, text }
}

export function parseVoiceTranscriptTime(value: string): number | null {
  const parts = value.split(':').map((part) => part.trim())
  if (parts.length < 2 || parts.length > 3) return null

  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null

  const [hoursOrMinutes, minutesOrSeconds, maybeSeconds] = numbers
  const totalSeconds = maybeSeconds === undefined
    ? (hoursOrMinutes * 60) + minutesOrSeconds
    : (hoursOrMinutes * 3600) + (minutesOrSeconds * 60) + maybeSeconds
  return Math.round(totalSeconds * 1000)
}

function formatTranscriptTime(offsetMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(offsetMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
  return `${minutes}:${seconds}`
}

function audioCaptureLabel(uri: string): string {
  const normalized = uri.split('\\').join('/')
  return normalized.split('/').pop() || 'audio recording'
}
