import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Node deployment helper is an ESM script.
import { restartLaunchAgent } from '../scripts/install-agent-runtime.mjs'

describe('runtime service replacement', () => {
  it('waits for launchd to release a removed job before retrying bootstrap', async () => {
    const run = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 5, stderr: 'Input/output error' })
      .mockReturnValueOnce({ status: 0 })
    const wait = vi.fn().mockResolvedValue(undefined)
    await restartLaunchAgent('gui/501', 'backbone', '/tmp/backbone.plist', run, wait)
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ['bootout', 'gui/501/backbone'],
      ['bootstrap', 'gui/501', '/tmp/backbone.plist'],
      ['bootstrap', 'gui/501', '/tmp/backbone.plist'],
    ])
    expect(wait).toHaveBeenCalledOnce()
  })

  it('reports a persistent launch failure after a bounded retry', async () => {
    const run = vi.fn().mockReturnValue({ status: 5, stderr: 'Bad plist' })
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(restartLaunchAgent('gui/501', 'backbone', '/tmp/backbone.plist', run, wait)).rejects.toThrow('Bad plist')
    expect(run).toHaveBeenCalledTimes(21)
  })
})
