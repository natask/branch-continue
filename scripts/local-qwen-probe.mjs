#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions'
const DEFAULT_MODEL = 'other-machine/Qwen3.6-35B-A3B'
const DEFAULT_CONTEXT_WINDOW_TOKENS = 60_000
const DEFAULT_CONTEXT_FRACTION = 0.5
const DEFAULT_RESERVED_OUTPUT_TOKENS = 2_000
const DEFAULT_MAX_PARALLEL = 16
const DEFAULT_TIMEOUT_MS = 180_000
const MINIMAL_SYSTEM_PROMPT = 'Work only from the attached org sections. Be concise and do not infer private facts beyond the text.'
const LOCAL_OPENCODE_MODEL_PREFIXES = ['local/', 'other-machine/']

export function splitOrgSections(content, sourcePath = 'dummy.org') {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const starts = []

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\*+\s/.test(lines[index] ?? '')) starts.push(index)
  }

  if (starts.length === 0) {
    return [buildSection({ sourcePath, startLine: 1, endLine: lines.length, text: normalized })]
  }

  const sections = []
  if (starts[0] > 0) {
    sections.push(buildSection({
      sourcePath,
      startLine: 1,
      endLine: starts[0],
      text: lines.slice(0, starts[0]).join('\n'),
      title: 'Preamble',
      level: 0,
    }))
  }

  for (let offset = 0; offset < starts.length; offset += 1) {
    const start = starts[offset]
    const end = offset + 1 < starts.length ? starts[offset + 1] : lines.length
    sections.push(buildSection({
      sourcePath,
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join('\n'),
    }))
  }

  return sections.filter((section) => section.text.trim().length > 0)
}

export function estimateTokens(text) {
  if (!text) return 0
  const chars = text.length
  const whitespaceRuns = text.match(/\s+/g)?.length ?? 0
  return Math.ceil(chars / 4) + Math.ceil(whitespaceRuns / 20)
}

export function packOrgSections(sections, options = {}) {
  const contextWindowTokens = positiveNumber(options.contextWindowTokens, DEFAULT_CONTEXT_WINDOW_TOKENS)
  const fraction = clamp(Number(options.contextFraction ?? DEFAULT_CONTEXT_FRACTION), 0.05, 1)
  const reservedOutputTokens = positiveNumber(options.reservedOutputTokens, DEFAULT_RESERVED_OUTPUT_TOKENS)
  const systemPromptTokens = estimateTokens(options.systemPrompt ?? '')
  const targetTokens = Math.max(1, Math.floor(contextWindowTokens * fraction))
  const availableTokens = Math.max(1, targetTokens - reservedOutputTokens - systemPromptTokens)
  const packed = []
  let usedTokens = 0
  let truncated = false

  for (const section of sections) {
    const header = `\n\n---\nsource: ${section.sourcePath}:${section.startLine}-${section.endLine}\ntitle: ${section.title}\n\n`
    const candidate = `${header}${section.text.trimEnd()}`
    const candidateTokens = estimateTokens(candidate)
    const remainingTokens = availableTokens - usedTokens

    if (remainingTokens <= 0) {
      truncated = true
      break
    }

    if (candidateTokens <= remainingTokens) {
      packed.push(candidate)
      usedTokens += candidateTokens
      continue
    }

    const approximateChars = Math.max(0, remainingTokens * 4 - header.length - 160)
    if (approximateChars > 200) {
      packed.push(`${header}${section.text.trimEnd().slice(0, approximateChars)}\n\n[TRUNCATED: context budget reached]`)
      usedTokens = availableTokens
    }
    truncated = true
    break
  }

  return {
    text: packed.join(''),
    sectionsIncluded: packed.length,
    totalSections: sections.length,
    estimatedInputTokens: usedTokens + systemPromptTokens,
    availableContentTokens: availableTokens,
    targetTokens,
    truncated,
  }
}

export function buildChatRequest({ model = DEFAULT_MODEL, packedText, systemPrompt = MINIMAL_SYSTEM_PROMPT, maxTokens = 512, temperature = 0 }) {
  const messages = []
  if (systemPrompt !== 'none' && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() })
  }
  messages.push({
    role: 'user',
    content: [
      'Analyze these org-mode note sections. Return:',
      '1. The most actionable next thought.',
      '2. Three concrete questions the notes raise.',
      '3. Any missing context needed before acting.',
      '',
      packedText,
    ].join('\n'),
  })

  return {
    model,
    messages,
    stream: false,
    temperature,
    max_tokens: maxTokens,
  }
}

export function buildOpencodeCommand({
  model = DEFAULT_MODEL,
  contextPath,
  workspaceDir,
  title = 'local-qwen-probe',
  pure = true,
  format = 'default',
}) {
  const args = ['run', buildOpencodePrompt()]
  if (pure) args.push('--pure')
  args.push('--model', model)
  args.push('--format', format)
  args.push('--title', title)
  args.push('--dir', workspaceDir)
  args.push('--file', contextPath)
  return { command: 'opencode', args }
}

