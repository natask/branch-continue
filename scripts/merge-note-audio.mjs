#!/usr/bin/env node

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const AUDIO_LINE_RE = /^(\s*)Audio recording:\s+(.+)$/i
const NOTE_HEADLINE_RE = /^\*+\s.*\[\d{4}-\d{2}-\d{2} [^\]]+\]/
const AUDIO_EXT_RE = /\.(webm|m4a|mp4|aac|ogg|opus|wav|mp3|flac)$/i

export async function mergeNoteAudioFile(sourcePath, options = {}) {
  const absoluteSource = resolve(sourcePath)
  const sourceDir = dirname(absoluteSource)
  const dryRun = Boolean(options.dryRun)
  const keepParts = Boolean(options.keepParts)
  const ffmpeg = options.ffmpeg || process.env.FFMPEG || 'ffmpeg'
  const now = options.now || new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const backupRoot = join(sourceDir, '.audio-merge-backup', stamp)
  const original = await readFile(absoluteSource, 'utf8')
  const notes = findNoteRanges(original)
  const changes = []
  const unavailableReferences = notes.flatMap((note) => (
    extractNoteAudioReferences(original, note)
      .filter((item) => !isFileAudioReference(item.reference))
      .map((item) => ({ headline: note.headline, reference: item.reference }))
  ))
  const missingFileReferences = notes.flatMap((note) => (
    extractNoteAudioReferences(original, note)
      .filter((item) => isFileAudioReference(item.reference))
      .filter((item) => !existsSync(safeAudioPath(sourceDir, item.reference)))
      .map((item) => ({ headline: note.headline, reference: item.reference }))
  ))
  let nextContent = original

  for (const note of notes) {
    const plan = await planNoteMerge(original, note, sourceDir)
    if (!plan || plan.inputs.length <= 1 && plan.outputPath === plan.inputs[0]?.path) continue
    changes.push(plan)
  }

  const executionPlans = coalescePlans(changes)
  if (!dryRun && changes.length > 0) {
    await mkdir(backupRoot, { recursive: true })
    await copyFile(absoluteSource, join(backupRoot, basename(absoluteSource)))
    await backupPaths(
      [...new Set(executionPlans.flatMap((plan) => plan.backupPaths))],
      sourceDir,
      backupRoot,
    )
  }

  for (const plan of executionPlans) {
    if (dryRun) continue
    await mkdir(dirname(plan.outputPath), { recursive: true })
    const stableInputs = plan.inputs.map((input) => join(backupRoot, relative(sourceDir, input.path)))
    await mergeWithFfmpeg(stableInputs, plan.outputPath, ffmpeg)
    await writeCanonicalMetadata(plan)
    await writeCanonicalSessionIndex(plan)
  }

  if (!dryRun && !keepParts) {
    const outputs = new Set(executionPlans.map((plan) => resolve(plan.outputPath)))
    const inputs = new Map()
    for (const plan of executionPlans) {
      for (const input of plan.inputs) inputs.set(resolve(input.path), input.path)
    }
    for (const [resolvedPath, inputPath] of inputs) {
      if (!outputs.has(resolvedPath)) await removeAudioAndSidecars(inputPath)
    }
  }

  // Work from the bottom so original line offsets remain valid.
  for (const plan of [...changes].reverse()) {
    nextContent = replaceNoteAudioLines(nextContent, plan.note, plan.outputReference)
  }

  if (!dryRun && changes.length > 0) {
    const temporarySource = `${absoluteSource}.audio-merge-${process.pid}.tmp`
    await writeFile(temporarySource, nextContent, 'utf8')
    await rename(temporarySource, absoluteSource)
  }

  return {
    sourcePath: absoluteSource,
    backupRoot: changes.length > 0 && !dryRun ? backupRoot : null,
    changedNotes: changes.length,
    plans: changes.map((plan) => ({
      headline: plan.headline,
      outputReference: plan.outputReference,
      inputs: plan.inputs.map((input) => input.reference),
    })),
    unavailableReferences,
    missingFileReferences,
  }
}

