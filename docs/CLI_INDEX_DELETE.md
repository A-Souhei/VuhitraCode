# opencode indexer delete Command

User guide for the `opencode indexer delete` CLI command.

## Table of Contents

1. [Purpose](#purpose)
2. [When to Use](#when-to-use)
3. [Quick Start](#quick-start)
4. [Command Syntax](#command-syntax)
5. [Options](#options)
6. [Safety Confirmation](#safety-confirmation)
7. [What Happens Next](#what-happens-next)
8. [HTTP API Equivalent](#http-api-equivalent)
9. [Troubleshooting](#troubleshooting)
10. [Examples](#examples)

---

## Purpose

The `opencode indexer delete` command permanently removes all vector embeddings and index data for your project from the vector database (Qdrant). This allows you to:

- **Switch embedding providers** (e.g., from one API to another)
- **Change embedding models** (e.g., upgrading to a newer, more capable model)
- **Reconfigure indexing settings** without keeping stale embeddings
- **Recover from a corrupted index**
- **Reduce storage usage** by clearing cached embeddings you no longer need
- **Reset your project's search capabilities** for a fresh start

The deletion is **permanent** (within OpenCode) and **immediate**—the vector index data cannot be recovered through OpenCode after deletion. However, the indexer will automatically regenerate the index on your next use of the system.

⚠️ **Important Note on Backups:** If your Qdrant instance has snapshots or backups configured, those may still retain the deleted data. Consult your [Qdrant deployment documentation](https://qdrant.tech/documentation/guides/backup/) for information about data retention policies and backup management.

---

## When to Use

### ✅ Good Use Cases

**Switching Embedding Providers**

```
Old Setup: Using Provider A for embeddings
New Setup: Switching to Provider B with better quality/cost

→ Use: opencode indexer delete
```

After deletion, the indexer will re-embed your codebase using Provider B on next use.

**Upgrading to a Better Model**

```
Old Embeddings: Using model-v1 (768 dimensions)
New Embeddings: Upgrading to model-v2 (1024 dimensions, better quality)

→ Use: opencode indexer delete
```

The old embeddings won't work with the new model anyway, so deletion clears space and ensures clean re-indexing.

**Recovering from Corruption**

```
Symptoms: Search results are inaccurate, index operations are failing

→ Use: opencode indexer delete
→ The indexer will rebuild from scratch on next use
```

**Bulk Configuration Changes**

```
Updating multiple indexing settings or embedding parameters

→ Use: opencode indexer delete
→ Ensures all settings apply uniformly across a fresh index
```

### ❌ When NOT to Use

- **You just need to search**: The index is automatically maintained; no deletion needed
- **Temporary performance issues**: First try restarting the service
- **Debugging**: Consider running with verbose logging instead
- **Regular maintenance**: Not required—the indexer self-maintains

---

## Quick Start

### Basic Usage (With Confirmation)

```bash
opencode indexer delete
```

You'll be prompted to confirm before deletion proceeds:

```
✔ Delete all index data for this project? This will be re-indexed on next use.
· yes / no
```

### Skip Confirmation (Automated Runs)

Use the `--force` flag to skip the confirmation prompt:

```bash
opencode indexer delete --force
```

Useful for CI/CD pipelines or scripted operations where user input isn't available.

---

## Command Syntax

```bash
opencode indexer delete [OPTIONS]
```

### Arguments

None—the command operates on the current project automatically.

### Return Codes

- **0**: Index successfully deleted
- **1**: Deletion failed (check error message for details)

---

## Options

### `--force` / `-f`

**Type:** Boolean flag  
**Default:** `false`  
**Description:** Skip the confirmation prompt and proceed directly to deletion.

**When to Use:**

- Automated scripts and CI/CD pipelines
- Unattended operations
- Batch processing

**Example:**

```bash
opencode indexer delete --force
```

**Note:** Even with `--force`, if the deletion fails (e.g., Qdrant connection error), the command will exit with code 1 and print an error message.

---

## Safety Confirmation

By default, `opencode indexer delete` requires explicit user confirmation before proceeding.

### The Confirmation Prompt

```
✔ Delete all index data for this project? This will be re-indexed on next use.
· yes / no
```

### User Actions

- **Press `y` or `Enter` to confirm**: Proceeds with deletion
- **Press `n` to decline**: Cancels the operation—no data is deleted
- **Press `Ctrl+C` to cancel**: Cancels the operation and exits

### Why Confirmation?

Index deletion is a destructive operation. The confirmation serves as a **defense-in-depth** safeguard to:

1. **Prevent accidental deletions** from typos or misunderstandings
2. **Give users a moment to reconsider** before permanent action
3. **Ensure intentional operations** in critical environments
4. **Provide UX clarity** about what's about to happen

---

## What Happens Next

### During Deletion

1. Command validates your project configuration
2. Connects to Qdrant (or other configured vector database)
3. Deletes the project's collection/index
4. Resets the indexer status to `disabled`

### After Deletion

The indexer automatically handles regeneration:

1. **On next operation** requiring search or codebase analysis:
   - The system detects the index is disabled
   - Automatically triggers a re-index pass
   - Re-embeds all files in your codebase with current settings
2. **Progress feedback** is shown during re-indexing
3. **Transparent recovery** - once complete, everything works as before

**Timeline:**

- Small projects (< 1,000 files): ~1-5 minutes
- Medium projects (1,000-10,000 files): ~5-30 minutes
- Large projects (10,000+ files): 30+ minutes

The exact time depends on:

- Number of files in your codebase
- File sizes
- Embedding model complexity
- Your network connection (if using remote Qdrant)

---

## HTTP API Equivalent

For programmatic access or integration with other tools, use the HTTP API:

### Endpoint

```http
DELETE /indexer/data
```

### Required Header

```http
X-Confirm-Deletion: true
```

The `X-Confirm-Deletion` header is required and acts as explicit confirmation for API clients (similar to the CLI prompt).

### Example Request

```bash
curl -X DELETE http://localhost:4096/indexer/data \
  -H "X-Confirm-Deletion: true"
```

### Responses

| Status | Description                 |
| ------ | --------------------------- |
| 204    | Index deleted successfully  |
| 400    | Missing confirmation header |
| 500    | Server error (check logs)   |

### Example Success Response

```bash
$ curl -X DELETE http://localhost:4096/indexer/data \
  -H "X-Confirm-Deletion: true" \
  -w "\nStatus: %{http_code}\n"

Status: 204
```

### Example Failure (Missing Header)

```bash
$ curl -X DELETE http://localhost:4096/indexer/data

{"error":"Requires X-Confirm-Deletion: true header"}
Status: 400
```

---

## Troubleshooting

### "Failed to delete index: Connection refused"

**Cause:** The vector database (Qdrant) is not running or unreachable.

**Solution:**

1. Check that Qdrant is running:
   ```bash
   # If using Docker
   docker ps | grep qdrant
   ```
2. Verify the Qdrant URL in your environment:
   ```bash
   echo $QDRANT_URL
   # Default: http://localhost:6333
   ```
3. If using remote Qdrant, verify network connectivity
4. Restart Qdrant if needed, then retry

**Example:**

```bash
# Start Qdrant locally (Docker)
docker run -p 6333:6333 \
  -e QDRANT__HTTP_PORT=6333 \
  qdrant/qdrant

# Then retry
opencode indexer delete --force
```

### "Failed to delete index: 401 Unauthorized"

**Cause:** Qdrant authentication failed (if using auth-enabled Qdrant).

**Solution:**

1. Verify your API key or credentials:
   ```bash
   echo $QDRANT_API_KEY
   ```
2. Ensure credentials match your Qdrant setup
3. Check Qdrant logs for detailed auth errors

### "Failed to delete index: 404 Not Found"

**Cause:** The index collection doesn't exist (already deleted).

**Solution:**

- This is actually safe to ignore! The index is already gone.
- If you see this, the index was previously deleted or never existed.
- Re-indexing will proceed normally on next use.

**Note:** The CLI treats 404 as a success case automatically.

### "Cancelled"

**Cause:** You declined the confirmation prompt.

**Solution:**

- Run the command again if deletion was desired
- No data was deleted, so you can safely retry

### Command Hangs or Takes Very Long

**Cause:** Qdrant is slow to respond (network latency, large collection).

**Solution:**

1. Wait up to 30 seconds (timeout limit)
2. If it still hangs, check Qdrant status:
   ```bash
   curl http://localhost:6333/health
   ```
3. Restart Qdrant if needed
4. Try again

### "Requires X-Confirm-Deletion: true header" (API only)

**Cause:** Using the HTTP API without the required confirmation header.

**Solution:**

```bash
# Wrong - missing header
curl -X DELETE http://localhost:4096/indexer/data

# Correct - include header
curl -X DELETE http://localhost:4096/indexer/data \
  -H "X-Confirm-Deletion: true"
```

---

## Examples

### Example 1: Simple Interactive Deletion

```bash
$ opencode indexer delete

✔ Delete all index data for this project? This will be re-indexed on next use.
· Yes

✓ Index data deleted successfully

The indexer will automatically regenerate the index on next use.
```

### Example 2: Automated Deletion (Scripted)

```bash
$ opencode indexer delete --force

✓ Index data deleted successfully

The indexer will automatically regenerate the index on next use.
```

### Example 3: Switching Embedding Models

**Scenario:** You're upgrading from the free embedding model to a premium model.

```bash
# 1. Update your configuration or environment
$ export EMBEDDING_MODEL="premium-v2"

# 2. Delete the old index (built with free model)
$ opencode indexer delete --force

# 3. Next time you use search or analysis, it re-indexes with premium model
# Re-indexing starts automatically...
```

### Example 4: Automated CI/CD Pipeline

```bash
#!/bin/bash
# deploy-new-embeddings.sh

set -e

echo "Deploying new embedding model..."
export EMBEDDING_MODEL="production-v3"

# Delete old index in automation (no confirmation needed)
opencode indexer delete --force

echo "Index cleared. Production deployment ready."
echo "Indexing will resume automatically on next user action."
```

### Example 5: Using the HTTP API from a Script

```bash
#!/bin/bash
# api-delete-index.sh

OPENCODE_API="http://localhost:4096"

echo "Deleting index via API..."

response=$(curl -s -X DELETE \
  "$OPENCODE_API/indexer/data" \
  -H "X-Confirm-Deletion: true" \
  -w "\n%{http_code}")

http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "204" ]; then
  echo "✓ Index deleted successfully"
  exit 0
else
  echo "✗ Failed to delete index (HTTP $http_code)"
  exit 1
fi
```

### Example 6: Recovery from Corruption

**Scenario:** Your search results are inaccurate and you suspect index corruption.

```bash
$ opencode indexer delete --force
✓ Index data deleted successfully

The indexer will automatically regenerate the index on next use.

# Then, next time you use the system:
$ opencode search "your query"

# Internally: System detects disabled index and re-builds automatically
# ... re-indexing in progress ...
# (Your search query waits for completion, then proceeds with fresh index)
```

---

## Summary

| Task                           | Command                              |
| ------------------------------ | ------------------------------------ |
| Delete with confirmation       | `opencode indexer delete`            |
| Delete without confirmation    | `opencode indexer delete --force`    |
| Delete via HTTP API            | `DELETE /indexer/data` + header      |
| Check next steps               | Index auto-regenerates on use        |
| Troubleshoot Qdrant connection | Verify Qdrant is running & reachable |
| Use in automated scripts       | Always use `--force` flag            |

---

## Related Topics

- [Qdrant Documentation](https://qdrant.tech/)
- [Understanding Vector Embeddings](https://en.wikipedia.org/wiki/Word2vec)
- Changing Embedding Providers (see your project configuration)
- Index Status & Monitoring (check logs with verbose mode)
