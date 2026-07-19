import { describe, expect, it } from 'vitest'
import {
  isCommandPaletteOpenShortcut,
  shouldOpenCommandPalette,
} from '../src/ui/lib/keyboard-shortcuts'

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

  it('opens on command+shift+k', () => {
    expect(isCommandPaletteOpenShortcut(keyEvent({ metaKey: true, shiftKey: true }))).toBe(true)
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

describe('shouldOpenCommandPalette', () => {
  it('opens command+k outside editable controls', () => {
    expect(shouldOpenCommandPalette(keyEvent({ metaKey: true }))).toBe(true)
  })

  it('opens command+k from a focused input-like target', () => {
    const inputTarget = {
      closest: (selector: string) => (selector.includes('input') ? inputTarget : null),
    } as EventTarget

    expect(shouldOpenCommandPalette(keyEvent({ metaKey: true, target: inputTarget }))).toBe(true)
  })

  it('opens command+shift+k from contenteditable targets', () => {
    const editorTarget = {
      isContentEditable: true,
      closest: () => null,
    } as EventTarget

    expect(
      shouldOpenCommandPalette(keyEvent({ metaKey: true, shiftKey: true, target: editorTarget })),
    ).toBe(true)
  })

  it('keeps control+k available for native text editing behavior', () => {
    const inputTarget = {
      closest: (selector: string) => (selector.includes('textarea') ? inputTarget : null),
    } as EventTarget

    expect(shouldOpenCommandPalette(keyEvent({ ctrlKey: true, target: inputTarget }))).toBe(false)
  })
})
