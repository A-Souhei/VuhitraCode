# Biblion & Memento Cache Improvement Implementation Plan

## Overview

### Current System

The current caching system for biblion and memento entries has the following characteristics:

- **Vector Storage**: Uses Qdrant or Redis for embedding storage
- **Write Behavior**: Each write operation creates a new entry with a UUID, with no deduplication
- **Search Behavior**: Uses raw embedding similarity scores with no usage-based ranking
- **Cache Efficiency**: Poor due to lack of canonicalization — semantically identical queries may be stored as separate entries

### Pain Points

1. **Redundant Entries**: Same information stored multiple times with different UUIDs
2. **No Quality Differentiation**: All entries treated equally regardless of usefulness
3. **No Usage Tracking**: Frequently accessed entries not prioritized in search
4. **Cold Start Problem**: New entries with no usage data compete equally with established entries
5. **Search Ranking**: Pure similarity misses context about entry quality and popularity

---

## Proposed Changes

### 1. New Entry Schema

The new `CacheEntry` interface extends the existing schema with canonicalization, quality, and usage tracking fields:

```typescript
interface CacheEntry {
  // Core identification
  id: string // UUID

  // Canonicalized query (the canonical form of what this entry answers)
  query: string

  // Vector embedding for similarity search
  embedding: number[]

  // The response/solution this entry stores
  answer: string

  // Auto-generated tags by LLM (e.g., ["typescript", "async", "error-handling"])
  tags: string[]

  // Quality score 0-1 (normalized from user-provided 0-10)
  quality: number

  // Timestamps
  created_at: string // ISO timestamp

  // Usage tracking
  used_count: number // Incremented on each read

  // Optional rich content fields
  problem: string // Optional: problem description
  context: string // Optional: additional context
  solution: string // Optional: detailed solution
  steps: string[] // Optional: step-by-step breakdown

  // Existing required fields (preserved for compatibility)
  type: EntryType
  session_id: string
  branch: string
  timestamp: number
  token_count: number
}
```

**Field Justification**:

| Field                                  | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `query`                                | Canonicalized form enables deduplication and consistent search |
| `tags`                                 | LLM-generated metadata for filtering and discovery             |
| `quality`                              | User-provided signal about entry usefulness                    |
| `used_count`                           | Usage frequency as a trust/relevance signal                    |
| `problem`/`context`/`solution`/`steps` | Structured rich content for complex entries                    |

---

### 2. Canonicalization Flow

The canonicalization process runs on every `biblion_write` or `memento_write` operation:

```
┌─────────────────────────────────────────────────────────────┐
│                    Write Request Received                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           Subagent (Scout/Sentinel) Canonicalizes            │
│         Session topic/summary into a canonical query        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│          Search for semantically similar entries            │
│              (≥95% similarity threshold)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
               Similar              No Match
               Found                   │
                    │                   │
                    ▼                   ▼
    ┌────────────────────┐    ┌────────────────────┐
    │ Skip write         │    │ Proceed with write  │
    │ Return existing ID │    │ Prompt for quality  │
    │ (optional: merge)  │    │ score from user     │
    └────────────────────┘    └────────────────────┘
```

**Canonicalization Prompt (for subagent)**:

```
Given the following session summary/topic:
"{session_summary}"

Extract the core technical question or topic. Return a canonical query string that:
1. Is a complete question or clear topic phrase
2. Uses specific technical terminology
3. Is under 100 characters
4. Does not include names, dates, or session-specific context
5. Represents the universal form of this topic

Example:
Session: "User toavina asked about fixing a race condition in their Express middleware"
Canonical: "race condition in Express middleware handling"
```

---

### 3. Quality Scoring

Quality scoring provides a user-driven signal about entry reliability:

**Prompt to User** (after write completion):

```
How useful was this entry? (0-10)
- 0-3: Incorrect, misleading, or incomplete
- 4-6: Partially correct but missing key information
- 7-8: Correct and useful for common cases
- 9-10: Comprehensive, accurate, and essential

Your score will improve how this entry ranks in future searches.
```

**Storage**: User provides 0-10, system normalizes to 0-1:

```typescript
const normalizeQuality = (userScore: number): number => {
  return Math.max(0, Math.min(1, userScore / 10))
}
```

**Integration with Vector Payload**: Quality score is included in the embedding payload for hybrid scoring.

---

### 4. Usage Tracking

Usage tracking measures how often each entry is accessed and returned to users:

**Implementation**:

