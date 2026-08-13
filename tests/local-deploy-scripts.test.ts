import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('local-only desktop deploy scripts', () => {
  it('packages the local app without invoking an OTA command', () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts['app:deploy']).toBe('pnpm app:package && ./scripts/deploy-single-app.sh')
    expect(packageJson.scripts['app:package']).toBe('pnpm tauri:build')
    expect(packageJson.scripts['tauri:build']).toBe('pnpm tauri build')
    expect(packageJson.scripts['tauri:build']).not.toMatch(/ota|updater|desktop-updater/)
  })
})
