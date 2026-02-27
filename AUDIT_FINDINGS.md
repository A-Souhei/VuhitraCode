# GITIGNORE FILE PROCESSING AUDIT REPORT

## AUDIT SCOPE
Two additional entry points where gitignored files are processed:
1. User message attachments (session/prompt.ts)
2. Code indexing (indexer.ts)

Plus analysis of other potential entry points: read.ts, glob.ts, grep.ts

---

## FINDINGS

### 1. ATTACHMENT HANDLING (session/prompt.ts, lines 1248-1262)

**Code Location:** Lines 1248-1262 in `packages/opencode/src/session/prompt.ts`

**What happens:**
- When a file:// URL attachment is processed in a message
- After handling text/plain (lines 1105-1209)
- After handling application/x-directory (lines 1212-1245)
- For any remaining file type (typically binary)

**Current Logic:**
```typescript
if (await isGitignored(filepath)) {
  const rel = path.relative(Instance.worktree, filepath)
  const guidance = Env.get("OLLAMA_MODEL")
    ? `Use the @secret agent (task tool with subagent_type="secret") to analyze it privately.`
    : `This file is gitignored and contains binary content that cannot be faked. Remove it from the context.`
  return [{
    messageID: info.id,
    sessionID: input.sessionID,
    type: "text",
    synthetic: true,
    text: `Attachment blocked: "${rel}" is gitignored (private). Binary content cannot be included in context. ${guidance}`,
  }]
}

// Falls through to include raw binary content
FileTime.read(input.sessionID, filepath)
return [{...}, {type: "file", url: `data:${part.mime};base64,...`}]
```

✗ [FAIL] **CRITICAL INCONSISTENCY DETECTED**

The code BLOCKS gitignored files from being included, which is good. However:

1. **Wrong Message:** The message says "contains binary content" but the code flows through for ANY file type that isn't text/plain or directory. A gitignored .json file or .env file would be binary-blocked even though it could be faked.

2. **Unreachable Faking for Text:** If a gitignored TEXT file reaches this point (1248), it's blocked as "binary content" - but read.ts HAS faker support for text files. This blocks legitimate gitignored text files unnecessarily.

3. **Control Flow Issue:** The directory check (lines 1212-1245) handles directories but then falls through to the gitignore check. Text files from ReadTool execution (lines 1105-1209) also fall through. Any file type that's not text/plain or directory gets blocked here as "binary".

**Specific Issues:**
- Line 1252: Message wrongly assumes binary content
- No attempt to fake gitignored text attachments (unlike read.ts)
- Binary files ARE correctly blocked (cannot be faked)

---

### 2. INDEXER HANDLING (indexer.ts)

**Code Locations:**
- Lines 280-282: `indexFile()` function - gitignore check and faker application
- Lines 406: `buildIgnoreChecker()` builds gitignore cache
- Lines 261-320: Full indexing flow

**Current Logic:**
```typescript
async function indexFile(...) {
  ...
  let content = await fs.promises.readFile(filePath, "utf-8")
  const ignored = isIgnored ? isIgnored(filePath) : await isGitignored(filePath)
  if (ignored) {
    content = await Faker.fakeContent(content, filePath)  // LINE 282
  }
  const chunks = chunkFile(content, filePath)
  ...
  const results = await mapParallel(chunks, 10, async (chunk) => {
    const vector = await embed(`File: ${filePath}\n\n${chunk.text}`, signal)
    return {
      id: chunk.id,
      vector,
      payload: {
        file_path: filePath,      // REAL filepath
        text: chunk.text,         // FAKED content
        start_line: chunk.startLine,
        mtime: stat.mtimeMs,
      },
    }
  }, signal)
  
  await upsertPoints(points)  // Uploads to Qdrant
}
```

✓ [PASS] **FAKING APPLIED CORRECTLY**
- Line 280: Gitignore check performed
- Line 282: Faker applied to content BEFORE chunking
- Line 284: Chunks are created from faked content
- Line 293: Embeddings are created from faked content
- Line 299: Metadata includes real filepath (safe - not sensitive)

**BUT:**

⚠ [WARN] **POTENTIAL METADATA LEAK**
- Line 298: `file_path: filePath` stores the actual file path in the index
- If a gitignored file at `.env.secret` or `aws/credentials.json` is indexed, the metadata reveals:
  - The existence of sensitive files
  - Directory structure of secrets
  - File names that may expose infrastructure details

