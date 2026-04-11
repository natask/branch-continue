// Platform-agnostic database abstraction
// Mirrors the PlatformDatabase / PlatformStatement interfaces from moav2

export interface PlatformStatement {
  run(...params: unknown[]): Promise<{ changes: number }>
  get(...params: unknown[]): Promise<Record<string, unknown> | undefined>
  all(...params: unknown[]): Promise<Record<string, unknown>[]>
}

export interface PlatformDatabase {
  exec(sql: string): Promise<void>
  prepare(sql: string): PlatformStatement
  close(): Promise<void>
}

export interface PlatformSqlite {
  open(name: string): Promise<PlatformDatabase>
}
