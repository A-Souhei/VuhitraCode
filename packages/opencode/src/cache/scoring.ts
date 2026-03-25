// Scoring utilities for biblion and memento cache improvement

export namespace Scoring {
  // Normalize used_count using log scale to prevent runaway counts
  // log(1 + count) / log(1 + maxCount)
  export function normalizeUsedCount(count: number, maxCount: number): number {
    if (maxCount <= 0) return count > 0 ? 1 : 0
    if (maxCount === 1) return count > 0 ? 1 : 0
    return Math.log(1 + count) / Math.log(1 + maxCount)
  }

  // Calculate hybrid score: similarity * 0.7 + normalizedUsedCount * 0.3
  export function calculateScore(
    similarity: number,
    usedCount: number,
    maxUsedCount: number,
    options?: { similarityWeight?: number; usageWeight?: number },
  ): number {
    const simWeight = options?.similarityWeight ?? DEFAULT_SIMILARITY_WEIGHT
    const useWeight = options?.usageWeight ?? DEFAULT_USAGE_WEIGHT
    const norm = normalizeUsedCount(usedCount, maxUsedCount)
    return similarity * simWeight + norm * useWeight
  }

  // Default weights
  export const DEFAULT_SIMILARITY_WEIGHT = 0.7
  export const DEFAULT_USAGE_WEIGHT = 0.3

  // Default thresholds
  export const DEFAULT_DEDUP_THRESHOLD = 0.95
  export const DEFAULT_MIN_SIMILARITY = 0.7
  export const DEFAULT_MAX_CANDIDATES = 50
  export const DEFAULT_QUALITY = 0.5

  // Interface for scored results
  export interface ScoredEntry<T> {
    entry: T
    score: number
    similarity: number
    normalizedUsedCount: number
  }

  // Score and sort entries
  export function scoreEntries<T extends { id: string; used_count?: number }>(
    entries: Array<{ entry: T; similarity: number }>,
    options?: { similarityWeight?: number; usageWeight?: number },
  ): ScoredEntry<T>[] {
    const maxUsedCount = Math.max(1, ...entries.map((e) => e.entry.used_count ?? 0))

    const scored = entries.map((e) => {
      const normalizedUsedCount = normalizeUsedCount(e.entry.used_count ?? 0, maxUsedCount)
      const score = calculateScore(e.similarity, e.entry.used_count ?? 0, maxUsedCount, options)
      return {
        entry: e.entry,
        score,
        similarity: e.similarity,
        normalizedUsedCount,
      }
    })

    return scored.sort((a, b) => b.score - a.score)
  }
}
