export * from './actions'
export * from './openapi'
export * from './openapi-execution'

export type CommandFilter = (value: string, search: string, keywords?: string[]) => number

export type CommandSelectionMode = 'single' | 'multiple'

export type CommandPointerBehavior = 'fused' | 'split' | 'locked'

export type CommandItemInput = {
  id: string
  value: string
  keywords?: string[]
  disabled?: boolean
  forceMount?: boolean
  groupId?: string
  modeId?: string
  filter?: CommandFilter
}

export type CommandGroupInput = {
  id: string
  value?: string
  forceMount?: boolean
  modeId?: string
  filter?: CommandFilter
}

export type CommandModeInput = {
  id: string
  filter?: CommandFilter
  loading?: boolean
}

export type CommandEngineOptions = {
  filter?: CommandFilter
  shouldFilter?: boolean
  loop?: boolean
  defaultValue?: string
  defaultSearch?: string
  mode?: string
  defaultMode?: string
  selectionMode?: CommandSelectionMode
  defaultSelectedValues?: string[]
}

export type CommandEngineSnapshot = {
  search: string
  value: string
  mode?: string
  selectedValues: string[]
  filtered: {
    count: number
    items: Map<string, number>
    groups: Set<string>
  }
  orderedItemIds: string[]
  visibleItemIds: string[]
  orderedGroupIds: string[]
  visibleGroupIds: string[]
}

type RegisteredItem = CommandItemInput & {
  order: number
  keywords: string[]
}

type RegisteredGroup = CommandGroupInput & {
  order: number
}

type RegisteredMode = CommandModeInput & {
  order: number
}

type MutableState = {
  search: string
  value: string
  mode?: string
  selectedValues: Set<string>
  filtered: {
    count: number
    items: Map<string, number>
    groups: Set<string>
  }
  orderedItemIds: string[]
  visibleItemIds: string[]
  orderedGroupIds: string[]
  visibleGroupIds: string[]
}

export type CommandEngine = ReturnType<typeof createCommandEngine>

export const defaultFilter: CommandFilter = (value, search, keywords) => commandScore(value, search, keywords)