**Recommendation:** Consider if file paths in indexed metadata should be generic or redacted for gitignored files.

✓ [PASS] **FAKING HAPPENS BEFORE EMBEDDING**
- Faking at line 282
- Chunking at line 284
- Embedding at line 293
- Correct order ✓

---

### 3. READ TOOL (read.ts)

**Code Locations:**
- Lines 76-91: Gitignore check and conditional faking
- Lines 245-250: Faker application
- Lines 274-276: Privacy notice

✓ [PASS] **COMPREHENSIVE PROTECTION**

1. **Gitignore Check:** Lines 78-79
2. **OLLAMA Redirect:** Lines 80-87 - directs to @secret if OLLAMA_MODEL enabled
3. **Faking Applied:** Lines 245-250 - Faker.fakeContent() called
4. **Symlink Handling:** Lines 49-59 - resolves and checks targets
5. **Binary File Handling:** Lines 176-194 - images/PDFs handled correctly
6. **Directory Listing Protection:** Lines 117-167 - doesn't reveal gitignored content

---

### 4. GLOB TOOL (glob.ts)

**Code Location:** Lines 39-54

✓ [PASS] **RESPECTS GITIGNORE BY DEFAULT**
- Uses Ripgrep.files()
- No `--no-ignore` flag used
- Gitignored files are NOT returned in glob results

---

### 5. GREP TOOL (grep.ts)

**Code Location:** Lines 41-45

⚠ [WARN] **POTENTIAL ISSUE - GREP SHOWS REAL CONTENT**

```typescript
const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
// No --no-ignore, so ripgrep respects .gitignore
// BUT confirmation needed: does ripgrep return gitignored file content?
```

Grep tool returns matching lines from files:
```typescript
for (const match of finalMatches) {
  outputLines.push(`${match.path}:`)
  outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)  // REAL CONTENT!
}
```

**Issue:** If ripgrep returns gitignored file content, secrets would be exposed.
**Verification Needed:** Test whether `rg --hidden "pattern" dir/` includes gitignored files.

---

## CONSISTENCY VERIFICATION

| Entry Point | Gitignore Check | Faking Applied | Error Message | Safe? |
|---|---|---|---|---|
| read.ts | ✓ Line 78 | ✓ Line 246 | Clear, directs to @secret | YES ✓ |
| indexer.ts | ✓ Line 280 | ✓ Line 282 | N/A (no error) | YES ✓ |
| prompt.ts | ✓ Line 1248 | ✗ **MISSING** | Says "binary" always | NO ✗ |
| glob.ts | ✓ Ripgrep default | N/A (paths only) | N/A | YES ✓ |
| grep.ts | ✓ Ripgrep default | N/A (content shown) | N/A | ⚠ VERIFY |

---

## ANSWER: ARE ALL ENTRY POINTS PROTECTED?

### **NO** ✗

**Critical Gaps:**

1. **✗ [FAIL] Attachment handling (prompt.ts, lines 1248-1262)**
   - Gitignored TEXT files blocked instead of faked
   - Inconsistent with read.ts behavior
   - SEVERITY: HIGH

2. **⚠ [WARN] Indexer metadata leaks (indexer.ts, line 298)**
   - Real file paths stored in search index
   - Directory structure of secrets exposed
   - SEVERITY: MEDIUM

3. **⚠ [WARN] Grep tool needs verification (grep.ts)**
   - Need to confirm ripgrep respects gitignore in all cases
   - Current code: returns real content from matches
   - SEVERITY: HIGH (IF ripgrep returns gitignored content)

---

## DETAILED FINDINGS BY ENTRY POINT

### ENTRY POINT 1: User Message Attachments

**File:** `packages/opencode/src/session/prompt.ts`

**Lines 1248-1262:** Gitignore check for file:// attachments

```typescript
if (await isGitignored(filepath)) {
  const rel = path.relative(Instance.worktree, filepath)
  const guidance = Env.get("OLLAMA_MODEL")
    ? `Use the @secret agent (task tool with subagent_type="secret") to analyze it privately.`
    : `This file is gitignored and contains binary content that cannot be faked. Remove it from the context.`
  return [{...}]  // BLOCKS ALL GITIGNORED FILES
}

// If not gitignored, includes binary file as base64
FileTime.read(input.sessionID, filepath)
return [{type: "file", url: `data:${part.mime};base64,...`}]
```

