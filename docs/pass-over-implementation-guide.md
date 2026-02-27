# Pass Over Feature - Implementation Guide

## Phase Overview

This implementation guide complements the architecture document and provides concrete steps for building the pass over feature.

---

## Phase 1: Core Data Structures (Week 1)

### 1.1 Create Type Definitions

**File**: `packages/opencode/src/pass-over/types.ts`

```typescript
// PassOverRequest, WorkContext, WorkOutput, WorkArtifact, PassOverMetadata
// See architecture doc sections 2.1-2.5

export namespace PassOver {
  export interface Request { /* ... */ }
  export interface WorkContext { /* ... */ }
  export interface WorkOutput { /* ... */ }
  export type Artifact = /* union of artifact types */
  export interface Metadata { /* ... */ }
}
```

**Acceptance Criteria:**

- All types compile
- Types match architecture document exactly
- Zod schemas created for validation
- Unit tests pass for schema validation

### 1.2 Database Schema

**File**: `packages/opencode/src/pass-over/pass-over.sql.ts`

Tables needed:

- `pass_over_requests` (id, originating_agent, subagent, status, ...)
- `work_outputs` (work_id, pass_over_id, status, artifacts_json, ...)
- `return_contexts` (session_id, return_id, status, chain_depth, ...)
- `pass_over_audit` (pass_over_id, originating_agent, subagent, ...)

**Naming Convention** (per AGENTS.md):

- Use snake_case for fields
- Join columns are `<entity>_id`
- Indexes are `<table>_<column>_idx`

---

## Phase 2: Loop Prevention (Week 1-2)

### 2.1 Chain Depth Validation

**File**: `packages/opencode/src/pass-over/chain-validator.ts`

```typescript
export class ChainValidator {
  static MAX_CHAIN_DEPTH = 3

  static validatePassOverChain(
    request: PassOver.Request,
    sessionHistory: Message[],
  ): { valid: boolean; error?: PassOverError }

  // Check:
  // 1. Chain depth < MAX_CHAIN_DEPTH
  // 2. No cycles (agent appears twice)
  // 3. No ping-pong (A→B→A)
  // 4. Timeout not exceeded
}
```

**Acceptance Criteria:**

- Rejects pass overs with depth ≥ 3
- Detects cycles and ping-pongs
- All tests pass (unit + integration)
- Error messages are clear

### 2.2 Return Context State Machine

**File**: `packages/opencode/src/pass-over/return-context.ts`

States:

```
initial → waiting_for_return → returned → [processed | cancelled | timed_out]
```

**Acceptance Criteria:**

- Correct state transitions
- Cannot transition to impossible states
- Timeout handling works
- Metadata updated correctly

---

## Phase 3: Configuration Management (Week 2)

### 3.1 Parse and Validate Config

**File**: `packages/opencode/src/pass-over/config.ts`

```typescript
export class PassOverConfig {
  static load(filePath: string): PassOverPreferences
  static validate(config: any): boolean
  static resolvePreference(from: string, to: string, override?: Partial<AgentPairPreference>): AgentPairPreference
}
```

**Acceptance Criteria:**

- Parses `.opencode/pass-over.json`
- Schema validation with Zod
- Preference resolution order works
- Inline overrides work

### 3.2 Preference Storage

**Tables:**

- `pass_over_preferences` (from_agent, to_agent, enabled, auto_return, ...)
- `pass_over_defaults` (key, value, type)

---

## Phase 4: Context Extraction (Week 2-3)

### 4.1 Message Extraction

**File**: `packages/opencode/src/pass-over/extract.ts`

```typescript
export namespace Extract {
  export function workContext(session: Session, relevantFiles: string[], lookbackMinutes?: number): WorkContext

  export function artifacts(messages: Message[], agentID: string): WorkArtifact[]
}
```

**Acceptance Criteria:**

- Extracts file contents correctly
- Selects recent messages intelligently
- Converts tool results to artifacts
- Handles token limits properly

### 4.2 Selective Message History

**File**: `packages/opencode/src/pass-over/history-selector.ts`

