import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/** A local Codex connection. Credentials stay in Codex's own account store. */
export class CodexAppServer {
  constructor({ command = process.env.AGENT_CODEX_COMMAND || 'codex', cwd = process.env.AGENT_RUNTIME_WORKDIR || process.cwd(), timeoutMs = 720000 } = {}) {
    this.command = command
    this.cwd = cwd
    this.timeoutMs = timeoutMs
    this.pending = new Map()
    this.listeners = new Set()
    this.nextId = 0
  }

  async connect() {
    if (this.connection) return this.connection
    this.connection = this.start().catch((error) => {
      this.connection = null
      throw error
    })
    return this.connection
  }

  async start() {
    const child = spawn(this.command, ['app-server'], { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8000) })
    const fail = (error) => {
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
      for (const listener of this.listeners) listener({ method: 'connection/closed', params: { error: error.message } })
      this.connection = null
      if (this.child === child) this.child = null
    }
    child.on('error', fail)
    child.on('exit', (code) => fail(new Error(`Codex app-server exited (${code}). ${stderr}`.trim())))
    child.stdin.on('error', fail)
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.id != null && !message.method) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message || 'Codex request failed.'))
        else entry.resolve(message.result)
      } else if (message.id != null && message.method) {
        // Page agents never approve commands, file writes, or external credentials.
        this.send({ id: message.id, error: { code: -32601, message: 'Interactive tools are unavailable for page agents.' } })
      } else {
        for (const listener of this.listeners) listener(message)
      }
    })
    await this.rpc('initialize', { clientInfo: { name: 'backbone', title: 'Backbone', version: '0.1.0' } })
    this.send({ method: 'initialized', params: {} })
  }

  send(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex app-server is disconnected.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  rpc(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex ${method} timed out.`))
      }, this.timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      try { this.send({ id, method, params }) } catch (error) {
        this.pending.get(id)?.reject(error)
        this.pending.delete(id)
      }
    })
  }

  async account() {
    await this.connect()
    return this.rpc('account/read', { refreshToken: false })
  }

  async login(deviceCode = false) {
    await this.connect()
    return this.rpc('account/login/start', { type: deviceCode ? 'chatgptDeviceCode' : 'chatgpt' })
  }

  async run({ prompt, sessionId, editPage = false, instructions = '' }) {
    await this.connect()
    // Resolve the account's available default rather than inheriting an inaccessible
    // model from a different Codex client configuration.
    const models = await this.rpc('model/list', {})
    const model = process.env.AGENT_CODEX_MODEL || models.data?.find((entry) => entry.isDefault)?.model || models.data?.[0]?.model
    const threadParams = {
      cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only',
      developerInstructions: [
        'You are the Backbone page assistant. Work only on the page supplied in the prompt. Do not read local files, run commands, or use external tools. Return edits as document text for the application to save.',
        instructions,
      ].filter(Boolean).join('\n\n'),
      ...(model ? { model } : {}),
    }
    const result = sessionId
      ? await this.rpc('thread/resume', { ...threadParams, threadId: sessionId })
      : await this.rpc('thread/start', threadParams)
    const threadId = result.thread.id
    let finalResponse = ''
    let activeTurnId
    const events = []
    let finish
    const completion = new Promise((resolve, reject) => { finish = { resolve, reject } })
    // A connection can close while turn/start is still awaiting its RPC response.
    completion.catch(() => {})
    const handle = (event) => {
      if (event.method === 'connection/closed') {
        finish.reject(new Error(event.params.error))
        return
      }
      if (event.params?.threadId !== threadId) return
      if (!activeTurnId) { events.push(event); return }
      if (event.params.turnId && event.params.turnId !== activeTurnId) return
      if (event.method === 'item/completed' && event.params.item?.type === 'agentMessage') {
        finalResponse = event.params.item.text || ''
      }
      if (event.method === 'turn/completed' && event.params.turn?.id === activeTurnId) {
        const turn = event.params.turn
        if (turn.status !== 'completed') finish.reject(new Error(turn.error?.message || `Codex turn ${turn.status}.`))
        else finish.resolve()
      }
    }
    this.listeners.add(handle)
    let timer
    try {
      const turnParams = { threadId, input: [{ type: 'text', text: prompt }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } }
      if (editPage) turnParams.outputSchema = {
        type: 'object', additionalProperties: false,
        properties: { response: { type: 'string' }, editedDocument: { type: 'string' } },
        required: ['response', 'editedDocument'],
      }
      const started = await this.rpc('turn/start', turnParams)
      activeTurnId = started.turn.id
      timer = setTimeout(() => {
        this.rpc('turn/interrupt', { threadId, turnId: activeTurnId }).catch(() => {})
        finish.reject(new Error('Codex page agent timed out.'))
      }, this.timeoutMs)
      for (const event of events) handle(event)
      await completion
      if (editPage) {
        const edited = JSON.parse(finalResponse)
        if (typeof edited.editedDocument !== 'string' || typeof edited.response !== 'string') throw new Error('Codex returned an invalid page edit.')
        return { response: edited.response, editedDocument: edited.editedDocument, sessionId: threadId }
      }
      return { response: finalResponse, sessionId: threadId }
    } finally {
      clearTimeout(timer)
      this.listeners.delete(handle)
    }
  }

  close() { this.child?.kill('SIGTERM') }
}
