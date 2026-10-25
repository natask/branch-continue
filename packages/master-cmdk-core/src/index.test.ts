import { describe, expect, test } from 'vitest'
import { commandScore, createCommandEngine } from './index'

describe('createCommandEngine', () => {
  test('registers items and filters with the default matcher', () => {
    const engine = createCommandEngine()

    engine.registerItem({ id: 'open', value: 'Open File' })
    engine.registerItem({ id: 'cafe', value: 'Café' })
    engine.registerItem({ id: 'github', value: 'GitHub' })

    expect(engine.getState().visibleItemIds).toEqual(['open', 'cafe', 'github'])

    engine.setSearch('cafe')
    expect(engine.getState().visibleItemIds).toEqual(['cafe'])
    expect(engine.getState().value).toBe('Café')

    engine.setSearch('gh')
    expect(engine.getState().visibleItemIds).toEqual(['github'])
  })

  test('orders matching items by score and restores source order when search clears', () => {
    const engine = createCommandEngine()

    engine.registerItem({ id: 'alpha', value: 'Alpha' })
    engine.registerItem({ id: 'alphabet', value: 'Alphabet' })
    engine.registerItem({ id: 'settings', value: 'Settings', keywords: ['alpha'] })

    engine.setSearch('alpha')
    expect(engine.getState().orderedItemIds).toEqual(['alpha', 'settings', 'alphabet'])

    engine.setSearch('')
    expect(engine.getState().orderedItemIds).toEqual(['alpha', 'alphabet', 'settings'])
  })

  test('uses item filter over group filter over root filter', () => {
    const rootNever = () => 0
    const groupAlways = () => 1
    const itemNever = () => 0
    const engine = createCommandEngine({ filter: rootNever })

    engine.registerGroup({ id: 'group', filter: groupAlways })
    engine.registerItem({ id: 'group-match', value: 'Group Match', groupId: 'group' })
    engine.registerItem({ id: 'item-override', value: 'Item Override', groupId: 'group', filter: itemNever })
    engine.registerItem({ id: 'root-hidden', value: 'Root Hidden' })

    engine.setSearch('anything')

    expect(engine.getState().visibleItemIds).toEqual(['group-match'])
    expect(engine.getState().visibleGroupIds).toEqual(['group'])
  })

  test('scopes items to the active mode', () => {
    const engine = createCommandEngine()

    engine.registerMode({ id: 'commands' })
    engine.registerMode({ id: 'files' })
    engine.registerItem({ id: 'deploy', value: 'Deploy', modeId: 'commands' })
    engine.registerItem({ id: 'index', value: 'src/index.ts', modeId: 'files' })

    expect(engine.getState().mode).toBe('commands')
    expect(engine.getState().visibleItemIds).toEqual(['deploy'])

    engine.setMode('files')
    expect(engine.getState().visibleItemIds).toEqual(['index'])
    expect(engine.getState().value).toBe('src/index.ts')
  })

  test('moves selection through enabled visible items', () => {
    const engine = createCommandEngine({ loop: true })

    engine.registerItem({ id: 'alpha', value: 'Alpha' })
    engine.registerItem({ id: 'bravo', value: 'Bravo', disabled: true })
    engine.registerItem({ id: 'charlie', value: 'Charlie' })

    expect(engine.getState().value).toBe('Alpha')

    engine.moveSelection(1)
    expect(engine.getState().value).toBe('Charlie')

    engine.moveSelection(1)
    expect(engine.getState().value).toBe('Alpha')
  })

  test('supports multiple selected values without changing active value', () => {
    const engine = createCommandEngine({ selectionMode: 'multiple', defaultSelectedValues: ['Alpha'] })

    engine.registerItem({ id: 'alpha', value: 'Alpha' })
    engine.registerItem({ id: 'bravo', value: 'Bravo' })

    expect(engine.getState().selectedValues).toEqual(['Alpha'])
    expect(engine.getState().value).toBe('Alpha')

    engine.moveSelection(1)
    engine.toggleSelectedValue()

    expect(engine.getState().value).toBe('Bravo')
    expect(engine.getState().selectedValues).toEqual(['Alpha', 'Bravo'])
  })

  test('notifies subscribers when state changes', () => {
    const engine = createCommandEngine()
    let calls = 0
    const unsubscribe = engine.subscribe(() => {
      calls += 1
    })

    engine.registerItem({ id: 'alpha', value: 'Alpha' })
    engine.setSearch('alp')
    unsubscribe()
    engine.setSearch('alpha')

    expect(calls).toBe(2)
  })
})

describe('commandScore', () => {
  test('matches diacritics and acronyms', () => {
    expect(commandScore('Café', 'cafe')).toBeGreaterThan(0)
    expect(commandScore('GitHub', 'gh')).toBeGreaterThanOrEqual(0.7)
  })

  test('matches typo-tolerant tokens inside longer text entries', () => {
    expect(commandScore('Search notes by title and body text', 'serach')).toBeGreaterThan(0)
    expect(commandScore('Quarterly planning notes include renewal strategy', 'renwel strat')).toBeGreaterThan(0)
  })

  test('matches compact fuzzy subsequences inside words', () => {
    expect(commandScore('Create Linear issue from selected text', 'lnr')).toBeGreaterThan(0.7)
    expect(commandScore('Open browser tab', 'brws')).toBeGreaterThan(0.7)
  })

  test('keeps stronger literal matches ahead of typo matches', () => {
    expect(commandScore('Search notes', 'search')).toBeGreaterThan(commandScore('Research archive', 'serach'))
  })
})
