import { describe, expect, test, vi } from 'vitest'
import { createAbortableDebounce } from './async'

describe('createAbortableDebounce', () => {
  test('coalesces quick calls into one dispatch with latest value', () => {
    vi.useFakeTimers()
    const dispatch = vi.fn()
    const debounce = createAbortableDebounce(150, dispatch)

    debounce.queue('a')
    debounce.queue('ab')
    debounce.queue('abc')

    vi.advanceTimersByTime(149)
    expect(dispatch).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenLastCalledWith('abc', expect.any(AbortSignal))

    debounce.cancel()
    vi.useRealTimers()
  })
})