**Test Case 1: User attaches .env file (gitignored, text)**
- Current behavior: BLOCKED with "binary content" message
- Expected behavior: Should be faked (like read.ts does)
- Gap: No attempt to fake text files

**Test Case 2: User attaches .jpg file (gitignored, binary)**
- Current behavior: BLOCKED ✓
- Expected behavior: BLOCKED ✓
- Status: CORRECT

**Test Case 3: User attaches non-gitignored .json file**
- Current behavior: INCLUDED as base64 ✓
- Expected behavior: INCLUDED as base64 ✓
- Status: CORRECT

---

### ENTRY POINT 2: Code Indexing

**File:** `packages/opencode/src/indexer/index.ts`

**Lines 261-320:** `indexFile()` function

**Flow:**
1. Line 280: Check if file is gitignored
2. Line 282: If ignored, apply faker to content
3. Line 284: Create chunks from faked content
4. Line 293: Create embeddings from faked content + filepath
5. Line 298-302: Store in Qdrant with payload
6. Line 316: Upsert points to database

**Test Case 1: Gitignored .env file indexed**
- Content: FAKED ✓
- Embeddings: From faked content ✓
- Metadata: Real filepath stored (potential leak)
- Status: CONTENT PROTECTED ✓, METADATA EXPOSED ⚠

**Test Case 2: Non-gitignored .py file indexed**
- Content: REAL ✓
- Embeddings: From real content ✓
- Status: CORRECT ✓

**Test Case 3: Search results for gitignored file**
- User queries: "database"
- Result shows: file_path = ".vuhitra/secrets/prod_db_creds.yml"
- Gap: Directory structure of secrets exposed

---

## RECOMMENDATIONS

### Priority 1: URGENT

**Fix attachment handling to apply faker to gitignored text files**
- Location: `packages/opencode/src/session/prompt.ts`, lines 1248-1262
- Action: Apply Faker.fakeContent() to text files before blocking
- Align with read.ts behavior
- Import Faker module
- Check file extension to determine if fakeable

### Priority 2: HIGH

**Verify grep tool behavior with gitignored files**
- Location: `packages/opencode/src/tool/grep.ts`
- Action: Test whether ripgrep returns content from gitignored files
- Test command: `echo "secret" > .env.test && rg --hidden "secret" dir/`
- If yes: Add `--no-ignore=false` or filter results
- If no: Document that ripgrep respects gitignore ✓

### Priority 3: MEDIUM

**Mask gitignored file paths in search results**
- Location: `packages/opencode/src/indexer/index.ts`, line 298
- Action: Add `file_path_display` field with masked path for gitignored files
- Store real path internally for tracking
- Return masked path in search results

### Priority 4: LOW

**Standardize error messages across entry points**
- read.ts: "Access denied: ... is gitignored"
- prompt.ts: "Attachment blocked: ... contains binary content"
- Align messages for consistency

---

## SUMMARY TABLE

```
FINDINGS:
┌────────────────────┬──────────────┬──────────────┬──────────┐
│ Entry Point        │ Check        │ Fake         │ Status   │
├────────────────────┼──────────────┼──────────────┼──────────┤
│ read.ts            │ ✓ Line 78    │ ✓ Line 246   │ PASS ✓   │
│ indexer.ts         │ ✓ Line 280   │ ✓ Line 282   │ PASS ✓*  │
│ prompt.ts          │ ✓ Line 1248  │ ✗ MISSING    │ FAIL ✗   │
│ glob.ts            │ ✓ Ripgrep    │ N/A          │ PASS ✓   │
│ grep.ts            │ ✓ Ripgrep    │ N/A          │ WARN ⚠   │
└────────────────────┴──────────────┴──────────────┴──────────┘
* Metadata leak possible
⚠ Needs verification
```

---

## ANSWER

**Are ALL entry points protected?**

### **NO** ✗

**Protected:**
- ✓ read.ts - fully protected with faking
- ✓ indexer.ts - content protected, metadata exposed
- ✓ glob.ts - respects gitignore
- ⚠ grep.ts - needs verification

**NOT Protected:**
- ✗ prompt.ts - gitignored text files blocked instead of faked (inconsistent)
- ⚠ indexer.ts metadata - directory structure of secrets exposed
- ⚠ grep.ts - potential to show real content (needs verification)

**Action Required:** Fix 3 gaps identified above
