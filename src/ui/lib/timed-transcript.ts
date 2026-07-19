export interface TimedTranscriptWord {
  text: string
  startMs: number
  endMs: number
  approximate?: boolean
}

export interface TimedTranscriptCue {
  key: string
  timeMs: number
  text: string
  durationMs?: number
  words?: TimedTranscriptWord[]
}

export interface TimedTranscriptBlock {
  key: string
  startMs: number
  endMs: number
  words: TimedTranscriptWord[]
}

export interface GroupTimedTranscriptOptions {
  gapMs?: number
  maxBlockMs?: number
}

const DEFAULT_SPEECH_GAP_MS = 1_200
const DEFAULT_MAX_BLOCK_MS = 30_000
const DEFAULT_WORD_MS = 320

/**
 * Makes one session-wide word stream and splits it at meaningful silence. A
 * block is also capped at 30 seconds so long dictation remains easy to scan.
 */
export function groupTimedTranscript(
  cues: TimedTranscriptCue[],
  options: GroupTimedTranscriptOptions = {},
): TimedTranscriptBlock[] {
  const words = cues
    .flatMap((cue, index) => wordsForCue(cue, cues[index + 1]))
    .filter(isUsableWord)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  if (words.length === 0) return []

  const gapMs = Math.max(0, options.gapMs ?? DEFAULT_SPEECH_GAP_MS)
  const maxBlockMs = Math.max(1_000, options.maxBlockMs ?? DEFAULT_MAX_BLOCK_MS)
  const blocks: TimedTranscriptBlock[] = []
  let blockWords: TimedTranscriptWord[] = []
  let blockStartMs = 0
  let previousEndMs = 0

  const finishBlock = () => {
    const first = blockWords[0]
    const last = blockWords[blockWords.length - 1]
    if (!first || !last) return
    blocks.push({
      key: `${first.startMs}:${blocks.length}`,
      startMs: first.startMs,
      endMs: Math.max(first.startMs, last.endMs),
      words: blockWords,
    })
    blockWords = []
  }

  for (const word of words) {
    const startsAfterGap = blockWords.length > 0 && word.startMs - previousEndMs >= gapMs
    const exceedsMaximum = blockWords.length > 0 && word.startMs - blockStartMs >= maxBlockMs
    if (startsAfterGap || exceedsMaximum) finishBlock()
    if (blockWords.length === 0) blockStartMs = word.startMs
    blockWords.push(word)
    previousEndMs = Math.max(word.startMs, word.endMs)
  }
  finishBlock()
  return blocks
}

/**
 * Drops cues that start at or after the audio's actual duration. A mismatched
 * recorder-to-assembled time remap (or a stale legacy inline cue) otherwise
 * anchors leftover transcript text past the end of the real waveform, showing
 * speech in a stretch that has no audio behind it.
 */
export function clampTranscriptCuesToDuration<T extends { timeMs: number }>(
  cues: T[],
  durationMs: number,
): T[] {
  if (!(durationMs > 0)) return cues
  return cues.filter((cue) => cue.timeMs < durationMs)
}

export function formatTimedTranscriptTime(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

/** Formats the complete raw session for pasting into notes or other apps. */
export function formatTimedTranscriptForClipboard(blocks: TimedTranscriptBlock[]): string {
  return blocks
    .map((block) => `[${formatTimedTranscriptTime(block.startMs)}] ${joinTimedTranscriptWords(block.words)}`)
    .filter((block) => !/\]\s*$/.test(block))
    .join('\n\n')
}

export function joinTimedTranscriptWords(words: Pick<TimedTranscriptWord, 'text'>[]): string {
  let result = ''

  for (const word of words) {
    const token = word.text.replace(/\s+/g, ' ').trim()
    if (!token) continue
    if (!result || attachesToPrevious(token) || previousOpensToken(result)) {
      result += token
    } else {
      result += ` ${token}`
    }
  }

  return result.trim()
}

function attachesToPrevious(token: string): boolean {
  return /^[,.;:!?%…\)\]\}]/u.test(token)
    || /^(?:['’](?:s|d|m|re|ve|ll|t)|n't)\b/iu.test(token)
    || /^[-–—/]/u.test(token)
}

function previousOpensToken(value: string): boolean {
  return /[\(\[\{“‘\-–—/]$/u.test(value)
}

function wordsForCue(cue: TimedTranscriptCue, nextCue?: TimedTranscriptCue): TimedTranscriptWord[] {
  if (cue.words?.length) return cue.words.map(normalizeWord)

  const tokens = cue.text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  // Old sidecars only know the chunk timestamp. Keep them useful by spreading
  // words across that chunk; the UI explicitly labels these timings estimated.
  const nextBoundary = nextCue ? nextCue.timeMs : Number.POSITIVE_INFINITY
  const durationMs = Math.max(
    tokens.length * 80,
    Math.min(cue.durationMs ?? tokens.length * DEFAULT_WORD_MS, nextBoundary - cue.timeMs),
  )
  const wordMs = durationMs / tokens.length
  return tokens.map((text, index) => ({
    text,
    startMs: Math.round(cue.timeMs + index * wordMs),
    endMs: Math.round(cue.timeMs + (index + 1) * wordMs),
    approximate: true,
  }))
}

function normalizeWord(word: TimedTranscriptWord): TimedTranscriptWord {
  const startMs = Math.max(0, Math.round(word.startMs))
  return {
    text: word.text.trim(),
    startMs,
    endMs: Math.max(startMs, Math.round(word.endMs)),
    approximate: word.approximate,
  }
}

function isUsableWord(word: TimedTranscriptWord): boolean {
  return Boolean(word.text) && Number.isFinite(word.startMs) && Number.isFinite(word.endMs)
}
