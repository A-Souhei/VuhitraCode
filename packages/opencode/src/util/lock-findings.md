# Audit Findings: `util/lock.ts`

Reviewed by the `inspect` subagent. File: `/home/toavina/Apps/opencode/packages/opencode/src/util/lock.ts`

---

## [critical] Stale lock reference after key deletion and recreation

**Location:** `lock.ts`, dispose closures in `read()` / `write()`

**Description:** The dispose closures capture the `lock` object by reference at acquisition time. If the lock entry is deleted from the Map (via the cleanup in `process()`) and then re-created by a subsequent `get()` call before the original dispose runs, `lock.readers--` (or `lock.writer = false`) decrements the **old stale object**, not the new Map entry. Meanwhile `process(key)` resolves the new object. The new lock's counters are never decremented, leaving it permanently stuck — writers can never acquire it.

**Fix:** Pass the captured `lock` object directly into `process()` instead of re-resolving by key. Change `process(key: string)` to `process(key: string, lock: LockState)` and update all call sites.

---

## [critical] Cleanup block inside `process()` is unreachable from the reader-wakeup path

**Location:** `lock.ts`, lines 46–49

**Description:** After the `while` loop drains `waitingReaders` (lines 41–44), each callback does `lock.readers++` synchronously. So by the time the cleanup check runs, `lock.readers > 0` — the condition is always false on this path. The cleanup only ever fires from dispose callbacks when the lock goes fully idle (no readers, no writer, no waiters) — which is the correct path. But the cleanup block inside the reader-wakeup section is dead code and creates confusion.

**Fix:** Remove the cleanup block from inside `process()` after the reader wakeup loop. Move cleanup responsibility entirely into the dispose callbacks.

---

## [major] Exception in a waiter callback causes permanent deadlock

**Location:** `lock.ts`, `process()` function

**Description:** If a callback in `waitingWriters` or `waitingReaders` throws, `process()` aborts mid-execution. The lock state becomes inconsistent: the Map entry exists but is neither held nor progressing. All subsequent callers waiting on this key will deadlock.

**Fix:** Wrap `nextWriter()` / `nextReader()` calls in error isolation. Since the style guide discourages `try/catch`, consider using `queueMicrotask` or `Promise.resolve().then(cb)` to isolate callback exceptions from `process()`.

---

## [major] Reader starvation is unbounded under sustained write pressure

**Location:** `lock.ts`, lines 33–38 and line 60

**Description:** The JSDoc says "prioritizes writers to prevent starvation" — but this actually enables **reader starvation**. Once any writer is queued (`waitingWriters.length > 0`), new readers always enqueue. `process()` always picks the next writer first. A continuous stream of writers means waiting readers never get the lock.

**Fix:** Document clearly that writers take absolute priority and readers may starve. If fairness is required, implement a generation counter or promotion strategy (e.g. promote all current waiting readers when a new writer is granted, preventing new writers from jumping them).

---

## [minor] `nextWriter` and `nextReader` are single-use variables

**Location:** `lock.ts`, lines 35–36 and 42–43

**Description:** The style guide requires inlining values used only once.

**Fix:**

```ts
// Before
const nextWriter = lock.waitingWriters.shift()!
nextWriter()

// After
lock.waitingWriters.shift()!()
```

Same for `nextReader`.

---

## [minor] `process` shadows the Node.js global `process` object

**Location:** `lock.ts`, line 29

**Description:** The private helper `process` shadows Node's well-known global within this module's scope. While TypeScript scopes it correctly inside the namespace, it is surprising to readers and could confuse linters.

**Fix:** Rename to `schedule`, `wake`, or `drain`.

---

## [minor] No test coverage

**Location:** No `lock.test.ts` found.

**Description:** This is a non-trivial concurrency primitive used for real file I/O coordination (in `storage.ts`). A bug here causes data corruption or deadlocks that are hard to reproduce.

**Fix:** Add `packages/opencode/src/util/lock.test.ts` covering: concurrent reads allowed, reader blocks writer, writer blocks reader, writer priority over waiting readers, lock cleanup after full release.

---

## [suggestion] JSDoc on `read()` / `write()` is overly mechanical

**Location:** `lock.ts`, lines 52–55 and 82–85

**Description:** The comments explain how `Disposable` works rather than what the function does semantically. The return type already communicates the mechanical detail.

**Fix:** Shorten to a single semantic sentence, e.g.:

- `read()`: _"Acquires a shared read lock for the given key. Resolves immediately unless a writer holds or is waiting."_
- `write()`: _"Acquires an exclusive write lock for the given key. Resolves when no readers or writers are active."_

---

## [suggestion] `process()` re-looks up the lock object by key

**Location:** `lock.ts`, lines 29–31

**Description:** Callers (`read`, `write`) already hold the `lock` reference. Passing the key and re-doing `locks.get(key)` is redundant and contributes to the stale-reference risk described above.

**Fix:** Change signature to `process(key: string, lock: LockState)` and pass the captured reference directly.

---

_Generated: 2026-02-26_
