import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('local-only desktop deploy scripts', () => {
  it('packages the local app without invoking an OTA command', () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts['app:deploy']).toBe('pnpm app:package && ./scripts/deploy-single-app.sh')
    expect(packageJson.scripts.deploy).toBe('pnpm app:deploy')
    expect(packageJson.scripts['app:package']).toBe('pnpm tauri:build')
    expect(packageJson.scripts['tauri:build']).toBe('pnpm tauri build')
    expect(packageJson.scripts['tauri:build']).not.toMatch(/ota|updater|desktop-updater/)
  })

  it('keeps desktop update startup disabled while allowing mobile OTA', () => {
    const main = readFileSync(path.join(repoRoot, 'src/main.tsx'), 'utf8')
    const nativeApp = readFileSync(path.join(repoRoot, 'src-tauri/src/lib.rs'), 'utf8')

    expect(main).toContain('const deploymentUpdatesEnabled = false')
    expect(main).toMatch(/if \(deploymentUpdatesEnabled\) \{\s*startDesktopUpdater\(\)\s*\}/)
    expect(main).toContain('startMobileOtaRedirect()')
    expect(nativeApp).toContain('option_env!("BRANCH_CONTINUE_ENABLE_DESKTOP_UPDATER") == Some("1")')
  })
})