export async function findMaxParallelOpencode({
  model = DEFAULT_MODEL,
  packedText,
  maxParallel = DEFAULT_MAX_PARALLEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowNonLocal = false,
  keepWorkspace = false,
}) {
  assertLocalOpencodeModel(model, allowNonLocal)

  const workspaceDir = await createProbeWorkspace()
  const contextPath = path.join(workspaceDir, 'packed-org-context.md')
  await writeFile(contextPath, packedText, 'utf8')

  try {
    let low = 0
    let high = Math.max(1, maxParallel)
    const attempts = []

    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      const result = await runOpencodeParallelAttempt({ model, contextPath, workspaceDir, parallel: mid, timeoutMs })
      attempts.push(result)
      if (result.ok) low = mid
      else high = mid - 1
    }

    return { maxParallel: low, attempts, workspaceDir: keepWorkspace ? workspaceDir : null }
  } finally {
    if (!keepWorkspace) await rm(workspaceDir, { recursive: true, force: true })
  }
}

export async function findMaxParallel({ endpoint = DEFAULT_ENDPOINT, request, maxParallel = DEFAULT_MAX_PARALLEL, timeoutMs = DEFAULT_TIMEOUT_MS, allowNonLocal = false }) {
  assertLocalEndpoint(endpoint, allowNonLocal)

  let low = 0
  let high = Math.max(1, maxParallel)
  const attempts = []

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const result = await runEndpointParallelAttempt({ endpoint, request, parallel: mid, timeoutMs })
    attempts.push(result)
    if (result.ok) low = mid
    else high = mid - 1
  }

  return { maxParallel: low, attempts }
}

export function makeDummyOrg({ sections = 80, wordsPerSection = 120 } = {}) {
  const words = [
    'local', 'private', 'dummy', 'branch', 'thought', 'question', 'answer', 'pattern',
    'decision', 'constraint', 'search', 'context', 'model', 'token', 'window', 'agent',
  ]
  const blocks = []
  for (let index = 0; index < sections; index += 1) {
    const level = index % 7 === 0 ? '**' : '*'
    const body = Array.from({ length: wordsPerSection }, (_, wordIndex) => words[(index + wordIndex) % words.length]).join(' ')
    blocks.push(`${level} Dummy note ${String(index + 1).padStart(3, '0')}\n${body}\n- synthetic bullet ${index + 1}\n`)
  }
  return blocks.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const systemPrompt = resolveSystemPrompt(args)
  const content = args.file ? await readFile(args.file, 'utf8') : makeDummyOrg({
    sections: positiveNumber(args.sections, 80),
    wordsPerSection: positiveNumber(args.wordsPerSection, 120),
  })
  const sections = splitOrgSections(content, args.file ?? 'dummy.org')
  const packed = packOrgSections(sections, {
    contextWindowTokens: args.contextWindowTokens,
    contextFraction: args.contextFraction,
    reservedOutputTokens: args.reservedOutputTokens,
    systemPrompt,
  })
  const model = args.model ?? DEFAULT_MODEL
  const request = buildChatRequest({
    model,
    packedText: packed.text,
    systemPrompt,
    maxTokens: positiveNumber(args.maxTokens, 512),
    temperature: Number(args.temperature ?? 0),
  })
  const transport = args.transport ?? 'opencode'

  if (args.dryRun) {
    const workspaceDir = path.join('scratch', 'local-qwen-probe', 'opencode-run')
    const command = buildOpencodeCommand({
      model,
      contextPath: path.join(workspaceDir, 'packed-org-context.md'),
      workspaceDir,
    })
    printJson({
      mode: 'dry-run',
      transport,
      packed,
      opencode: summarizeOpencodeCommand(command),
      endpointFallback: summarizeRequest(request),
    })
    return
  }

  const result = transport === 'endpoint'
    ? await findMaxParallel({
      endpoint: args.endpoint ?? DEFAULT_ENDPOINT,
      request,
      maxParallel: positiveNumber(args.maxParallel, DEFAULT_MAX_PARALLEL),
      timeoutMs: positiveNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS),
      allowNonLocal: Boolean(args.allowNonLocal),
    })
    : await findMaxParallelOpencode({
      model,
      packedText: packed.text,
      maxParallel: positiveNumber(args.maxParallel, DEFAULT_MAX_PARALLEL),
      timeoutMs: positiveNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS),
      allowNonLocal: Boolean(args.allowNonLocal),
      keepWorkspace: Boolean(args.keepWorkspace),
    })

  printJson({ mode: 'probe', transport, packed, result })
}

async function runOpencodeParallelAttempt({ model, contextPath, workspaceDir, parallel, timeoutMs }) {
  const startedAt = Date.now()
  const results = await Promise.allSettled(
    Array.from({ length: parallel }, (_, index) => callOpencode({ model, contextPath, workspaceDir, timeoutMs, index })),
  )
  const failures = results.filter((result) => result.status === 'rejected')
  return {
    parallel,
    ok: failures.length === 0,
    durationMs: Date.now() - startedAt,
    failures: failures.slice(0, 3).map((failure) => String(failure.reason?.message ?? failure.reason)),
  }
}

