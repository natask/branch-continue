export interface CommandPaletteShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target?: EventTarget | null
}

export function isCommandPaletteOpenShortcut(
  event: CommandPaletteShortcutEvent,
  options: { allowShiftX?: boolean } = {},
): boolean {
  if (!event.metaKey || event.ctrlKey || event.altKey) return false

  const key = event.key.toLowerCase()
  if (key === 'k') return !event.shiftKey
  return Boolean(options.allowShiftX && key === 'x' && event.shiftKey)
}

export function shouldOpenCommandPalette(
  event: CommandPaletteShortcutEvent,
  options: { allowShiftX?: boolean } = {},
): boolean {
  return isCommandPaletteOpenShortcut(event, options) && !isEditableShortcutTarget(event.target ?? null)
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false

  const candidate = target as {
    isContentEditable?: boolean
    closest?: (selector: string) => unknown
  }

  if (candidate.isContentEditable) return true
  if (typeof candidate.closest !== 'function') return false

  return candidate.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
}
