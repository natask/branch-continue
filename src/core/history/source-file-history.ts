const DB_NAME = 'branch-continue-history'
const STORE_NAME = 'source-histories'
const DB_VERSION = 1
export const MAX_SOURCE_HISTORY_COMMANDS = 200

export type SourceFileCommandKind = 'create-note' | 'update-note'

export interface SourceFileCommand {
  id: string
  kind: SourceFileCommandKind
  label: string
  noteId?: string
  createdAt: string
  start: number
  removedText: string
  insertedText: string
}

export interface SourceFileHistoryState {
  sourceKey: string
  commands: SourceFileCommand[]
  /** Number of commands currently applied. Commands at and after this index are redoable. */
  cursor: number
  updatedAt: string
}

export interface SourceFileHistoryStep {
  state: SourceFileHistoryState
  content: string
  command: SourceFileCommand
}

export function emptySourceFileHistory(sourceKey: string): SourceFileHistoryState {
  return { sourceKey, commands: [], cursor: 0, updatedAt: new Date().toISOString() }
}

export function createSourceFileCommand(input: {
  before: string
  after: string
  kind: SourceFileCommandKind
  label: string
  noteId?: string
  now?: Date
}): SourceFileCommand | null {
  if (input.before === input.after) return null

  let start = 0
  const sharedLength = Math.min(input.before.length, input.after.length)
  while (start < sharedLength && input.before[start] === input.after[start]) start += 1

  let beforeEnd = input.before.length
  let afterEnd = input.after.length
  while (
    beforeEnd > start &&
    afterEnd > start &&
    input.before[beforeEnd - 1] === input.after[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  const createdAt = (input.now ?? new Date()).toISOString()
  return {
    id: createCommandId(),
    kind: input.kind,
    label: input.label,
    noteId: input.noteId,
    createdAt,
    start,
    removedText: input.before.slice(start, beforeEnd),
    insertedText: input.after.slice(start, afterEnd),
  }
}

export function appendSourceFileCommand(
  state: SourceFileHistoryState,
  command: SourceFileCommand,
): SourceFileHistoryState {
  const commands = [...state.commands.slice(0, state.cursor), command]
  const retained = commands.slice(-MAX_SOURCE_HISTORY_COMMANDS)
  return {
    ...state,
    commands: retained,
    cursor: retained.length,
    updatedAt: command.createdAt,
  }
}

export function undoSourceFileCommand(
  state: SourceFileHistoryState,
  currentContent: string,
): SourceFileHistoryStep | null {
  if (state.cursor <= 0) return null
  const command = state.commands[state.cursor - 1]
  if (!command) return null
  const content = applyCommand(currentContent, command, 'undo')
  if (content === null) return null
  return {
    state: { ...state, cursor: state.cursor - 1, updatedAt: new Date().toISOString() },
    content,
    command,
  }
}

export function redoSourceFileCommand(
  state: SourceFileHistoryState,
  currentContent: string,
): SourceFileHistoryStep | null {
  const command = state.commands[state.cursor]
  if (!command) return null
  const content = applyCommand(currentContent, command, 'redo')
  if (content === null) return null
  return {
    state: { ...state, cursor: state.cursor + 1, updatedAt: new Date().toISOString() },
    content,
    command,
  }
}

export function canUndoSourceFile(state: SourceFileHistoryState, currentContent: string): boolean {
  if (state.cursor <= 0) return false
  const command = state.commands[state.cursor - 1]
  return Boolean(command && applyCommand(currentContent, command, 'undo') !== null)
}

export function canRedoSourceFile(state: SourceFileHistoryState, currentContent: string): boolean {
  const command = state.commands[state.cursor]
  return Boolean(command && applyCommand(currentContent, command, 'redo') !== null)
}

export async function loadSourceFileHistory(sourceKey: string): Promise<SourceFileHistoryState> {
  if (typeof indexedDB === 'undefined') return loadFallback(sourceKey)
  const db = await openHistoryDb()
  try {
    const stored = await request<SourceFileHistoryState | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(sourceKey),
    )
    return normalizeState(stored, sourceKey)
  } finally {
    db.close()
  }
}

export async function saveSourceFileHistory(state: SourceFileHistoryState): Promise<void> {
  saveFallback(state)
  if (typeof indexedDB === 'undefined') return
  const db = await openHistoryDb()
  try {
    await request(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(state),
    )
  } finally {
    db.close()
  }
}

function applyCommand(
  content: string,
  command: SourceFileCommand,
  direction: 'undo' | 'redo',
): string | null {
  const expected = direction === 'undo' ? command.insertedText : command.removedText
  const replacement = direction === 'undo' ? command.removedText : command.insertedText
  if (content.slice(command.start, command.start + expected.length) !== expected) return null
  return `${content.slice(0, command.start)}${replacement}${content.slice(command.start + expected.length)}`
}

function normalizeState(
  value: SourceFileHistoryState | undefined,
  sourceKey: string,
): SourceFileHistoryState {
  if (!value || value.sourceKey !== sourceKey || !Array.isArray(value.commands)) {
    return loadFallback(sourceKey)
  }
  const cursor = Math.max(0, Math.min(Number(value.cursor) || 0, value.commands.length))
  return { ...value, cursor }
}

function createCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function fallbackKey(sourceKey: string): string {
  return `branch-continue:history:${sourceKey}`
}

function loadFallback(sourceKey: string): SourceFileHistoryState {
  if (typeof localStorage === 'undefined') return emptySourceFileHistory(sourceKey)
  try {
    const raw = localStorage.getItem(fallbackKey(sourceKey))
    if (!raw) return emptySourceFileHistory(sourceKey)
    const parsed = JSON.parse(raw) as SourceFileHistoryState
    if (parsed.sourceKey !== sourceKey || !Array.isArray(parsed.commands)) {
      return emptySourceFileHistory(sourceKey)
    }
    return { ...parsed, cursor: Math.max(0, Math.min(parsed.cursor, parsed.commands.length)) }
  } catch {
    return emptySourceFileHistory(sourceKey)
  }
}

function saveFallback(state: SourceFileHistoryState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(fallbackKey(state.sourceKey), JSON.stringify(state))
  } catch {
    // IndexedDB remains the primary store; a full localStorage quota is harmless.
  }
}

function openHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sourceKey' })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('Could not open command history.'))
  })
}

function request<T = IDBValidKey>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error ?? new Error('Command history operation failed.'))
  })
}