```typescript
export class HistorySelector {
  static select(
    messages: Message[],
    options: {
      max_messages?: number
      max_tokens?: number
      lookback_minutes?: number
    },
  ): Message[]
}
```

**Acceptance Criteria:**

- Respects message count limit
- Respects token budget
- Respects time window
- Returns most recent context

---

## Phase 5: API & Integration (Week 3-4)

### 5.1 Originator API (Sending Pass Over)

**File**: `packages/opencode/src/pass-over/api-send.ts`

```typescript
export async function passOver(options: {
  subagent: string
  work_context: PassOver.WorkContext
  reason: string
  return_required?: boolean
  override?: Partial<AgentPairPreference>
}): Promise<PassOver.WorkOutput>
```

**Integration Points:**

- In `Agent.ts` for each subagent (alice, scout, audit, etc.)
- Called when agent identifies need for delegation

**Acceptance Criteria:**

- Validates request
- Creates database entries
- Enforces policies
- Handles errors gracefully

### 5.2 Subagent API (Returning)

**File**: `packages/opencode/src/pass-over/api-return.ts`

```typescript
export async function returnFromPassOver(output: PassOver.WorkOutput): Promise<void>
```

**Integration Points:**

- Called by subagent when done
- Updates return context
- Notifies originator
- Records audit trail

**Acceptance Criteria:**

- Validates output format
- Updates database
- Sends notifications
- Prevents orphaned passes

---

## Phase 6: Audit Logging (Week 4)

### 6.1 Audit Trail Recording

**File**: `packages/opencode/src/pass-over/audit-log.ts`

```typescript
export class AuditLog {
  static record(entry: PassOverAuditEntry): Promise<void>
  static query(filters: {
    session_id?: string
    originating_agent?: string
    subagent?: string
    start_time?: number
    end_time?: number
  }): Promise<PassOverAuditEntry[]>
}
```

**Acceptance Criteria:**

- Logs all passes with full metadata
- JSONL format in `.opencode/pass-over-logs/`
- Rotation by date
- Retention policy enforced

### 6.2 Log Query Interface

**File**: `packages/opencode/src/pass-over/audit-query.ts`

For UI consumption via API.

---

## Phase 7: Error Handling (Week 4)

### 7.1 Error Types

**File**: `packages/opencode/src/pass-over/errors.ts`

All error codes from architecture doc:

- E001-E004: Request validation
- E010-E013: Execution
- E020-E022: Return
- E030-E031: Configuration

**Acceptance Criteria:**

- Clear error messages
- Actionable suggestions
- Recoverable flag set correctly
- Tests cover all paths

### 7.2 Retry Logic

**File**: `packages/opencode/src/pass-over/retry.ts`

Exponential backoff for recoverable errors.

### 7.3 Error Handling Patterns

**Overview**

Error handling in pass-over operations requires distinguishing between recoverable and non-recoverable failures. This section covers common error scenarios, recovery strategies, error codes, and implementation patterns.

**Error Categories**

1. **Request Validation (E001-E004)**: Input validation failures before pass-over initiation
2. **Execution (E010-E013)**: Failures during subagent execution
3. **Return (E020-E022)**: Failures during result return to originator
4. **Configuration (E030-E031)**: Configuration or policy violations

**Common Error Scenarios and Recovery**

| Error                    | Code | Cause                            | Recoverable | Recovery Strategy                                 |
| ------------------------ | ---- | -------------------------------- | ----------- | ------------------------------------------------- |
| Chain depth exceeded     | E001 | Too many delegation hops         | No          | Redesign delegation flow, reduce chain depth      |
| Cycle detected           | E002 | Delegation loop (A→B→A)          | No          | Review routing logic, add agent-pair exclusions   |
| Agent not found          | E003 | Target agent doesn't exist       | No          | Verify agent name in config, check agent registry |
| Invalid work output      | E004 | Malformed output structure       | No          | Validate output schema before passing             |
| Subagent timeout         | E010 | Subagent exceeded time limit     | Yes         | Retry with extended timeout or split context      |
| Subagent crashed         | E011 | Subagent process failed          | Yes         | Retry operation; check subagent logs              |
| Permission denied        | E012 | Caller not authorized            | No          | Update agent permissions or credentials           |
| Resource exhausted       | E013 | Insufficient memory/disk         | Yes         | Reduce context size, clean up resources           |
| Return context lost      | E020 | Database or session corruption   | No          | Restore from audit log, manual recovery           |
| Invalid return format    | E021 | Subagent returned malformed data | Maybe       | Attempt to parse; if parsing fails, escalate      |
| Return timeout           | E022 | Originator didn't receive return | Yes         | Retry return delivery                             |
| Config validation failed | E030 | Config schema violation          | No          | Fix config file, validate against schema          |
| Missing required setting | E031 | Required config key absent       | No          | Add missing key with default value                |

