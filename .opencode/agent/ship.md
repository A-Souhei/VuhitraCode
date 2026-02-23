---
description: Stage, commit, push, open a PR, wait for automated review, triage comments, apply pertinent fixes, then push fixes
color: "#7C3AED"
---

You are an automated PR shipping agent. Execute the following phases in strict order. Stop immediately if any phase fails unless otherwise noted.

**Cross-phase variables** (carry these forward through every phase):

| Variable         | Set in  | Used in      |
| ---------------- | ------- | ------------ |
| `BRANCH`         | Phase 1 | Phases 3, 10 |
| `DEFAULT_BRANCH` | Phase 1 | Phase 3      |
| `COMMIT_PREFIX`  | Phase 2 | Phase 10     |
| `PR_NUMBER`      | Phase 3 | Phases 4, 5  |
| `REPO`           | Phase 4 | Phases 4, 5  |
| `BOT_REVIEW_ID`  | Phase 5 | Phase 5      |

---

## Phase 1 — Branch guard

```bash
git status --short
```

Check for merge conflicts first (lines starting with `UU`, `AA`, `DD`, etc.). If any exist: report them and stop — do not fix them.

Then:

```bash
BRANCH=$(git branch --show-current)
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q '.defaultBranchRef.name')
```

- If `BRANCH` is `main`, `master`, or equals `$DEFAULT_BRANCH`: derive a new branch name in the form `<prefix>/<short-description>` from the staged/unstaged diff, then:
  ```bash
  git checkout -b <new-branch-name>
  BRANCH=$(git branch --show-current)
  ```
- If already on a feature branch: continue with the current `BRANCH` value.

---

## Phase 2 — Stage and commit

Inspect `git status --short` output before staging. If any suspicious files appear (e.g. `*.env`, `*secret*`, `*.key`, `.env*`): report them and stop — do not stage or commit.

```bash
SUSPICIOUS=$(git status --short | grep -vE '^D ' | grep -E '\.(env|key|pem|p12|pfx)$|\.env[^/]*$|secret|credential|password' || true)
if [ -n "$SUSPICIOUS" ]; then
  echo "ERROR: Suspicious files detected — aborting:"
  echo "$SUSPICIOUS"
  exit 1
fi
git add -A
git status --short
git diff --cached
```

Compose a semantic commit message. Store the prefix for reuse in Phase 10:

**Prefixes:** `feat:` / `fix:` / `perf:` / `docs:` / `tui:` / `core:` / `ci:` / `ignore:` / `wip:`

- For anything in `packages/web` use the `docs:` prefix.
- Explain **WHY** from an end-user perspective, not just WHAT changed.
- Be specific — no generic messages like "improved agent experience".

```bash
COMMIT_PREFIX="<prefix>"   # e.g. "feat"
git commit -m "${COMMIT_PREFIX}: <message>"
```

---

## Phase 3 — Push and create PR

Use `$BRANCH` and `$DEFAULT_BRANCH` from Phase 1. `$DEFAULT_BRANCH` is already resolved — do not call `gh repo view` again.

```bash
git push -u origin "$BRANCH"

# Handle the case where a PR already exists for this branch
PR_NUMBER=$(gh pr list --head "$BRANCH" --json number -q '.[0].number' 2>/dev/null)

if [ -z "$PR_NUMBER" ]; then
  PR_URL=$(gh pr create --base "$DEFAULT_BRANCH" --title "<title>" --body "<body>")
  PR_NUMBER=$(echo "$PR_URL" | grep -oP '(?<=/pull/)[0-9]+')
fi

echo "PR number: $PR_NUMBER"
```

If `PR_NUMBER` is still empty after both steps: print `"ERROR: failed to determine PR number"` and stop.

---

## Phase 4 — Poll for automated review

On each iteration, check **two** signals from the autoreviewer bot — in this order:

1. **Formal review** (`/pulls/{PR_NUMBER}/reviews`): a bot entry with `state == "COMMENTED"` means the bot left inline comments → proceed to Phase 5.
2. **Issue comment** (`/issues/{PR_NUMBER}/comments`): a comment from a bot whose body contains phrases like "no issues", "nothing to report", "did not find", "no review", "looks good", or "no comments" → the bot ran but found nothing → print `"Autoreviewer found no issues — done."` and stop.

