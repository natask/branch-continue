import { afterEach, describe, expect, it, vi } from 'vitest'
import { startCodexSignIn } from '../src/ui/agent-runtime/agent-service-runtime'

afterEach(() => vi.unstubAllGlobals())

describe('Codex sign-in from another device', () => {
  it.each([
    ['http://10.147.17.6:8765', true],
    ['https://runtime.example.com', true],
    ['http://127.0.0.1:8765', false],
    ['http://localhost:8765', false],
    ['http://[::1]:8765', false],
  ])('selects a reachable authentication flow for %s', async (url, deviceCode) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ loginId: 'test' })))
    vi.stubGlobal('fetch', fetch)
    await startCodexSignIn(url)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ deviceCode })
  })

  it('keeps an explicitly requested flow', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ loginId: 'test' })))
    vi.stubGlobal('fetch', fetch)
    await startCodexSignIn('http://10.147.17.6:8765', false)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ deviceCode: false })
  })
})
