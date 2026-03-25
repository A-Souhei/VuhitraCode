// End-to-end test for the memento cache improvement system.
// Tests the full canonicalize → score → rank pipeline using only pure modules,// no external backends required.

import { test, expect, describe } from "bun:test"
import { Canonicalize } from "./canonicalize"
import { Scoring } from "./scoring"

// ─── In-memory simulation of the memento cache ───────────────────────────────

type EntryType = "issue" | "resolution" | "finding" | "command" | "procedure" | "script" | "branch" | "log"

interface MockEntry {
  id: string
  type: EntryType
  content: string
  quality: number
  used_count: number
  canonical: Canonicalize.CanonicalResult
}

// Simulate in-memory store
const store: MockEntry[] = []

function writeEntry(
  id: string,
  type: EntryType,
  content: string,
  qualityRaw: number,
  extraMeta?: Partial<Pick<MockEntry, "used_count">>,
): MockEntry {
  const canonical = Canonicalize.createCanonicalResult(content, type)
  const quality = qualityRaw / 10 // Normalize 0-10 → 0-1 as Memory.WriteTool does
  const entry: MockEntry = {
    id,
    type,
    content,
    quality,
    used_count: extraMeta?.used_count ?? 0,
    canonical,
  }
  store.push(entry)
  return entry
}

