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
    test("returns correct score with default weights (0.7/0.3)", () => {
      const score = Scoring.calculateScore(0.8, 50, 100)
      const expectedNorm = Scoring.normalizeUsedCount(50, 100)
      const expected = 0.8 * 0.7 + expectedNorm * 0.3
      expect(score).toBeCloseTo(expected)
    })

    test("returns correct score with custom weights", () => {
      const score = Scoring.calculateScore(0.5, 20, 100, {
        similarityWeight: 0.6,
        usageWeight: 0.4,
      })
      const expectedNorm = Scoring.normalizeUsedCount(20, 100)
      const expected = 0.5 * 0.6 + expectedNorm * 0.4
      expect(score).toBeCloseTo(expected)
    })

    test("handles edge case when similarity = 0", () => {
      const score = Scoring.calculateScore(0, 50, 100)
      const expectedNorm = Scoring.normalizeUsedCount(50, 100)
      expect(score).toBeCloseTo(expectedNorm * 0.3)
    })

    test("handles edge case when usedCount = 0", () => {
      const score = Scoring.calculateScore(0.9, 0, 100)
      expect(score).toBeCloseTo(0.9 * 0.7 + 0 * 0.3)
      expect(score).toBe(0.63)
    })

    test("handles both similarity and usedCount at 0", () => {
      const score = Scoring.calculateScore(0, 0, 100)
      expect(score).toBe(0)
    })
  })

  describe("scoreEntries", () => {
    test("scores and sorts entries correctly", () => {
      // maxUsedCount = 50
      const entries = [
        { entry: { id: "a", used_count: 10 }, similarity: 0.9 },
        { entry: { id: "b", used_count: 50 }, similarity: 0.7 },
        { entry: { id: "c", used_count: 30 }, similarity: 0.8 },
      ]

      // Calculated scores:
      // a: 0.9*0.7 + log(11)/log(51)*0.3 ≈ 0.821
      // b: 0.7*0.7 + 1.0*0.3 = 0.79
      // c: 0.8*0.7 + log(31)/log(51)*0.3 ≈ 0.834
      const result = Scoring.scoreEntries(entries)

      expect(result).toHaveLength(3)
      expect(result[0].entry.id).toBe("c") // highest score
      expect(result[1].entry.id).toBe("a")
      expect(result[2].entry.id).toBe("b")
    })

    test("handles empty array", () => {
      const result = Scoring.scoreEntries([])
      expect(result).toHaveLength(0)
    })

    test("handles entries with different used_counts", () => {
      type TestEntry = { id: string; used_count: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "low", used_count: 1 }, similarity: 0.9 },
        { entry: { id: "high", used_count: 100 }, similarity: 0.9 },
      ]

      const result = Scoring.scoreEntries(entries)

      // high used_count should rank higher when similarity is equal
      expect(result[0].entry.id).toBe("high")
      expect(result[1].entry.id).toBe("low")
    })

    test("returns sorted descending by score", () => {
      type TestEntry = { id: string; used_count: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "first", used_count: 5 }, similarity: 0.95 },
        { entry: { id: "second", used_count: 20 }, similarity: 0.85 },
        { entry: { id: "third", used_count: 50 }, similarity: 0.6 },
      ]

      const result = Scoring.scoreEntries(entries)

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score)
      }
    })

    test("includes all required fields in ScoredEntry", () => {
      const entries = [{ entry: { id: "test" as const, used_count: 10 }, similarity: 0.8 }]
      const result = Scoring.scoreEntries(entries)

      expect(result[0]).toHaveProperty("entry")
      expect(result[0]).toHaveProperty("score")
      expect(result[0]).toHaveProperty("similarity")
      expect(result[0]).toHaveProperty("normalizedUsedCount")
    })

    test("handles entries without used_count (defaults to 0)", () => {
      type TestEntry = { id: string; used_count?: number }
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "no_count" }, similarity: 0.9 },
        { entry: { id: "with_count", used_count: 50 }, similarity: 0.5 },
      ]

      const result = Scoring.scoreEntries(entries)

      // entry with used_count should score higher due to usage weight
      expect(result[0].entry.id).toBe("with_count")
    })
  })
})
