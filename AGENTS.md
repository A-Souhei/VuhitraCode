- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## VCS Operations — Mandatory Delegation

**NEVER run git, gh, svn, or hg commands yourself.** You do not have permission to execute VCS commands. Any attempt to run `git`, `gh`, `svn`, or `hg` will be automatically denied.

Instead, ALWAYS delegate VCS work to the `chores` subagent via the Task tool:

```
Task(
  description="<short description of VCS op>",
  prompt="<full description of what VCS operation to perform and any relevant context>",
  subagent_type="chores"
)
```

This applies to ALL VCS operations without exception:

- Reading state: `git status`, `git log`, `git diff`, `git show`, `gh pr view`, etc.
- Mutations: `git add`, `git commit`, `git push`, `git pull`, `git rebase`, `git merge`, `git stash`, etc.
- PR workflow: `gh pr create`, `gh pr merge`, `gh pr list`, etc.
- Branching: `git branch`, `git checkout`, `git switch`, etc.

The `chores` subagent is the sole authorized agent for version control. It will execute the operation and return the result to you.

> **Exception**: If YOU are the `chores` subagent, you ARE authorized to run `git`, `gh`, `svn`, and `hg` commands directly. The above delegation rule applies to all OTHER agents delegating TO you — not to your own execution.
