import { describe, expect, it } from 'vitest'
import { resolveMobileOtaAction } from '../src/core/platform/mobile-ota'

const MANIFEST = {
  app: 'branch-continue',
  entrypoint: 'index.html',
  releaseId: 'release-b',
  files: [
    { path: 'index.html', bytes: 100, sha256: 'index-sha' },
    { path: 'assets/index.js', bytes: 100, sha256: 'asset-sha' },
  ],
}

describe('resolveMobileOtaAction', () => {
  it('redirects embedded shells to the mobile OTA origin', () => {
    expect(
      resolveMobileOtaAction({
        targetUrl: 'https://branch-continue.main.lan/mobile/',
        currentUrl: 'tauri://localhost/index.html',
        manifest: MANIFEST,
      }),
    ).toEqual({
      type: 'redirect',
      url: 'https://branch-continue.main.lan/mobile/?ota=release-b',
      releaseId: 'release-b',
    })
  })

  it('reloads a remote mobile runtime when the deployed release changes', () => {
    expect(
      resolveMobileOtaAction({
        targetUrl: 'https://branch-continue.main.lan/mobile/',
        currentUrl: 'https://branch-continue.main.lan/mobile/?ota=release-a',
        manifest: MANIFEST,
        loadedReleaseId: 'release-a',
      }),
    ).toEqual({
      type: 'reload',
      url: 'https://branch-continue.main.lan/mobile/?ota=release-b',
      releaseId: 'release-b',
    })
  })

  it('does nothing when the current remote release is already loaded', () => {
    expect(
      resolveMobileOtaAction({
        targetUrl: 'https://branch-continue.main.lan/mobile/',
        currentUrl: 'https://branch-continue.main.lan/mobile/',
        manifest: MANIFEST,
        loadedReleaseId: 'release-b',
      }),
    ).toEqual({ type: 'none', releaseId: 'release-b' })
  })

  it('uses the stored release id when the bundle has no embedded release id', () => {
    expect(
      resolveMobileOtaAction({
        targetUrl: 'https://branch-continue.main.lan/mobile/',
        currentUrl: 'https://branch-continue.main.lan/mobile/',
        manifest: MANIFEST,
        storedReleaseId: 'release-a',
      }).type,
    ).toBe('reload')
  })

  it('does not redirect to an empty or incomplete mobile OTA manifest', () => {
    expect(
      resolveMobileOtaAction({
        targetUrl: 'https://branch-continue.main.lan/mobile/',
        currentUrl: 'tauri://localhost/index.html',
        manifest: { app: 'branch-continue', entrypoint: 'index.html', releaseId: 'release-b' },
      }),
    ).toEqual({ type: 'none' })
  })
})