```typescript
// On every biblion_read or memento_read
async function incrementUsedCount(entryId: string): Promise<void> {
  const key = `biblion:meta:${entryId}`
  await redis.hincrby(key, "used_count", 1)
}

// Retrieval
async function getUsedCount(entryId: string): Promise<number> {
  const key = `biblion:meta:${entryId}`
  const count = await redis.hget(key, "used_count")
  return parseInt(count || "0", 10)
}
```

**Storage Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Redis Hash Structure                      │
├─────────────────────────────────────────────────────────────┤
│ Key: biblion:meta:{entry_id}                                │
│ Fields:                                                      │
│   - used_count: number                                       │
│   - quality: number (0-1)                                    │
│   - tags: string[] (JSON serialized)                        │
│   - created_at: ISO string                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Qdrant Point Structure                    │
├─────────────────────────────────────────────────────────────┤
│ - id: string (UUID)                                          │
│ - vector: float[] (embedding)                               │
│ - payload: {                                                │
│     query, answer, type, session_id, branch,                │
│     timestamp, token_count, tags, quality, used_count        │
│   }                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

### 5. Scoring Formula

The search scoring combines semantic similarity with usage and quality signals:

```
score = (similarity * 0.7) + (normalized_used_count * 0.3)
```

**Used Count Normalization** (log scale to prevent runaway:

```typescript
function normalizeUsedCount(usedCount: number, maxCount: number): number {
  if (usedCount === 0) return 0
  // Log scale normalization: log(1 + count) / log(1 + maxCount)
  return Math.log(1 + usedCount) / Math.log(1 + maxCount)
}
```

**Combined Score Calculation**:

```typescript
interface ScoredResult {
  entry: CacheEntry
  score: number
  similarity: number
  normalizedUsedCount: number
}

function calculateScore(
  similarity: number,
  usedCount: number,
  maxUsedCount: number,
  qualityWeight: number = 0,
): number {
  const normalizedUsed = normalizeUsedCount(usedCount, maxUsedCount)
  // Base score: 70% similarity, 30% usage
  const baseScore = similarity * 0.7 + normalizedUsed * 0.3
  // Optional quality boost (can be integrated differently based on needs)
  return baseScore
}
```

**Why These Weights?**

- **70% similarity**: Semantic relevance remains primary
- **30% usage**: Popular entries get a boost but don't dominate

---

### 6. Storage Architecture

**Dual-Store Approach**:

```
┌─────────────────────────────────────────────────────────────┐
│                     Embeddings (Qdrant)                     │
├─────────────────────────────────────────────────────────────┤
│ Primary storage for vector embeddings                       │
│ - Fast similarity search                                     │
│ - Payload includes all searchable metadata                  │
│ - Point-level atomic updates for embedding+metadata        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (sync)
┌─────────────────────────────────────────────────────────────┐
│                    Metadata (Redis)                          │
├─────────────────────────────────────────────────────────────┤
│ Fast counters and frequently-updated fields                  │
│ - used_count (hincrby for atomic increments)                │
│ - quality (user-provided, rarely updated)                   │
│ - tags (JSON serialized)                                     │
│ - canonical_query (for deduplication lookup)                │
└─────────────────────────────────────────────────────────────┘
```

**Alternative: Single Store (Qdrant Only)**

For simplicity, store everything in Qdrant:

```typescript
// On write: single atomic upsert
await qdrant.upsert({
  collection_name: "biblion",
  points: [
    {
      id: uuid,
      vector: embedding,
      payload: {
        query,
        answer,
        tags,
        quality,
        used_count: 0,
        created_at: new Date().toISOString(),
        type,
        session_id,
        branch,
        timestamp,
        token_count,
      },
    },
  ],
})

// On read: update Redis counter (non-blocking)
redis.hincrby(`biblion:meta:${id}`, "used_count", 1).catch(console.error)
```

**Atomic Operation Option**:

For true atomicity, use Redis transaction to update metadata:

```typescript
async function atomicWrite(entry: CacheEntry): Promise<void> {
  const pipeline = redis.pipeline()
  pipeline.hset(`biblion:meta:${entry.id}`, {
    used_count: 0,
    quality: entry.quality,
    tags: JSON.stringify(entry.tags),
    created_at: entry.created_at,
  })
  pipeline.sadd("biblion:canonical_queries", entry.query)
  await pipeline.exec()

  await qdrant.upsert({
    collection_name: "biblion",
    points: [{ id: entry.id, vector: entry.embedding, payload: entry }],
  })
}
```

---

### 7. Semantic Search Update

Updated `biblion_read` flow:

```
┌─────────────────────────────────────────────────────────────┐
│                      Query Received                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Embed Query (same model)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Qdrant Search (top K + threshold)              │
│         Retrieve more candidates than needed                │
│         (e.g., top 50 for final ranking)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            Fetch metadata from Redis (used_count)           │
│              (batch fetch for all candidates)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Apply Scoring Formula                     │
│         score = similarity * 0.7 + normalized_used * 0.3    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Return Top Results                        │
│            (with full metadata, sorted by score)            │
└─────────────────────────────────────────────────────────────┘
```

**Implementation**:

```typescript
async function semanticSearch(
  query: string,
  options: { limit?: number; minSimilarity?: number } = {},
): Promise<ScoredResult[]> {
  const { limit = 10, minSimilarity = 0.7 } = options

  // 1. Embed query
  const embedding = await embedQuery(query)

  // 2. Search Qdrant (get more candidates for re-ranking)
  const results = await qdrant.search({
    collection_name: "biblion",
    vector: embedding,
    limit: 50, // Fetch more than needed
    score_threshold: minSimilarity,
  })

  // 3. Batch fetch Redis metadata
  const ids = results.map((r) => r.id)
  const metaPipeline = redis.pipeline()
  ids.forEach((id) => metaPipeline.hgetall(`biblion:meta:${id}`))
  const metaResults = await metaPipeline.exec()

  // 4. Build candidate list with metadata
  const candidates = results.map((r, i) => ({
    entry: { ...r.payload, id: r.id } as CacheEntry,
    similarity: r.score,
    usedCount: parseInt(metaResults[i]?.used_count || "0", 10),
  }))

  // 5. Get max used count for normalization
  const maxUsedCount = Math.max(...candidates.map((c) => c.usedCount), 1)

  // 6. Apply scoring formula
  const scored = candidates.map((c) => ({
    ...c,
    score: calculateScore(c.similarity, c.usedCount, maxUsedCount),
    normalizedUsedCount: normalizeUsedCount(c.usedCount, maxUsedCount),
  }))

  // 7. Sort and limit
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
```

---

### 8. Agent Integration

**Permission Updates**:

```typescript
// src/tool/registry.ts
const toolPermissions = {
  // ... existing permissions
  biblion_read: ["scout", "sentinel", "data-explore"],
  biblion_write: ["scout", "sentinel"],
  memento_read: ["scout", "sentinel"],
  memento_write: ["scout", "sentinel"],
}

// src/agent/agent.ts
const agentPermissions = {
  scout: {
    // ... existing permissions
    biblion_read: "allow",
    memento_read: "allow",
  },
  sentinel: {
    // ... existing permissions
    biblion_read: "allow",
    memento_read: "allow",
  },
}
```

**Scout/Sentinel Prompt Updates**:

Add to system prompt:

```
When answering technical questions, first search the biblion/memento cache
using semantic search to find existing solutions. Use the cached entries when
they score ≥0.8 after applying the hybrid scoring formula.

Cache search format:
- Embed your query using the configured embedding model
- Search with similarity threshold 0.7
- Re-rank results using: score = similarity * 0.7 + (log(1+used_count)/log(1+max_used)) * 0.3
```

**Alice Delegation to Workers**:

```
Before performing work that might produce reusable knowledge:
1. Delegate to Scout/Sentinel for canonicalization of the topic
2. Scout/Sentinel generates a canonical query
3. Check cache for existing entry (≥95% similarity)
4. If found, use existing; if not, create new entry with user quality feedback
```

---

## Implementation Phases

### Phase 1: Schema Migration

**Goal**: Add new fields with backward compatibility

**Changes**:

- Update `CacheEntry` interface with new fields
- Add default values for existing entries (quality=0.5, used_count=0, tags=[])
- Migration script for existing entries

**Validation**:

- Existing entries readable with new schema
- New fields populated correctly for new entries

**Files**: `src/biblion/index.ts`, `src/memory/index.ts`

**Duration**: ~2 hours

---

### Phase 2: Canonicalization Service

**Goal**: Implement query canonicalization

**Changes**:

- Create `src/biblion/canonicalize.ts`
- Create `src/memory/canonicalize.ts`
- Integrate into write flows
- Add deduplication check (≥95% similarity)

**Validation**:

- Canonicalization produces consistent output for similar inputs
- Deduplication correctly identifies near-duplicates
- Non-duplicates proceed to write

**Files**: `src/biblion/canonicalize.ts`, `src/memory/canonicalize.ts`

**Duration**: ~4 hours

---

### Phase 3: Quality Scoring UI/Prompt

**Goal**: Collect quality scores from users

**Changes**:

- Add quality prompt to write confirmation flow
- Store normalized quality score
- Include quality in vector payload

**Validation**:

- User receives quality prompt after write
- Quality stored correctly (0-1 range)
- Quality retrievable with entry

**Files**: `src/biblion/index.ts`, `src/memory/index.ts`

**Duration**: ~3 hours

---

### Phase 4: Usage Tracking (Redis Counters)

**Goal**: Track entry usage in Redis

**Changes**:

- Add Redis hash structure for metadata
- Implement `incrementUsedCount()` on read
- Implement `getUsedCount()` for search re-ranking

**Validation**:

- Used count increments on each read
- Count persists across restarts
- Batch fetch works for multiple entries

**Files**: `src/biblion/index.ts`, `src/memory/index.ts`

**Duration**: ~3 hours

---

### Phase 5: Search Scoring Formula

**Goal**: Apply hybrid scoring to search results

**Changes**:

- Create `src/biblion/scoring.ts`
- Create `src/memory/scoring.ts`
- Update search flow to fetch Redis metadata
- Apply scoring formula

**Validation**:

- Popular entries rank higher than new entries with same similarity
- Quality provides marginal boost
- Log-scale normalization prevents runaway counts

**Files**: `src/biblion/scoring.ts`, `src/memory/scoring.ts`

**Duration**: ~4 hours

---

### Phase 6: Agent Permission Updates

**Goal**: Grant cache read access to relevant agents

**Changes**:

- Update `src/tool/registry.ts` with new permissions
- Update `src/agent/agent.ts` with agent permissions
- Update Scout/Sentinel system prompts

**Validation**:

- Scout/Sentinel can call biblion_read/memento_read
- Permission checks work correctly
- Unauthorized agents rejected

**Files**: `src/tool/registry.ts`, `src/agent/agent.ts`

**Duration**: ~2 hours

---

### Phase 7: Testing and Validation

**Goal**: End-to-end validation of the system

**Tests**:

1. Write new entry → canonicalization → deduplication check
2. Write entry → quality prompt → storage with quality
3. Read entry → used_count increments
4. Search → results ranked by hybrid score
5. Similar query → finds existing entry (deduplication)
6. Permission enforcement → unauthorized agent blocked
7. Backward compatibility → old entries still readable

**Duration**: ~4 hours

---

## Files to Modify

### `/packages/opencode/src/biblion/index.ts`

- Add new schema fields to `CacheEntry` interface
- Implement canonicalization check on write
- Add quality scoring prompt integration
- Add Redis metadata storage on write
- Add `used_count` increment on read
- Integrate scoring formula in search

### `/packages/opencode/src/memory/index.ts`

- Mirror all biblion changes for memento
- Ensure consistent schema and behavior

### `/packages/opencode/src/tool/registry.ts`

- Add `biblion_read`, `biblion_write` permissions
- Add `memento_read`, `memento_write` permissions
- Map permissions to allowed agents

### `/packages/opencode/src/agent/agent.ts`

- Add `biblion_read`, `memento_read` to scout/sentinel permissions
- Update system prompts for cache usage

### `/packages/opencode/src/session/llm.ts`

- Integrate semantic search into LLM context building
- Add cache lookup before generating responses

---

## New Files

### `/packages/opencode/src/biblion/canonicalize.ts`

```typescript
// Canonicalization service for biblion entries

interface CanonicalizationResult {
  query: string
  tags: string[]
  confidence: number
}

export async function canonicalize(
  sessionSummary: string,
  existingEntries: CacheEntry[],
): Promise<CanonicalizationResult> {
  // Implementation: use LLM to extract canonical query and tags
  // Check against existing entries for deduplication
}

export async function findSimilar(query: string, threshold: number = 0.95): Promise<CacheEntry | null> {
  // Embed query, search, return if above threshold
}
```

### `/packages/opencode/src/biblion/scoring.ts`

```typescript
// Scoring formula utilities for biblion

export function normalizeUsedCount(count: number, max: number): number {
  if (count === 0) return 0
  return Math.log(1 + count) / Math.log(1 + max)
}

export function calculateScore(similarity: number, usedCount: number, maxUsedCount: number): number {
  const normalizedUsed = normalizeUsedCount(usedCount, maxUsedCount)
  return similarity * 0.7 + normalizedUsed * 0.3
}

export interface ScoredEntry {
  entry: CacheEntry
  score: number
  similarity: number
  normalizedUsedCount: number
}
```

### `/packages/opencode/src/memory/canonicalize.ts`

```typescript
// Canonicalization service for memory (memento) entries
// Mirrors biblion/canonicalize.ts but for memory-specific semantics
```

### `/packages/opencode/src/memory/scoring.ts`

```typescript
// Scoring formula utilities for memory (memento) entries
// Mirrors biblion/scoring.ts but for memory-specific collections
```

---

## Configuration

### Environment Variables

```bash
# Biblion/Memento Settings
BIBLION_CANONICALIZATION_THRESHOLD=0.95  # Similarity threshold for deduplication
BIBLION_SEARCH_MIN_SIMILARITY=0.7         # Minimum similarity for search results
BIBLION_SIMILARITY_WEIGHT=0.7             # Weight for similarity in scoring
BIBLION_USAGE_WEIGHT=0.3                 # Weight for usage in scoring
BIBLION_MAX_CANDIDATES=50                 # Candidates to fetch before re-ranking
BIBLION_DEFAULT_QUALITY=0.5               # Default quality for entries without rating

# Redis Metadata Keys
BIBLION_META_PREFIX="biblion:meta:"       # Redis key prefix for metadata
MEMORY_META_PREFIX="memory:meta:"        # Redis key prefix for memory metadata
```

---

## Migration Strategy

### Existing Entries

For existing entries without new fields:

```typescript
// Migration: set defaults for existing entries
async function migrateEntry(entry: CacheEntry): Promise<CacheEntry> {
  return {
    ...entry,
    query: entry.query || extractQueryFromContent(entry), // Use existing content
    tags: entry.tags || [],
    quality: entry.quality ?? 0.5, // Default to neutral
    used_count: entry.used_count ?? 0,
    created_at: entry.created_at || new Date(entry.timestamp).toISOString(),
  }
}
```

### Backward Compatibility

- All new fields have defaults or are optional
- Existing code reading old schema still works
- New fields populated lazily or via background migration

---

## Error Handling

### Canonicalization Failures

```typescript
// If canonicalization fails, fall back to content-based query
async function canonicalizeSafe(sessionSummary: string): Promise<string> {
  try {
    return await canonicalize(sessionSummary)
  } catch (error) {
    // Fallback: use first 100 chars of summary
    return sessionSummary.slice(0, 100).trim()
  }
}
```

### Redis Failures

```typescript
// If Redis unavailable, continue without usage tracking
async function getUsedCount(id: string): Promise<number> {
  try {
    return await redis.hget(`biblion:meta:${id}`, "used_count")
  } catch {
    return 0 // Default to 0 on Redis failure
  }
}
```

### Qdrant Failures

```typescript
// If Qdrant unavailable, return error (search is core functionality)
async function search(query: string): Promise<ScoredResult[]> {
  try {
    return await qdrantSearch(query)
  } catch (error) {
    throw new Error(`Search unavailable: ${error.message}`)
  }
}
```

---

## Success Metrics

### Cache Hit Rate

- Track % of queries that find existing entries (≥95% similarity)
- Target: >40% cache hit rate after 30 days

### Deduplication Rate

- Track % of writes skipped due to existing entries
- Target: >30% of writes deduplicated

### Usage Distribution

- P50 used_count should increase over time
- Top 10% entries should have >100 uses
- Long-tail entries (used <5) should be <50%

### Quality Distribution

- Average quality should stabilize around 0.7
- <10% entries with quality <0.4 (poor entries)

---

## Appendix: Full TypeScript Interfaces

```typescript
// src/biblion/types.ts

export type EntryType = "solution" | "problem" | "note" | "reference"

export interface CacheEntry {
  // Core identification
  id: string
  query: string
  embedding: number[]
  answer: string
  tags: string[]
  quality: number
  created_at: string
  used_count: number
  problem?: string
  context?: string
  solution?: string
  steps?: string[]

  // Existing fields
  type: EntryType
  session_id: string
  branch: string
  timestamp: number
  token_count: number
}

export interface CacheEntryMetadata {
  used_count: number
  quality: number
  tags: string[]
  created_at: string
}

export interface SearchOptions {
  limit?: number
  minSimilarity?: number
  tags?: string[]
  type?: EntryType
}

export interface ScoredResult {
  entry: CacheEntry
  score: number
  similarity: number
  normalizedUsedCount: number
}
```
