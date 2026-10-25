export type DebouncedDispatch = (value: string, signal: AbortSignal) => void

export function createAbortableDebounce(delay: number, dispatch: DebouncedDispatch) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  const clearTimer = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  const cancel = () => {
    clearTimer()
    controller?.abort()
    controller = undefined
  }

  const queue = (value: string) => {
    clearTimer()
    controller?.abort()
    controller = new AbortController()

    const run = () => {
      const activeController = controller
      if (!activeController) return
      dispatch(value, activeController.signal)
    }

    if (delay > 0) {
      timeoutId = setTimeout(() => {
        timeoutId = undefined
        run()
      }, delay)
      return
    }

    run()
  }

  return { queue, cancel }
}
