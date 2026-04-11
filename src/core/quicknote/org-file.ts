import type {
  QuickNoteCreateRequest,
  QuickNoteSearchHit,
  SourceNote,
} from './types'

const TIMESTAMP_RE = /\[\d{4}-\d{2}-\d{2} [^\]]+\]/
const ORG_SUFFIX_TAGS_RE = /\s+(:[^\s:]+(?::[^\s:]+)*:)\s*$/
const HASH_TAG_LINE_RE = /^\s*(#[A-Za-z0-9_-]+(?:\s+#[A-Za-z0-9_-]+)*)\s*$/
const ORG_PROPERTIES_START_RE = /^\s*:PROPERTIES:\s*$/i
const ORG_PROPERTIES_END_RE = /^\s*:END:\s*$/i
const ORG_PROPERTY_LINE_RE = /^\s*:([A-Za-z0-9_@#%.-]+):\s*(.*?)\s*$/
const NOTE_UID_PROPERTY_KEY = 'BRANCH_CONTINUE_NOTE_UID'
const PARENT_NOTE_ID_PROPERTY_KEY = 'BRANCH_CONTINUE_PARENT_NOTE_ID'

interface NoteLineageMetadata {
  noteUid: string | null
  parentNoteId: string | null
}

export interface ParsedQuickNoteFile {
  content: string
  sourcePath: string
  lines: string[]
  headlineIndexes: number[]
  entries: SourceNote[]
  byHeadlineIndex: Map<number, SourceNote>
}

export function parseQuickNoteFile(content: string, sourcePath: string): ParsedQuickNoteFile {
  const lines = content.split(/\r?\n/)
  const headlineIndexes: number[] = []
  const idUsage = new Map<string, number>()

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('* ')) {
      headlineIndexes.push(index)
    }
  }

  const entries: SourceNote[] = []
  const byHeadlineIndex = new Map<number, SourceNote>()

  const total = headlineIndexes.length
  for (let offset = 0; offset < total; offset += 1) {
    const headlineIndex = total - 1 - offset
    const note = parseNote(lines, headlineIndexes, headlineIndex, sourcePath, idUsage)
    entries.push(note)
    byHeadlineIndex.set(headlineIndex, note)
  }

  return {
    content,
    sourcePath,
    lines,
    headlineIndexes,
    entries,
    byHeadlineIndex,
  }
}

export function appendQuickNoteEntry(
  parsed: ParsedQuickNoteFile,
  request: QuickNoteCreateRequest,
): { parsed: ParsedQuickNoteFile; entry: SourceNote } {
  const body = request.body?.replace(/\r\n/g, '\n').trimEnd() ?? ''
  if (!body.trim()) {
    throw new Error('Note body cannot be empty.')
  }

  const title = request.title?.trim() ?? ''
  const tags = normalizeTags(request.tags ?? [])
  const timestamp = request.timestamp?.trim() || formatOrgTimestamp(new Date())
  const lineage = resolveLineageForCreate(request)
  const entryLines = buildNoteLines({ title, timestamp, tags, body, lineage })
  const nextContent = `${parsed.content.trimEnd()}\n\n${entryLines.join('\n')}\n`
  const nextParsed = parseQuickNoteFile(nextContent, parsed.sourcePath)
  const entry = nextParsed.entries[0]

  if (!entry) {
    throw new Error('Created note, but failed to parse it back from the selected file.')
  }

  return {
    parsed: nextParsed,
    entry,
  }
}

export function updateQuickNoteEntry(
  parsed: ParsedQuickNoteFile,
  noteId: string,
  request: QuickNoteCreateRequest,
): { parsed: ParsedQuickNoteFile; entry: SourceNote } {
  const existing = parsed.entries.find((entry) => entry.id === noteId)
  if (!existing) {
    throw new Error(`Could not find note ${noteId} in selected file.`)
  }

  const body = request.body?.replace(/\r\n/g, '\n').trimEnd() ?? ''
  const title = request.title?.trim() ?? existing.title
  const tags = normalizeTags(request.tags ?? existing.tags)
  const timestamp = request.timestamp?.trim() || existing.timestamp || formatOrgTimestamp(new Date())
  const lineage = resolveLineageForUpdate(existing, request)

  const startIndex = existing.startLine - 1
  const endExclusiveIndex = existing.endLine
  const entryLines = buildNoteLines({ title, timestamp, tags, body, lineage })
  const nextLines = [
    ...parsed.lines.slice(0, startIndex),
    ...entryLines,
    ...parsed.lines.slice(endExclusiveIndex),
  ]
  const nextContent = nextLines.join('\n')
  const nextParsed = parseQuickNoteFile(nextContent, parsed.sourcePath)
  const entry =
    nextParsed.entries.find((candidate) => candidate.startLine === startIndex + 1) ??
    nextParsed.entries.find((candidate) => candidate.id === noteId)

  if (!entry) {
    throw new Error(`Updated note ${noteId}, but failed to locate it afterward.`)
  }

  return {
    parsed: nextParsed,
    entry,
  }
}

export function searchQuickNoteFile(
  parsed: ParsedQuickNoteFile,
  query: string,
  limit = 50,
): QuickNoteSearchHit[] {
  const needle = query.trim()
  if (!needle) return []

  const caseSensitive = /[A-Z]/.test(needle)
  const normalizedNeedle = caseSensitive ? needle : needle.toLowerCase()
  const results: QuickNoteSearchHit[] = []

  for (let index = 0; index < parsed.lines.length; index += 1) {
    const line = parsed.lines[index]
    const haystack = caseSensitive ? line : line.toLowerCase()

    if (!haystack.includes(normalizedNeedle)) continue

    const lineNumber = index + 1
    const noteIndex = findContainingNoteIndex(parsed.headlineIndexes, lineNumber)
    if (noteIndex < 0) continue

    const note = parsed.byHeadlineIndex.get(noteIndex)
    if (!note) continue

    results.push({
      id: `${note.id}:${lineNumber}`,
      noteId: note.id,
      lineNumber,
      preview: clip(line.trim(), 220),
      matchText: line,
      note,
    })

    if (results.length >= limit) break
  }

  return results
}

function parseNote(
  lines: string[],
  headlineIndexes: number[],
  headlineIndex: number,
  sourcePath: string,
  idUsage: Map<string, number>,
): SourceNote {
  const startIndex = headlineIndexes[headlineIndex]
  const endIndex =
    headlineIndex + 1 < headlineIndexes.length
      ? headlineIndexes[headlineIndex + 1]
      : lines.length

  const rawHeadline = lines[startIndex].slice(2)
  const bodyLines = lines.slice(startIndex + 1, endIndex)
  const rawHeadlineTrimmed = rawHeadline.trim()

  const suffixMatch = rawHeadlineTrimmed.match(ORG_SUFFIX_TAGS_RE)
  const suffixTags = suffixMatch ? extractOrgTags(suffixMatch[1]) : []
  const withoutSuffix = suffixMatch
    ? rawHeadlineTrimmed.slice(0, rawHeadlineTrimmed.length - suffixMatch[0].length).trim()
    : rawHeadlineTrimmed

  const timestampMatch = withoutSuffix.match(TIMESTAMP_RE)
  const timestamp = timestampMatch?.[0] ?? null
  const cleanedTitle = withoutSuffix.replace(TIMESTAMP_RE, '').trim()
  const bodyPreamble = extractBodyPreamble(bodyLines)
  const contentLines = bodyLines.filter((_, index) => !bodyPreamble.indexes.has(index))
  const title = cleanedTitle || withoutSuffix || rawHeadlineTrimmed || 'Untitled'
  const tags = Array.from(new Set([...suffixTags, ...bodyPreamble.tags]))
  const previewSource = firstMeaningfulLine(contentLines) ?? firstMeaningfulLine(bodyLines) ?? rawHeadlineTrimmed

  return {
    id: buildNoteId(timestamp, startIndex, idUsage),
    noteUid: bodyPreamble.lineage.noteUid,
    parentNoteId: bodyPreamble.lineage.parentNoteId,
    offset: headlineIndexes.length - 1 - headlineIndex,
    sourcePath,
    startLine: startIndex + 1,
    endLine: endIndex,
    rawHeadline,
    title,
    timestamp,
    tags,
    body: contentLines.join('\n'),
    preview: clip(previewSource.trim() || 'No body content.', 220),
  }
}

function buildNoteId(
  timestamp: string | null,
  startIndex: number,
  idUsage: Map<string, number>,
): string {
  const base = timestamp
    ? `ts-${normalizeTimestampForId(timestamp)}`
    : `line-${startIndex + 1}`
  const occurrence = (idUsage.get(base) ?? 0) + 1
  idUsage.set(base, occurrence)
  return occurrence === 1 ? `qn-${base}` : `qn-${base}-${occurrence}`
}

function normalizeTimestampForId(timestamp: string): string {
  return timestamp
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9+-]+/g, '')
}

