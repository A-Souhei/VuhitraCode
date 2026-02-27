# Pass Over Feature - Quick Reference

## TL;DR: Data Flow

```
Originator (Alice)
    ↓ sends PassOverRequest
Subagent (Audit)
    ↓ receives WorkContext, executes, collects artifacts
Originator (Alice)
    ↓ receives WorkOutput, applies/rejects
Session continues
```

## Core Data Structures

### PassOverRequest → WorkContext → WorkOutput

| Stage        | Data             | Purpose                                       |
| ------------ | ---------------- | --------------------------------------------- |
| **Request**  | PassOverRequest  | Originator tells subagent what to do          |
| **Context**  | WorkContext      | Complete work snapshot passed to subagent     |
| **Output**   | WorkOutput       | Subagent's findings, modifications, decisions |
| **Metadata** | PassOverMetadata | Tracing, timing, chain info                   |

## Key Types Reference

### PassOverRequest

- `originating_agent_id`: who sent this
- `subagent_id`: who receives it
- `work_context`: what work to do
- `reason`: why (e.g., "review_changes")
- `return_required`: must originator handle return

### WorkContext

- `files`: relevant source files
- `messages`: conversation history
- `tool_results`: recent tool calls
- `objective`: what needs doing
- `todos`: current plan state

### WorkOutput

- `artifacts`: FileModificationArtifact, DecisionArtifact, FindingArtifact, etc.
- `status`: "completed" | "failed" | "aborted" | "partial"
- `summary`: decision, findings, recommendations
- `return_to`: must match originating_agent_id
- `metadata`: timestamps, chain info

### PassOverMetadata

- `chain_depth`: how many agents in delegation chain (prevent loops)
- `origination_chain`: history of who delegated to whom
- `created_at`, `completed_at`: timing
- `policy_name`: which config was used

## Loop Prevention

```
Chain Depth: alice → audit (depth=1)
             alice → scout → audit (depth=2)
             alice → scout → audit → ... (depth ≥ 3: BLOCKED)

Max Default: 3-5 agents deep

Also Blocked:
- Same agent appears twice (ping-pong)
- Agent passes to self
- Timeout reached
```

## User Preferences

### Config File: `.opencode/pass-over.json`

```json
{
  "defaults": {
    "auto_return": false,
    "auto_apply": false,
    "timeout_ms": 30000,
    "max_chain_depth": 3
  },
  "pairs": {
    "alice->audit": {
      "auto_return": true,
      "auto_apply": false,
      "notify_on_return": "always"
    }
  }
}
```

### Inline Override (in code)

```typescript
await passOver({
  subagent: "audit",
  work_context: {...},
  override: {
    timeout_ms: 60000,
    auto_return: true,
  }
})
```

### Preference Resolution Order

1. **Inline override** (highest priority)
2. Agent pair setting (alice->audit)
3. Subagent setting (audit.\*)
4. Global default
5. System default (lowest)

## Message Capture

### How Work Output Becomes Artifacts

```
Agent Message History
    ↓ filter for tool results
Tool Result (e.g., edit, bash, read)
    ↓ extract
Artifact (FileModification, ToolResult, Finding)
    ↓ collect in
WorkOutput.artifacts[]
```

### Artifact Types

- `FileModificationArtifact`: old_content → new_content
- `DecisionArtifact`: question → answer + reasoning
- `FindingArtifact`: issue found (severity, location, fix)
- `MessageArtifact`: communication for originator
- `ToolResultArtifact`: raw tool result (bash, read, etc.)

## Return Flow

### Auto-Return When:

1. Subagent completes (status="completed")
2. No blockers found
3. Policy says `auto_return: true`
4. User approves in UI
5. Timeout reached

### Return State Machine

```
[ PassOverRequest Sent ]
            ↓
[ waiting_for_return ]
            ↓
[ WorkOutput Received ]
            ↓
[ returned ]
            ↓
[ Originator Applies/Rejects ]
```

## Audit Trail

### Per-Pass Logging