function coalescePlans(plans) {
  const byOutput = new Map()
  for (const plan of plans) {
    const key = resolve(plan.outputPath)
    const existing = byOutput.get(key)
    if (!existing) {
      byOutput.set(key, { ...plan, inputs: [...plan.inputs], backupPaths: [...plan.backupPaths] })
      continue
    }
    const inputPaths = new Set(existing.inputs.map((input) => resolve(input.path)))
    for (const input of plan.inputs) {
      if (!inputPaths.has(resolve(input.path))) existing.inputs.push(input)
    }
    existing.inputs.sort((left, right) => segmentIndex(left.metadata) - segmentIndex(right.metadata))
    existing.backupPaths = [...new Set([...existing.backupPaths, ...plan.backupPaths])]
  }
  return [...byOutput.values()]
}

export function findNoteRanges(content) {
  const lines = content.split(/\r?\n/)
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    if (NOTE_HEADLINE_RE.test(lines[index] || '')) starts.push(index)
  }
  return starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? lines.length,
    headline: lines[start] || `Note at line ${start + 1}`,
  }))
}

export function extractNoteAudioReferences(content, note) {
  const lines = content.split(/\r?\n/)
  const references = []
  for (let index = note.start + 1; index < note.end; index += 1) {
    const match = lines[index]?.match(AUDIO_LINE_RE)
    if (!match) continue
    const reference = normalizeAudioReference(match[2] || '')
    if (reference) references.push({ reference, lineIndex: index })
  }
  return references
}

export function replaceNoteAudioLines(content, note, outputReference) {
  const lines = content.split(/\r?\n/)
  const indexes = []
  let indentation = ''
  for (let index = note.start + 1; index < note.end; index += 1) {
    const match = lines[index]?.match(AUDIO_LINE_RE)
    if (!match) continue
    indexes.push(index)
    if (indexes.length === 1) indentation = match[1] || ''
  }
  if (indexes.length === 0) return content
  const outputLine = `${indentation}Audio recording: [${basename(outputReference)}](${outputReference})`
  lines[indexes[0]] = outputLine
  for (let index = indexes.length - 1; index >= 1; index -= 1) lines.splice(indexes[index], 1)
  return lines.join('\n')
}

async function planNoteMerge(content, note, sourceDir) {
  const explicit = extractNoteAudioReferences(content, note)
  if (explicit.length === 0) return null
  const inputs = []
  const seen = new Set()
  let sessionId = ''

  for (const item of explicit) {
    if (!isFileAudioReference(item.reference)) continue
    const path = safeAudioPath(sourceDir, item.reference)
    const metadata = await readJsonIfPresent(`${path}.json`)
    sessionId ||= typeof metadata?.sessionId === 'string' ? metadata.sessionId : ''
    const members = await readSessionMembers(path, metadata, sourceDir)
    const candidates = members.length > 0 ? members : [{ reference: item.reference, path, metadata }]
    for (const candidate of candidates) {
      const key = resolve(candidate.path)
      if (seen.has(key) || !existsSync(candidate.path)) continue
      seen.add(key)
      inputs.push(candidate)
    }
  }
  if (inputs.length === 0) return null
  inputs.sort((left, right) => segmentIndex(left.metadata) - segmentIndex(right.metadata))

  const firstReference = explicit.find((item) => isFileAudioReference(item.reference))?.reference
  if (!firstReference) return null
  const stem = basename(firstReference, extname(firstReference))
  const outputReference = `recordings/${stem}.wav`
  const outputPath = safeAudioPath(sourceDir, outputReference)
  const backupPaths = new Set()
  for (const input of inputs) {
    for (const path of audioAndSidecarPaths(input.path)) {
      if (existsSync(path)) backupPaths.add(path)
    }
  }
  for (const path of audioAndSidecarPaths(outputPath)) {
    if (existsSync(path)) backupPaths.add(path)
  }
  if (sessionId) {
    const indexPath = join(sourceDir, 'recordings', `${safeSessionId(sessionId)}.session.json`)
    if (existsSync(indexPath)) backupPaths.add(indexPath)
  }

  return {
    headline: note.headline,
    note,
    inputs,
    outputPath,
    outputReference,
    sessionId: sessionId || `voice-session-${stem}`,
    backupPaths: [...backupPaths],
  }
}

async function readSessionMembers(canonicalPath, metadata, sourceDir) {
  const sessionId = typeof metadata?.sessionId === 'string' ? metadata.sessionId : ''
  if (!sessionId) return []
  const indexPath = join(dirname(canonicalPath), `${safeSessionId(sessionId)}.session.json`)
  const index = await readJsonIfPresent(indexPath)
  if (!Array.isArray(index?.members)) return []
  const members = index.members.filter((member) => typeof member?.uri === 'string' && member.uri.trim())
  return Promise.all(members.map(async (member) => {
    const reference = typeof member?.uri === 'string' ? member.uri : ''
    const path = safeAudioPath(sourceDir, reference)
    return { reference, path, metadata: await readJsonIfPresent(`${path}.json`) }
  }))
}

