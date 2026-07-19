export const TRANSCRIPT_BLOCK_MAX_MS = 30_000
export const TRANSCRIPT_PAUSE_BREAK_MS = 2_500

export interface TimedTranscriptWord {
  text: string
  startMs: number
  endMs?: number
}

export interface TimedTranscriptCue {
  key: string
  text: string
  startMs: number
  endMs?: number
  words?: TimedTranscriptWord[]
}

export interface TranscriptWordAnchor extends TimedTranscriptWord {
  key: string
  timing: 'word' | 'cue'
}

export interface TranscriptEvidenceBlock {
  id: string
  startMs: number
  endMs: number
  title: string
  text: string
  words: TranscriptWordAnchor[]
  cueKeys: string[]
}

interface MutableEvidenceBlock {
  cues: TimedTranscriptCue[]
  startMs: number
  endMs: number
}

/**
 * Creates deterministic, extractive idea/evidence blocks from transcript cues.
 * A block never spans more than 30 seconds of cue starts and also breaks at a
 * meaningful silence. This deliberately does not claim to be an AI summary:
 * its title is copied from the first sentence of the evidence.
 */
export function buildTranscriptEvidenceBlocks(
  cues: TimedTranscriptCue[],
  options: { maxBlockMs?: number; pauseBreakMs?: number } = {},
): TranscriptEvidenceBlock[] {
  const maxBlockMs = positiveOption(options.maxBlockMs, TRANSCRIPT_BLOCK_MAX_MS)
  const pauseBreakMs = positiveOption(options.pauseBreakMs, TRANSCRIPT_PAUSE_BREAK_MS)
  const ordered = cues
    .filter((cue) => cue.text.trim() && Number.isFinite(cue.startMs))
    .map(normalizeCue)
    .sort((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key))

  const groups: MutableEvidenceBlock[] = []
  for (let index = 0; index < ordered.length; index += 1) {
    const cue = ordered[index]
    if (!cue) continue
    const nextCue = ordered[index + 1]
    const cueEndMs = resolvedCueEnd(cue, nextCue?.startMs, maxBlockMs)
    const current = groups[groups.length - 1]
    const previousCue = current?.cues[current.cues.length - 1]
    const previousEndMs = previousCue
      ? resolvedCueEnd(previousCue, cue.startMs, maxBlockMs)
      : cue.startMs
    const startsNewBlock = !current
      || cue.startMs - current.startMs >= maxBlockMs
      || cue.startMs - previousEndMs >= pauseBreakMs

    if (startsNewBlock) {
      groups.push({ cues: [cue], startMs: cue.startMs, endMs: cueEndMs })
    } else {
      current.cues.push(cue)
      current.endMs = Math.max(current.endMs, cueEndMs)
    }
  }

  return groups.map((group, index) => evidenceBlockFromGroup(group, index))
}

export function formatTranscriptRange(startMs: number, endMs: number): string {
  const start = formatTranscriptClock(startMs)
  const end = formatTranscriptClock(Math.max(startMs, endMs))
  return start === end ? start : `${start}–${end}`
}

function evidenceBlockFromGroup(group: MutableEvidenceBlock, index: number): TranscriptEvidenceBlock {
  const text = group.cues.map((cue) => cue.text.trim()).join(' ').replace(/\s+/g, ' ').trim()
  return {
    id: `evidence-${index}-${group.startMs}`,
    startMs: group.startMs,
    endMs: group.endMs,
    title: extractiveTitle(text),
    text,
    words: group.cues.flatMap(wordAnchorsFromCue),
    cueKeys: group.cues.map((cue) => cue.key),
  }
}

function wordAnchorsFromCue(cue: TimedTranscriptCue): TranscriptWordAnchor[] {
  if (cue.words?.length) {
    return cue.words
      .filter((word) => word.text.trim() && Number.isFinite(word.startMs))
      .map((word, index) => ({
        key: `${cue.key}:word:${index}:${word.startMs}`,
        text: word.text,
        startMs: Math.max(cue.startMs, word.startMs),
        endMs: word.endMs,
        timing: 'word' as const,
      }))
  }

  return tokenize(cue.text).map((text, index) => ({
    key: `${cue.key}:cue-word:${index}`,
    text,
    startMs: cue.startMs,
    endMs: cue.endMs,
    timing: 'cue' as const,
  }))
}

function normalizeCue(cue: TimedTranscriptCue): TimedTranscriptCue {
  const startMs = Math.max(0, Math.round(cue.startMs))
  const endMs = typeof cue.endMs === 'number' && Number.isFinite(cue.endMs)
    ? Math.max(startMs, Math.round(cue.endMs))
    : undefined
  return { ...cue, text: cue.text.replace(/\s+/g, ' ').trim(), startMs, endMs }
}

function resolvedCueEnd(cue: TimedTranscriptCue, nextStartMs: number | undefined, maxBlockMs: number): number {
  if (typeof cue.endMs === 'number' && cue.endMs > cue.startMs) return cue.endMs
  if (typeof nextStartMs === 'number' && nextStartMs > cue.startMs) {
    return Math.min(nextStartMs, cue.startMs + maxBlockMs)
  }
  const spokenEstimateMs = Math.max(1_000, tokenize(cue.text).length * 360)
  return cue.startMs + Math.min(spokenEstimateMs, maxBlockMs)
}

function extractiveTitle(text: string): string {
  const sentence = text.match(/^.+?(?:[.!?](?=\s|$)|$)/)?.[0]?.trim() || text
  if (sentence.length <= 120) return sentence
  const short = sentence.slice(0, 117).replace(/\s+\S*$/, '').trimEnd()
  return `${short || sentence.slice(0, 117)}…`
}

function tokenize(text: string): string[] {
  return text.trim().match(/\S+/g) ?? []
}

function positiveOption(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function formatTranscriptClock(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
  return `${minutes}:${seconds}`
}