```
PassOverAuditEntry:
  - pass_over_id: unique identifier
  - originating_agent: who sent it
  - subagent: who received it
  - reason: why
  - started_at, completed_at: timing
  - artifacts_count: how many results
  - status: "completed" | "failed" | "aborted"
  - applied: was it used?
```

### Log Location

```
.opencode/pass-over-logs/
├── 2024-02/
│   ├── session-abc123-passes.jsonl
│   └── session-def456-passes.jsonl
```

## Common Patterns

### Pattern 1: Alice Passes to Audit for Review

```typescript
// Alice's work.ts
const output = await passOver({
  subagent: "audit",
  work_context: {
    files: changedFiles,
    objective: "Review changes for correctness",
  },
  reason: "code_review",
})

if (output.summary.decision === "approved") {
  // Apply changes
} else {
  // Revise and retry
}
```

### Pattern 2: Scout Gathers, Returns Info

```typescript
// Scout's work.ts
const output = await passOver({
  subagent: "inspector",
  work_context: {
    files: candidateFiles,
    objective: "Validate file structure",
  },
})

// Process findings
for (const finding of output.artifacts) {
  if (finding.type === "finding") {
    console.log(finding.message)
  }
}
```

### Pattern 3: Prevent Infinite Loops

```typescript
// System automatically checks:
// ✓ Chain depth < max (default 3)
// ✓ No cycles (same agent twice)
// ✓ No ping-pong (A→B→A)
// ✓ Timeout not exceeded

// If any fail:
throw PassOverError(CHAIN_DEPTH_EXCEEDED)
```

## Error Codes

| Code | Meaning              | Recoverable |
| ---- | -------------------- | ----------- |
| E001 | Invalid subagent     | No          |
| E002 | Chain depth exceeded | No          |
| E003 | Cycle detected       | No          |
| E010 | Subagent timeout     | Yes (retry) |
| E011 | Subagent crashed     | Yes (retry) |
| E020 | Return context lost  | No          |
| E021 | Invalid work output  | No          |
| E030 | Config invalid       | No          |

## Retry Strategy

```typescript
passOverWithRetry({
  request,
  options: {
    max_retries: 3,
    retry_delay_ms: 1000,
    backoff_multiplier: 2, // delay doubles each retry
  },
})
```

## Performance Tips

- **Reduce Context**: Only pass needed files and messages
- **Set Timeout**: Larger timeout = better results but slower feedback
- **Batch Operations**: Multiple passes cost more than one
- **Cache Results**: Save audit findings for identical inputs
- **Monitor Depth**: Keep chain_depth ≤ 2 for speed

## Testing

### Test Chain Depth Prevention

```typescript
test("blocks pass over beyond max depth", () => {
  // alice → audit → scout → inspector (depth=3, max=3, OK)
  // alice → audit → scout → inspector → validator (depth=4, max=3, BLOCKED)
})
```

### Test Return Validation

```typescript
test("validates return originates from correct agent", () => {
  // PassOverRequest says return_to: "alice"
  // WorkOutput.return_to must also be "alice"
  // Mismatch = error
})
```

### Test Loop Prevention

```typescript
test("detects ping-pong pattern", () => {
  // alice → audit → alice = ERROR
})
```

## FAQ

**Q: What if the subagent crashes?**
A: WorkOutput.status = "failed". Originator decides: retry, manual fix, or cancel.

**Q: Can I pass over between different sessions?**
A: Not in v1. Pass over is session-scoped.

**Q: How much data can I pass?**
A: Limited by token count (usually ~50K tokens). Compress or summarize large histories.

**Q: What if user changes config during a pass over?**
A: Config change takes effect on next pass over. Current one uses original policy.

**Q: Can subagent modify files directly?**
A: Yes, but returned as artifacts. Originator decides whether to apply.

**Q: What happens if timeout expires?**
A: Subagent continues but originator doesn't wait. WorkOutput.status = "timeout".

## Related Docs

- **Full Architecture**: `pass-over-feature-architecture.md`
- **Agent Prompts**: `packages/opencode/src/agent/prompt/`
- **Session Management**: `packages/opencode/src/session/`
- **Message Format**: `packages/opencode/src/session/message-v2.ts`
