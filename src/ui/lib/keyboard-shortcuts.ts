export interface CommandPaletteShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
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