async function mergeWithFfmpeg(inputs, outputPath, ffmpeg) {
  const temporaryOutput = `${outputPath}.merge-${process.pid}.wav`
  const inputArgs = inputs.flatMap((path) => ['-i', path])
  const normalizedInputs = inputs
    .map((_, index) => `[${index}:a]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono[a${index}]`)
    .join(';')
  const concatInputs = inputs.map((_, index) => `[a${index}]`).join('')
  try {
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputArgs,
      '-filter_complex', `${normalizedInputs};${concatInputs}concat=n=${inputs.length}:v=0:a=1[outa]`,
      '-map', '[outa]', '-vn', '-c:a', 'pcm_s16le', temporaryOutput,
    ])
    await rename(temporaryOutput, outputPath)
  } finally {
    await rm(temporaryOutput, { force: true })
  }
}

async function writeCanonicalMetadata(plan) {
  const last = plan.inputs[plan.inputs.length - 1]?.metadata || {}
  const metadata = {
    sessionId: plan.sessionId,
    segmentIndex: Math.max(0, ...plan.inputs.map((input) => segmentIndex(input.metadata))),
    offsetMs: 0,
    languageCode: typeof last.languageCode === 'string' ? last.languageCode : 'auto',
    segmentStartReason: 'start',
    final: true,
  }
  await writeFile(`${plan.outputPath}.json`, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

async function writeCanonicalSessionIndex(plan) {
  const index = {
    id: plan.sessionId,
    sessionId: plan.sessionId,
    canonicalUri: plan.outputReference,
    members: [{
      uri: plan.outputReference,
      segmentIndex: Math.max(0, ...plan.inputs.map((input) => segmentIndex(input.metadata))),
    }],
    updatedAt: new Date().toISOString(),
  }
  const indexPath = join(dirname(plan.outputPath), `${safeSessionId(plan.sessionId)}.session.json`)
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function backupPaths(paths, sourceDir, backupRoot) {
  for (const path of paths) {
    const relativePath = relative(sourceDir, path)
    if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..') continue
    const destination = join(backupRoot, relativePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(path, destination)
  }
}

async function removeAudioAndSidecars(audioPath) {
  for (const path of audioAndSidecarPaths(audioPath)) await rm(path, { force: true })
}

function audioAndSidecarPaths(audioPath) {
  const stem = audioPath.replace(AUDIO_EXT_RE, '')
  return [audioPath, `${audioPath}.json`, `${stem}.peaks.json`, `${stem}.transcript.md`]
}

function safeAudioPath(sourceDir, reference) {
  if (!reference || !AUDIO_EXT_RE.test(reference)) throw new Error(`Invalid audio reference: ${reference || '(empty)'}`)
  const path = resolve(sourceDir, reference)
  const relativePath = relative(sourceDir, path)
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Audio reference escapes the note directory: ${reference}`)
  }
  return path
}

function normalizeAudioReference(value) {
  const trimmed = value.trim().replace(/^<(.+)>$/, '$1')
  const markdown = trimmed.match(/^\[[^\]]*\]\(([^)]+)\)/)
  return (markdown?.[1] || trimmed).trim().split(/\s+/)[0] || ''
}

function isFileAudioReference(reference) {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(reference) && AUDIO_EXT_RE.test(reference)
}

function safeSessionId(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function segmentIndex(metadata) {
  return Number.isFinite(metadata?.segmentIndex) ? metadata.segmentIndex : 0
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`))
    })
  })
}

function parseCliArgs(argv) {
  const args = [...argv]
  const dryRun = args.includes('--dry-run')
  const keepParts = args.includes('--keep-parts')
  const sourcePath = args.find((arg) => !arg.startsWith('--'))
  return { sourcePath, dryRun, keepParts }
}

async function main() {
  const { sourcePath, dryRun, keepParts } = parseCliArgs(process.argv.slice(2))
  if (!sourcePath) {
    console.error('Usage: pnpm audio:merge -- /absolute/path/to/notes.org [--dry-run] [--keep-parts]')
    process.exitCode = 1
    return
  }
  const result = await mergeNoteAudioFile(sourcePath, { dryRun, keepParts })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
