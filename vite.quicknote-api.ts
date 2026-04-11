import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

const QUICKNOTE_PATH = path.join(os.homedir(), 'sync/markor/QuickNote.org')
const PROJECTS_ROOT = path.join(os.homedir(), 'sync/branch-continue/projects')
const ROOT_INDEX_PATH = path.join(PROJECTS_ROOT, 'index.json')
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

type NoteId = `qn-${number}`

interface SourceNote {
  id: NoteId
  offset: number
  sourcePath: string
  startLine: number
  endLine: number
  rawHeadline: string
  title: string
  timestamp: string | null
  tags: string[]
  body: string
  preview: string
}

interface QuickNoteSearchHit {
  id: string
  noteId: SourceNote['id']
  lineNumber: number
  preview: string
  matchText: string
  note: SourceNote
}

interface QuickNoteCreateRequest {
  title?: string
  tags?: string[]
  body: string
}

interface QuickNoteCreateResponse {
  entry: SourceNote
}

interface ProjectRecord {
  slug: string
  name: string
  path: string
  ticketCount: number
  updatedAt: string
}

interface TicketRecord {
  id: string
  title: string
  project: string
  path: string
  status: 'proposed'
  type: 'implementation_prompt'
  sourceNoteId: string
  sourceStartLine: number
  sourceEndLine: number
  promotedAt: string
}

interface PromotionRequest {
  note: SourceNote
  projectSlug?: string
  projectName?: string
  ticketTitle?: string
  synthesis?: string
}

interface EntriesResponse {
  entries: SourceNote[]
  totalCount: number
  offset: number
  limit: number
  sourcePath: string
}

interface SearchResponse {
  results: QuickNoteSearchHit[]
  sourcePath: string
}

interface ProjectsResponse {
  projects: ProjectRecord[]
  rootPath: string
}

interface PromotionResponse {
  project: ProjectRecord
  ticket: TicketRecord
}

interface ParsedFile {
  lines: string[]
  headlineIndexes: number[]
}

