import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { homedir, networkInterfaces } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('Start the Backbone runtime with pnpm agent:runtime on this platform.')
  process.exit(0)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const label = 'com.natnael.backbone-agent'
const domain = `gui/${process.getuid()}`
const logs = path.join(homedir(), 'Library', 'Logs', 'Backbone')
const agents = path.join(homedir(), 'Library', 'LaunchAgents')
const plist = path.join(agents, `${label}.plist`)
const codex = process.env.AGENT_CODEX_COMMAND || execFileSync('/usr/bin/which', ['codex'], { encoding: 'utf8' }).trim()
const overlayAddress = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === 'IPv4' && entry.address === '10.147.17.6')?.address
const mobileHost = process.env.AGENT_RUNTIME_MOBILE_HOST || overlayAddress
const mobileOrigin = process.env.AGENT_RUNTIME_CORS_ORIGIN || 'http://10.147.17.10'
const xml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
await mkdir(logs, { recursive: true })
await mkdir(agents, { recursive: true })
await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root, 'scripts/agent-runtime-service.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH || '/usr/bin:/bin')}</string><key>AGENT_CODEX_COMMAND</key><string>${xml(codex)}</string>${mobileHost ? `<key>AGENT_RUNTIME_MOBILE_HOST</key><string>${xml(mobileHost)}</string><key>AGENT_RUNTIME_CORS_ORIGIN</key><string>${xml(mobileOrigin)}</string>` : ''}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'runtime.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'runtime-error.log'))}</string>
</dict></plist>\n`, { mode: 0o600 })
spawnSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' })
execFileSync('launchctl', ['bootstrap', domain, plist])
console.log(`Installed Backbone runtime: ${plist}`)