async function callOpencode({ model, contextPath, workspaceDir, timeoutMs, index }) {
  const command = buildOpencodeCommand({
    model,
    contextPath,
    workspaceDir,
    title: `local-qwen-probe-${index}`,
  })
  return runProcess(command.command, command.args, { timeoutMs })
}

async function runEndpointParallelAttempt({ endpoint, request, parallel, timeoutMs }) {
  const startedAt = Date.now()
  const results = await Promise.allSettled(
    Array.from({ length: parallel }, (_, index) => callChatCompletion({ endpoint, request, timeoutMs, index })),
  )
  const failures = results.filter((result) => result.status === 'rejected')
  return {
    parallel,
    ok: failures.length === 0,
    durationMs: Date.now() - startedAt,
    failures: failures.slice(0, 3).map((failure) => String(failure.reason?.message ?? failure.reason)),
  }
}

function runProcess(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`opencode exited ${code}: ${(stderr || stdout).slice(0, 500)}`))
    })
  })
}

async function callChatCompletion({ endpoint, request, timeoutMs, index }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, metadata: { probe_index: index } }),
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`)
    return body
  } finally {
    clearTimeout(timer)
  }
}

function buildSection({ sourcePath, startLine, endLine, text, title, level }) {
  const firstLine = text.split('\n', 1)[0] ?? ''
  const headline = firstLine.match(/^(\*+)\s+(.*)$/)
  return {
    sourcePath,
    startLine,
    endLine,
    level: level ?? (headline ? headline[1].length : 0),
    title: title ?? (headline ? headline[2].trim() : 'Untitled'),
    text,
    estimatedTokens: estimateTokens(text),
  }
}

function assertLocalEndpoint(endpoint, allowNonLocal) {
  const url = new URL(endpoint)
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (!allowNonLocal && !localHosts.has(url.hostname)) {
    throw new Error(`Refusing non-local endpoint ${endpoint}. Pass --allow-nonlocal only if you intentionally want network traffic.`)
  }
}

function assertLocalOpencodeModel(model, allowNonLocal) {
  if (allowNonLocal) return
  if (LOCAL_OPENCODE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))) return
  throw new Error(`Refusing non-local opencode model ${model}. Expected one of: ${LOCAL_OPENCODE_MODEL_PREFIXES.join(', ')}. Pass --allow-nonlocal only deliberately.`)
}

async function createProbeWorkspace() {
  const baseDir = path.join(process.cwd(), 'scratch', 'local-qwen-probe')
  await mkdir(baseDir, { recursive: true })
  const workspaceDir = path.join(baseDir, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(workspaceDir, { recursive: true })
  return workspaceDir
}

function buildOpencodePrompt() {
  return [
    'Use only the attached packed-org-context.md file.',
    'Do not inspect the repository, home directory, chat history, or environment.',
    'Return exactly three bullets: actionable next thought, concrete questions, missing context.',
  ].join(' ')
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (!raw.startsWith('--')) continue
    const [key, inlineValue] = raw.slice(2).split('=', 2)
    const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    const next = argv[index + 1]
    if (inlineValue !== undefined) {
      args[camelKey] = coerceValue(inlineValue)
    } else if (!next || next.startsWith('--')) {
      args[camelKey] = true
    } else {
      args[camelKey] = coerceValue(next)
      index += 1
    }
  }
  return args
}

function resolveSystemPrompt(args) {
  if (args.systemPrompt === 'none') return 'none'
  if (typeof args.systemPrompt === 'string') return args.systemPrompt
  return MINIMAL_SYSTEM_PROMPT
}

function coerceValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  const number = Number(value)
  return Number.isFinite(number) && value.trim() !== '' ? number : value
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function summarizeRequest(request) {
  return {
    model: request.model,
    messageCount: request.messages.length,
    estimatedMessageTokens: estimateTokens(request.messages.map((message) => message.content).join('\n')),
    systemPromptTokens: estimateTokens(request.messages.find((message) => message.role === 'system')?.content ?? ''),
    max_tokens: request.max_tokens,
  }
}

function summarizeOpencodeCommand(command) {
  return {
    command: command.command,
    args: command.args.map((arg) => arg.length > 120 ? `${arg.slice(0, 117)}...` : arg),
    minimizesOverhead: [
      '--pure disables external plugins',
      '--dir points at an isolated scratch workspace',
      '--file attaches packed context instead of putting note text in argv',
    ],
  }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printHelp() {
  process.stdout.write(`local-qwen-probe\n\nOpenCode-first dummy/org context packer and parallel Qwen probe.\n\nUsage:\n  node scripts/local-qwen-probe.mjs --dry-run\n  node scripts/local-qwen-probe.mjs --model other-machine/Qwen3.6-35B-A3B --max-parallel 16\n  node scripts/local-qwen-probe.mjs --transport endpoint --endpoint http://127.0.0.1:11434/v1/chat/completions\n  node scripts/local-qwen-probe.mjs --file ./dummy.org --context-window-tokens 60000 --context-fraction 0.5 --max-parallel 16\n\nDefaults use opencode with local/other-machine models only. Use --allow-nonlocal only deliberately.\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
  })
}