const TIMESTAMP_RE = /\[\d{4}-\d{2}-\d{2} [^\]]+\]/
const ORG_SUFFIX_TAGS_RE = /\s+(:[^\s:]+(?::[^\s:]+)*:)\s*$/
const HASH_TAG_LINE_RE = /^\s*(#[A-Za-z0-9_-]+(?:\s+#[A-Za-z0-9_-]+)*)\s*$/

export function quickNoteApiPlugin(): Plugin {
  const middleware = createQuickNoteMiddleware()

  return {
    name: 'quicknote-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

function createQuickNoteMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) {
      next()
      return
    }

    try {
      const url = new URL(req.url, 'http://localhost')

      if (req.method === 'GET' && url.pathname === '/api/quicknote/entries') {
        const offset = normalizeOffset(url.searchParams.get('offset'))
        const limit = normalizeLimit(url.searchParams.get('limit'))
        return json(res, 200, await handleEntries(offset, limit))
      }

      if (req.method === 'GET' && url.pathname === '/api/quicknote/search') {
        const query = url.searchParams.get('q')?.trim() ?? ''
        const limit = normalizeLimit(url.searchParams.get('limit'))
        return json(res, 200, await handleSearch(query, limit))
      }

      if (req.method === 'POST' && url.pathname === '/api/quicknote/entries') {
        const body = (await readJsonBody(req)) as QuickNoteCreateRequest
        return json(res, 200, await handleCreateEntry(body))
      }

      if (req.method === 'GET' && url.pathname === '/api/projects') {
        return json(res, 200, await handleProjects())
      }

      if (req.method === 'POST' && url.pathname === '/api/promotions') {
        const body = (await readJsonBody(req)) as PromotionRequest
        return json(res, 200, await handlePromotion(body))
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(res, 500, { error: message })
    }
  }
}

async function handleEntries(offset: number, limit: number): Promise<EntriesResponse> {
  const parsed = await readParsedFile()
  const entries = listEntries(parsed, offset, limit)

  return {
    entries,
    totalCount: parsed.headlineIndexes.length,
    offset,
    limit,
    sourcePath: QUICKNOTE_PATH,
  }
}

async function handleSearch(query: string, limit: number): Promise<SearchResponse> {
  if (!query) {
    return { results: [], sourcePath: QUICKNOTE_PATH }
  }

  const parsed = await readParsedFile()
  const rawMatches = await runRipgrep(query, Math.max(limit * 4, limit))
  const cache = new Map<number, SourceNote>()
  const results: QuickNoteSearchHit[] = []

  for (const match of rawMatches) {
    const noteIndex = findContainingNoteIndex(parsed.headlineIndexes, match.lineNumber)
    if (noteIndex < 0) continue

    let note = cache.get(noteIndex)
    if (!note) {
      note = parseNote(parsed, noteIndex)
      cache.set(noteIndex, note)
    }

    results.push({
      id: `${note.id}:${match.lineNumber}`,
      noteId: note.id,
      lineNumber: match.lineNumber,
      preview: clip(match.text.trim(), 220),
      matchText: match.text,
      note,
    })

    if (results.length >= limit) break
  }

  return {
    results,
    sourcePath: QUICKNOTE_PATH,
  }
}

async function handleCreateEntry(request: QuickNoteCreateRequest): Promise<QuickNoteCreateResponse> {
  const body = request.body?.replace(/\r\n/g, '\n').trimEnd() ?? ''
  if (!body.trim()) {
    throw new Error('Note body cannot be empty.')
  }

  const title = request.title?.trim() ?? ''
  const tags = Array.from(new Set((request.tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
  const now = new Date()
  const timestamp = formatOrgTimestamp(now)
  const headline = title ? `* ${title} ${timestamp}` : `* ${timestamp}`
  const sections = [headline]

  if (tags.length > 0) {
    sections.push(tags.map((tag) => `#${normalizeTag(tag)}`).join(' '))
  }

  sections.push(body)

  const current = await fs.readFile(QUICKNOTE_PATH, 'utf8')
  const nextContent = `${current.trimEnd()}\n\n${sections.join('\n')}\n`
  await fs.writeFile(QUICKNOTE_PATH, nextContent, 'utf8')

  const parsed = await readParsedFile()
  if (parsed.headlineIndexes.length === 0) {
    throw new Error('Created note, but failed to parse it back from the source file.')
  }

  return {
    entry: parseNote(parsed, parsed.headlineIndexes.length - 1),
  }
}

async function handleProjects(): Promise<ProjectsResponse> {
  const projects = await readProjectsIndex()
  return {
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    rootPath: PROJECTS_ROOT,
  }
}

async function handlePromotion(request: PromotionRequest): Promise<PromotionResponse> {
  if (!request.note?.id) {
    throw new Error('Promotion request is missing note metadata.')
  }

  const projectName = request.projectName?.trim()
  const rootProjects = await readProjectsIndex()
  const existingProject = request.projectSlug
    ? rootProjects.find((project) => project.slug === request.projectSlug)
    : undefined

  const resolvedProjectName = existingProject?.name ?? projectName
  if (!existingProject && !resolvedProjectName) {
    throw new Error('Select an existing project or provide a new project name.')
  }

  const now = new Date().toISOString()
  const slug = existingProject?.slug ?? slugify(resolvedProjectName!)
  const name = existingProject?.name ?? resolvedProjectName!
  const projectDir = path.join(PROJECTS_ROOT, slug)
  const ticketsDir = path.join(projectDir, 'tickets')
  const ticketsIndexPath = path.join(ticketsDir, 'index.json')

  await fs.mkdir(ticketsDir, { recursive: true })

  const ticketId = createId('tkt')
  const ticketTitle = request.ticketTitle?.trim() || request.note.title || 'Untitled Ticket'
  const filename = `${ticketId}-${slugify(ticketTitle).slice(0, 64) || 'ticket'}.md`
  const ticketPath = path.join(ticketsDir, filename)
  const synthesis = request.synthesis?.trim() || buildSynthesisScaffold(request.note)
  const markdown = buildTicketMarkdown({
    ticketId,
    projectSlug: slug,
    ticketTitle,
    note: request.note,
    promotedAt: now,
    synthesis,
  })

  await fs.writeFile(ticketPath, markdown, 'utf8')

  const tickets = await readJsonArray<TicketRecord>(ticketsIndexPath)
  const ticketRecord: TicketRecord = {
    id: ticketId,
    title: ticketTitle,
    project: slug,
    path: ticketPath,
    status: 'proposed',
    type: 'implementation_prompt',
    sourceNoteId: request.note.id,
    sourceStartLine: request.note.startLine,
    sourceEndLine: request.note.endLine,
    promotedAt: now,
  }

  tickets.unshift(ticketRecord)
  await writeJson(ticketsIndexPath, tickets)

  const projectRecord: ProjectRecord = {
    slug,
    name,
    path: projectDir,
    ticketCount: tickets.length,
    updatedAt: now,
  }

  const updatedProjects = upsertProject(rootProjects, projectRecord)
  await writeJson(ROOT_INDEX_PATH, updatedProjects)

  return {
    project: projectRecord,
    ticket: ticketRecord,
  }
}

async function readParsedFile(): Promise<ParsedFile> {
  const content = await fs.readFile(QUICKNOTE_PATH, 'utf8')
  const lines = content.split(/\r?\n/)
  const headlineIndexes: number[] = []

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('* ')) {
      headlineIndexes.push(index)
    }
  }

  return { lines, headlineIndexes }
}

function listEntries(parsed: ParsedFile, offset: number, limit: number): SourceNote[] {
  const entries: SourceNote[] = []
  const totalCount = parsed.headlineIndexes.length
  const endOffset = Math.min(offset + limit, totalCount)

  for (let currentOffset = offset; currentOffset < endOffset; currentOffset += 1) {
    const headlineIndex = totalCount - 1 - currentOffset
    entries.push(parseNote(parsed, headlineIndex))
  }

  return entries
}

function parseNote(parsed: ParsedFile, headlineIndex: number): SourceNote {
  const startIndex = parsed.headlineIndexes[headlineIndex]
  const endIndex =
    headlineIndex + 1 < parsed.headlineIndexes.length
      ? parsed.headlineIndexes[headlineIndex + 1]
      : parsed.lines.length

  const rawHeadline = parsed.lines[startIndex].slice(2)
  const bodyLines = parsed.lines.slice(startIndex + 1, endIndex)
  const rawHeadlineTrimmed = rawHeadline.trim()

  const suffixMatch = rawHeadlineTrimmed.match(ORG_SUFFIX_TAGS_RE)
  const suffixTags = suffixMatch ? extractOrgTags(suffixMatch[1]) : []
  const withoutSuffix = suffixMatch
    ? rawHeadlineTrimmed.slice(0, rawHeadlineTrimmed.length - suffixMatch[0].length).trim()
    : rawHeadlineTrimmed

  const timestampMatch = withoutSuffix.match(TIMESTAMP_RE)
  const timestamp = timestampMatch?.[0] ?? null
  const cleanedTitle = withoutSuffix.replace(TIMESTAMP_RE, '').trim()
  const bodyTagLines = extractBodyTagLines(bodyLines)
  const title = cleanedTitle || withoutSuffix || rawHeadlineTrimmed || 'Untitled'
  const tags = Array.from(new Set([...suffixTags, ...bodyTagLines.tags]))
  const previewSource =
    firstMeaningfulLine(bodyLines.filter((line, index) => !bodyTagLines.indexes.has(index))) ??
    firstMeaningfulLine(bodyLines) ??
    rawHeadlineTrimmed

  return {
    id: `qn-${startIndex + 1}`,
    offset: parsed.headlineIndexes.length - 1 - headlineIndex,
    sourcePath: QUICKNOTE_PATH,
    startLine: startIndex + 1,
    endLine: endIndex,
    rawHeadline,
    title,
    timestamp,
    tags,
    body: bodyLines.join('\n'),
    preview: clip(previewSource.trim() || 'No body content.', 220),
  }
}

function extractBodyTagLines(bodyLines: string[]): { tags: string[]; indexes: Set<number> } {
  const tags: string[] = []
  const indexes = new Set<number>()

  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]
    if (!line.trim()) {
      continue
    }

    if (!HASH_TAG_LINE_RE.test(line)) {
      break
    }

    indexes.add(index)
    for (const tag of extractHashTags(line)) {
      tags.push(tag)
    }
  }

  return { tags, indexes }
}