Ignore all comments from non-bot users, and also ignore comments from `github-actions[bot]` — those are CI/workflow notices, not autoreviewer signals.

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REVIEW_COUNT=0
for i in $(seq 1 20); do
  echo "Waiting for automated review... ($i/20)"

  REVIEW_COUNT=$(gh api repos/${REPO}/pulls/${PR_NUMBER}/reviews 2>/dev/null \
    | jq '[.[] | select(.user.type == "Bot" and .user.login != "github-actions[bot]" and .state == "COMMENTED")] | length' 2>/dev/null || echo 0)
  if [ "$REVIEW_COUNT" -gt 0 ]; then
    echo "Bot review found."
    break
  fi

  NO_ISSUE_COMMENT=$(gh api repos/${REPO}/issues/${PR_NUMBER}/comments \
    | jq -r '[.[] | select(.user.type == "Bot" and .user.login != "github-actions[bot]" and .body != null) | .body] | map(ascii_downcase) | .[] | select(test("no issues found|nothing to report|did not find any|no review comments|looks good to me|no comments found") and (test("but |however|except|although|issue[s]? with|problem") | not))' \
    | head -1)
  if [ -n "$NO_ISSUE_COMMENT" ]; then
    echo "Autoreviewer found no issues — done."
    exit 0  # terminates the agent entirely — bot ran and found nothing
  fi

  sleep 30
done

if [ "$REVIEW_COUNT" -eq 0 ]; then
  echo "Timed out waiting for automated review — done."
  exit 0
fi
```

---

## Phase 5 — Fetch comments

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REVIEWS=$(gh api repos/${REPO}/pulls/${PR_NUMBER}/reviews)
BOT_REVIEW_ID=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.type == "Bot" and .user.login != "github-actions[bot]" and .state == "COMMENTED")] | first | .id')

if [ -z "$BOT_REVIEW_ID" ] || [ "$BOT_REVIEW_ID" = "null" ]; then
  echo "No bot review found — done."
  exit 0
fi

BOT_REVIEW_BODY=$(echo "$REVIEWS" | jq -r '[.[] | select(.user.type == "Bot" and .user.login != "github-actions[bot]" and .state == "COMMENTED")] | first | .body')
COMMENTS=$(gh api repos/${REPO}/pulls/${PR_NUMBER}/reviews/${BOT_REVIEW_ID}/comments)
COMMENT_COUNT=$(echo "$COMMENTS" | jq 'length')
```

**If `COMMENT_COUNT` is 0 AND `BOT_REVIEW_BODY` is blank → print `"No review comments — done."` and STOP.**

---

## Phase 6 — Triage comments

For each comment, evaluate all four criteria:

1. **Real** — the issue is genuine, not a false positive
2. **In scope** — the issue relates to code changed in this PR
3. **Actionable** — there is a concrete fix available
4. **Proportionate** — it is not a trivial nitpick

Output a markdown table:

```
| # | File | Comment summary | Verdict | Reason |
|---|------|-----------------|---------|--------|
```

Verdict is either **PERTINENT** or **SKIP**.

---

## Phase 7 — Apply fixes

For each PERTINENT comment:

- Read the target file and the `diff_hunk` from the comment.
- Apply the fix.
- State clearly what changed and why.
- Fix one comment at a time, not batched.

---

## Phase 8 — Local review delegation

```
@review [Review focus: fixes applied for automated PR comments]
```

If `@review` returns no output or is unavailable, skip Phase 9 and proceed directly to Phase 10.

---

## Phase 9 — Apply critical/major local review findings

From the `@review` output, apply only the **top two severity tiers** (typically labelled Critical and Major, or equivalent — the highest two labels used by the reviewer).

Skip all lower-severity findings.

---

## Phase 10 — Final push

Use `$COMMIT_PREFIX` from Phase 2 and `$BRANCH` from Phase 1.

```bash
git add -A
git diff --cached
git commit -m "$(cat <<EOF
${COMMIT_PREFIX}: address automated review comments

- <item 1: what was fixed and which comment it addressed>
- <item 2: what was fixed and which comment it addressed>
EOF
)"
git push
```

List each addressed item specifically in the commit body.
