#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appName = 'branch-continue'
const defaultChannel = 'production'
const defaultEndpoint = 'https://branch-continue.elocute.main.lan/desktop/latest.json'
const defaultRemoteHost = 'reclaim@10.147.17.10'
const defaultRemoteBase = '/home/reclaim-ethiopia/agent-stations/apps/branch-continue/desktop-ota'
const defaultOutputRoot = path.join(repoRoot, '.desktop-ota')
const defaultKeyPath = path.join(defaultOutputRoot, 'keys', 'branch-continue.key')

const command = process.argv[2]
const args = process.argv.slice(3)

if (!command || command === '--help' || command === '-h' || args.includes('--help') || args.includes('-h')) {
  printUsage()
  process.exit(command ? 0 : 1)
}

try {
  if (command === 'init') {
    await init(args)
  } else if (command === 'package') {
    await packageDesktop(args)
  } else if (command === 'deploy') {
    await deploy(args)
  } else if (command === 'stage') {
    await stage(args)
  } else {
    throw new Error(`Unknown desktop updater command: ${command}`)
  }
} catch (error) {
  console.error(`desktop-updater: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

async function init(rawArgs) {
  const { options, passthrough } = parseArgs(rawArgs)
  if (passthrough.length > 0) {
    throw new Error(`Unexpected init arguments: ${passthrough.join(' ')}`)
  }

  const signing = await ensureSigningKey(options)
  console.log(`desktop-updater: private key ${path.relative(repoRoot, signing.keyPath)}`)
  console.log(`desktop-updater: public key ${signing.publicKey}`)
}

async function packageDesktop(rawArgs) {
  const { options, passthrough } = parseArgs(rawArgs)
  const signing = await ensureSigningKey(options)
  const configPath = await writeGeneratedConfig(signing.publicKey, options)

  console.log(`desktop-updater: generated config ${path.relative(repoRoot, configPath)}`)
  run('pnpm', ['tauri', 'build', '--config', configPath, ...passthrough], signing.env)

  if (options['skip-stage'] !== '1' && options['skip-stage'] !== 'true') {
    return await stageFromOptions(options)
  }

  return null
}

async function deploy(rawArgs) {
  const { options, passthrough } = parseArgs(rawArgs)
  if (passthrough.length > 0) {
    throw new Error(`Unexpected deploy arguments: ${passthrough.join(' ')}`)
  }
  if (options['skip-stage'] === '1' || options['skip-stage'] === 'true') {
    throw new Error('Desktop OTA deploy requires staging. Remove --skip-stage.')
  }

  const staged = await packageDesktop(rawArgs)
  if (!staged) {
    throw new Error('Desktop OTA deploy did not produce a staged update.')
  }

  const remoteHost = options.host ?? process.env.DESKTOP_UPDATE_SSH_HOST ?? defaultRemoteHost
  const remoteBase = options['remote-base'] ?? process.env.DESKTOP_UPDATE_REMOTE_BASE ?? defaultRemoteBase
  const remoteRelease = `${remoteBase.replace(/\/+$/, '')}/releases/${staged.manifest.releaseId}`

  run('ssh', [remoteHost, `mkdir -p ${shellQuote(remoteRelease)}`], process.env)
  run('rsync', ['-az', '--delete', `${staged.currentDir}/`, `${remoteHost}:${remoteRelease}/`], process.env)
  run(
    'ssh',
    [
      remoteHost,
      [
        'set -e',
        `cd ${shellQuote(remoteBase)}`,
        `ln -sfn ${shellQuote(remoteRelease)} current.next`,
        'mv -Tf current.next current',
        'readlink -f current',
      ].join('; '),
    ],
    process.env,
  )

  console.log(`desktop-updater: deployed ${staged.manifest.releaseId} to ${remoteHost}:${remoteRelease}`)
}

async function stage(rawArgs) {
  const { options, passthrough } = parseArgs(rawArgs)
  if (passthrough.length > 0) {
    throw new Error(`Unexpected stage arguments: ${passthrough.join(' ')}`)
  }

  await stageFromOptions(options)
}

async function stageFromOptions(options) {
  const channel = options.channel ?? process.env.DESKTOP_UPDATE_CHANNEL ?? defaultChannel
  const releaseId = sanitizeReleaseId(
    options.release ?? options['release-id'] ?? process.env.DESKTOP_UPDATE_RELEASE_ID ?? (await defaultReleaseId()),
  )
  const outDir = path.resolve(repoRoot, options['out-dir'] ?? process.env.DESKTOP_UPDATE_OUT_DIR ?? defaultOutputRoot)
  const endpoint = resolveEndpoint(options)
  const assetBase = resolveAssetBase(options, endpoint)
  const version = await readTauriVersion()
  const platformKey = options['update-target'] ?? process.env.DESKTOP_UPDATE_TARGET ?? currentPlatformKey()
  const artifact = await selectUpdaterArtifact(platformKey)
  const fileName = path.basename(artifact.file)
  const signature = (await fs.readFile(artifact.signature, 'utf8')).trim()
  const artifactUrl = new URL(encodePathSegment(fileName), assetBase).href
  const createdAt = new Date().toISOString()
  const releaseDir = path.join(outDir, channel, 'releases', releaseId)
  const currentDir = path.join(outDir, channel, 'current')
  const channelManifestPath = path.join(outDir, channel, 'manifest.json')

  const latest = {
    version,
    notes: options.notes ?? process.env.DESKTOP_UPDATE_NOTES ?? '',
    pub_date: createdAt,
    platforms: {
      [platformKey]: {
        signature,
        url: artifactUrl,
      },
    },
  }

  const manifest = {
    schemaVersion: 1,
    app: appName,
    channel,
    releaseId,
    appVersion: version,
    createdAt,
    endpoint,
    platform: platformKey,
    artifact: fileName,
    artifactUrl,
  }

  await fs.rm(releaseDir, { recursive: true, force: true })
  await fs.mkdir(releaseDir, { recursive: true })
  await fs.copyFile(artifact.file, path.join(releaseDir, fileName))
  await fs.copyFile(artifact.signature, path.join(releaseDir, `${fileName}.sig`))
  await writeJson(path.join(releaseDir, 'latest.json'), latest)
  await writeJson(path.join(releaseDir, 'branch-continue-desktop-update.json'), manifest)
  await replaceDir(currentDir, releaseDir)
  await writeJson(channelManifestPath, manifest)

  console.log(`desktop-updater: staged ${manifest.app} ${manifest.releaseId}`)
  console.log(`desktop-updater: current bundle ${path.relative(repoRoot, currentDir)}`)
  console.log(`desktop-updater: release bundle ${path.relative(repoRoot, releaseDir)}`)
  console.log(`desktop-updater: latest.json ${path.relative(repoRoot, path.join(currentDir, 'latest.json'))}`)
  return { manifest, currentDir }
}

async function ensureSigningKey(options) {
  const env = { ...process.env }
  const explicitPrivateKey = env.TAURI_SIGNING_PRIVATE_KEY
  const explicitPrivateKeyPath = options['key-path'] ?? env.TAURI_SIGNING_PRIVATE_KEY_PATH
  const publicKeyFromEnv = options['public-key'] ?? env.DESKTOP_UPDATER_PUBLIC_KEY
  const publicKeyPath =
    options['public-key-path'] ?? env.DESKTOP_UPDATER_PUBLIC_KEY_PATH ?? inferPublicKeyPath(explicitPrivateKeyPath)

  if (explicitPrivateKey || explicitPrivateKeyPath) {
    const publicKey = publicKeyFromEnv ?? (publicKeyPath ? await readPublicKey(publicKeyPath) : null)
    if (!publicKey) {
      throw new Error(
        'Set DESKTOP_UPDATER_PUBLIC_KEY or DESKTOP_UPDATER_PUBLIC_KEY_PATH when using an external signing key.',
      )
    }

    if (explicitPrivateKeyPath && !env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
      env.TAURI_SIGNING_PRIVATE_KEY_PATH = path.resolve(repoRoot, explicitPrivateKeyPath)
    }
    if (explicitPrivateKeyPath && !env.TAURI_SIGNING_PRIVATE_KEY) {
      env.TAURI_SIGNING_PRIVATE_KEY = await fs.readFile(path.resolve(repoRoot, explicitPrivateKeyPath), 'utf8')
    }
    if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = options['key-password'] ?? process.env.DESKTOP_UPDATE_KEY_PASSWORD ?? ''
    }

    return {
      keyPath: explicitPrivateKeyPath ? path.resolve(repoRoot, explicitPrivateKeyPath) : '<env>',
      publicKey,
      env,
    }
  }

  const keyPath = path.resolve(repoRoot, options['key-path'] ?? env.DESKTOP_UPDATE_KEY_PATH ?? defaultKeyPath)
  const keyPassword = options['key-password'] ?? env.DESKTOP_UPDATE_KEY_PASSWORD

  if (!(await fileExists(keyPath)) || !(await fileExists(`${keyPath}.pub`))) {
    await fs.mkdir(path.dirname(keyPath), { recursive: true })
    const signerArgs = ['tauri', 'signer', 'generate', '--ci', '-w', keyPath]
    if (keyPassword) signerArgs.push('-p', keyPassword)
    run('pnpm', signerArgs, env)
  }

  env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath
  env.TAURI_SIGNING_PRIVATE_KEY = await fs.readFile(keyPath, 'utf8')
  if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = keyPassword ?? ''
  }

  return {
    keyPath,
    publicKey: await readPublicKey(`${keyPath}.pub`),
    env,
  }
}

async function writeGeneratedConfig(publicKey, options) {
  const endpoint = resolveEndpoint(options)
  const allowHttp = isHttpAllowed(options)
  const configPath = path.join(defaultOutputRoot, 'generated', 'tauri.desktop-updater.json')
  const config = {
    bundle: {
      createUpdaterArtifacts: true,
    },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [endpoint],
        windows: {
          installMode: 'passive',
        },
        ...(endpoint.startsWith('http:') && allowHttp ? { dangerousInsecureTransportProtocol: true } : {}),
      },
    },
  }

  await writeJson(configPath, config)
  return configPath
}

async function selectUpdaterArtifact(platformKey) {
  const bundleRoot = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle')
  const signatures = await collectFiles(bundleRoot, (file) => file.endsWith('.sig'))
  const artifacts = []

  for (const signature of signatures) {
    const file = signature.slice(0, -'.sig'.length)
    if (!(await fileExists(file))) continue
    artifacts.push({
      file,
      signature,
      score: scoreArtifact(platformKey, file),
    })
  }

  const usable = artifacts.filter((artifact) => artifact.score > 0)
  usable.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))

  if (!usable[0]) {
    throw new Error('No signed updater artifact found. Run pnpm desktop:ota:package first.')
  }

  return usable[0]
}

function scoreArtifact(platformKey, file) {
  const normalized = file.replaceAll(path.sep, '/')
  if (platformKey.startsWith('darwin-')) {
    if (normalized.endsWith('.app.tar.gz')) return 100
    if (normalized.endsWith('.dmg')) return 10
  }

  if (platformKey.startsWith('windows-')) {
    if (normalized.endsWith('-setup.exe') || normalized.endsWith('.exe')) return 100
    if (normalized.endsWith('.msi')) return 90
    if (normalized.endsWith('.zip')) return 80
  }

  if (platformKey.startsWith('linux-')) {
    if (normalized.endsWith('.AppImage')) return 100
    if (normalized.endsWith('.tar.gz')) return 90
  }

  return 0
}

async function collectFiles(root, predicate) {
  const files = []

  async function walk(currentDir) {
    let entries
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
      } else if (entry.isFile() && predicate(absolutePath)) {
        files.push(absolutePath)
      }
    }
  }

  await walk(root)
  return files.sort()
}

function parseArgs(rawArgs) {
  const options = {}
  const passthrough = []
  const valueOptions = new Set([
    'asset-base-url',
    'channel',
    'endpoint',
    'host',
    'key-password',
    'key-path',
    'notes',
    'out-dir',
    'public-key',
    'public-key-path',
    'release',
    'release-id',
    'remote-base',
    'update-target',
  ])
  const flagOptions = new Set(['allow-http', 'skip-stage'])

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === '--') {
      passthrough.push(...rawArgs.slice(index + 1))
      break
    }

    if (!arg.startsWith('--')) {
      passthrough.push(arg)
      continue
    }

    const eq = arg.indexOf('=')
    const rawKey = eq === -1 ? arg.slice(2) : arg.slice(2, eq)

    if (valueOptions.has(rawKey)) {
      if (eq !== -1) {
        options[rawKey] = arg.slice(eq + 1)
        continue
      }

      const next = rawArgs[index + 1]
      if (!next) throw new Error(`--${rawKey} requires a value`)
      options[rawKey] = next
      index += 1
      continue
    }

    if (flagOptions.has(rawKey)) {
      options[rawKey] = eq === -1 ? '1' : arg.slice(eq + 1)
      continue
    }

    passthrough.push(arg)
  }

  return { options, passthrough }
}

function resolveEndpoint(options) {
  const endpoint = options.endpoint ?? process.env.DESKTOP_UPDATE_ENDPOINT ?? defaultEndpoint
  return normalizeUrl(endpoint, { allowHttp: isHttpAllowed(options), requireDirectory: false })
}

function resolveAssetBase(options, endpoint) {
  const explicit = options['asset-base-url'] ?? process.env.DESKTOP_UPDATE_ASSET_BASE_URL
  if (explicit) {
    return normalizeUrl(explicit, { allowHttp: isHttpAllowed(options), requireDirectory: true })
  }

  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/[^/]*$/, '')
  url.search = ''
  url.hash = ''
  return normalizeUrl(url.href, { allowHttp: isHttpAllowed(options), requireDirectory: true })
}

function normalizeUrl(value, { allowHttp, requireDirectory }) {
  const url = new URL(value)
  const allowed = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
  if (!allowed) {
    throw new Error('Desktop updater URLs must use HTTPS. Set DESKTOP_UPDATE_ALLOW_HTTP=1 only for local testing.')
  }

  if (requireDirectory && !url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`
  }

  url.hash = ''
  return url.href
}

