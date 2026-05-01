export type ScrollAxis = 'x' | 'y'

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

const SCROLL_EPSILON_PX = 1

export function canConsumeScrollDelta(
  metrics: ScrollMetrics,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) return false

  if (axis === 'y') {
    const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
    if (maxScrollTop <= SCROLL_EPSILON_PX) return false
    if (delta < 0) return metrics.scrollTop > SCROLL_EPSILON_PX
    return metrics.scrollTop < maxScrollTop - SCROLL_EPSILON_PX
  }

  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  if (maxScrollLeft <= SCROLL_EPSILON_PX) return false
  if (delta < 0) return metrics.scrollLeft > SCROLL_EPSILON_PX
  return metrics.scrollLeft < maxScrollLeft - SCROLL_EPSILON_PX
}

export function elementCanConsumeScrollDelta(
  element: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  return canConsumeScrollDelta(
    {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    },
    axis,
    delta,
  )
}

export function closestScrollableElement(
  target: EventTarget | null,
  selector: string,
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  return target.closest<HTMLElement>(selector)
}
