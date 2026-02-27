# Pass Over Feature - Documentation Index

## Overview

The pass over feature enables agents to delegate specialized work to subagents (e.g., Alice → Audit → Alice) with complete context preservation and controlled return mechanisms.

## Documentation Structure

### 1. **pass-over-feature-architecture.md** (Primary Design Document)

**1,179 lines | 33 KB**

Comprehensive architectural design covering all aspects of the pass over system.

**Sections:**

- Conceptual Model & Data Flow Diagram
- Data Structures (PassOverRequest, WorkContext, WorkOutput, WorkArtifact, PassOverMetadata)
- Message Structure & Capture Logic
- Return Loop Mechanism & State Machine
- User Preferences & Configuration System
- Context Preservation Strategies
- Metadata & Audit Trail Design
- Summary Generation Approach
- Error Handling & Recovery
- Implementation Roadmap (5 phases)
- Complete API Examples
- Glossary & Example Pass Over Cycle

**Use this when:** You need complete understanding of the system design, detailed specifications, or reference implementation details.

### 2. **pass-over-quick-reference.md** (Quick Reference)

**331 lines | 7.8 KB**

Quick lookup guide with tables, diagrams, and common patterns.

**Contents:**

- TL;DR Data Flow
- Core Types Reference Tables
- Loop Prevention Rules
- Configuration Examples (file + inline)
- Message Capture Explanation
- Return Flow State Machine
- Audit Trail Overview
- Common Patterns (3 examples)
- Error Codes Reference
- FAQ Section
- Performance Tips

**Use this when:** You need a quick lookup, want to understand the flow, or need copy-paste examples.

### 3. **pass-over-implementation-guide.md** (Implementation Roadmap)

**635 lines | 14 KB**

Step-by-step implementation guide with file locations, test requirements, and checklists.

**Contents:**

- 10 Phases with Week-by-Week Breakdown
- Specific File Locations (packages, filenames)
- Code Structure & Patterns
- Database Schema Requirements
- Testing Infrastructure Setup
- Code Style Guidance
- Database & Testing Commands
- Performance Targets
- Risk Areas & Mitigations
- Future Enhancement Ideas
- Support & Troubleshooting

**Use this when:** You're implementing the feature, need file paths, want to understand testing strategy, or need a checklist.

## Key Design Decisions

### Data Flow

```
Originating Agent (Alice)
    ↓ PassOverRequest
Subagent (Audit)
    ↓ WorkOutput
Originating Agent (Alice) continues
```

### Loop Prevention

- **Max Chain Depth**: 3 agents (default, configurable)
- **Cycle Detection**: No agent appears twice in chain
- **Ping-Pong Detection**: A→B→A prevented
- **Timeout Handling**: Subagent execution timeout

### Return Mechanism

- **State Machine**: waiting_for_return → returned → processed/cancelled
- **Auto-Return Conditions**: Success + policy + no blockers
- **Return Validation**: Must come from correct originating agent
- **Immutable Tracing**: Full chain recorded in metadata

### Configuration

Three-tier preference system:

1. **Inline Override** (highest priority) - per-call overrides
2. **Per-Agent-Pair Settings** - alice→audit specific config
3. **Global Defaults** (lowest priority)

### Artifacts Captured

- File Modifications (with old/new content)
- Decisions (question + answer + reasoning)
- Findings (severity + location + fix)
- Messages (for communication)
- Tool Results (bash, read, edit, etc.)

## Data Structures at a Glance

| Structure            | Purpose                              | Key Fields                                               |
| -------------------- | ------------------------------------ | -------------------------------------------------------- |
| **PassOverRequest**  | Originator tells subagent what to do | originating_agent_id, subagent_id, work_context, reason  |
| **WorkContext**      | Complete work snapshot               | files, messages, tool_results, objective                 |
| **WorkOutput**       | Subagent's results                   | artifacts[], status, summary, return_to                  |
| **WorkArtifact**     | Individual result                    | type (file/decision/finding/message/tool), content       |
| **PassOverMetadata** | Tracing & timing                     | pass_over_id, chain_depth, origination_chain, timestamps |

## Configuration System

### Global Config: `.opencode/pass-over.json`

```json
{
  "defaults": {
    "auto_return": false,
    "auto_apply": false,
    "max_chain_depth": 3
  },
  "pairs": {
    "alice->audit": {
      "auto_return": true,
      "auto_apply": false,
      "timeout_ms": 60000
    }
  }
}
```

### Inline Override

```typescript
await passOver({
  subagent: "audit",
  work_context: {...},
  override: {
    timeout_ms: 90000,
    auto_return: true,
  }
})
```

## Database Schema

Tables to be created:

