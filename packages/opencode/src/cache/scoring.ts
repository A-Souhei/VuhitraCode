// Scoring utilities for biblion and memento cache improvement

export namespace Scoring {
  // Normalize used_count using log scale to prevent runaway counts
  // log(1 + count) / log(1 + maxCount)
  export function normalizeUsedCount(count: number, maxCount: number): number {
    if (maxCount <= 0) return count > 0 ? 1 : 0
    if (maxCount === 1) return count > 0 ? 1 : 0
    return Math.log(1 + count) / Math.log(1 + maxCount)
  }

  // Calculate hybrid score: similarity * 0.7 + normalizedUsedCount * 0.2 + normalizedQuality * 0.1
  export function calculateScore(
    similarity: number,
    usedCount: number,
    maxUsedCount: number,
    quality: number,
    options?: { similarityWeight?: number; usageWeight?: number; qualityWeight?: number },
  ): number {
    const simWeight = options?.similarityWeight ?? DEFAULT_SIMILARITY_WEIGHT
    const useWeight = options?.usageWeight ?? DEFAULT_USAGE_WEIGHT
    const qualWeight = options?.qualityWeight ?? DEFAULT_QUALITY_WEIGHT
    const normUsed = normalizeUsedCount(usedCount, maxUsedCount)
    // quality is already normalized to 0-1 by the writer (quality / 10)
    const normQuality = Math.max(0, Math.min(1, quality))
    return similarity * simWeight + normUsed * useWeight + normQuality * qualWeight
  }

  // Default weights
  export const DEFAULT_SIMILARITY_WEIGHT = 0.7
  export const DEFAULT_USAGE_WEIGHT = 0.2
  export const DEFAULT_QUALITY_WEIGHT = 0.1

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
    normalizedQuality: number
  }

  // Score and sort entries
  export function scoreEntries<T extends { id: string; used_count?: number; quality?: number }>(
    entries: Array<{ entry: T; similarity: number }>,
    options?: { similarityWeight?: number; usageWeight?: number; qualityWeight?: number },
  ): ScoredEntry<T>[] {
    const maxUsedCount = Math.max(1, ...entries.map((e) => e.entry.used_count ?? 0))

    const scored = entries.map((e) => {
      const normalizedUsedCount = normalizeUsedCount(e.entry.used_count ?? 0, maxUsedCount)
      const normalizedQuality = Math.max(0, Math.min(1, e.entry.quality ?? DEFAULT_QUALITY))
      const score = calculateScore(
        e.similarity,
        e.entry.used_count ?? 0,
        maxUsedCount,
        e.entry.quality ?? DEFAULT_QUALITY,
        options,
      )
      return {
        entry: e.entry,
        score,
        similarity: e.similarity,
        normalizedUsedCount,
        normalizedQuality,
      }
    })

    return scored.sort((a, b) => b.score - a.score)
  }
}
