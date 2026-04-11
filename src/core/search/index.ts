// Search engine factory — simplified from @moa.os/search
// MVP: exact + fuzzy scoring, no semantic or frecency

export type { SearchResult, SearchEngine, CreateSearchConfig } from './types'

import type { SearchResult, SearchEngine, CreateSearchConfig } from './types'
import { exact } from './exact'
import { fuzzy } from './fuzzy'

export function createSearch<T>(config: CreateSearchConfig<T>): SearchEngine<T> {
  let items = [...config.items]
  let lowerTexts = items.map((item) => config.getText(item).toLowerCase())

  function search(query: string): SearchResult<T>[] {
    if (!query.trim()) {
      return items.map((item) => ({ item, score: 0 }))
    }

    const q = query.trim()
    const results: SearchResult<T>[] = []

    for (let i = 0; i < items.length; i++) {
      const text = config.getText(items[i])
      const exactScore = exact(q, text)
      const fuzzyScore = fuzzy(q, lowerTexts[i])

      // Weighted combination
      const score = exactScore * 0.6 + fuzzyScore * 0.4

      if (score > 0.05) {
        results.push({ item: items[i], score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results
  }

  function update(newItems: readonly T[]) {
    items = [...newItems]
    lowerTexts = items.map((item) => config.getText(item).toLowerCase())
  }

  return { search, update }
}