**Error Handling Implementation**

```typescript
// Example: Safe pass-over with error handling
async function safePassOver(params: PassOverParams): Promise<Result> {
  try {
    const config = await loadPassOverConfig(directory)
    const prefs = getPreferences(config, fromAgent, toAgent)

    if (!prefs.enabled) {
      throw new Error("E030: Pass-over disabled for this agent pair")
    }

    const controller = new ReturnController(fromAgent, prefs.max_chain_depth)
    const metadata = controller.asPassOverMetadata()

    // Validate before sending
    const validated = PassOverMetadata.parse(metadata)

    // Execute pass-over
    const result = await passOver(params)
    return result
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))

    // Classify error
    if (error.message.includes("E001") || error.message.includes("E002")) {
      // Non-recoverable: chain depth or cycle
      return { status: "failed", error: error.message, recoverable: false }
    }

    if (error.message.includes("E010") || error.message.includes("E022")) {
      // Recoverable: timeout or subagent failure
      return { status: "pending_retry", error: error.message, recoverable: true }
    }

    // Default: log and re-throw
    console.error(`[PassOver] Unhandled error: ${error.message}`)
    throw error
  }
}
```

**Retry Strategy**

Use exponential backoff for recoverable errors:

```typescript
async function retryWithBackoff(fn: () => Promise<T>, maxAttempts = 3, initialDelayMs = 100): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // Check if error is recoverable
      const recoverable =
        error.message.includes("E010") || error.message.includes("E013") || error.message.includes("E022")

      if (!recoverable || attempt === maxAttempts - 1) {
        throw error
      }

      // Exponential backoff: 100ms, 200ms, 400ms, etc.
      const delayMs = initialDelayMs * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
```

**Error Logging Pattern**

```typescript
// Log errors with context for debugging
function logPassOverError(
  error: Error,
  context: {
    sessionId: string
    fromAgent: string
    toAgent: string
    chainDepth: number
  },
) {
  const timestamp = new Date().toISOString()
  const errorEntry = {
    timestamp,
    error: error.message,
    errorCode: extractErrorCode(error.message), // E001, E010, etc.
    context,
    stack: error.stack,
  }

  // Write to audit log
  console.error(`[PassOver Error] ${JSON.stringify(errorEntry)}`)
}

function extractErrorCode(message: string): string | null {
  const match = message.match(/E\d{3}/)
  return match?.[0] ?? null
}
```

**Handling Specific Error Codes**

**E001 (Chain Depth Exceeded)**

- Cause: Pass-over chain exceeds max depth
- Recovery: None (design issue)
- Action: Review delegation logic, reduce chain depth in config

**E002 (Cycle Detected)**

- Cause: Agent delegates back to recent peer
- Recovery: None (routing conflict)
- Action: Add exclusion rule or redesign routing

**E010 (Subagent Timeout)**

- Cause: Subagent didn't complete in time
- Recovery: Retry with larger timeout or reduced context
- Action: Increase timeout_ms in config or split context

**E013 (Resource Exhausted)**

- Cause: Out of memory or disk space
- Recovery: Retry after cleanup
- Action: Reduce context size; clean up old logs

**E020 (Return Context Lost)**

- Cause: Database issue or session corruption
- Recovery: None (data loss)
- Action: Restore from audit log; contact admin

**E030 (Config Validation Failed)**

