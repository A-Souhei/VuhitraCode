import { test, expect, describe } from "bun:test"
import { Scoring } from "./scoring"

describe("Scoring", () => {
  describe("normalizeUsedCount", () => {
    test("returns 0 when count is 0", () => {
      expect(Scoring.normalizeUsedCount(0, 100)).toBe(0)
    })

    test("returns correct value for count > 0 with various maxCount values", () => {
      // With maxCount = 10, count = 5: log(6) / log(11)
      const result = Scoring.normalizeUsedCount(5, 10)
      expect(result).toBeCloseTo(Math.log(6) / Math.log(11))
    })

    test("handles edge case when maxCount = 0", () => {
      expect(Scoring.normalizeUsedCount(0, 0)).toBe(0)
      expect(Scoring.normalizeUsedCount(1, 0)).toBe(1)
      expect(Scoring.normalizeUsedCount(5, 0)).toBe(1)
    })

    test("handles edge case when maxCount = 1", () => {
      expect(Scoring.normalizeUsedCount(0, 1)).toBe(0)
      expect(Scoring.normalizeUsedCount(1, 1)).toBe(1)
      expect(Scoring.normalizeUsedCount(5, 1)).toBe(1)
    })

    test("tests log scale normalization", () => {
      // Log scale should give diminishing returns for higher counts
      const norm5 = Scoring.normalizeUsedCount(5, 100)
      const norm50 = Scoring.normalizeUsedCount(50, 100)
      const norm100 = Scoring.normalizeUsedCount(100, 100)

      // log(6)/log(101) < log(51)/log(101) < log(101)/log(101) = 1
      expect(norm5).toBeLessThan(norm50)
      expect(norm50).toBeLessThan(norm100)
      expect(norm100).toBe(1)
    })
  })

  describe("calculateScore", () => {
    test("returns correct score with default weights (0.7/0.2/0.1)", () => {
      const quality = 0.7 // already normalized to 0-1
      const score = Scoring.calculateScore(0.8, 50, 100, quality)
      const expectedNormUsed = Scoring.normalizeUsedCount(50, 100)
      const expected = 0.8 * 0.7 + expectedNormUsed * 0.2 + quality * 0.1
      expect(score).toBeCloseTo(expected)
    })

    test("returns correct score with custom weights", () => {
      const quality = 0.5
      const score = Scoring.calculateScore(0.5, 20, 100, quality, {
        similarityWeight: 0.5,
        usageWeight: 0.3,
        qualityWeight: 0.2,
      })
      const expectedNormUsed = Scoring.normalizeUsedCount(20, 100)
      const expected = 0.5 * 0.5 + expectedNormUsed * 0.3 + quality * 0.2
      expect(score).toBeCloseTo(expected)
    })

    test("handles edge case when similarity = 0", () => {
      const quality = 0.8
      const score = Scoring.calculateScore(0, 50, 100, quality)
      const expectedNorm = Scoring.normalizeUsedCount(50, 100)
      // 0*0.7 + norm*0.2 + quality*0.1
      expect(score).toBeCloseTo(expectedNorm * 0.2 + quality * 0.1)
    })

    test("handles edge case when usedCount = 0", () => {
      const quality = 0.6
      const score = Scoring.calculateScore(0.9, 0, 100, quality)
      // 0.9*0.7 + 0*0.2 + 0.6*0.1
      expect(score).toBeCloseTo(0.9 * 0.7 + quality * 0.1)
    })

    test("handles edge case when quality = 0", () => {
      const score = Scoring.calculateScore(0.8, 50, 100, 0)
      const expectedNorm = Scoring.normalizeUsedCount(50, 100)
      // 0.8*0.7 + norm*0.2 + 0*0.1
      expect(score).toBeCloseTo(0.8 * 0.7 + expectedNorm * 0.2)
    })

    test("handles edge case when quality = 1", () => {
      const score = Scoring.calculateScore(0.8, 50, 100, 1)
      const expectedNorm = Scoring.normalizeUsedCount(50, 100)
      // 0.8*0.7 + norm*0.2 + 1*0.1
      expect(score).toBeCloseTo(0.8 * 0.7 + expectedNorm * 0.2 + 0.1)
    })

    test("handles all components at 0", () => {
      const score = Scoring.calculateScore(0, 0, 100, 0)
      expect(score).toBe(0)
    })

    test("handles all components at maximum", () => {
      const score = Scoring.calculateScore(1, 100, 100, 1)
      // 1*0.7 + 1*0.2 + 1*0.1 = 1.0
      expect(score).toBeCloseTo(1.0)
    })

    test("quality is clamped to 0-1 range", () => {
      // Quality > 1 should be clamped to 1
      const score1 = Scoring.calculateScore(0.5, 10, 100, 1.5)
      const score2 = Scoring.calculateScore(0.5, 10, 100, 1)
      expect(score1).toBeCloseTo(score2)

      // Quality < 0 should be clamped to 0
      const score3 = Scoring.calculateScore(0.5, 10, 100, -0.5)
      const score4 = Scoring.calculateScore(0.5, 10, 100, 0)
      expect(score3).toBeCloseTo(score4)
    })
  })

  describe("scoreEntries", () => {
    test("scores and sorts entries correctly with three-component formula", () => {
      // maxUsedCount = 50
      const entries = [
        { entry: { id: "a", used_count: 10, quality: 0.5 }, similarity: 0.9 },
        { entry: { id: "b", used_count: 50, quality: 0.7 }, similarity: 0.7 },
        { entry: { id: "c", used_count: 30, quality: 0.9 }, similarity: 0.8 },
      ]

      // Calculated scores with new formula: sim*0.7 + normUsed*0.2 + quality*0.1
      // norm(10,50) = log(11)/log(51) ≈ 0.654
      // norm(50,50) = 1.0
      // norm(30,50) = log(31)/log(51) ≈ 0.854
      // a: 0.9*0.7 + 0.654*0.2 + 0.5*0.1 ≈ 0.811
      // b: 0.7*0.7 + 1.0*0.2 + 0.7*0.1 = 0.76
      // c: 0.8*0.7 + 0.854*0.2 + 0.9*0.1 ≈ 0.821
      const result = Scoring.scoreEntries(entries)

      expect(result).toHaveLength(3)
      expect(result[0].entry.id).toBe("c") // highest score (0.821)
      expect(result[1].entry.id).toBe("a") // second (0.811)
      expect(result[2].entry.id).toBe("b") // lowest (0.76)
    })

    test("handles empty array", () => {
      const result = Scoring.scoreEntries([])
      expect(result).toHaveLength(0)
    })

    test("handles entries with different used_counts", () => {
      type TestEntry = { id: string; used_count: number; quality: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "low", used_count: 1, quality: 0.5 }, similarity: 0.9 },
        { entry: { id: "high", used_count: 100, quality: 0.5 }, similarity: 0.9 },
      ]

      const result = Scoring.scoreEntries(entries)

      // high used_count should rank higher when similarity and quality are equal
      expect(result[0].entry.id).toBe("high")
      expect(result[1].entry.id).toBe("low")
    })

    test("handles entries with different quality values", () => {
      type TestEntry = { id: string; used_count: number; quality: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "low_quality", used_count: 50, quality: 0.3 }, similarity: 0.8 },
        { entry: { id: "high_quality", used_count: 50, quality: 0.9 }, similarity: 0.8 },
      ]

      const result = Scoring.scoreEntries(entries)

      // high quality should rank higher when similarity and used_count are equal
      expect(result[0].entry.id).toBe("high_quality")
      expect(result[1].entry.id).toBe("low_quality")
    })

    test("returns sorted descending by score", () => {
      type TestEntry = { id: string; used_count: number; quality: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "first", used_count: 5, quality: 0.9 }, similarity: 0.95 },
        { entry: { id: "second", used_count: 20, quality: 0.5 }, similarity: 0.85 },
        { entry: { id: "third", used_count: 50, quality: 0.3 }, similarity: 0.6 },
      ]

      const result = Scoring.scoreEntries(entries)

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score)
      }
    })

    test("includes all required fields in ScoredEntry", () => {
      const entries = [{ entry: { id: "test" as const, used_count: 10, quality: 0.7 }, similarity: 0.8 }]
      const result = Scoring.scoreEntries(entries)

      expect(result[0]).toHaveProperty("entry")
      expect(result[0]).toHaveProperty("score")
      expect(result[0]).toHaveProperty("similarity")
      expect(result[0]).toHaveProperty("normalizedUsedCount")
      expect(result[0]).toHaveProperty("normalizedQuality")
    })

    test("handles entries without used_count (defaults to 0)", () => {
      type TestEntry = { id: string; used_count?: number; quality?: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "no_count" }, similarity: 0.9 },
        { entry: { id: "with_count", used_count: 50 }, similarity: 0.5 },
      ]

      const result = Scoring.scoreEntries(entries)

      // With new formula, high similarity (70% weight) can outweigh used_count (20% weight)
      // no_count: used_count=0, quality=0.5 (default), similarity=0.9
      //   score = 0.9*0.7 + 0*0.2 + 0.5*0.1 = 0.68
      // with_count: used_count=50, quality=0.5 (default), similarity=0.5
      //   norm(50,50)=1.0, score = 0.5*0.7 + 1.0*0.2 + 0.5*0.1 = 0.60
      // So no_count scores higher due to higher similarity
      expect(result[0].entry.id).toBe("no_count")
    })

    test("handles entries without quality (defaults to DEFAULT_QUALITY)", () => {
      type TestEntry = { id: string; used_count: number; quality?: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "no_quality", used_count: 50 }, similarity: 0.8 },
        { entry: { id: "high_quality", used_count: 50, quality: 0.9 }, similarity: 0.8 },
      ]

      const result = Scoring.scoreEntries(entries)

      // entry with high quality should score higher
      expect(result[0].entry.id).toBe("high_quality")
    })

    test("three-component formula: quality contributes 10% to final score", () => {
      type TestEntry = { id: string; used_count: number; quality: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "low_q", used_count: 0, quality: 0.0 }, similarity: 1.0 },
        { entry: { id: "high_q", used_count: 0, quality: 1.0 }, similarity: 1.0 },
      ]

      const result = Scoring.scoreEntries(entries)

      // Both have similarity=1.0 and used_count=0
      // low_q: 1.0*0.7 + 0*0.2 + 0.0*0.1 = 0.7
      // high_q: 1.0*0.7 + 0*0.2 + 1.0*0.1 = 0.8
      // Difference should be exactly 0.1 (the quality weight contribution)
      expect(result[0].entry.id).toBe("high_q")
      expect(result[1].entry.id).toBe("low_q")
      expect(result[0].score - result[1].score).toBeCloseTo(0.1, 5)
    })
  })
})
