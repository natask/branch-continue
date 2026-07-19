class BranchContinuePcm16CaptureProcessor extends AudioWorkletProcessor {
  stopRequested = false

  constructor() {
    super()
    this.port.onmessage = (event) => {
      if (event.data?.command === 'stop') this.stopRequested = true
    }
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0)
    }

    const input = inputs[0]?.[0]
    if (input?.length) {
      const samples = new Float32Array(input.length)
      samples.set(input)
      this.port.postMessage({ samples }, [samples.buffer])
    }

    if (this.stopRequested) {
      this.port.postMessage({ stopped: true })
      return false
    }
    return true
  }
}

registerProcessor('branch-continue-pcm16-capture', BranchContinuePcm16CaptureProcessor)