- Cause: Invalid pass-over.json
- Recovery: Fix config
- Action: Validate JSON, ensure required fields present

**User-Facing Error Messages**

Provide clear, actionable messages to users:

```typescript
function userFacingErrorMessage(error: Error): string {
  if (error.message.includes("E001")) {
    return "Too many delegation steps. Cannot pass to another agent."
  }
  if (error.message.includes("E002")) {
    return "This would create a delegation loop. Choose a different agent."
  }
  if (error.message.includes("E010")) {
    return "Agent took too long to respond. Try again with a simpler task."
  }
  if (error.message.includes("E030")) {
    return "Configuration error. Contact your administrator."
  }
  return "Unexpected error. Please try again."
}
```

---

## Phase 8: Testing Infrastructure (Week 4-5)

### 8.1 Unit Tests

**File**: `packages/opencode/test/pass-over/`

Test suites:

- `chain-validator.test.ts` - loop prevention
- `config.test.ts` - preference resolution
- `extract.test.ts` - context extraction
- `errors.test.ts` - error handling
- `return-context.test.ts` - state transitions

### 8.2 Integration Tests

**File**: `packages/opencode/test/pass-over/integration/`

Test scenarios:

- `alice-to-audit.test.ts` - happy path
- `timeout.test.ts` - timeout handling
- `chain-depth.test.ts` - loop prevention
- `config-override.test.ts` - preferences
- `error-recovery.test.ts` - retry logic

**Acceptance Criteria:**

- > 80% code coverage
- All happy paths tested
- All error paths tested
- Integration tests pass

---

## Phase 9: Agent Integration (Week 5-6)

### 9.1 Modify Agent Prompts

**Files**:

- `packages/opencode/src/agent/prompt/alice.txt` - add pass over section
- `packages/opencode/src/agent/prompt/audit.txt` - add instructions
- `packages/opencode/src/agent/prompt/scout.txt` - add delegation guidance

Each prompt should include:

- When to pass over
- How to call `passOver()`
- How to handle return
- What to avoid

### 9.2 Update Agent Registry

**File**: `packages/opencode/src/agent/agent.ts`

In `Agent.Info`:

- Mark which agents can be originators
- Mark which agents can be subagents
- Set default preferences

---

## Phase 10: UI & Observability (Week 6-7)

### 10.1 Pass Over Status Component

**File**: `packages/app/src/components/pass-over-status.tsx`

Show:

- Current pass over in progress
- Chain depth visualization
- Timeout countdown
- Subagent name

### 10.2 Audit Log Viewer

**File**: `packages/app/src/components/pass-over-audit.tsx`

Show:

- Historical pass overs
- Chain visualization
- Findings & decisions
- Timeline

### 10.3 Preferences UI

**File**: `packages/app/src/components/pass-over-preferences.tsx`

Allow user to:

- View current policy
- Enable/disable pairs
- Set timeouts
- Override defaults

---

## Implementation Checklist

### Core (Week 1-2)

- [ ] Type definitions complete
- [ ] Database schema created
- [ ] Schema migrations generated
- [ ] Chain validator implemented
- [ ] Unit tests pass

### Configuration (Week 2-3)

- [ ] Config parser working
- [ ] Preference resolution correct
- [ ] Inline overrides work
- [ ] Config validation strict

### Extraction (Week 2-3)

- [ ] Message extraction working
- [ ] Token budgets respected
- [ ] Artifacts correctly formed
- [ ] Tool results captured

### API (Week 3-4)

- [ ] `passOver()` function works
- [ ] `returnFromPassOver()` works
- [ ] Error handling complete
- [ ] Retry logic tested

### Logging (Week 4)

- [ ] Audit log records all passes
- [ ] Query interface works
- [ ] Log rotation configured
- [ ] Retention policy enforced

### Integration (Week 5-6)

- [ ] Alice can pass to audit
- [ ] Audit returns properly
- [ ] Results appear in session
- [ ] Agent prompts updated

### UI (Week 6-7)

- [ ] Status component displays
- [ ] Audit log viewer functional
- [ ] Preferences UI works
- [ ] E2E tests pass

---

