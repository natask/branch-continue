import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

const { CodexAppServer } = await import('../scripts/codex-app-server.mjs')
const services: ChildProcess[] = []
const clients: InstanceType<typeof CodexAppServer>[] = []
const directories: string[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.kill('SIGTERM')
  for (const client of clients.splice(0)) client.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function createClient(mode = 'normal') {
  const directory = await mkdtemp(join(tmpdir(), 'backbone-codex-test-'))
  directories.push(directory)
  const command = join(directory, 'codex')
  await writeFile(command, `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
rl.on('line', (line) => {
 const message = JSON.parse(line);
 if (message.id == null) return;
 const reply = (result) => send({ id: message.id, result });
 if (message.method === 'initialize') return reply({});
 if (message.method === 'model/list') return reply({ data: [{ model: 'available-test-model', isDefault: true }] });
 if (message.method === 'account/read') return reply({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true });
 if (message.method === 'account/login/start') return reply({ authUrl: 'https://auth.openai.com/test', loginId: 'login' });
 if (message.method.startsWith('thread/') && !message.params.developerInstructions.includes('Backbone page assistant')) process.exit(3);
 if (message.method.startsWith('thread/')) return reply({ thread: { id: message.params.threadId || 'test-thread' } });
 if (message.method === 'turn/start') {
  if (message.params.approvalPolicy !== 'never' || message.params.sandboxPolicy.type !== 'readOnly') process.exit(2);
  if (${JSON.stringify(mode)} === 'exit') return process.exit(1);
  // Deliberately send events before the turn/start response to cover the race.
  const text = message.params.outputSchema ? JSON.stringify({ response: 'Fixed spelling.', editedDocument: 'A small note.' }) : 'A reply';
  send({ method: 'item/completed', params: { threadId: message.params.threadId, item: { type: 'agentMessage', text } } });
  send({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: { id: 'turn-1', status: 'completed' } } });
  return reply({ turn: { id: 'turn-1' } });
 }
 reply({});
});
`)
  await chmod(command, 0o755)
  const client = new CodexAppServer({ command, cwd: directory, timeoutMs: 3000 })
  clients.push(client)
  return client
}

describe('JavaScript Codex page runtime', () => {
  it('reads normal Codex sign-in and starts browser authentication', async () => {
    const client = await createClient()
    expect((await client.account()).account.type).toBe('chatgpt')
    expect((await client.login()).authUrl).toBe('https://auth.openai.com/test')
  })

  it('returns a full page revision and can resume the conversation', async () => {
    const client = await createClient()
    const result = await client.run({ prompt: 'Fix spelling', editPage: true })
    expect(result).toEqual({ response: 'Fixed spelling.', editedDocument: 'A small note.', sessionId: 'test-thread' })
    expect(await client.run({ prompt: 'Explain', sessionId: result.sessionId })).toEqual({ response: 'A reply', sessionId: 'test-thread' })
  })

  it('fails promptly when the Codex process closes during a request', async () => {
    const client = await createClient('exit')
    await expect(client.run({ prompt: 'test' })).rejects.toThrow('exited')
  })
})

async function startService() {
  const fake = await createClient()
  const service = spawn(process.execPath, ['scripts/agent-runtime-service.mjs'], {
    cwd: process.cwd(), env: { ...process.env, AGENT_CODEX_COMMAND: fake.command, AGENT_CODEX_ARGS: '', AGENT_RUNTIME_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  services.push(service)
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Runtime service failed to listen.')), 3000)
    service.on('error', (error) => { clearTimeout(timer); reject(error) })
    service.stdout!.on('data', (chunk) => {
      const match = chunk.toString().match(/listening at (http:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
}

describe('Codex runtime HTTP contract', () => {
  it('denies untrusted browser origins before starting an account operation', async () => {
    const url = await startService()
    const denied = await fetch(`${url}/codex/account`, { headers: { Origin: 'https://untrusted.example' } })
    expect(denied.status).toBe(403)
    const allowed = await fetch(`${url}/codex/account`, { headers: { Origin: 'tauri://localhost' } })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('tauri://localhost')
    expect((await allowed.json()).account.type).toBe('chatgpt')
  })

  it('returns structured edits and deduplicates a repeated page request', async () => {
    const url = await startService()
    const body = {
      request: { id: 'request-1', agentId: 'codex', prompt: 'Fix spelling', context: { pageId: 'page-1', threadId: 'thread-1', documentText: 'A smal note.' }, metadata: { editPage: true, pageSystemPrompt: 'Preserve meaning.' } },
      agent: { id: 'codex', purpose: 'Edit this page' },
    }
    const submit = () => fetch(`${url}/agent-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((response) => response.json())
    const result = await submit()
    expect(result.status).toBe('completed')
    expect(result.editedDocument).toBe('A small note.')
    expect(result.externalId).toBe('test-thread')
    expect(await submit()).toEqual(result)
    expect(await fetch(`${url}/agent-runs/request-1`).then((response) => response.json())).toEqual(result)
  })
})