function extractBodyPreamble(bodyLines: string[]): {
  tags: string[]
  indexes: Set<number>
  lineage: NoteLineageMetadata
} {
  const tags: string[] = []
  const indexes = new Set<number>()
  let index = 0

  while (index < bodyLines.length && !bodyLines[index]!.trim()) {
    indexes.add(index)
    index += 1
  }

  const propertyDrawer = parsePropertiesDrawer(bodyLines, index)
  if (propertyDrawer) {
    for (let cursor = index; cursor < propertyDrawer.endIndex; cursor += 1) {
      indexes.add(cursor)
    }
    index = propertyDrawer.endIndex
  }

  while (index < bodyLines.length) {
    const line = bodyLines[index]!
    const trimmed = line.trim()

    if (!trimmed) {
      indexes.add(index)
      index += 1
      continue
    }

    if (!HASH_TAG_LINE_RE.test(line)) break

    indexes.add(index)
    for (const tag of extractHashTags(line)) {
      tags.push(tag)
    }
    index += 1
  }

  return {
    tags,
    indexes,
    lineage: {
      noteUid: normalizeLineageValue(propertyDrawer?.properties.get(NOTE_UID_PROPERTY_KEY)),
      parentNoteId: normalizeLineageValue(propertyDrawer?.properties.get(PARENT_NOTE_ID_PROPERTY_KEY)),
    },
  }
}

