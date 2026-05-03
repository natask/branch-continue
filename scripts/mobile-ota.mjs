#!/usr/bin/env node

import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appName = 'branch-continue'
const defaultRuntime = 'tauri-mobile-v1'
const defaultChannel = 'production'
const defaultMobileOtaUrl = 'https://branch-continue.elocute.main.lan/'
const outputRoot = path.join(repoRoot, '.mobile-ota')

const command = process.argv[2]
const args = process.argv.slice(3)

if (!command || command === '--help' || command === '-h') {
  printUsage()
  process.exit(command ? 0 : 1)
}

try {
  if (command === 'bundle') {
    await bundle(args)
  } else if (command === 'shell') {
    await shell(args)
  } else {
    throw new Error(`Unknown mobile OTA command: ${command}`)
  }
} catch (error) {
  console.error(`mobile-ota: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

async function bundle(rawArgs) {
  const { options, passthrough } = parseArgs(rawArgs)
  if (passthrough.length > 0) {
    throw new Error(`Unexpected bundle arguments: ${passthrough.join(' ')}`)
  }

  const channel = options.channel ?? process.env.MOBILE_OTA_CHANNEL ?? defaultChannel
  const runtime = options.runtime ?? process.env.MOBILE_OTA_RUNTIME ?? defaultRuntime
  const releaseId = sanitizeReleaseId(
    options.release ?? options['release-id'] ?? process.env.MOBILE_OTA_RELEASE_ID ?? (await defaultReleaseId()),
  )
  const outDir = path.resolve(repoRoot, options['out-dir'] ?? process.env.MOBILE_OTA_OUT_DIR ?? outputRoot)
  const publicUrl =
    options['public-url'] ?? process.env.MOBILE_OTA_PUBLIC_URL ?? process.env.MOBILE_OTA_URL ?? defaultMobileOtaUrl
  const skipBuild = options['skip-build'] === '1' || options['skip-build'] === 'true'
  const distDir = path.join(repoRoot, 'dist')

  if (!skipBuild) {
    run('pnpm', ['build'], {
      ...process.env,
      BRANCH_CONTINUE_MOBILE_OTA: '1',
    })
  }

  await assertFile(path.join(distDir, 'index.html'), 'Missing dist/index.html; run pnpm build first.')

  const files = await collectFiles(distDir)
  const fileEntries = []
  for (const file of files) {
    const absolutePath = path.join(distDir, file)
    const bytes = await fs.readFile(absolutePath)
    fileEntries.push({
      path: file,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
  }

  const manifest = {
    schemaVersion: 1,
    app: appName,
    channel,
    runtime,
    releaseId,
    appVersion: await readTauriVersion(),
    packageVersion: await readPackageVersion(),
    createdAt: new Date().toISOString(),
    entrypoint: 'index.html',
    publicUrl: publicUrl ? normalizeDirectoryUrl(publicUrl, { allowHttp: true }) : null,
    bundleSha256: hashManifestFiles(fileEntries),
    files: fileEntries,
  }

  const releaseDir = path.join(outDir, runtime, channel, 'releases', releaseId)
  const currentDir = path.join(outDir, runtime, channel, 'current')
  const channelManifestPath = path.join(outDir, runtime, channel, 'manifest.json')

  await replaceDir(releaseDir, distDir)
  await writeJson(path.join(releaseDir, 'branch-continue-mobile-ota.json'), manifest)
  await replaceDir(currentDir, releaseDir)
  await writeJson(channelManifestPath, manifest)

  console.log(`mobile-ota: built ${manifest.app} ${manifest.releaseId}`)
  console.log(`mobile-ota: current bundle ${path.relative(repoRoot, currentDir)}`)
  console.log(`mobile-ota: release bundle ${path.relative(repoRoot, releaseDir)}`)
  console.log(`mobile-ota: manifest ${path.relative(repoRoot, channelManifestPath)}`)
}

async function shell(rawArgs) {
  const platform = rawArgs[0]
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error('Usage: node scripts/mobile-ota.mjs shell <android|ios> [tauri build args]')
  }

  const { options, passthrough } = parseShellArgs(rawArgs.slice(1))
  const url = options.url ?? process.env.MOBILE_OTA_URL ?? defaultMobileOtaUrl

  const normalizedUrl = normalizeDirectoryUrl(url, {
    allowHttp: process.env.MOBILE_OTA_ALLOW_HTTP === '1' || options['allow-http'] === '1',
  })
  const remotePatterns = remoteCapabilityPatterns(normalizedUrl)
  const configPath = path.join(outputRoot, 'generated', `tauri.mobile-ota.${platform}.json`)
  const config = {
    build: {
      frontendDist: normalizedUrl,
      beforeBuildCommand: null,
    },
    app: {
      security: {
        capabilities: [
          'default',
          {
            identifier: 'mobile-ota-remote',
            description: 'Allows the configured mobile OTA bundle origin to use the same app permissions as the embedded frontend.',
            windows: ['main'],
            remote: {
              urls: remotePatterns,
            },
            permissions: [
              'core:default',
              'fs:default',
              'dialog:default',
              {
                identifier: 'fs:allow-read-text-file',
                allow: [{ path: '$HOME/**' }],
              },
              {
                identifier: 'fs:allow-read-file',
                allow: [{ path: '$HOME/**' }],
              },
              {
                identifier: 'fs:allow-write-text-file',
                allow: [{ path: '$HOME/**' }],
              },
              {
                identifier: 'fs:allow-write-file',
                allow: [{ path: '$HOME/**' }],
              },
              {
                identifier: 'fs:allow-exists',
                allow: [{ path: '$HOME/**' }],
              },
            ],
          },
        ],
      },
    },
  }

  await writeJson(configPath, config)

  console.log(`mobile-ota: shell URL ${normalizedUrl}`)
  console.log(`mobile-ota: remote capability ${remotePatterns.join(', ')}`)
  console.log(`mobile-ota: generated config ${path.relative(repoRoot, configPath)}`)

  run('pnpm', ['tauri', platform, 'build', '--config', configPath, ...passthrough], process.env)
}

function parseArgs(rawArgs) {
  const options = {}
  const passthrough = []

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
    if (eq !== -1) {
      options[arg.slice(2, eq)] = arg.slice(eq + 1)
      continue
    }

    const key = arg.slice(2)
    const next = rawArgs[index + 1]
    if (!next || next.startsWith('--')) {
      options[key] = '1'
      continue
    }

    options[key] = next
    index += 1
  }

  return { options, passthrough }
}

function parseShellArgs(rawArgs) {
  const options = {}
  const passthrough = []

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === '--') {
      passthrough.push(...rawArgs.slice(index + 1))
      break
    }

    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length)
      continue
    }

    if (arg === '--url') {
      const next = rawArgs[index + 1]
      if (!next) throw new Error('--url requires a value')
      options.url = next
      index += 1
      continue
    }

    if (arg === '--allow-http') {
      options['allow-http'] = '1'
      continue
    }

    passthrough.push(arg)
  }

  return { options, passthrough }
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

async function collectFiles(root) {
  const files = []

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) continue
      files.push(path.relative(root, absolutePath).split(path.sep).join('/'))
    }
  }

  await walk(root)
  return files.sort()
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

async function assertFile(file, message) {
  try {
    const stat = await fs.stat(file)
    if (stat.isFile()) return
  } catch {
    // Use the clearer caller-provided message below.
  }

  throw new Error(message)
}

async function readPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
  return pkg.version
}

async function readTauriVersion() {
  const config = JSON.parse(await fs.readFile(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  return config.version
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

function sanitizeReleaseId(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function normalizeDirectoryUrl(value, { allowHttp }) {
  const url = new URL(value)
  const allowed = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
  if (!allowed) {
    throw new Error('Mobile OTA URLs must use HTTPS. Set MOBILE_OTA_ALLOW_HTTP=1 only for local device testing.')
  }

  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`
  }

  url.hash = ''
  return url.href
}

function remoteCapabilityPatterns(value) {
  const url = new URL(value)
  url.search = ''
  url.hash = ''
  const exact = `${url.origin}${url.pathname}`
  return [exact, `${exact}*`]
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function hashManifestFiles(fileEntries) {
  const hash = crypto.createHash('sha256')
  for (const file of fileEntries) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function printUsage() {
  console.log(`Usage:
  pnpm mobile:ota:bundle
  pnpm mobile:shell:android
  pnpm mobile:shell:ios

Environment:
  MOBILE_OTA_CHANNEL       Channel name, default ${defaultChannel}
  MOBILE_OTA_RUNTIME       Native compatibility lane, default ${defaultRuntime}
  MOBILE_OTA_OUT_DIR       Bundle output directory, default .mobile-ota
  MOBILE_OTA_PUBLIC_URL    Optional public URL recorded in the manifest, default ${defaultMobileOtaUrl}
  MOBILE_OTA_URL           HTTPS URL the native mobile shell loads, default ${defaultMobileOtaUrl}
`)
}
