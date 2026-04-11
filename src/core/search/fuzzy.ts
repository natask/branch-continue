// Fuzzy matching — ported from @moa.os/search/fuzzy.ts

const MATCH_BASE = 2
const BOUNDARY_BONUS = 1.25
const STREAK_BONUS = 0.75
const GAP_PENALTY = 1.1

export function fuzzy(query: string, text: string): number {
  if (query.length === 0) return 0
  if (text.length === 0) return 0

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  if (q.length > t.length) return 0

  // DP scoring
  let score = 0
  let qi = 0
  let streak = 0

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += MATCH_BASE

      // Boundary bonus: start of string or after non-alpha
      if (ti === 0 || /\W/.test(text[ti - 1])) {
        score += BOUNDARY_BONUS
      }

      // Streak bonus
      if (streak > 0) {
        score += STREAK_BONUS
      }

      // Case match bonus
      if (text[ti] === query[qi]) {
        score += 0.1
      }

      streak++
      qi++
    } else {
      score -= GAP_PENALTY
      streak = 0
    }
  }

  // All query chars must be found
  if (qi < q.length) return 0

  // Normalize to [0, 1]
  const maxPossible = q.length * (MATCH_BASE + BOUNDARY_BONUS + STREAK_BONUS + 0.1)
  return Math.max(0, Math.min(1, score / maxPossible))
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}
