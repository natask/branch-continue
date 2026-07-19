import { describe, expect, it } from 'vitest'
import {
  appendSourceFileCommand,
  canRedoSourceFile,
  canUndoSourceFile,
  createSourceFileCommand,
  emptySourceFileHistory,
  redoSourceFileCommand,
  undoSourceFileCommand,
} from '../src/core/history/source-file-history'

describe('persistent source file command history', () => {
  it('stores a compact reversible text command', () => {
    const before = '* Note\nhello world\n'
    const after = '* Note\nhello brave world\n'
    const command = createSourceFileCommand({
      before,
      after,
      kind: 'update-note',
      label: 'Edit Note',
    })!

    expect(command.removedText).toBe('')
    expect(command.insertedText).toBe('brave ')

    const state = appendSourceFileCommand(emptySourceFileHistory('/notes.org'), command)
    expect(canUndoSourceFile(state, after)).toBe(true)
    const undone = undoSourceFileCommand(state, after)!
    expect(undone.content).toBe(before)
    expect(canRedoSourceFile(undone.state, before)).toBe(true)
    expect(redoSourceFileCommand(undone.state, before)?.content).toBe(after)
  })

  it('drops the redo branch when a new command follows undo', () => {
    const first = createSourceFileCommand({
      before: 'a', after: 'ab', kind: 'update-note', label: 'first',
    })!
    const second = createSourceFileCommand({
      before: 'ab', after: 'abc', kind: 'update-note', label: 'second',
    })!
    let state = appendSourceFileCommand(emptySourceFileHistory('file'), first)
    state = appendSourceFileCommand(state, second)
    const undone = undoSourceFileCommand(state, 'abc')!
    const alternate = createSourceFileCommand({
      before: 'ab', after: 'ab!', kind: 'update-note', label: 'alternate',
    })!
    state = appendSourceFileCommand(undone.state, alternate)

    expect(state.commands.map((command) => command.label)).toEqual(['first', 'alternate'])
    expect(canRedoSourceFile(state, 'ab!')).toBe(false)
  })

  it('refuses to overwrite content that diverged externally', () => {
    const command = createSourceFileCommand({
      before: 'before', after: 'after', kind: 'update-note', label: 'edit',
    })!
    const state = appendSourceFileCommand(emptySourceFileHistory('file'), command)

    expect(canUndoSourceFile(state, 'external edit')).toBe(false)
    expect(undoSourceFileCommand(state, 'external edit')).toBeNull()
  })
})