// Simulate a search: score entries using current used_counts, sort, increment
// used_count for top results (mirrors Memory.search behaviour).
function simulateSearch(topK = 5): Scoring.ScoredEntry<MockEntry>[] {
  // We simulate similarity at a constant to isolate the scoring/ranking logic.
  const BASE_SIMILARITY = 0.85

  const entries = store.map((e) => ({
    entry: {
      id: e.id,
      type: e.type,
      content: e.content,
      quality: e.quality,
      used_count: e.used_count,
      canonical: e.canonical,
    },
    similarity: BASE_SIMILARITY,
  }))

  const scored = Scoring.scoreEntries(entries)
  const top = scored.slice(0, topK)

  // Increment used_count for returned results (mirrors Memory.search behaviour)
  for (const s of top) {
    const found = store.find((e) => e.id === s.entry.id)
    if (found) found.used_count++
  }

  return top
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Memento cache improvement — E2E", () => {
  // ── Setup: write 3 entries ────────────────────────────────────────────────

  test("write entry 1 — quality 3, error handling topic", () => {
    store.length = 0 // reset store
    const e = writeEntry(
      "entry-1",
      "issue",
      "Application throws unhandled exception during error processing. The middleware fails silently when encountering async errors.",
      3,
    )
    expect(e.quality).toBeCloseTo(0.3)
    expect(e.used_count).toBe(0)
    // Verify canonicalization extracted meaningful query and tags
    expect(e.canonical.query.length).toBeGreaterThan(0)
    expect(e.canonical.tags).toContain("issue")
    // issue type → at least async and middleware should be detected from content
    expect(e.canonical.tags).toContain("async")
    expect(e.canonical.tags).toContain("middleware")
  })

  test("write entry 2 — quality 7, error handling topic", () => {
    const e = writeEntry(
      "entry-2",
      "resolution",
      "Fixed async error propagation by wrapping callbacks in try-catch blocks and forwarding exceptions to the error handling middleware.",
      7,
    )
    expect(e.quality).toBeCloseTo(0.7)
    expect(e.used_count).toBe(0)
    expect(e.canonical.query.length).toBeGreaterThan(0)
    expect(e.canonical.tags).toContain("resolution")
    // async and middleware should appear in tags
    expect(e.canonical.tags).toContain("async")
    expect(e.canonical.tags).toContain("middleware")
  })

  test("write entry 3 — quality 9, error handling topic", () => {
    const e = writeEntry(
      "entry-3",
      "finding",
      "Comprehensive error handling pattern: wrap async operations in try-catch, use middleware for centralised error reporting, and always propagate errors with context.",
      9,
    )
    expect(e.quality).toBeCloseTo(0.9)
    expect(e.used_count).toBe(0)
    expect(e.canonical.query.length).toBeGreaterThan(0)
    expect(e.canonical.tags).toContain("finding")
    expect(e.canonical.tags).toContain("async")
    expect(e.canonical.tags).toContain("middleware")
  })

  // ── Verify store state ────────────────────────────────────────────────────

  test("store contains exactly 3 entries after writes", () => {
    expect(store).toHaveLength(3)
  })

  // ── Search 1: all used_count=0 before scoring → score = sim*0.7 + quality*0.1 ───────

  describe("Search 1 — no prior reads, used_count=0 for all", () => {
    let results: Scoring.ScoredEntry<MockEntry>[]

    test("search returns 3 results", () => {
      results = simulateSearch(3)
      expect(results).toHaveLength(3)
    })

    test("after search 1 all entries have used_count=1", () => {
      for (const e of store) {
        expect(e.used_count).toBe(1)
      }
    })

    test("scores are sorted descending", () => {
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
      }
    })

    test("entries ranked by quality when used_count=0 and similarity is equal", () => {
      // Before search 1: all used_count=0, maxUsedCount clamped to 1
      // norm(0, 1) = 0 (special case in normalizeUsedCount)
      // With new formula: score = similarity*0.7 + normUsed*0.2 + quality*0.1
      // entry-1: quality=0.3 → score = 0.85*0.7 + 0*0.2 + 0.3*0.1 = 0.625
      // entry-2: quality=0.7 → score = 0.85*0.7 + 0*0.2 + 0.7*0.1 = 0.665
      // entry-3: quality=0.9 → score = 0.85*0.7 + 0*0.2 + 0.9*0.1 = 0.685
      // Expected order: entry-3 (highest quality), entry-2, entry-1
      expect(results[0].entry.id).toBe("entry-3")
      expect(results[1].entry.id).toBe("entry-2")
      expect(results[2].entry.id).toBe("entry-1")
    })

    test("hybrid score formula verifies three-component scoring", () => {
      const norm = Scoring.normalizeUsedCount(0, 1) //= 0 (special case)
      // Verify each entry's score matches the formula
      const expected1 =
        0.85 * Scoring.DEFAULT_SIMILARITY_WEIGHT +
        norm * Scoring.DEFAULT_USAGE_WEIGHT +
        0.3 * Scoring.DEFAULT_QUALITY_WEIGHT
      const expected2 =
        0.85 * Scoring.DEFAULT_SIMILARITY_WEIGHT +
        norm * Scoring.DEFAULT_USAGE_WEIGHT +
        0.7 * Scoring.DEFAULT_QUALITY_WEIGHT
      const expected3 =
        0.85 * Scoring.DEFAULT_SIMILARITY_WEIGHT +
        norm * Scoring.DEFAULT_USAGE_WEIGHT +
        0.9 * Scoring.DEFAULT_QUALITY_WEIGHT

      const r1 = results.find((r) => r.entry.id === "entry-1")!
      const r2 = results.find((r) => r.entry.id === "entry-2")!
      const r3 = results.find((r) => r.entry.id === "entry-3")!
      expect(r1.score).toBeCloseTo(expected1, 5)
      expect(r2.score).toBeCloseTo(expected2, 5)
      expect(r3.score).toBeCloseTo(expected3, 5)
    })
  })

  // ── Search 2: entry-1 manually bumped → used_count=2, others at 1 ─────────

  describe("Search 2 — entry-1 manually incremented to simulate prior targeted read", () => {
    let results: Scoring.ScoredEntry<MockEntry>[]

    test("manually increment entry-1 used_count to 2", () => {
      const e1 = store.find((e) => e.id === "entry-1")!
      e1.used_count++ // 1 → 2
      expect(e1.used_count).toBe(2)
      expect(store.find((e) => e.id === "entry-2")!.used_count).toBe(1)
      expect(store.find((e) => e.id === "entry-3")!.used_count).toBe(1)
    })

    test("search 2 returns 3 results", () => {
      results = simulateSearch(3)
      expect(results).toHaveLength(3)
    })

    test("used_counts incremented after search 2: entry-1=3, others=2", () => {
      expect(store.find((e) => e.id === "entry-1")!.used_count).toBe(3)
      expect(store.find((e) => e.id === "entry-2")!.used_count).toBe(2)
      expect(store.find((e) => e.id === "entry-3")!.used_count).toBe(2)
    })

    test("scores are sorted descending", () => {
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
      }
    })

    test("three-component formula balances used_count and quality", () => {
      // scoreEntries sees: entry-1(quality=0.3)=2, entry-2(quality=0.7)=1, entry-3(quality=0.9)=1; max=2
      // norm(2,2)=1.0, norm(1,2)=log(2)/log(3)≈0.631
      // entry-1: 0.85*0.7 + 1.0*0.2 + 0.3*0.1 = 0.825
      // entry-2: 0.85*0.7 + 0.631*0.2 + 0.7*0.1 = 0.771
      // entry-3: 0.85*0.7 + 0.631*0.2 + 0.9*0.1 = 0.791
      // Expected order: entry-1 (highest usage boost), entry-3 (highest quality), entry-2
      expect(results[0].entry.id).toBe("entry-1")
    })

    test("entry-1 score in search 2: 0.85*0.7 + norm(2,2)*0.2 + 0.3*0.1 = 0.825", () => {
      const norm = Scoring.normalizeUsedCount(2, 2) // = 1.0
      const expected = 0.85 * 0.7 + norm * 0.2 + 0.3 * 0.1
      const r1 = results.find((r) => r.entry.id === "entry-1")!
      expect(r1.score).toBeCloseTo(expected, 5)
      expect(r1.score).toBeCloseTo(0.825, 5)
    })

    test("entry-3 outranks entry-2 due to higher quality despite same used_count", () => {
      const e2 = results.find((r) => r.entry.id === "entry-2")!
      const e3 = results.find((r) => r.entry.id === "entry-3")!
      expect(e3.score).toBeGreaterThan(e2.score)
      expect(results[0].entry.id).toBe("entry-1")
      expect(results[1].entry.id).toBe("entry-3")
      expect(results[2].entry.id).toBe("entry-2")
    })
  })

  // ── Search 3: log-normalized used_count effect ─────────────────────────────

  describe("Search 3 — log-normalization effect", () => {
    let results: Scoring.ScoredEntry<MockEntry>[]

    test("search 3 returns 3 results", () => {
      // Before: entry-1=3, entry-2=2, entry-3=2
      results = simulateSearch(3)
      expect(results).toHaveLength(3)
    })

    test("used_counts incremented after search 3: entry-1=4, others=3", () => {
      expect(store.find((e) => e.id === "entry-1")!.used_count).toBe(4)
      expect(store.find((e) => e.id === "entry-2")!.used_count).toBe(3)
      expect(store.find((e) => e.id === "entry-3")!.used_count).toBe(3)
    })

    test("scores are sorted descending", () => {
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
      }
    })

    test("three-component formula: quality can outweigh used_count with new weights", () => {
      // scoreEntries sees: entry-1(quality=0.3)=3, entry-2(quality=0.7)=2, entry-3(quality=0.9)=2; max=3
      // norm(3,3)=1.0, norm(2,3)=log(3)/log(4)≈0.792
      // entry-1: 0.85*0.7 + 1.0*0.2 + 0.3*0.1 = 0.825
      // entry-2: 0.85*0.7 + 0.792*0.2 + 0.7*0.1 = 0.8234
      // entry-3: 0.85*0.7 + 0.792*0.2 + 0.9*0.1 = 0.8434
      // With 20% usage weight + 10% quality weight, entry-3's high quality (0.9)
      // outweighs entry-1's used_count advantage
      // Expected order: entry-3 (highest quality), entry-1, entry-2
      expect(results[0].entry.id).toBe("entry-3")
      expect(results[1].entry.id).toBe("entry-1")
      expect(results[2].entry.id).toBe("entry-2")
    })

    test("verify exact hybrid scores in search 3", () => {
      // scoreEntries sees: entry-1=3, others=2; max=3
      const norm3 = Scoring.normalizeUsedCount(3, 3)
      const norm2 = Scoring.normalizeUsedCount(2, 3)
      const scoreEntry1 = 0.85 * 0.7 + norm3 * 0.2 + 0.3 * 0.1
      const scoreEntry2 = 0.85 * 0.7 + norm2 * 0.2 + 0.7 * 0.1
      const scoreEntry3 = 0.85 * 0.7 + norm2 * 0.2 + 0.9 * 0.1

      const r1 = results.find((r) => r.entry.id === "entry-1")!
      const r2 = results.find((r) => r.entry.id === "entry-2")!
      const r3 = results.find((r) => r.entry.id === "entry-3")!

      expect(r1.score).toBeCloseTo(scoreEntry1, 5)
      expect(r2.score).toBeCloseTo(scoreEntry2, 5)
      expect(r3.score).toBeCloseTo(scoreEntry3, 5)
    })

    test("log-normalization produces diminishing returns on used_count boost", () => {
      // With max=3: norm(1)=log(2)/log(4)≈0.5, norm(2)≈0.792, norm(3)=1.0
      // gap 1→2 > gap 2→3 (diminishing returns)
      const diff12 = Scoring.normalizeUsedCount(2, 3) - Scoring.normalizeUsedCount(1, 3)
      const diff23 = Scoring.normalizeUsedCount(3, 3) - Scoring.normalizeUsedCount(2, 3)
      expect(diff12).toBeGreaterThan(diff23)
    })
  })

  // ── Canonicalization correctness ──────────────────────────────────────────

  describe("Canonicalization correctness", () => {
    test("all 3 entries have non-empty canonical queries ≤ 100 chars", () => {
      for (const e of store) {
        expect(e.canonical.query.length).toBeGreaterThan(0)
        expect(e.canonical.query.length).toBeLessThanOrEqual(100)
      }
    })

    test("all 3 entries have at least 1 canonical tag", () => {
      for (const e of store) {
        expect(e.canonical.tags.length).toBeGreaterThanOrEqual(1)
      }
    })

    test("entry 1 (issue type) canonical query is derived from first sentence", () => {
      const e = store.find((e) => e.id === "entry-1")!
      expect(e.canonical.query).toBeTruthy()
      // issue → extractQuery returns first sentence of cleaned content
      expect(e.canonical.query.toLowerCase()).toMatch(/application|exception|error|processing|middleware|async/)
    })

    test("entry 2 (resolution type) canonical query contains relevant content", () => {
      const e = store.find((e) => e.id === "entry-2")!
      expect(e.canonical.query).toBeTruthy()
      expect(e.canonical.query.length).toBeGreaterThan(5)
    })

    test("entry 3 (finding type) canonical query ≤ 100 chars", () => {
      const e = store.find((e) => e.id === "entry-3")!
      expect(e.canonical.query.length).toBeLessThanOrEqual(100)
    })

    test("different entries have distinct canonical queries", () => {
      const [q1, q2, q3] = store.map((e) => e.canonical.query)
      expect(q1 === q2 && q2 === q3).toBe(false)
    })

    test("entry type is always the first canonical tag", () => {
      expect(store.find((e) => e.id === "entry-1")!.canonical.tags[0]).toBe("issue")
      expect(store.find((e) => e.id === "entry-2")!.canonical.tags[0]).toBe("resolution")
      expect(store.find((e) => e.id === "entry-3")!.canonical.tags[0]).toBe("finding")
    })

    test("async keyword detected in all 3 error-handling entries", () => {
      for (const e of store) {
        expect(e.canonical.tags).toContain("async")
      }
    })

    test("middleware keyword detected in all 3 entries", () => {
      for (const e of store) {
        expect(e.canonical.tags).toContain("middleware")
      }
    })
  })

  // ── Scoring formula validation ────────────────────────────────────────────

  describe("Hybrid scoring formula validation", () => {
    test("normalizeUsedCount(0, N) = 0 for any N ≥ 1", () => {
      for (const max of [1, 5, 10, 100]) {
        expect(Scoring.normalizeUsedCount(0, max)).toBe(0)
      }
    })

    test("normalizeUsedCount(N, N) = 1.0 when count equals max", () => {
      for (const n of [1, 5, 10, 100]) {
        expect(Scoring.normalizeUsedCount(n, n)).toBe(1.0)
      }
    })

    test("calculateScore uses 0.7/0.2/0.1 default weights", () => {
      const quality = 0.8
      const score = Scoring.calculateScore(1.0, 10, 10, quality)
      // 1.0*0.7 + 1.0*0.2 + 0.8*0.1 = 0.98
      expect(score).toBeCloseTo(0.98, 5)
    })

    test("calculateScore with zero used_count uses similarity and quality weights", () => {
      const quality = 0.6
      const score = Scoring.calculateScore(0.8, 0, 100, quality)
      // 0.8*0.7 + 0*0.2 + 0.6*0.1 = 0.62
      expect(score).toBeCloseTo(0.62, 5)
    })

    test("calculateScore with maximum values returns 1.0", () => {
      const score = Scoring.calculateScore(1.0, 100, 100, 1.0)
      // 1.0*0.7 + 1.0*0.2 + 1.0*0.1 = 1.0
      expect(score).toBeCloseTo(1.0, 5)
    })

    test("rank order: quality differentiates when similarity and used_count equal", () => {
      // With same similarity and used_count, quality determines order
      const entries = [
        { entry: { id: "entry-1", used_count: 0, quality: 0.3 }, similarity: 0.85 },
        { entry: { id: "entry-2", used_count: 0, quality: 0.7 }, similarity: 0.85 },
        { entry: { id: "entry-3", used_count: 0, quality: 0.9 }, similarity: 0.85 },
      ]
      const scored = Scoring.scoreEntries(entries)
      expect(scored[0].entry.id).toBe("entry-3") // highest quality
      expect(scored[1].entry.id).toBe("entry-2")
      expect(scored[2].entry.id).toBe("entry-1") // lowest quality
    })

    test("three-component formula: all three factors contribute to final score", () => {
      type TestEntry = { id: string; used_count: number; quality: number }
      // Create entries where each excels in one component
      const entries: Array<{ entry: TestEntry; similarity: number }> = [
        { entry: { id: "high_sim", used_count: 0, quality: 0 }, similarity: 1.0 }, // similarity=1.0, used=0, quality=0
        { entry: { id: "high_used", used_count: 100, quality: 0 }, similarity: 0 }, // similarity=0, used=100, quality=0
        { entry: { id: "high_qual", used_count: 0, quality: 1.0 }, similarity: 0 }, // similarity=0, used=0, quality=1
      ]

      const scored = Scoring.scoreEntries(entries)

      // high_sim: 1.0*0.7 + 0*0.2 + 0*0.1 = 0.7
      // high_used: 0*0.7 + 1.0*0.2 + 0*0.1 = 0.2
      // high_qual: 0*0.7 + 0*0.2 + 1.0*0.1 = 0.1
      expect(scored[0].entry.id).toBe("high_sim")
      expect(scored[1].entry.id).toBe("high_used")
      expect(scored[2].entry.id).toBe("high_qual")
      expect(scored[0].score).toBeCloseTo(0.7, 5)
      expect(scored[1].score).toBeCloseTo(0.2, 5)
      expect(scored[2].score).toBeCloseTo(0.1, 5)
    })
  })
})
