/** Spacing for the waveform time ruler at a given horizontal resolution. */
export interface WaveformTickSpec {
  /** Seconds between tick notches. */
  tickSec: number
  /** Seconds between labeled ticks; always a whole multiple of tickSec. */
  labelSec: number
}

// Steps that land on natural clock boundaries, in milliseconds.
const NICE_STEPS_MS = [
  100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
]

const MIN_TICK_PX = 13
const MIN_LABEL_PX = 72

/**
 * Choose ruler intervals for the current zoom: finer steps as px-per-second
 * grows, coarser as the waveform zooms out, always on clock boundaries with
 * labels on a whole multiple of the tick step.
 */
export function computeWaveformTickSpec(pxPerSec: number): WaveformTickSpec {
  const pxPerMs = (Number.isFinite(pxPerSec) && pxPerSec > 0 ? pxPerSec : 1) / 1000
  const tickMs = NICE_STEPS_MS.find((step) => step * pxPerMs >= MIN_TICK_PX)
    ?? NICE_STEPS_MS[NICE_STEPS_MS.length - 1]!
  const labelMs = NICE_STEPS_MS.find((step) => step % tickMs === 0 && step * pxPerMs >= MIN_LABEL_PX)
    ?? Math.ceil(MIN_LABEL_PX / (tickMs * pxPerMs)) * tickMs
  return { tickSec: tickMs / 1000, labelSec: labelMs / 1000 }
}

/** m:ss labels, h:mm:ss past an hour, tenths only for sub-second label steps. */
export function formatWaveformTickLabel(seconds: number, labelSec: number): string {
  const showTenths = labelSec < 1
  const tenthsTotal = Math.round(seconds * 10)
  const totalSeconds = showTenths ? Math.floor(tenthsTotal / 10) : Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = String(totalSeconds % 60).padStart(2, '0')
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${minutes}:${secs}`
  return showTenths ? `${base}.${tenthsTotal % 10}` : base
}
