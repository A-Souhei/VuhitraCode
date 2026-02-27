# Pass Over Feature - Developer Guide

Comprehensive guide for developers implementing pass over functionality in agents and systems.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How Agents Trigger Pass Over](#how-agents-trigger-pass-over)
3. [Writing Agents for Pass Over](#writing-agents-for-pass-over)
4. [API Reference](#api-reference)
5. [Integration Points](#integration-points)
6. [Testing Workflows](#testing-workflows)
7. [Error Handling](#error-handling)

---

## Architecture Overview

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Opencode Runtime                         │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │                   │
              ┌──────────┐        ┌──────────┐
              │  Agent   │        │  Agent   │
              │ (Alice)  │        │  (Audit) │
              └──────────┘        └──────────┘
                    │                   ▲
                    │                   │
                    └───[pass_over]────┘
                         Context &
                        Work Output

         ┌────────────────────────────────┐
         │   Pass Over System             │
         │                                │
         │ • ContextBuilder               │
         │ • ReturnController             │
         │ • PassOverConfig               │
         │ • PassOverTool                 │
         └────────────────────────────────┘
```

### Data Flow Sequence

```
1. ORIGINATING AGENT (Alice)
   ├─ Completes work
   ├─ Collects modified files
   ├─ Generates summary
   └─ Emits [pass_over: audit]

2. CONTEXT BUILDER
   ├─ Extracts work output from messages
   ├─ Captures file modifications
   ├─ Collects tool results
   └─ Builds PassOverContext

3. PASS OVER TOOL
   ├─ Validates target agent exists
   ├─ Checks permissions
   ├─ Validates work_output structure
   ├─ Detects cycles (prevents loops)
   └─ Creates PassOverContext

4. SUBAGENT (Audit)
   ├─ Receives complete context
   ├─ Accesses modified files
   ├─ Reviews/analyzes work
   ├─ Creates artifacts/findings
   └─ Emits [return_to: originating_agent]

5. RETURN CONTROLLER
   ├─ Validates return is allowed
   ├─ Checks chain depth not exceeded
   ├─ Updates pass over state
   └─ Prepares context for return

6. ORIGINATING AGENT (Alice) Resumes
   ├─ Receives subagent output
   ├─ Integrates findings
   ├─ Continues execution
   └─ Session continues

7. OPTIONAL: Another Pass Over
   └─ Can trigger additional delegations (up to max_chain_depth)
```

### Key Components

| Component          | Location                             | Purpose                                                |
| ------------------ | ------------------------------------ | ------------------------------------------------------ |
| `PassOverTool`     | `src/tool/pass-over.ts`              | Accepts pass over requests, validates, creates context |
| `ContextBuilder`   | `src/pass-over/context-builder.ts`   | Extracts work output from messages and tool results    |
| `ReturnController` | `src/pass-over/return-controller.ts` | Manages return chain, prevents cycles                  |
| `PassOverConfig`   | `src/config/pass-over.ts`            | Configuration management and preferences               |
| `AgentCommand`     | `src/cli/cmd/agent.ts`               | CLI interface for configuration                        |

---

## How Agents Trigger Pass Over

### Method 1: [pass_over: agent_name] Tag (Recommended)

The simplest way to trigger pass over is using a tag in agent output.

**In agent response:**

```
I've completed the implementation. Now I need Audit to review it.

[pass_over: audit]

Summary of work:
- src/auth/login.ts: Added login handler
- src/auth/token.ts: Added token management

Reason: code_review
```

**How it works:**

1. Agent emits `[pass_over: agent_name]` tag
2. Runtime detects the tag
3. ContextBuilder extracts work output from recent messages
4. PassOverTool validates and creates context
5. Subagent is invoked with context
6. When subagent returns, runtime resumes original agent

**Tag format:**

```
[pass_over: <agent_name>]

Summary:
<what was accomplished>

Reason: <reason_code>
```

**Reason codes:**

- `code_review`: Code quality review
- `verify_implementation`: Verify correctness
- `fix_issues`: Address issues found
- `security_audit`: Security review
- `architecture_review`: Architecture validation
- `performance_review`: Performance analysis
- `test_execution`: Run tests
- `process_findings`: Process scout findings
- Custom: Any reason string

---

### Method 2: Direct PassOverTool Usage (Advanced)

For programmatic control, agents can use the pass_over tool directly.

**Tool definition:**

```typescript
// From src/tool/pass-over.ts
PassOverTool = Tool.define("pass_over", async () => {
  return {
    description: "Pass work to another agent for specialized handling",
    parameters: PassOver.Parameters,
    async execute(params, ctx) {
      // Implementation
    },
  }
})

// PassOver.Parameters schema
export const Parameters = z.object({
  subagent: z.string().describe("Target agent name"),
  reason: z.string().describe("Why passing over"),
  work_output: WorkOutput,
  auto_confirm: z.boolean().optional().describe("Override auto-confirm"),
  timeout_ms: z.number().optional().describe("Override timeout"),
})
```

**Usage in agent:**

```typescript
const result = await passOverTool.execute({
  subagent: "audit",
  reason: "code_review",
  work_output: {
    files_modified: ["src/auth/login.ts", "src/auth/token.ts"],
    summary: "Created auth module with login and token handlers",
    messages: previousMessages,
    tool_results: recentToolResults,
  },
  auto_confirm: true, // Skip user confirmation
  timeout_ms: 60000, // 60 second timeout
})

// Result structure:
// {
//   status: "confirmed" | "pending",
//   target_agent: "audit",
//   reason: "code_review",
//   context_id: "tool_abc123",
// }
```

---

### Method 3: Returning from Pass Over

When a subagent completes work, it returns to the originating agent using:

**Return tag:**

```
[return_to: alice]

Findings:
- Fixed 2 critical issues
- Added 3 recommendations

Summary: Code review complete. Ready for production.
```

**Return validation:**

- Must specify correct originating agent name
- Checked against PassOverMetadata.originating_agent
- ReturnController validates return is allowed

---

## Writing Agents for Pass Over

### How to Implement a Pass Over-Aware Agent

**Step 1: Agent receives pass over context**

When your agent is invoked via pass over, it receives:

- `work_output`: What previous agent did
- `metadata`: Who, when, why, chain info
- `reason`: Why it was delegated to you
- Full conversation history

**In your system prompt:**

```markdown
# Audit Agent

You are a specialized code reviewer. When you receive work:

1. Understand what was done (from work_output summary)
2. Review the modified files
3. Check for bugs, style issues, performance
4. Generate detailed findings
5. Return findings to original agent

You will receive:

- List of modified files
- Summary of work done
- Full conversation history
- Reason for the pass over

When you're done:

1. List all findings (critical first)
2. Make recommendations
3. Emit [return_to: original_agent_name]
```

**Step 2: Emit [return_to: ...] when done**

```typescript
// In agent response
const findings = `
FINDINGS:
✗ CRITICAL: Security issue in auth.ts:156
✗ HIGH: Missing error handling
✓ GOOD: Code structure is clean

RECOMMENDATIONS:
1. Add CSRF validation
2. Add try/catch blocks

[return_to: alice]

Summary: Code review complete. Found 2 critical issues, addressed above.
Files modified: 0
`
```

**Step 3: Handle errors appropriately**

```typescript
// If you can't complete the work
if (analysis failed) {
  return {
    status: "failed",
    error: "Analysis timed out",
    [return_to: alice]

    Summary: Could not complete analysis due to timeout.
    Please review manually or try again.
  }
}
```

---

### Work Output Context You Receive

When invoked via pass over, you receive a `PassOverContext`:

```typescript
export interface PassOverContext {
  context_id: string // Unique ID for this pass over
  work_output: WorkOutput // What previous agent did
  metadata: PassOverMetadata // Chain info, timing, etc.
  reason: string // Why delegated to you
}

export interface WorkOutput {
  files_modified: string[] // List of modified files
  summary: string // Summary of work done
  messages?: unknown[] // Previous messages
  tool_results?: unknown[] // Tool execution results
}

export interface PassOverMetadata {
  chain_depth: number // How deep in delegation chain
  previous_pass_over_id?: string // Previous pass over ID (if any)
  originating_agent: string // Who started this
  timestamp: number // When pass over occurred
}
```

**How to use this context:**

```typescript
// In your agent code
function processPassOverContext(context: PassOverContext) {
  // What was done
  console.log("Modified files:", context.work_output.files_modified)
  console.log("Work summary:", context.work_output.summary)

  // Why we're here
  console.log("Reason:", context.reason) // "code_review", "verify", etc.

  // Chain tracking
  console.log("Chain depth:", context.metadata.chain_depth)
  console.log("Originating agent:", context.metadata.originating_agent)

  // Continue messages if needed
  if (context.work_output.messages) {
    // Use for context
  }
}
```

---

### Error Handling in Pass Over

**Types of errors:**

| Error                | Cause                      | Resolution                   |
| -------------------- | -------------------------- | ---------------------------- |
| Agent not found      | Target agent doesn't exist | Verify agent name            |
| Permission denied    | Agent not authorized       | Check permissions            |
| Chain depth exceeded | Too many delegations       | Reduce depth or increase max |
| Cycle detected       | Same agent twice in chain  | Redesign workflow            |
| Invalid work_output  | Missing required fields    | Include all required fields  |
| Timeout              | Subagent took too long     | Increase timeout or optimize |

**Handling errors in agent:**

```typescript
try {
  await passOverTool.execute({
    subagent: "audit",
    reason: "code_review",
    work_output: {
      files_modified: files,
      summary: workSummary,
    },
  })
} catch (error) {
  if (error.message.includes("chain depth")) {
    // Too deep, break into smaller pieces
    console.log("Workflow too complex. Reducing scope.")
    // Continue without pass over
  } else if (error.message.includes("not found")) {
    // Agent doesn't exist
    console.log("Audit agent not available")
    // Continue with fallback
  } else {
    // Other error
    throw error
  }
}
```

---

## API Reference

### PassOver Tool Parameters

```typescript
export interface Parameters {
  subagent: string // Target agent name (required)
  reason: string // Why passing over (required)
  work_output: WorkOutput // What was accomplished (required)
  auto_confirm?: boolean // Override auto-confirm (optional)
  timeout_ms?: number // Override timeout (optional)
}

export interface WorkOutput {
  files_modified: string[] // List of file paths (required)
  summary: string // Brief summary (required)
  messages?: unknown[] // Previous messages (optional)
  tool_results?: unknown[] // Tool results (optional)
}
```

### PassOver Response

```typescript
export interface Response {
  status: "confirmed" | "pending" // Current status
  target_agent: string // Where it went
  reason: string // Why
  context_id: string // Unique ID
}
```

### PassOverContext Structure

```typescript
export interface PassOverContext {
  context_id: string // Unique identifier
  work_output: WorkOutput // Work done
  metadata: PassOverMetadata // Metadata
  reason: string // Reason for pass over
}

export interface PassOverMetadata {
  chain_depth: number // Position in chain (1, 2, 3, ...)
  previous_pass_over_id?: string // Previous pass over context
  originating_agent: string // Original requesting agent
  timestamp: number // Unix timestamp
}
```

### Configuration API

**Loading configuration:**

```typescript
import { loadPassOverConfig } from "@/config/pass-over"

const config = await loadPassOverConfig(directory)
// Returns PassOverConfig with global_settings and agent_pair_settings
```

**Getting preferences for a pair:**

```typescript
import { getPreferences } from "@/config/pass-over"

const prefs = getPreferences(config, "alice", "audit")
// Returns PassOverPreferences for alice → audit pair
// Falls back to global_settings if not configured
```

**Saving configuration:**

```typescript
import { savePassOverConfig } from "@/config/pass-over"

await savePassOverConfig(directory, updatedConfig)
```

**Default configuration:**

```typescript
import { DEFAULT_CONFIG } from "@/config/pass-over"

// Global defaults
const defaults = DEFAULT_CONFIG.global_settings
// {
//   auto_confirm: false,
//   timeout_ms: 30000,
//   return_to_originator: true,
//   max_chain_depth: 3,
//   enabled: true,
// }
```

### ReturnController API

**Creating a controller:**

```typescript
import { ReturnController } from "@/pass-over/return-controller"

const controller = new ReturnController("alice", 3) // origin, maxDepth
```

**Adding agents to chain:**

```typescript
// Validates cycle and depth
controller.addToChain("audit", "code_review")
// Now chain is: alice → audit

controller.addToChain("tester", "test_execution")
// Now chain is: alice → audit → tester

controller.addToChain("reviewer", "final_check")
// Now chain is: alice → audit → tester → reviewer (depth=3)

// This would fail:
controller.addToChain("validator", "verify")
// Error: "Pass over chain depth (3) exceeded"
```

**Checking return capability:**

```typescript
// Can we return to previous agent?
const canReturn = controller.canReturn()

// Where do we return?
const target = controller.getReturnTarget() // "tester"

// Current state
const state = controller.getState()
// {
//   pass_over_chain: [...],
//   origin_agent: "alice",
//   current_agent: "reviewer",
//   can_return: true,
//   next_return_target: "tester",
// }
```

**Cycle detection:**

```typescript
const hasCycle = controller.detectCycle()

const depth = controller.getChainDepth() // 4 (alice + audit + tester + reviewer)
```

**PassOver metadata:**

```typescript
const metadata = controller.asPassOverMetadata()
// {
//   chain_depth: 3,
//   originating_agent: "alice",
//   timestamp: 1234567890,
// }
```

---

## Integration Points

### How Pass Over Integrates with Message Flow

**Message flow with pass over:**

```
1. User → Agent (Alice)
   Message: "Implement auth module"

2. Alice generates response
   [Response with modified files, pass_over: audit]

3. Runtime captures:
   - Alice's message
   - Modified files list
   - Work summary

4. ContextBuilder extracts:
   - WorkOutput from messages
   - Files modified
   - Tool results

5. PassOverTool validates and creates:
   - PassOverContext
   - PassOverMetadata

6. Audit receives:
   - WorkOutput
   - Metadata
   - Access to modified files

7. Audit processes and returns
   [Response with findings, return_to: alice]

8. ReturnController validates return

9. Runtime resumes Alice with:
   - Audit's message
   - Audit's findings
   - File modifications (if any)

10. Alice continues
    Integrated into session history
```

### ReturnController Behavior

**Return mechanics:**

```typescript
// When subagent completes and emits [return_to: alice]

1. ReturnController validates:
   - Current agent can return (not origin yet)
   - Return target matches chain
   - Chain depth allows return

2. Returns to previous agent:
   controller.getReturnTarget()  // Returns previous agent name

3. Updates state:
   - Moves current pointer back
   - Maintains chain history
   - Preserves metadata

4. Context for returning agent:
   - Receives subagent's work output
   - Sees what files were modified
   - Has full history
```

**Auto-return vs manual:**

```typescript
// With auto_return: true
Audit finishes → Automatically returns to Alice

// With auto_return: false
Audit finishes → Alice must manually confirm return
[return_to: alice]  // Must be explicit
```

### Loop Prevention Rules

**Enforced at multiple levels:**

```
1. PassOverTool
   ├─ Prevents same agent twice in succession
   ├─ Validates chain depth < MAX_CHAIN_DEPTH
   └─ Throws error if violated

2. ReturnController
   ├─ Tracks full chain history
   ├─ Detects cycles (same agent twice)
   ├─ Validates return target is previous
   └─ Enforces max depth

3. Runtime
   ├─ Prevents pass over if disabled
   ├─ Checks configuration policies
   └─ Respects enabled flag
```

**Examples of prevented loops:**

```
BLOCKED:
✗ alice → alice               (same agent twice)
✗ alice → audit → alice → audit  (ping-pong)
✗ alice → a → b → c → d      (depth > max_chain_depth)

ALLOWED:
✓ alice → audit → alice       (return to origin is OK)
✓ alice → audit → tester → reviewer (depth = 3)
✓ alice → scout → alice → audit → alice (multiple paths)
```

---

## Testing Workflows

### Local Testing Setup

**1. Create test agents:**

```bash
# Create test alice agent
vuhitracode agent create \
  --path test/agents \
  --description "Test implementation agent" \
  --mode primary

# Create test audit agent
vuhitracode agent create \
  --path test/agents \
  --description "Test code review agent" \
  --mode subagent
```

**2. Configure for testing:**

```bash
# Enable auto-confirm for faster testing
vuhitracode agent pass-over set-global --auto-confirm true

# Fast timeout for dev
vuhitracode agent pass-over set-global --timeout-ms 10000

# Allow multiple passes for testing
vuhitracode agent pass-over set-global --max-chain-depth 5
```

**3. Create test files:**

```typescript
// test/pass-over.test.ts
import { PassOverTool } from "@/tool/pass-over"
import { ReturnController } from "@/pass-over/return-controller"
import { ContextBuilder } from "@/pass-over/context-builder"

describe("Pass Over", () => {
  it("should pass work to audit agent", async () => {
    const result = await PassOverTool.execute({
      subagent: "audit",
      reason: "code_review",
      work_output: {
        files_modified: ["src/test.ts"],
        summary: "Created test file",
      },
    })

    expect(result.status).toBe("confirmed")
    expect(result.target_agent).toBe("audit")
  })

  it("should prevent cycles", async () => {
    const controller = new ReturnController("alice", 3)
    controller.addToChain("audit", "review")

    expect(() => {
      controller.addToChain("audit", "review")
    }).toThrow("Cycle detected")
  })
})
```

### Debugging Tips

**1. Enable verbose logging:**

```typescript
// In your agent
const context = {
  pass_over_depth: ctx.extra?.pass_over_depth ?? 0,
  previous_pass_over_agent: ctx.extra?.previous_pass_over_agent,
  pass_over_id: ctx.extra?.pass_over_id,
}

console.log("Pass over context:", context)
```

**2. Inspect messages:**

```typescript
// See what gets captured for pass over
const messages = [
  { role: "user", content: "..." },
  { role: "assistant", content: "[pass_over: audit]..." },
]

const output = extractWorkOutput(messages)
console.log("Captured output:", output)
// {
//   files_modified: [...],
//   summary: "...",
//   messages: count,
//   tool_results: [...]
// }
```

**3. Check configuration:**

```bash
# View all settings
vuhitracode agent pass-over config

# View specific pair
vuhitracode agent pass-over list
```

**4. Trace pass over execution:**

```typescript
// In PassOverTool execution
console.log("Pass over triggered:")
console.log("- From:", caller)
console.log("- To:", params.subagent)
console.log("- Reason:", params.reason)
console.log("- Chain depth:", depth)
console.log("- Context ID:", contextId)
```

---

## Error Handling

### Common Errors and Solutions

**1. Agent not found**

```
Error: Agent 'reviewer' does not exist

Solution:
- Check agent exists: vuhitracode agent list
- Verify spelling in [pass_over: reviewer]
- Create agent if needed: vuhitracode agent create
```

**2. Permission denied**

```
Error: Not authorized to pass to agent 'audit'

Solution:
- Check agent permissions configuration
- Verify calling agent has permission to delegate
- Check PermissionNext rules
```

**3. Chain depth exceeded**

```
Error: Pass over chain depth (3) exceeded

Solution:
- Increase max depth: vuhitracode agent pass-over set-global --max-chain-depth 5
- Redesign to use fewer agents
- Break work into independent pass overs
```

**4. Cycle detected**

```
Error: Cannot pass back to same agent 'audit' twice in succession

Solution:
- Use different agent for second review
- Don't pass back to immediate previous agent
- Design workflow differently:
  - alice → audit → alice → alice (last step doesn't need pass over)
```

**5. Invalid work_output**

```
Error: Missing required fields in work_output

Solution:
- Include files_modified (array)
- Include summary (string)
- files_modified must be non-empty
```

### Best Practices

**1. Always provide meaningful summaries:**

```typescript
// BAD
work_output: {
  files_modified: ["src/auth.ts"],
  summary: "Done"  // Too vague
}

// GOOD
work_output: {
  files_modified: ["src/auth.ts"],
  summary: "Implemented user authentication with login/logout, token refresh, and session management"
}
```

**2. Handle pass over failures gracefully:**

```typescript
try {
  await passOver(...)
} catch (error) {
  // Log but don't crash
  console.error("Pass over failed:", error.message)

  // Continue with fallback
  return "Could not delegate to audit. Continuing with internal checks."
}
```

**3. Use auto-confirm strategically:**

```typescript
// Use auto-confirm for trusted pairs
vuhitracode agent pass-over set-pair alice audit \
  --auto-confirm true

// Require confirmation for risky operations
vuhitracode agent pass-over set-pair alice production_deployer \
  --auto-confirm false
```

**4. Design workflows to respect chain depth:**

```
Instead of:
alice → a → b → c → d → e (depth 5, might exceed limit)

Use:
alice → (scout + plan + build in parallel) → alice
alice → deploy (no pass over)
```

**5. Monitor timeouts:**

```typescript
// If subagents consistently timeout, increase timeout
vuhitracode agent pass-over set-pair alice heavy_analysis \
  --timeout-ms 120000

// Or optimize the subagent to be faster
```

---

## Complete Example: Code Review Agent

**Full example of a pass-over-aware code review agent:**

```typescript
// agents/audit.md
---
description: Expert code reviewer providing detailed feedback
mode: subagent
---

# Audit Agent - Code Review Specialist

You are a senior code reviewer. Your job is to review code and provide constructive feedback.

When you receive work via pass over:
1. Read the modified files
2. Look for bugs, performance issues, style problems
3. Check for security vulnerabilities
4. Provide actionable recommendations
5. Return findings to original agent

## Review Checklist
- [ ] Code correctness
- [ ] Error handling
- [ ] Performance considerations
- [ ] Security issues
- [ ] Code style consistency
- [ ] Test coverage
- [ ] Documentation

## Response Format

When you're done:

FINDINGS:
- Critical issues (if any)
- High priority items
- Recommendations
- Positive notes

[return_to: <original_agent>]

Summary: Brief summary of findings
```

**Using this agent:**

```typescript
// In alice's response
const response = `
I've implemented the auth module. Let me get it reviewed.

[pass_over: audit]

Summary of work:
- src/auth/login.ts: Login handler implementation
- src/auth/token.ts: JWT token management
- src/auth/types.ts: TypeScript interfaces

Reason: code_review
`

// Audit receives this, reviews code, responds with:

const auditResponse = `
FINDINGS:
✗ CRITICAL: Hardcoded API key in login.ts line 42
✗ HIGH: Missing error handling in token.ts line 89
✓ GOOD: Type definitions are comprehensive
✓ GOOD: Error messages are descriptive

RECOMMENDATIONS:
1. Move API key to environment variables
2. Add try/catch around token operations
3. Add rate limiting to login endpoint
4. Add integration tests

[return_to: alice]

Summary: Code review found 2 critical issues. Recommendations provided.
`

// Alice receives audit's response and addresses issues
```

---

## References

- **User Guide**: `pass-over-user-guide.md` - How to use pass over
- **Architecture**: `pass-over-feature-architecture.md` - Deep technical details
- **Quick Reference**: `pass-over-quick-reference.md` - Tables and patterns
- **Source Code**: `packages/opencode/src/pass-over/` - Implementation
