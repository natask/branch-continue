export type EditorSection = 'title' | 'timestamp' | 'tags' | 'body'
export type SectionMoveDirection = 'previous' | 'next'

interface BodyCaretMoveOptions {
  value: string
  selectionStart: number
  selectionEnd: number
  direction: SectionMoveDirection
}

export function resolveAdjacentEditorSection(
  current: EditorSection,
  direction: SectionMoveDirection,
  hasTimestamp: boolean,
): EditorSection | null {
  const sections: EditorSection[] = hasTimestamp
    ? ['title', 'timestamp', 'tags', 'body']
    : ['title', 'tags', 'body']
  const currentIndex = sections.indexOf(current)
  if (currentIndex === -1) return null

  const delta = direction === 'previous' ? -1 : 1
  return sections[currentIndex + delta] ?? null
}

export function resolveBodyCaretLineMove({
  value,
  selectionStart,
  selectionEnd,
  direction,
}: BodyCaretMoveOptions): number | null {
  const caret = Math.min(Math.max(direction === 'previous' ? selectionStart : selectionEnd, 0), value.length)
  const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
  const lineEndIndex = value.indexOf('\n', caret)
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  const column = Math.min(caret - lineStart, lineEnd - lineStart)

  if (direction === 'previous') {
    if (lineStart === 0) return null
    const previousEnd = lineStart - 1
    const previousStart = value.lastIndexOf('\n', previousEnd - 1) + 1
    return previousStart + Math.min(column, previousEnd - previousStart)
  }

  if (lineEndIndex === -1) return null
  const nextStart = lineEndIndex + 1
  const nextEndIndex = value.indexOf('\n', nextStart)
  const nextEnd = nextEndIndex === -1 ? value.length : nextEndIndex
  return nextStart + Math.min(column, nextEnd - nextStart)
}