function firstMeaningfulLine(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return null
}

function extractOrgTags(tagSuffix: string): string[] {
  return tagSuffix
    .split(':')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function extractHashTags(line: string): string[] {
  return Array.from(line.matchAll(/#([A-Za-z0-9_-]+)/g), (match) => match[1])
}

function findContainingNoteIndex(headlineIndexes: number[], lineNumber: number): number {
  let low = 0
  let high = headlineIndexes.length - 1
  let result = -1
  const zeroBasedLine = lineNumber - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (headlineIndexes[mid] <= zeroBasedLine) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}...`
}

function formatOrgTimestamp(date: Date): string {
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0')
  const offsetMins = String(absOffset % 60).padStart(2, '0')
  return `[${year}-${month}-${day} ${weekday} ${hours}:${minutes}:${seconds} ${sign}${offsetHours}${offsetMins}]`
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#+/, '').trim()
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => normalizeTag(tag)).filter(Boolean)))
}

function buildNoteLines(input: {
  title: string
  timestamp: string
  tags: string[]
  body: string
  lineage: NoteLineageMetadata
}): string[] {
  const headline = input.title ? `* ${input.title} ${input.timestamp}` : `* ${input.timestamp}`
  const lines = [headline]

  if (input.lineage.noteUid || input.lineage.parentNoteId) {
    lines.push(':PROPERTIES:')
    if (input.lineage.noteUid) {
      lines.push(`:${NOTE_UID_PROPERTY_KEY}: ${input.lineage.noteUid}`)
    }
    if (input.lineage.parentNoteId) {
      lines.push(`:${PARENT_NOTE_ID_PROPERTY_KEY}: ${input.lineage.parentNoteId}`)
    }
    lines.push(':END:')
  }

  if (input.tags.length > 0) {
    lines.push(input.tags.map((tag) => `#${tag}`).join(' '))
  }

  if (input.body.length > 0) {
    lines.push(...input.body.split('\n'))
  }

  return lines
}

function parsePropertiesDrawer(
  bodyLines: string[],
  startIndex: number,
): { endIndex: number; properties: Map<string, string> } | null {
  if (!ORG_PROPERTIES_START_RE.test(bodyLines[startIndex] ?? '')) {
    return null
  }

  const properties = new Map<string, string>()
  for (let index = startIndex + 1; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]!
    if (ORG_PROPERTIES_END_RE.test(line)) {
      return {
        endIndex: index + 1,
        properties,
      }
    }
    const match = line.match(ORG_PROPERTY_LINE_RE)
    if (!match) continue
    properties.set(match[1].trim().toUpperCase(), match[2].trim())
  }

  return null
}

function resolveLineageForCreate(request: QuickNoteCreateRequest): NoteLineageMetadata {
  const parentNoteId = normalizeLineageValue(request.parentNoteId)
  let noteUid = normalizeLineageValue(request.noteUid)

  if (parentNoteId && !noteUid) {
    noteUid = createStableNoteUid()
  }

  return {
    noteUid,
    parentNoteId,
  }
}

function resolveLineageForUpdate(
  existing: SourceNote,
  request: QuickNoteCreateRequest,
): NoteLineageMetadata {
  const parentNoteId =
    request.parentNoteId === undefined
      ? normalizeLineageValue(existing.parentNoteId)
      : normalizeLineageValue(request.parentNoteId)
  let noteUid =
    request.noteUid === undefined
      ? normalizeLineageValue(existing.noteUid)
      : normalizeLineageValue(request.noteUid)

  if (parentNoteId && !noteUid) {
    noteUid = createStableNoteUid()
  }

  return {
    noteUid,
    parentNoteId,
  }
}

function normalizeLineageValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function createStableNoteUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `qnuid-${crypto.randomUUID()}`
  }
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `qnuid-${Date.now().toString(36)}-${randomPart}`
}
