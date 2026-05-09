// Fuzzy matching for long text entries. This intentionally favors literal
// phrase matches, then token matches with small typo tolerance.

export function fuzzy(query: string, text: string): number {
  const tokens = getTokens(query)
  const foldedText = fold(text)
  if (tokens.length === 0 || foldedText.length === 0) return 0

  const foldedQuery = fold(query)
  if (foldedText === foldedQuery) return 1
  if (foldedText.startsWith(foldedQuery)) return 0.92
  if (foldedText.includes(foldedQuery)) return 0.82

  let total = 0
  let weakest = 1
  for (const token of tokens) {
    const score = fuzzyToken(token, text)
    if (score < 0.52) return 0
    total += score
    weakest = Math.min(weakest, score)
  }

  const average = total / tokens.length
  const coveragePenalty = tokens.length === 1 ? 1 : 0.92 + weakest * 0.08
  return clamp(average * coveragePenalty, 0, 0.95)
}

export function fuzzyMatch(query: string, text: string): boolean {
  return fuzzy(query, text) > 0
}

function fuzzyToken(token: string, text: string): number {
  const foldedText = fold(text)
  if (foldedText.startsWith(token)) return 0.9
  if (foldedText.includes(token)) return 0.78

  let best = 0
  for (const word of getWords(text)) {
    const foldedWord = fold(word)
    if (foldedWord === token) best = Math.max(best, 1)
    else if (foldedWord.startsWith(token)) best = Math.max(best, 0.9)
    else if (foldedWord.includes(token)) best = Math.max(best, 0.74)
    else best = Math.max(best, typoScore(foldedWord, token))
  }
  return best
}

function typoScore(word: string, token: string): number {
  if (word.length < 3 || token.length < 3) return 0
  const distance = levenshtein(word, token)
  const length = Math.max(word.length, token.length)
  const allowed = length <= 5 ? 1 : length <= 9 ? 2 : 3
  if (distance > allowed) return 0
  return clamp(0.58 + (1 - distance / length) * 0.25, 0, 0.83)
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

function getTokens(input: string): string[] {
  return getWords(input).map(fold).filter(Boolean)
}

function getWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function fold(input: string): string {
  return input.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
