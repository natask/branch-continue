// Exact match scoring — ported from @moa.os/search/exact.ts

export function exact(query: string, text: string): number {
  if (query.length === 0) return 0

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // Exact full match
  if (t === q) return 1.0

  // Prefix match
  if (t.startsWith(q)) return 0.88

  // Contains match
  if (t.includes(q)) return 0.6

  return 0
}