## Code Style

Follow AGENTS.md style guide:

- Single word variable names where possible
- `const` over `let`
- Early returns, no `else`
- Avoid `any` type
- Use type inference

Example:

```typescript
// Good
const artifacts = result.artifacts.filter((a): a is DecisionArtifact => a.type === "decision").map((a) => a.answer)

// Bad
const artifacts: string[] = []
for (const artifact of result.artifacts) {
  if (artifact.type === "decision") {
    artifacts.push(artifact.answer)
  }
}
```

---

## Database Commands

```bash
# Generate migration
cd packages/opencode
bun run db generate --name "pass_over_initial"

# View migrations
ls migration/

# Test migrations
bun test migration/
```

---

## Testing Commands

```bash
# Run unit tests
cd packages/opencode
bun test:unit test/pass-over/

# Run integration tests
bun test:integration test/pass-over/integration/

# Run all pass-over tests
bun test test/pass-over/

# Check coverage
bun test --coverage test/pass-over/
```

---

## Documentation

As you implement, update:

1. **Architecture Doc** (`pass-over-feature-architecture.md`) - if design changes
2. **Quick Ref** (`pass-over-quick-reference.md`) - examples & patterns
3. **Code Comments** - complex logic
4. **Inline Docs** - API functions
5. **Error Messages** - user-facing clarity

---

## Review Criteria

Each phase should be reviewed before moving to next:

**Code Review:**

- Follows style guide
- No `any` types
- Proper error handling
- Adequate tests
- Updated docs

**Functional Review:**

- Works as designed
- Handles edge cases
- No data loss
- Performance acceptable
- Audit trail complete

**Integration Review:**

- Works with other components
- No conflicts with existing code
- Database schema clean
- No breaking changes

---

## Risk Areas & Mitigations

| Risk                     | Mitigation                               |
| ------------------------ | ---------------------------------------- |
| Loop/infinite delegation | Chain depth validation + unit tests      |
| Data loss in return      | Atomic database transactions             |
| Configuration errors     | Strict schema validation + UI validation |
| Token explosion          | Message selection + budgeting            |
| Database bloat           | Audit log retention policy               |
| Race conditions          | Database locking + state machine         |

---

## Performance Targets

- **Pass over setup**: < 100ms
- **Context extraction**: < 200ms
- **Chain validation**: < 10ms
- **Config resolution**: < 5ms
- **Audit logging**: < 50ms
- **Return notification**: < 100ms
- **Total latency**: < 500ms (excluding subagent compute)

---

## Future Enhancements (Post-MVP)

- [ ] Conditional passes (if-then-delegate)
- [ ] Batched passes (multiple in one)
- [ ] Streaming results (real-time delivery)
- [ ] Pass over pipelines (pre-configured chains)
- [ ] Result caching
- [ ] Agent learning (remember successful patterns)
- [ ] Cross-session passes
- [ ] Fine-grained resource access control

---

## Support & Troubleshooting

### Debug a Pass Over

```bash
# Query audit log
curl -X GET http://localhost:3000/api/pass-over/audit \
  ?session_id=abc123 \
  ?start_time=1700000000

# View return context
curl -X GET http://localhost:3000/api/pass-over/returns \
  ?session_id=abc123
```

### Common Issues

**Issue**: "Chain depth exceeded"

- **Cause**: Delegation chain too long
- **Fix**: Reduce chain depth in config or design

**Issue**: "Cycle detected"

- **Cause**: Agent delegates to self indirectly
- **Fix**: Review delegation paths, adjust routing

**Issue**: "Return context lost"

- **Cause**: Database corruption or lost session
- **Fix**: Check database integrity, replay from audit log

**Issue**: "Timeout"

- **Cause**: Subagent taking too long
- **Fix**: Increase timeout or reduce context size

---

## References

- Full Architecture: `docs/pass-over-feature-architecture.md`
- Quick Reference: `docs/pass-over-quick-reference.md`
- Style Guide: `AGENTS.md`
- Database Guide: `packages/opencode/AGENTS.md`
- Message Format: `packages/opencode/src/session/message-v2.ts`
