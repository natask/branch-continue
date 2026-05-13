import { describe, expect, it } from 'vitest'
import { isCommandPaletteOpenShortcut } from '../src/ui/lib/keyboard-shortcuts'

function keyEvent(overrides: Partial<Parameters<typeof isCommandPaletteOpenShortcut>[0]>) {
  return {
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  }
}

describe('isCommandPaletteOpenShortcut', () => {
  it('opens on command+k', () => {
    expect(isCommandPaletteOpenShortcut(keyEvent({ metaKey: true }))).toBe(true)
  })

  it('does not open on control+k', () => {
    expect(isCommandPaletteOpenShortcut(keyEvent({ ctrlKey: true }))).toBe(false)
  })

  it('does not open when control is held with command+k', () => {
    expect(isCommandPaletteOpenShortcut(keyEvent({ metaKey: true, ctrlKey: true }))).toBe(false)
  })

  it('keeps command+shift+x as an explicit alternate opener', () => {
    expect(
      isCommandPaletteOpenShortcut(keyEvent({ key: 'x', metaKey: true, shiftKey: true }), {
        allowShiftX: true,
      }),
    ).toBe(true)
    expect(
      isCommandPaletteOpenShortcut(keyEvent({ key: 'x', ctrlKey: true, shiftKey: true }), {
        allowShiftX: true,
      }),
    ).toBe(false)
  })
})
