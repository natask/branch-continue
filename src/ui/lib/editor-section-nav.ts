export type EditorSection = 'title' | 'timestamp' | 'tags' | 'body'
export type SectionMoveDirection = 'previous' | 'next'

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
