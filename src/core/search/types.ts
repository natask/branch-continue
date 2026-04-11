// Search types — ported from @moa.os/search

export interface SearchResult<T> {
  item: T
  score: number
}

export interface SearchEngine<T> {
  search(query: string): SearchResult<T>[]
  update(items: readonly T[]): void
}

export interface CreateSearchConfig<T> {
  items: readonly T[]
  getText: (item: T) => string
  getId: (item: T) => string
}