function firstMeaningfulLine(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      return trimmed
    }
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

async function runRipgrep(query: string, limit: number): Promise<Array<{ lineNumber: number; text: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn('rg', [
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '--fixed-strings',
      '--smart-case',
      '--max-count',
      String(limit),
      query,
      QUICKNOTE_PATH,
    ])

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(new Error(`Failed to execute rg: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code === 1) {
        resolve([])
        return
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `rg exited with code ${code}`))
        return
      }

      const matches = stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(':')
          return {
            lineNumber: Number(line.slice(0, separator)),
            text: line.slice(separator + 1),
          }
        })
        .filter((entry) => Number.isFinite(entry.lineNumber))

      resolve(matches)
    })
  })
}

async function readProjectsIndex(): Promise<ProjectRecord[]> {
  await fs.mkdir(PROJECTS_ROOT, { recursive: true })
  return readJsonArray<ProjectRecord>(ROOT_INDEX_PATH)
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function upsertProject(projects: ProjectRecord[], project: ProjectRecord): ProjectRecord[] {
  const filtered = projects.filter((entry) => entry.slug !== project.slug)
  filtered.unshift(project)
  return filtered
}

function buildSynthesisScaffold(note: SourceNote): string {
  const tagList = note.tags.length > 0 ? note.tags.join(', ') : 'none'
  return [
    'Turn this note into an implementation-ready ticket.',
    '',
    `Source title: ${note.title}`,
    `Source tags: ${tagList}`,
    '',
    'Clarify:',
    '- intended user outcome',
    '- concrete UI / behavior changes',
    '- open questions or missing constraints',
  ].join('\n')
}

function buildTicketMarkdown(args: {
  ticketId: string
  projectSlug: string
  ticketTitle: string
  note: SourceNote
  promotedAt: string
  synthesis: string
}): string {
  const tagsYaml =
    args.note.tags.length > 0
      ? ['source_tags:', ...args.note.tags.map((tag) => `  - ${escapeYaml(tag)}`)].join('\n')
      : 'source_tags: []'

  return [
    '---',
    `id: ${escapeYaml(args.ticketId)}`,
    `project: ${escapeYaml(args.projectSlug)}`,
    'status: proposed',
    'type: implementation_prompt',
    `source_path: ${escapeYaml(args.note.sourcePath)}`,
    `source_start_line: ${args.note.startLine}`,
    `source_end_line: ${args.note.endLine}`,
    `source_title: ${escapeYaml(args.note.title)}`,
    `source_timestamp: ${escapeYaml(args.note.timestamp ?? 'null')}`,
    tagsYaml,
    `promoted_at: ${escapeYaml(args.promotedAt)}`,
    '---',
    '',
    `# ${args.ticketTitle}`,
    '',
    '## Source Note',
    args.note.body || '_No body content._',
    '',
    '## Synthesis',
    args.synthesis,
    '',
    '## Next Steps',
    '- refine acceptance criteria',
    '- hand to an available agent when ready',
    '',
  ].join('\n')
}

function escapeYaml(value: string): string {
  if (value === 'null') return 'null'
  return JSON.stringify(value)
}

function parseOptionalInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeOffset(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

function normalizeLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
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

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw ? JSON.parse(raw) : {}
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}
