# Pass Over Feature - User Guide

A practical guide for end users and developers on using the pass over feature to delegate work between agents.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Use Cases](#use-cases)
4. [Configuration](#configuration)
5. [UI & Triggering Pass Over](#ui--triggering-pass-over)
6. [Troubleshooting](#troubleshooting)
7. [Examples](#examples)

---

## Overview

### What is Pass Over?

Pass Over is a mechanism that allows one agent to **delegate specialized work to another agent** while preserving all context, and then automatically resume when the subagent completes its work.

**Simple workflow:**

```
Alice (Designer)
  ↓ [pass_over: audit]
Audit Agent (Reviewer)
  ↓ [returns with findings]
Alice (Designer)
  ↓ continues with feedback
```

### Why Use Pass Over?

- **Specialization**: Different agents have different strengths (design, code review, testing, etc.)
- **Quality**: A dedicated reviewer agent catches issues the original agent might miss
- **Efficiency**: Agents work on their core competencies
- **Traceability**: Full audit trail of who did what and when
- **Context Preservation**: The receiving agent has complete context of what was done

### Common Workflows

| Workflow                | Description                                     |
| ----------------------- | ----------------------------------------------- |
| **Code Review**         | Alice → Audit (review) → Alice                  |
| **Architecture Review** | Build Agent → Plan Agent (verify) → Build Agent |
| **Discovery**           | Alice → Scout (explore) → Alice                 |
| **Multi-tier QA**       | Dev → QA1 (basic) → QA2 (security) → Dev        |

---

## Quick Start

### Basic Example: Alice → Audit → Alice

This example shows the simplest pass over workflow.

**1. Alice creates or modifies code:**

```
User: Design a new feature for user authentication

Alice: I've created the auth module. Let me have Audit review it for quality.

[pass_over: audit]

Summary of work:
- Created src/auth/login.ts (245 lines)
- Created src/auth/token.ts (180 lines)
- Updated src/auth/index.ts with exports

Reason: code_review
```

**2. Audit agent reviews the code:**

```
Audit receives:
- List of modified files
- Complete work summary
- Previous messages
- Reason for pass over

Audit response:
[FINDINGS]
- login.ts: Missing error logging on line 52
- token.ts: Verify token expiration matches backend spec
- index.ts: Exports look good

RECOMMENDATIONS:
1. Add try/catch with logging
2. Add constants for token TTL
3. Consider adding validation middleware

[return_to: alice]
```

**3. Alice receives audit results:**

```
Audit has reviewed your work and returned findings:
- 2 issues to address
- 3 recommendations

Files to review:
- src/auth/login.ts (issue on line 52)
- src/auth/token.ts (verify token expiration)

Alice now continues and addresses the findings.
```

---

## Use Cases

### Use Case 1: Design → Review → Design (Code Quality)

**Scenario**: Alice designs a new feature. You want Audit to review the implementation before merging.

**Command**:

```bash
# Alice creates feature
opencode run --agent alice --task "Implement user dashboard"

# Alice passes to audit
# [pass_over: audit]
# Reason: code_review
# Files: dashboard.ts, dashboard.scss, etc.
```

**What happens**:

1. Alice completes implementation
2. Emits `[pass_over: audit]` tag
3. Audit agent receives: code, summary, previous context
4. Audit reviews for bugs, style, performance
5. Returns findings to Alice
6. Alice addresses issues and continues

---

### Use Case 2: Build → Plan → Build (Architecture Review)

**Scenario**: A build agent designs application architecture. Plan agent verifies it aligns with system constraints.

**Command**:

```bash
# Build agent creates architecture design
vuhitracode agent pass-over set-pair build plan \
  --auto-confirm true \
  --timeout-ms 60000

# In agent code:
# [pass_over: plan]
# Reason: verify_architecture
```

**What happens**:

1. Build agent designs system
2. Automatically passes to Plan agent (auto-confirm enabled)
3. Plan verifies against constraints
4. Plan returns approval/modifications
5. Build continues with approved design
6. No manual confirmation needed

---

### Use Case 3: Scout Explores → Alice Processes

**Scenario**: Scout agent explores codebase to find issues. Alice processes findings and implements fixes.

**Command**:

```bash
# Scout explores the codebase
opencode run --agent scout --task "Find performance issues in database layer"

# Scout emits pass over when complete
# [pass_over: alice]
# Reason: process_findings
```

**Workflow**:

1. Scout explores files, runs analysis
2. Collects findings (potential issues, metrics, etc.)
3. Passes to Alice with complete context
4. Alice receives findings and prioritized list
5. Alice implements fixes based on Scout's findings
6. Scout might verify fixes with another pass over

---

## Configuration

### Global Settings

**View current configuration:**

```bash
vuhitracode agent pass-over config
```

**Output:**

```
Global Settings:
  auto_confirm: false
  timeout_ms: 30000
  return_to_originator: true
  max_chain_depth: 3
  enabled: true
```

### Configure Global Settings

```bash
# Enable auto-confirmation for all pass overs
vuhitracode agent pass-over set-global --auto-confirm true

# Increase timeout to 60 seconds
vuhitracode agent pass-over set-global --timeout-ms 60000

# Disable automatic return (manual control only)
vuhitracode agent pass-over set-global --return-to-originator false

# Increase max chain depth to 5
vuhitracode agent pass-over set-global --max-chain-depth 5
```

### Agent-Specific Pair Configuration

Configure behavior for specific agent pairs.

```bash
# Enable auto-confirm only for alice → audit
vuhitracode agent pass-over set-pair alice audit \
  --auto-confirm true \
  --timeout-ms 45000

# Different settings for alice → scout
vuhitracode agent pass-over set-pair alice scout \
  --auto-confirm false \
  --timeout-ms 90000

# Configure return behavior for audit → alice
vuhitracode agent pass-over set-pair audit alice \
  --return-to-originator true
```

### Configuration File: `.opencode/pass-over.json`

You can also edit the configuration file directly:

```json
{
  "global_settings": {
    "auto_confirm": false,
    "timeout_ms": 30000,
    "return_to_originator": true,
    "max_chain_depth": 3,
    "enabled": true
  },
  "agent_pair_settings": {
    "alice": {
      "audit": {
        "auto_confirm": true,
        "timeout_ms": 45000,
        "return_to_originator": true,
        "max_chain_depth": 3,
        "enabled": true
      },
      "scout": {
        "auto_confirm": false,
        "timeout_ms": 90000,
        "return_to_originator": true,
        "max_chain_depth": 5,
        "enabled": true
      }
    }
  }
}
```

### Configuration Parameters Explained

| Parameter              | Type    | Default | Description                                                  |
| ---------------------- | ------- | ------- | ------------------------------------------------------------ |
| `auto_confirm`         | boolean | false   | Automatically confirm pass over without user interaction     |
| `timeout_ms`           | number  | 30000   | How long to wait for subagent (milliseconds)                 |
| `return_to_originator` | boolean | true    | Automatically return to original agent when done             |
| `max_chain_depth`      | number  | 3       | Maximum agents in delegation chain (prevents infinite loops) |
| `enabled`              | boolean | true    | Enable/disable pass over for this pair                       |

---

## UI & Triggering Pass Over

### Triggering with [pass_over: agent_name] Tag

The primary way to trigger pass over is using the tag syntax in agent output.

**In your agent prompt/response:**

```
I've completed the implementation. Now I need Audit to review it.

[pass_over: audit]

Summary of work:
- src/auth/login.ts: Added login handler (245 lines)
- src/auth/token.ts: Added token management (180 lines)

Reason: code_review
```

**What the tag does:**

1. Signals to opencode that this agent is done
2. Passes control to the named agent (`audit`)
3. Sends along the work summary and context
4. Waits for the subagent to complete
5. Returns results to original agent

### Alternative: Using the pass_over Tool

Agents can also use the `pass_over` tool directly (if available):

```typescript
// In agent code
const result = await passOverTool.execute({
  subagent: "audit",
  reason: "code_review",
  work_output: {
    files_modified: ["src/auth/login.ts", "src/auth/token.ts"],
    summary: "Created auth module with login and token handlers",
    messages: previousMessages,
  },
  auto_confirm: true, // Optional: override config
})
```

### What Happens During Pass Over

**Transition Sequence:**

1. **Request Sent**

   ```
   Original Agent (Alice) emits [pass_over: audit]
   System captures current state:
   - Modified files list
   - Work summary
   - Message history
   - Tool results
   ```

2. **Context Prepared**

   ```
   System builds PassOverContext containing:
   - work_output: What was done
   - metadata: Who, when, why, chain depth
   - reason: Why this pass over
   - context_id: Unique identifier
   ```

3. **Subagent Starts**

   ```
   Audit agent receives:
   - Complete context from Alice
   - Files that were modified
   - Full conversation history
   - Reason: code_review

   Audit now has everything needed to do its job
   ```

4. **Subagent Works**

   ```
   Audit reviews code, finds issues, generates findings
   Audit may modify files or just provide feedback
   Audit completes its work
   ```

5. **Return Initiated**

   ```
   Audit emits [return_to: alice]
   System captures Audit's work output
   Creates return context
   ```

6. **Original Agent Resumes**

   ```
   Alice receives:
   - Audit's findings
   - Any files Audit modified
   - Full context of what Audit did

   Alice can now decide to:
   - Accept findings and address issues
   - Request more analysis (another pass over)
   - Override and continue as planned
   ```

### Seeing When Agent Switches

**In the UI/output:**

```
Alice: [Working on authentication module...]
[pass_over: audit]

→ Switching to Audit...

Audit: [Reviewing code...]
[return_to: alice]

→ Returning to Alice...

Alice: [Addressing audit findings...]
```

**In logs:**

```
[PASS_OVER] alice → audit (code_review)
  Context ID: tool_abc123
  Files: src/auth/login.ts, src/auth/token.ts

[AUDIT_WORK] Reviewing 2 files
  Status: completed
  Issues found: 2

[RETURN] audit → alice (code_review results)
  Context ID: tool_abc123
  Modified files: 0
  Recommendations: 3
```

---

## Troubleshooting

### Issue: Pass Over Not Triggering

**Problem**: `[pass_over: audit]` tag isn't switching to audit agent

**Solutions**:

1. **Check if pass over is enabled:**

   ```bash
   vuhitracode agent pass-over config
   ```

   Verify `enabled: true` in global_settings

2. **Verify agent exists:**

   ```bash
   vuhitracode agent list
   ```

   Make sure `audit` is in the list

3. **Check tag syntax:**
   - Should be: `[pass_over: audit]`
   - Not: `[pass-over: audit]` or `[passover: audit]`
   - Reason field should be present

---

### Issue: Subagent Timeout

**Problem**: Subagent takes too long and times out

**Solutions**:

1. **Increase timeout for the pair:**

   ```bash
   vuhitracode agent pass-over set-pair alice audit \
     --timeout-ms 120000
   ```

2. **Increase globally:**

   ```bash
   vuhitracode agent pass-over set-global --timeout-ms 120000
   ```

3. **Check what subagent is doing:**
   - Is it working on very large files?
   - Is it making many API calls?
   - Consider breaking work into smaller chunks

---

### Issue: Too Many Pass Overs (Chain Too Deep)

**Problem**: Getting error "Pass over chain depth exceeded"

**Solutions**:

1. **Increase max chain depth:**

   ```bash
   vuhitracode agent pass-over set-global --max-chain-depth 5
   ```

2. **Redesign workflow:**
   - Instead: alice → scout → plan → build → test (5 agents)
   - Consider: scout explores, returns to alice; alice then handles everything

3. **Combine steps:**
   - Can audit and plan be done by same agent?
   - Can testing be done without separate pass over?

---

### Issue: Same Agent Appears Twice (Ping-Pong Error)

**Problem**: Getting error "Cannot pass back to same agent twice in succession"

**Example causing error:**

```
alice → audit → alice → audit  ← ERROR: audit appears twice
```

**Solutions**:

1. **Design better workflow:**
   - If audit needs to verify Alice's fixes: alice → audit → done (not back to audit)
   - Then if needed: alice → alice (manual re-run, not pass over)

2. **Use different agents:**
   - First review: alice → audit1
   - Second review: alice → audit2

3. **Process results without pass over:**
   - audit returns findings
   - alice processes them
   - alice doesn't pass back to audit (just continues)

---

### Issue: Can't Trigger Pass Over to Specific Agent

**Problem**: Permission denied or agent not available

**Solutions**:

1. **Check agent permissions:**

   ```bash
   vuhitracode agent list
   # Look for your agent and its mode
   ```

2. **Verify agent can receive pass overs:**
   - Agent mode should be "all" or "subagent"
   - Check agent configuration file

3. **Check if pair settings disable it:**
   ```bash
   vuhitracode agent pass-over list
   # Look for agent pair and verify enabled: true
   ```

---

### Issue: Work Context Lost After Pass Over

**Problem**: Subagent doesn't have access to previous conversation

**Solutions**:

1. **Include in work_output summary:**

   ```
   When triggering pass over, make sure summary includes:
   - What has been done so far
   - Key decisions made
   - Any constraints
   ```

2. **Message history is included:**
   - The pass over automatically includes recent messages
   - But they're limited by window size
   - If summary is incomplete, increase message window

3. **Use artifacts:**
   - Subagent can access generated artifacts
   - Large context available via file references

---

### Issue: Agent Returns Unexpectedly

**Problem**: Agent returned before completing work

**Solutions**:

1. **Check return policy:**

   ```bash
   vuhitracode agent pass-over config
   # Check return_to_originator setting
   ```

2. **Agent might have hit timeout:**
   - Increase timeout for that pair
   - Check agent logs for timeout messages

3. **Agent might have auto-return enabled:**
   - If not desired, disable for that pair:
   ```bash
   vuhitracode agent pass-over set-pair agent1 agent2 \
     --return-to-originator false
   ```

---

## Examples

### Example 1: Code Review Workflow

**Scenario**: Alice implements a feature, Audit reviews the code, Alice fixes issues.

**Step 1: Alice implements feature**

```
User: Add a new payment processing module

Alice: I'll create the payment module with Stripe integration.
- src/payments/stripe.ts: Stripe API client (320 lines)
- src/payments/processor.ts: Payment logic (250 lines)
- src/payments/types.ts: TypeScript types (120 lines)
- Updated: src/index.ts with exports

The module includes:
✓ Async payment processing
✓ Error handling with retry logic
✓ Webhook verification
✓ Logging for debugging

[pass_over: audit]

Reason: code_review
Summary: Implemented Stripe payment processing with error handling and webhooks
Files: src/payments/*.ts, src/index.ts
```

**Step 2: Audit reviews**

```
Audit: Reviewing payment module...

FINDINGS:
✗ CRITICAL: Missing CSRF token validation in webhook handler (stripe.ts:156)
✗ HIGH: Sensitive keys logged in plaintext (stripe.ts:89)
✓ GOOD: Error handling is comprehensive
✓ GOOD: Types are well-defined

RECOMMENDATIONS:
1. Use environment variables for sensitive keys
2. Add CSRF validation middleware
3. Add rate limiting on payment endpoint
4. Consider adding circuit breaker pattern
5. Add integration tests

[return_to: alice]

Modified files: 1
- src/payments/stripe.ts (fixed CSRF, added key validation)

Summary: Code review complete. 2 critical issues found and fixed. Ready for testing.
```

**Step 3: Alice receives and decides**

```
Alice: Thanks for the review! I see the CSRF and logging issues.
I'll address the remaining recommendations:
- Added rate limiting middleware
- Added circuit breaker for Stripe API
- Added integration tests

Files modified:
- src/payments/stripe.ts
- src/payments/middleware.ts (NEW)
- src/payments/circuit-breaker.ts (NEW)
- tests/payments/*.test.ts (NEW)

This is ready for production deployment.
```

**Prompt for users running this workflow:**

```
You are Alice, a code implementation specialist.
Your job is to implement features following best practices.

When you've completed implementation:
1. Summarize what you built
2. Emit [pass_over: audit] to request code review
3. Wait for audit feedback
4. Address the findings
5. Continue with deployment

Use [pass_over: audit] when ready for review.
Use [return_to: alice] when audit finishes.
```

---

### Example 2: Complex Feature Implementation

**Scenario**: Implementing a complex feature that needs design review, implementation, testing, and final review.

**Configuration Setup:**

```bash
# Enable auto-confirm for alice → design (saves one confirmation)
vuhitracode agent pass-over set-pair alice design \
  --auto-confirm true

# Longer timeout for testing (tests take time)
vuhitracode agent pass-over set-pair alice tester \
  --timeout-ms 180000

# Final review requires manual confirmation
vuhitracode agent pass-over set-pair alice reviewer \
  --auto-confirm false

# Increase chain depth to allow: alice → design → alice → tester → alice → reviewer → alice
vuhitracode agent pass-over set-global --max-chain-depth 5
```

**Workflow Steps:**

```
Step 1: Alice → Design
Alice: Design a new recommendation engine
[pass_over: design]

Step 2: Design Agent Works
Design: Reviewing architecture requirements...
[return_to: alice]

Step 3: Alice → Tester
Alice: Implement based on design approval
[pass_over: tester]

Step 4: Tester Runs Tests
Tester: Running integration tests...
[return_to: alice]

Step 5: Alice → Reviewer
Alice: Final review before production
[pass_over: reviewer]

Step 6: Reviewer Final Check
Reviewer: [Manual confirmation needed]
✓ Approved for production
[return_to: alice]

Step 7: Alice Deploys
Alice: Deploying to production...
✓ Deployment complete
```

**Prompt for complex workflows:**

```
You are Alice, implementing a recommendation engine.

Follow this workflow:
1. Design phase: [pass_over: design]
   - Wait for architecture approval

2. Implementation: Code according to approved design

3. Testing: [pass_over: tester]
   - Wait for test results

4. Fix any test failures

5. Final Review: [pass_over: reviewer]
   - Wait for production approval

6. Deploy when approved

Track each stage and emit pass-over tags at the right time.
```

---

### Example 3: Multi-Agent Collaboration

**Scenario**: Scout explores the codebase, Alice processes findings, Plan validates approach.

**Setup:**

```bash
# Scout can take a long time exploring
vuhitracode agent pass-over set-pair alice scout \
  --timeout-ms 180000 \
  --auto-confirm false

# Plan needs to validate quickly
vuhitracode agent pass-over set-pair alice plan \
  --timeout-ms 30000 \
  --auto-confirm true

# Allow deeper chains for exploration
vuhitracode agent pass-over set-global --max-chain-depth 5
```

**Workflow:**

```
User: Audit the codebase for security issues

Step 1: Alice delegates to Scout
Alice: I need a security audit of the codebase
[pass_over: scout]
Reason: security_audit
Timeout: 180000ms

Step 2: Scout Explores
Scout: Scanning for security issues...
- Checking for exposed credentials
- Looking for SQL injection patterns
- Verifying authentication flows
- Checking encryption usage
- Analyzing dependency vulnerabilities

Findings:
✗ 3 hardcoded API keys in config files
✗ SQL queries missing parameterization (2 places)
✗ Weak password validation regex
✓ Good: HTTPS enforced
✓ Good: CSRF tokens used consistently

[return_to: alice]

Step 3: Alice Processes Findings
Alice: Scout found 3 critical security issues!

Priority fix list:
1. Remove hardcoded keys → Use environment variables
2. Fix SQL queries → Use parameterized queries
3. Improve password validation → Use strong regex

Now I'll validate the approach with Plan.

[pass_over: plan]
Reason: validate_security_fixes

Step 4: Plan Validates
Plan: Reviewing security fix approach...
✓ Environment variables approach is standard
✓ Parameterized queries will work
✓ Password validation regex is strong
✓ No conflicts with existing architecture

Ready to proceed.
[return_to: alice]

Step 5: Alice Implements
Alice: Proceeding with security fixes...
- Removed 3 hardcoded keys
- Fixed 2 SQL queries with parameterization
- Updated password validation

Files modified:
- src/config.ts (security)
- src/database/queries.ts (security)
- src/auth/validation.ts (security)

Security audit complete! ✓
```

**Prompt for Scout:**

```
You are Scout, an expert code auditor.

Your job:
1. Scan the codebase for security issues
2. Check for performance problems
3. Look for code quality issues
4. Identify technical debt

When you've completed your audit:
1. List all findings (critical first)
2. Suggest fixes
3. Emit [return_to: alice]

Be thorough. Alice will process your findings.
```

---

## Next Steps

- **See also**: `pass-over-developer-guide.md` for implementing pass over in agents
- **Reference**: `pass-over-feature-architecture.md` for deep technical details
- **Quick lookup**: `pass-over-quick-reference.md` for tables and quick patterns