function isHttpAllowed(options) {
  return options['allow-http'] === '1' || options['allow-http'] === 'true' || process.env.DESKTOP_UPDATE_ALLOW_HTTP === '1'
}

function currentPlatformKey() {
  const os = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  }[process.platform]
  const arch = {
    arm: 'armv7',
    arm64: 'aarch64',
    ia32: 'i686',
    x64: 'x86_64',
  }[process.arch]

  if (!os || !arch) {
    throw new Error(`Unsupported updater platform ${process.platform}-${process.arch}`)
  }

  return `${os}-${arch}`
}

async function defaultReleaseId() {
  const timestamp = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z')
  const version = await readTauriVersion()
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const suffix = git.status === 0 ? `-${git.stdout.trim()}` : ''
  return `${version}-${timestamp}${suffix}`
}

async function readTauriVersion() {
  const config = JSON.parse(await fs.readFile(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  return config.version
}

async function readPublicKey(publicKeyPath) {
  return (await fs.readFile(path.resolve(repoRoot, publicKeyPath), 'utf8')).trim()
}

function inferPublicKeyPath(privateKeyPath) {
  return privateKeyPath ? `${privateKeyPath}.pub` : null
}

async function replaceDir(target, source) {
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.cp(source, target, { recursive: true })
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  await fs.rename(`${file}.tmp`, file)
}

async function fileExists(file) {
  try {
    const stat = await fs.stat(file)
    return stat.isFile()
  } catch {
    return false
  }
}

function sanitizeReleaseId(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function encodePathSegment(value) {
  return value.split('/').map(encodeURIComponent).join('/')
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function run(commandName, commandArgs, env) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${commandName} ${commandArgs.join(' ')} exited with ${result.status}`)
  }
}

function printUsage() {
  console.log(`Usage:
  pnpm desktop:updater:init
  pnpm desktop:ota:package
  pnpm desktop:ota:deploy
  pnpm desktop:ota:stage

Environment:
  DESKTOP_UPDATE_CHANNEL          Channel name, default ${defaultChannel}
  DESKTOP_UPDATE_ENDPOINT         Updater latest.json URL, default ${defaultEndpoint}
  DESKTOP_UPDATE_ASSET_BASE_URL   Public URL directory for staged artifacts
  DESKTOP_UPDATE_OUT_DIR          Output directory, default .desktop-ota
  DESKTOP_UPDATE_KEY_PATH         Local signing key path, default .desktop-ota/keys/branch-continue.key
  DESKTOP_UPDATE_ALLOW_HTTP       Set to 1 only for local HTTP update testing
  DESKTOP_UPDATE_SSH_HOST         SSH upload target, default ${defaultRemoteHost}
  DESKTOP_UPDATE_REMOTE_BASE      Remote release base, default ${defaultRemoteBase}
`)
}
