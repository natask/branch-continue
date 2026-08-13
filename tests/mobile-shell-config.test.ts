import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('mobile OTA shell configuration', () => {
  it('grants the hosted phone surface its required native commands', () => {
    execFileSync(
      process.execPath,
      ['scripts/mobile-ota.mjs', 'shell', 'android', '--config-only'],
      { cwd: repoRoot, stdio: 'pipe' },
    )

    const config = JSON.parse(
      readFileSync(path.join(repoRoot, '.mobile-ota/generated/tauri.mobile-ota.android.json'), 'utf8'),
    )
    const remoteCapability = config.app.security.capabilities.find(
      (capability: { identifier?: string }) => capability.identifier === 'mobile-ota-remote',
    )

    expect(remoteCapability.remote.urls).toEqual([
      'http://10.147.17.10/mobile/',
      'http://10.147.17.10/mobile/*',
    ])
    expect(remoteCapability.permissions).toEqual(expect.arrayContaining([
      'allow-microphone-permission-state',
      'allow-submit-switchboard-intent',
      'allow-fetch-switchboard-tasks',
    ]))
  })
})
