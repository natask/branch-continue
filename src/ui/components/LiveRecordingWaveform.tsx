import { useEffect, useRef } from 'react'

const MS_PER_PEAK = 50
const BAR_WIDTH_PX = 2
const BAR_GAP_PX = 2
const BAR_STEP_PX = BAR_WIDTH_PX + BAR_GAP_PX

export interface LiveWaveformBar {
  x: number
  amplitude: number
}

/**
 * Lay out the recorded envelope with the newest peak pinned at the cursor
 * position; history flows left and off the edge. Pure so the geometry is
 * testable without a canvas.
 */
export function layoutLiveWaveformBars(
  peaks: number[],
  cursorX: number,
  elapsedInBucketMs: number,
): LiveWaveformBar[] {
  // Sub-bucket time advances the strip continuously instead of snapping once
  // per bucket, which reads as smooth motion at the cursor.
  const subBucketOffset = (Math.max(0, Math.min(MS_PER_PEAK, elapsedInBucketMs)) / MS_PER_PEAK) * BAR_STEP_PX
  const bars: LiveWaveformBar[] = []
  for (let index = peaks.length - 1; index >= 0; index -= 1) {
    const x = cursorX - subBucketOffset - (peaks.length - 1 - index) * BAR_STEP_PX
    if (x < -BAR_STEP_PX) break
    bars.push({ x, amplitude: Math.max(0, Math.min(1, peaks[index] ?? 0)) })
  }
  return bars
}

interface LiveRecordingWaveformProps {
  getPeaks: () => number[]
  height?: number
}

/**
 * The recording-time waveform: the playhead sits fixed while captured audio
 * appears at the cursor and slides left behind it, oscilloscope style. The
 * saved-session player takes over once recording stops.
 */
export function LiveRecordingWaveform({ getPeaks, height = 92 }: LiveRecordingWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const getPeaksRef = useRef(getPeaks)
  getPeaksRef.current = getPeaks

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const context = canvas.getContext('2d')
    if (!context) return undefined

    let frame = 0
    let lastPeakCount = 0
    let lastBucketAt = performance.now()

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      if (width === 0) return
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }

      const peaks = getPeaksRef.current()
      const now = performance.now()
      if (peaks.length !== lastPeakCount) {
        lastPeakCount = peaks.length
        lastBucketAt = now
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const middle = height / 2
      context.strokeStyle = 'rgba(232, 224, 214, 0.14)'
      context.setLineDash([2, 4])
      context.beginPath()
      context.moveTo(0, middle)
      context.lineTo(width, middle)
      context.stroke()
      context.setLineDash([])

      const cursorX = width / 2
      context.fillStyle = 'rgba(232, 168, 76, 0.78)'
      for (const bar of layoutLiveWaveformBars(peaks, cursorX, now - lastBucketAt)) {
        const barHeight = Math.max(2, bar.amplitude * (height - 8))
        context.fillRect(bar.x, middle - barHeight / 2, BAR_WIDTH_PX, barHeight)
      }

      context.fillStyle = 'rgba(232, 168, 76, 0.92)'
      context.fillRect(cursorX, 4, 2, height - 8)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [height])

  return (
    <div className="live-recording-waveform" aria-label="Live recording waveform" style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  )
}