export function createCommandEngine(options: CommandEngineOptions = {}) {
  let opts = { ...options }
  let nextItemOrder = 0
  let nextGroupOrder = 0
  let nextModeOrder = 0

  const listeners = new Set<() => void>()
  const items = new Map<string, RegisteredItem>()
  const groups = new Map<string, RegisteredGroup>()
  const modes = new Map<string, RegisteredMode>()
  const groupItems = new Map<string, Set<string>>()

  const state: MutableState = {
    search: opts.defaultSearch ?? '',
    value: trimValue(opts.defaultValue),
    mode: opts.mode ?? opts.defaultMode,
    selectedValues: new Set((opts.defaultSelectedValues ?? []).map(trimValue)),
    filtered: {
      count: 0,
      items: new Map(),
      groups: new Set(),
    },
    orderedItemIds: [],
    visibleItemIds: [],
    orderedGroupIds: [],
    visibleGroupIds: [],
  }

  recompute()
  if (!state.value) selectFirstVisible(false)

  function emit() {
    listeners.forEach((listener) => listener())
  }

  function recomputeAndEmit() {
    recompute()
    emit()
  }

  function registerItem(input: CommandItemInput) {
    const previous = items.get(input.id)
    if (previous?.groupId && previous.groupId !== input.groupId) {
      groupItems.get(previous.groupId)?.delete(input.id)
    }

    const item: RegisteredItem = {
      ...input,
      value: trimValue(input.value),
      keywords: (input.keywords ?? []).map(trimValue),
      order: previous?.order ?? nextItemOrder++,
    }

    items.set(input.id, item)

    if (item.groupId) {
      let ids = groupItems.get(item.groupId)
      if (!ids) {
        ids = new Set()
        groupItems.set(item.groupId, ids)
      }
      ids.add(item.id)
    }

    recompute()
    if (!state.value) selectFirstVisible(false)
    emit()

    return () => {
      const current = items.get(input.id)
      if (!current) return
      items.delete(input.id)
      if (current.groupId) {
        groupItems.get(current.groupId)?.delete(current.id)
      }
      recompute()
      if (state.value === current.value) selectFirstVisible(false)
      emit()
    }
  }

  function registerGroup(input: CommandGroupInput) {
    const previous = groups.get(input.id)
    groups.set(input.id, {
      ...input,
      value: input.value ? trimValue(input.value) : undefined,
      order: previous?.order ?? nextGroupOrder++,
    })

    if (!groupItems.has(input.id)) {
      groupItems.set(input.id, new Set())
    }

    recomputeAndEmit()

    return () => {
      groups.delete(input.id)
      groupItems.delete(input.id)
      recomputeAndEmit()
    }
  }

  function registerMode(input: CommandModeInput) {
    const previous = modes.get(input.id)
    modes.set(input.id, {
      ...input,
      order: previous?.order ?? nextModeOrder++,
    })

    if (state.mode === undefined) {
      state.mode = input.id
    }

    recomputeAndEmit()

    return () => {
      modes.delete(input.id)
      if (state.mode === input.id) {
        state.mode = Array.from(modes.values()).sort(byOrder)[0]?.id
      }
      recompute()
      if (!isSelectedValueVisible()) selectFirstVisible(false)
      emit()
    }
  }

  function setSearch(search: string) {
    const nextSearch = String(search)
    if (state.search === nextSearch) return
    state.search = nextSearch
    recompute()
    selectFirstVisible(false)
    emit()
  }

  function setValue(value: string | undefined) {
    const nextValue = trimValue(value)
    if (state.value === nextValue) return
    state.value = nextValue
    emit()
  }

  function setMode(mode: string | undefined) {
    if (state.mode === mode) return
    state.mode = mode
    recompute()
    if (!isSelectedValueVisible()) selectFirstVisible(false)
    emit()
  }

  function setOptions(nextOptions: Partial<CommandEngineOptions>) {
    opts = { ...opts, ...nextOptions }
    recompute()
    if (!isSelectedValueVisible()) selectFirstVisible(false)
    emit()
  }

  function toggleSelectedValue(value = state.value) {
    if ((opts.selectionMode ?? 'single') !== 'multiple') return
    const nextValue = trimValue(value)
    if (!nextValue) return

    if (state.selectedValues.has(nextValue)) state.selectedValues.delete(nextValue)
    else state.selectedValues.add(nextValue)

    emit()
  }

  function moveSelection(change: 1 | -1) {
    const candidates = getEnabledVisibleItems()
    if (candidates.length === 0) return

    const selectedIndex = candidates.findIndex((item) => item.value === state.value)
    const baseIndex = selectedIndex === -1 ? (change > 0 ? -1 : candidates.length) : selectedIndex
    let nextIndex = baseIndex + change

    if (opts.loop) {
      if (nextIndex < 0) nextIndex = candidates.length - 1
      if (nextIndex >= candidates.length) nextIndex = 0
    }

    const nextItem = candidates[nextIndex]
    if (!nextItem) return
    setValue(nextItem.value)
  }

  function selectFirst() {
    selectFirstVisible(true)
  }

  function selectLast() {
    const candidates = getEnabledVisibleItems()
    const item = candidates[candidates.length - 1]
    if (!item) return
    setValue(item.value)
  }

  function getState(): CommandEngineSnapshot {
    return {
      search: state.search,
      value: state.value,
      mode: state.mode,
      selectedValues: Array.from(state.selectedValues),
      filtered: {
        count: state.filtered.count,
        items: new Map(state.filtered.items),
        groups: new Set(state.filtered.groups),
      },
      orderedItemIds: [...state.orderedItemIds],
      visibleItemIds: [...state.visibleItemIds],
      orderedGroupIds: [...state.orderedGroupIds],
      visibleGroupIds: [...state.visibleGroupIds],
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function recompute() {
    const shouldFilter = opts.shouldFilter !== false
    const hasSearch = state.search !== ''
    const scores = new Map<string, number>()
    const visibleItemIds: string[] = []
    let filteredCount = 0

    for (const item of getSourceOrderedItems()) {
      if (!isModeVisible(item.modeId)) continue

      const rank = hasSearch && shouldFilter ? scoreItem(item) : 1
      scores.set(item.id, rank)

      const matches = rank > 0
      const visible = item.forceMount || !hasSearch || !shouldFilter || matches
      if (matches) filteredCount++
      if (visible) visibleItemIds.push(item.id)
    }

    const visibleGroups = new Set<string>()
    const visibleGroupIds: string[] = []

    for (const group of getSourceOrderedGroups()) {
      if (!isModeVisible(group.modeId)) continue

      const ids = groupItems.get(group.id) ?? new Set()
      const hasMatchingItem = Array.from(ids).some((itemId) => (scores.get(itemId) ?? 0) > 0)
      const visible = group.forceMount || !hasSearch || !shouldFilter || hasMatchingItem

      if (hasMatchingItem) visibleGroups.add(group.id)
      if (visible) visibleGroupIds.push(group.id)
    }

    state.filtered = {
      count: hasSearch && shouldFilter ? filteredCount : visibleItemIds.length,
      items: scores,
      groups: visibleGroups,
    }
    state.visibleItemIds = visibleItemIds
    state.visibleGroupIds = visibleGroupIds
    state.orderedItemIds = orderItems(visibleItemIds, scores)
    state.orderedGroupIds = orderGroups(visibleGroupIds, scores)
  }

  function scoreItem(item: RegisteredItem) {
    const groupFilter = item.groupId ? groups.get(item.groupId)?.filter : undefined
    const modeFilter = item.modeId ? modes.get(item.modeId)?.filter : undefined
    const filter = item.filter ?? groupFilter ?? modeFilter ?? opts.filter ?? defaultFilter
    return item.value ? filter(item.value, state.search, item.keywords) : 0
  }

  function orderItems(itemIds: string[], scores: Map<string, number>) {
    if (!state.search || opts.shouldFilter === false) return itemIds

    return [...itemIds].sort((a, b) => {
      const scoreDiff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
      if (scoreDiff !== 0) return scoreDiff
      return (items.get(a)?.order ?? 0) - (items.get(b)?.order ?? 0)
    })
  }

  function orderGroups(groupIds: string[], scores: Map<string, number>) {
    if (!state.search || opts.shouldFilter === false) return groupIds

    return [...groupIds].sort((a, b) => {
      const scoreDiff = getGroupMaxScore(b, scores) - getGroupMaxScore(a, scores)
      if (scoreDiff !== 0) return scoreDiff
      return (groups.get(a)?.order ?? 0) - (groups.get(b)?.order ?? 0)
    })
  }

  function getGroupMaxScore(groupId: string, scores: Map<string, number>) {
    let max = 0
    groupItems.get(groupId)?.forEach((itemId) => {
      max = Math.max(max, scores.get(itemId) ?? 0)
    })
    return max
  }

  function isModeVisible(modeId: string | undefined) {
    if (!modeId || !state.mode) return true
    return modeId === state.mode
  }

  function isSelectedValueVisible() {
    if (!state.value) return false
    return state.visibleItemIds.some((itemId) => items.get(itemId)?.value === state.value)
  }

  function selectFirstVisible(shouldEmit: boolean) {
    const item = getEnabledVisibleItems()[0]
    const nextValue = item?.value ?? ''
    if (state.value === nextValue) return
    state.value = nextValue
    if (shouldEmit) emit()
  }

  function getEnabledVisibleItems() {
    return state.orderedItemIds.map((itemId) => items.get(itemId)).filter(isEnabledItem)
  }

  function getSourceOrderedItems() {
    return Array.from(items.values()).sort(byOrder)
  }

  function getSourceOrderedGroups() {
    return Array.from(groups.values()).sort(byOrder)
  }

  return {
    registerItem,
    registerGroup,
    registerMode,
    setSearch,
    setValue,
    setMode,
    setOptions,
    toggleSelectedValue,
    moveSelection,
    selectFirst,
    selectLast,
    getState,
    subscribe,
  }
}

function isEnabledItem(item: RegisteredItem | undefined): item is RegisteredItem {
  return Boolean(item && !item.disabled)
}

function byOrder(a: { order: number }, b: { order: number }) {
  return a.order - b.order
}

function trimValue(value: string | undefined) {
  return value === undefined ? '' : String(value).trim()
}

function fold(input: string): string {
  return input.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getAcronym(words: string[]): string {
  return words
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
}

function getWords(input: string): string[] {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

  return words.length > 0 ? words : input.split(/\s+/).filter(Boolean)
}

function tierScore(rawHaystack: string, needle: string): number {
  const haystack = fold(rawHaystack)
  if (!haystack || !needle) return 0
  if (haystack === needle) return 1
  if (haystack.startsWith(needle)) return 0.9

  const words = getWords(rawHaystack).map((word) => fold(word))
  if (words.some((word) => word.startsWith(needle))) return 0.8
  if (getAcronym(words) === needle) return 0.7
  if (haystack.includes(needle)) return 0.6

  return clamp(legacyCommandScore(haystack, needle, [] as string[]) * 0.5, 0, 0.5)
}

function getSearchTokens(search: string): string[] {
  const tokens = getWords(search).map(fold).filter(Boolean)
  return tokens.length > 0 ? tokens : [fold(search)].filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = new Array<number>(b.length + 1)

  for (let ai = 1; ai <= a.length; ai += 1) {
    current[0] = ai
    for (let bi = 1; bi <= b.length; bi += 1) {
      const substitution = previous[bi - 1] + (a[ai - 1] === b[bi - 1] ? 0 : 1)
      current[bi] = Math.min(previous[bi] + 1, current[bi - 1] + 1, substitution)
    }
    ;[previous, current] = [current, previous]
  }

  return previous[b.length]
}

function typoScore(word: string, token: string): number {
  if (token.length < 3 || word.length < 3) return 0
  const distance = levenshtein(word, token)
  const length = Math.max(word.length, token.length)
  const allowed = length <= 5 ? 1 : length <= 9 ? 2 : 3
  if (distance > allowed) return 0

  const similarity = 1 - distance / length
  return clamp(0.58 + similarity * 0.25, 0, 0.83)
}

function subsequenceScore(word: string, token: string): number {
  if (token.length < 2 || word.length < 2 || token.length > word.length) return 0

  let best = 0

  for (let start = 0; start < word.length; start += 1) {
    if (word[start] !== token[0]) continue

    let wordIndex = start
    const positions = [start]

    for (let tokenIndex = 1; tokenIndex < token.length; tokenIndex += 1) {
      wordIndex = word.indexOf(token[tokenIndex], wordIndex + 1)
      if (wordIndex === -1) break
      positions.push(wordIndex)
    }

    if (positions.length !== token.length) continue

    const span = positions[positions.length - 1] - positions[0] + 1
    const density = token.length / span
    if (density < 0.45) continue

    let consecutive = 0
    for (let index = 1; index < positions.length; index += 1) {
      if (positions[index] === positions[index - 1] + 1) consecutive += 1
    }

    const coverage = token.length / word.length
    const consecutiveRatio = token.length === 1 ? 0 : consecutive / (token.length - 1)
    const startBonus = positions[0] === 0 ? 0.14 : 0
    const score = 0.52 + density * 0.22 + coverage * 0.08 + consecutiveRatio * 0.08 + startBonus
    best = Math.max(best, clamp(score, 0, 0.78))
  }

  return best
}

function fuzzyTokenScore(token: string, rawHaystack: string): number {
  const haystack = fold(rawHaystack)
  if (!haystack || !token) return 0

  const direct = tierScore(rawHaystack, token)
  if (direct >= 0.8) return direct

  const words = getWords(rawHaystack).map(fold)
  const acronym = getAcronym(words)
  let best = acronym.startsWith(token) ? 0.78 : acronym.includes(token) ? 0.68 : 0

  for (const word of words) {
    if (!word) continue
    if (word === token) best = Math.max(best, 1)
    else if (word.startsWith(token)) best = Math.max(best, 0.9)
    else if (word.includes(token)) best = Math.max(best, 0.76)
    else best = Math.max(best, subsequenceScore(word, token), typoScore(word, token))
  }

  return Math.max(best, direct)
}

function fuzzyTextScore(rawHaystack: string, rawSearch: string): number {
  const needle = fold(rawSearch)
  const haystack = fold(rawHaystack)
  if (!needle || !haystack) return 0

  const phraseScore = tierScore(rawHaystack, needle)
  const tokens = getSearchTokens(rawSearch)
  if (tokens.length === 0) return phraseScore

  let total = 0
  let min = 1
  for (const token of tokens) {
    const tokenScore = fuzzyTokenScore(token, rawHaystack)
    if (tokenScore < 0.52) return phraseScore >= 0.6 ? phraseScore : 0
    total += tokenScore
    min = Math.min(min, tokenScore)
  }

  const tokenAverage = total / tokens.length
  const coveragePenalty = tokens.length === 1 ? 1 : 0.92 + min * 0.08
  return Math.max(phraseScore, clamp(tokenAverage * coveragePenalty, 0, 0.95))
}

export function commandScore(value: string, search: string, keywords?: string[]): number {
  if (!fold(search)) return 0

  const labelScore = fuzzyTextScore(value, search)
  const keywordScore = (keywords ?? []).reduce((max, keyword) => Math.max(max, fuzzyTextScore(keyword, search)), 0)

  if (labelScore > 0 && labelScore >= keywordScore) {
    return clamp(labelScore + 0.01, 0, 1)
  }

  return keywordScore
}

const SCORE_CONTINUE_MATCH = 1
const SCORE_SPACE_WORD_JUMP = 0.9
const SCORE_NON_SPACE_WORD_JUMP = 0.8
const SCORE_CHARACTER_JUMP = 0.17
const SCORE_TRANSPOSITION = 0.1
const PENALTY_SKIPPED = 0.999
const PENALTY_CASE_MISMATCH = 0.9999
const PENALTY_NOT_COMPLETE = 0.99

const IS_GAP_REGEXP = /[\\\/_+.#"@\[\(\{&]/
const COUNT_GAPS_REGEXP = /[\\\/_+.#"@\[\(\{&]/g
const IS_SPACE_REGEXP = /[\s-]/
const COUNT_SPACE_REGEXP = /[\s-]/g

function commandScoreInner(
  string: string,
  abbreviation: string,
  lowerString: string,
  lowerAbbreviation: string,
  stringIndex: number,
  abbreviationIndex: number,
  memoizedResults: Record<string, number>,
): number {
  if (abbreviationIndex === abbreviation.length) {
    return stringIndex === string.length ? SCORE_CONTINUE_MATCH : PENALTY_NOT_COMPLETE
  }

  const memoizeKey = `${stringIndex},${abbreviationIndex}`
  if (memoizedResults[memoizeKey] !== undefined) {
    return memoizedResults[memoizeKey]
  }

  const abbreviationChar = lowerAbbreviation.charAt(abbreviationIndex)
  let index = lowerString.indexOf(abbreviationChar, stringIndex)
  let highScore = 0

  while (index >= 0) {
    let score = commandScoreInner(
      string,
      abbreviation,
      lowerString,
      lowerAbbreviation,
      index + 1,
      abbreviationIndex + 1,
      memoizedResults,
    )

    if (score > highScore) {
      if (index === stringIndex) {
        score *= SCORE_CONTINUE_MATCH
      } else if (IS_GAP_REGEXP.test(string.charAt(index - 1))) {
        score *= SCORE_NON_SPACE_WORD_JUMP
        const wordBreaks = string.slice(stringIndex, index - 1).match(COUNT_GAPS_REGEXP)
        if (wordBreaks && stringIndex > 0) {
          score *= Math.pow(PENALTY_SKIPPED, wordBreaks.length)
        }
      } else if (IS_SPACE_REGEXP.test(string.charAt(index - 1))) {
        score *= SCORE_SPACE_WORD_JUMP
        const spaceBreaks = string.slice(stringIndex, index - 1).match(COUNT_SPACE_REGEXP)
        if (spaceBreaks && stringIndex > 0) {
          score *= Math.pow(PENALTY_SKIPPED, spaceBreaks.length)
        }
      } else {
        score *= SCORE_CHARACTER_JUMP
        if (stringIndex > 0) {
          score *= Math.pow(PENALTY_SKIPPED, index - stringIndex)
        }
      }

      if (string.charAt(index) !== abbreviation.charAt(abbreviationIndex)) {
        score *= PENALTY_CASE_MISMATCH
      }
    }

    if (
      (score < SCORE_TRANSPOSITION &&
        lowerString.charAt(index - 1) === lowerAbbreviation.charAt(abbreviationIndex + 1)) ||
      (lowerAbbreviation.charAt(abbreviationIndex + 1) === lowerAbbreviation.charAt(abbreviationIndex) &&
        lowerString.charAt(index - 1) !== lowerAbbreviation.charAt(abbreviationIndex))
    ) {
      const transposedScore = commandScoreInner(
        string,
        abbreviation,
        lowerString,
        lowerAbbreviation,
        index + 1,
        abbreviationIndex + 2,
        memoizedResults,
      )

      if (transposedScore * SCORE_TRANSPOSITION > score) {
        score = transposedScore * SCORE_TRANSPOSITION
      }
    }

    if (score > highScore) {
      highScore = score
    }

    index = lowerString.indexOf(abbreviationChar, index + 1)
  }

  memoizedResults[memoizeKey] = highScore
  return highScore
}

function formatInput(string: string) {
  return string.toLowerCase().replace(COUNT_SPACE_REGEXP, ' ')
}

function legacyCommandScore(string: string, abbreviation: string, aliases: string[] = []): number {
  const value = aliases.length > 0 ? `${string} ${aliases.join(' ')}` : string
  return commandScoreInner(value, abbreviation, formatInput(value), formatInput(abbreviation), 0, 0, {})
}