- `pass_over_requests` - initiated passes
- `work_outputs` - subagent results
- `return_contexts` - return state tracking
- `pass_over_audit` - audit trail log
- `pass_over_preferences` - configuration storage
- `pass_over_defaults` - global defaults

## Implementation Phases

| Phase | Duration | Focus               | Deliverables                       |
| ----- | -------- | ------------------- | ---------------------------------- |
| 1     | Week 1-2 | Core Infrastructure | Types, DB, Chain Validator         |
| 2     | Week 1-2 | Loop Prevention     | State Machine, Cycle Detection     |
| 3     | Week 2   | Configuration       | Parser, Preference Resolution      |
| 4     | Week 2-3 | Context Extraction  | Message Selection, Token Budgeting |
| 5     | Week 3-4 | API & Integration   | passOver() & returnFromPassOver()  |
| 6     | Week 4   | Audit Logging       | Log Recording, Query Interface     |
| 7     | Week 4   | Error Handling      | Error Types, Retry Logic           |
| 8     | Week 4-5 | Testing             | Unit + Integration Tests           |
| 9     | Week 5-6 | Agent Integration   | Update Prompts, Registry           |
| 10    | Week 6-7 | UI & Observability  | Status Component, Audit Viewer     |

## Testing Strategy

### Unit Tests

- Chain validator (loops, depth, cycles)
- Configuration resolution
- Context extraction
- Error handling
- State transitions

### Integration Tests

- Alice → Audit → Alice cycle
- Timeout handling
- Chain depth enforcement
- Config overrides
- Error recovery

**Target Coverage:** >80% code coverage

## Error Handling

8 error categories:

- **E001-E004**: Request validation (not recoverable)
- **E010-E013**: Execution (some recoverable)
- **E020-E022**: Return issues (mostly not recoverable)
- **E030-E031**: Configuration (not recoverable)

All errors include:

- Clear error message
- Actionable suggestion
- Recoverable flag for retry logic

## Audit Trail

Every pass over is logged:

- Metadata about who, what, when, why
- Results stored in JSONL format
- Location: `.opencode/pass-over-logs/`
- Retention configurable (default: 30 days)
- Queryable via REST API

## Performance Targets

| Operation          | Target                               |
| ------------------ | ------------------------------------ |
| Pass over setup    | < 100ms                              |
| Chain validation   | < 10ms                               |
| Context extraction | < 200ms                              |
| Config resolution  | < 5ms                                |
| Audit logging      | < 50ms                               |
| **Total latency**  | **< 500ms** (excl. subagent compute) |

## Common Questions

**Q: Can a pass over chain be 5 agents deep?**
A: No, max is 3 (default). Configured via `max_chain_depth` in preferences.

**Q: What if subagent times out?**
A: Returns `status: "timeout"`. Originator decides next action.

**Q: Can I auto-apply all subagent changes?**
A: Yes, but requires explicit user configuration per pair.

**Q: Is the originating agent immutable?**
A: Yes, recorded in metadata and validated on return.

**Q: How much context can I pass?**
A: Limited by token budget (~50K tokens typical). Compress large histories.

## Future Enhancements (Post-MVP)

- Conditional passes (if-then-delegate)
- Batched passes (multiple in single request)
- Streaming results (real-time delivery)
- Pre-configured pass over pipelines
- Result caching for identical contexts
- Agent learning (remember successful patterns)
- Cross-session passes
- Fine-grained permission boundaries

## Related Documentation

- `AGENTS.md` - Style guide and VCS operations
- `packages/opencode/src/agent/agent.ts` - Agent registry
- `packages/opencode/src/session/message-v2.ts` - Message format
- `packages/opencode/src/session/` - Session management

## Getting Started

### For Designers/Architects

1. Read: **pass-over-feature-architecture.md** (full design)
2. Review: Section 1 (Conceptual Model) and Section 2 (Data Structures)
3. Understand: Sections 4-5 (Return Loop & Configuration)

### For Implementers

1. Start with: **pass-over-implementation-guide.md**
2. Follow: Phase 1-10 sequentially
3. Reference: **pass-over-feature-architecture.md** for detailed specs
4. Use: **pass-over-quick-reference.md** for examples

### For Reviewers

1. Skim: **pass-over-quick-reference.md** for overview
2. Deep dive: Relevant sections in **pass-over-feature-architecture.md**
3. Check: Against **pass-over-implementation-guide.md** requirements

## Document Maintenance

As the system evolves:

- Keep architecture doc as source of truth
- Update quick reference with new patterns
- Update implementation guide with actual file paths
- Add new sections for new features
- Review quarterly for accuracy

---

**Documents Created:** 3
**Total Lines:** 2,145
**Total Size:** 60 KB
**Date:** February 27, 2026

Last updated: 2026-02-27
