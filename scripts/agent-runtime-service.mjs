import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.AGENT_RUNTIME_PORT || 8765)
const HOST = process.env.AGENT_RUNTIME_HOST || '127.0.0.1'
const CODEX_COMMAND = process.env.AGENT_CODEX_COMMAND || 'codex'
const CODEX_ARGS = parseCommandArgs(
  process.env.AGENT_CODEX_ARGS ||
    'exec --dangerously-bypass-approvals-and-sandbox --json -',
)
const DEFAULT_TIMEOUT_MS = Number(process.env.AGENT_RUNTIME_TIMEOUT_MS || 1000 * 60 * 12)

const runs = new Map()
const chatSessions = new Map()

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', process.env.AGENT_RUNTIME_CORS_ORIGIN || '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      ok: true,
      runtime: 'local-codex',
      codexCommand: CODEX_COMMAND,
      codexArgs: CODEX_ARGS,
      runCount: runs.size,
      chatSessionCount: chatSessions.size,
    })
    return
  }

  const runStatusMatch = request.url?.match(/^\/agent-runs\/([^/?]+)$/)
  if (request.method === 'GET' && runStatusMatch) {
    const id = decodeURIComponent(runStatusMatch[1])
    const run = runs.get(id)
    if (!run) {
      writeJson(response, 404, { error: 'Agent run not found.' })
      return
    }
    if (run.result) {
      writeJson(response, 200, run.result)
      return
    }
    writeJson(response, 200, {
      runtimeId: 'local-codex',
      status: 'running',
      response: `Agent task ${id} is still running.`,
      externalId: id,
    })
    return
  }

  if (request.method === 'POST' && request.url === '/agent-runs') {
    try {
      const body = await readJson(request)
      const input = normalizeAgentRunInput(body)
      const existing = runs.get(input.request.id)
      if (existing?.status === 'completed' || existing?.status === 'failed') {
        writeJson(response, 200, existing.result)
        return
      }
      if (existing?.status === 'running' && existing.promise) {
        writeJson(response, 200, await existing.promise)
        return
      }

      const startedAt = new Date().toISOString()
      const promise = executeCodex(input.request, input.agent)
        .then((output) => ({
          runtimeId: 'local-codex',
          status: output.exitCode === 0 ? 'completed' : 'failed',
          response: output.stdout || output.stderr || 'Codex completed without output.',
          error: output.exitCode === 0 ? undefined : output.stderr || `Codex exited with ${output.exitCode}`,
          externalId: output.sessionId || undefined,
          metadata: {
            requestId: input.request.id,
            agentId: input.agent.id,
            startedAt,
            completedAt: new Date().toISOString(),
            exitCode: output.exitCode,
            stderr: output.stderr,
          },
        }))
        .catch((error) => ({
          runtimeId: 'local-codex',
          status: 'failed',
          response: errorMessage(error),
          error: errorMessage(error),
          metadata: {
            requestId: input.request.id,
            agentId: input.agent.id,
            startedAt,
            completedAt: new Date().toISOString(),
            exitCode: 1,
            stderr: errorMessage(error),
          },
        }))
      runs.set(input.request.id, {
        id: input.request.id,
        status: 'running',
        request: input.request,
        agent: input.agent,
        startedAt,
        promise,
      })

      const result = await promise
      runs.set(input.request.id, {
        id: input.request.id,
        status: result.status,
        request: input.request,
        agent: input.agent,
        result,
        startedAt,
      })
      writeJson(response, 200, result)
    } catch (error) {
      writeJson(response, 500, {
        runtimeId: 'local-codex',
        status: 'failed',
        response: errorMessage(error),
        error: errorMessage(error),
      })
    }
    return
  }

  writeJson(response, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Agent runtime service listening at http://${HOST}:${PORT}`)
  console.log(`Codex executor: ${CODEX_COMMAND} ${CODEX_ARGS.join(' ')}`)
})

function normalizeAgentRunInput(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Expected JSON body.')
  }
  const request = body.request
  const agent = body.agent
  if (!request || typeof request !== 'object') throw new Error('Missing request.')
  if (!agent || typeof agent !== 'object') throw new Error('Missing agent.')
  if (!request.id || !request.agentId || !request.prompt) {
    throw new Error('Request requires id, agentId, and prompt.')
  }
  if (!request.context || typeof request.context !== 'object') {
    throw new Error('Request requires context.')
  }
  return { request, agent }
}

function executeCodex(request, agent) {
  const prompt = buildCodexPrompt(request, agent)
  const threadId = request.context.threadId
  const persistedSessionId = typeof request.metadata?.codexSessionId === 'string'
    ? request.metadata.codexSessionId.trim()
    : ''
  const codexSessionId = chatSessions.get(threadId) || persistedSessionId
  const args = codexSessionId ? resumeCodexArgs(CODEX_ARGS, codexSessionId) : CODEX_ARGS
  return new Promise((resolve) => {
    const child = spawn(CODEX_COMMAND, args, {
      cwd: process.env.AGENT_RUNTIME_WORKDIR || process.cwd(),
      env: {
        ...process.env,
        BRANCH_CONTINUE_AGENT_REQUEST_ID: request.id,
        BRANCH_CONTINUE_AGENT_ID: agent.id,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      stderr += `\nTimed out after ${DEFAULT_TIMEOUT_MS}ms.`
      child.kill('SIGTERM')
    }, DEFAULT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${errorMessage(error)}`.trim() })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timeout)
      const parsed = parseCodexJsonOutput(stdout)
      if (parsed.sessionId && threadId) chatSessions.set(threadId, parsed.sessionId)
      resolve({
        exitCode: exitCode ?? 0,
        stdout: parsed.response || stdout.trim(),
        stderr: stderr.trim(),
        sessionId: parsed.sessionId || codexSessionId || '',
      })
    })
    child.stdin.end(prompt)
  })
}

function resumeCodexArgs(baseArgs, sessionId) {
  const execIndex = baseArgs.indexOf('exec')
  const rawOptions = execIndex >= 0 ? baseArgs.slice(execIndex + 1) : baseArgs.slice()
  const options = []
  for (let index = 0; index < rawOptions.length; index += 1) {
    const arg = rawOptions[index]
    if (arg === '-') continue
    if (arg === '--sandbox' || arg === '-s' || arg === '--ask-for-approval') {
      index += 1
      continue
    }
    options.push(arg)
  }
  return [
    ...(execIndex >= 0 ? baseArgs.slice(0, execIndex + 1) : ['exec']),
    'resume',
    ...options,
    sessionId,
    '-',
  ]
}

function parseCodexJsonOutput(stdout) {
  let sessionId = ''
  let response = ''
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        sessionId = event.thread_id
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        response = event.item.text
      }
    } catch {
      // Custom Codex wrappers may mix ordinary output with JSON events.
    }
  }
  return { sessionId, response }
}

function buildCodexPrompt(request, agent) {
  return [
    `You are @${agent.id}: ${agent.purpose || 'a local agent worker'}.`,
    '',
    'You are running as a local full-permission worker for Branch Continue.',
    'Answer the user request directly. Do not modify files unless the request explicitly asks for implementation or code changes.',
    '',
    `Prompt: ${request.prompt}`,
    '',
    'Anchor:',
    request.context.quote || '',
    '',
    'Local context:',
    request.context.localContext || '',
    '',
    'Full document:',
    request.context.documentText || '',
  ].join('\n')
}

function parseCommandArgs(value) {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? []
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function writeJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
