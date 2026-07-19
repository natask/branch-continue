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
  // The palette is an app-level escape hatch, so both Command+K and the more
  // forceful Command+Shift+K must work even while an editor owns focus.
  if (key === 'k') return true
  return Boolean(options.allowShiftX && key === 'x' && event.shiftKey)
}

export function shouldOpenCommandPalette(
  event: CommandPaletteShortcutEvent,
  options: { allowShiftX?: boolean } = {},
): boolean {
  return isCommandPaletteOpenShortcut(event, options)
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
