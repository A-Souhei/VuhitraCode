# slack-app-data-capture

A Slack-based question gateway that bridges the opencode CLI with Slack, using a **push-based architecture** where the CLI sends questions to a remote gateway server.

## Architecture / Flow

The gateway runs on a **remote server with a public domain name** (e.g., `gateway.example.com`). The local opencode CLI pushes questions TO the gateway; the gateway never connects back to the CLI.

```
Local machine (CLI)              Remote server (gateway.example.com)     Slack
     │                                      │                              │
     │── POST /questions ──────────────────►│                              │
     │   Authorization: Bearer <API_KEY>    │── chat_postMessage ─────────►│
     │   {id, sessionID, questions[]}       │   (Block Kit message)        │
     │                                      │                              │
     │── GET /questions/{id} (poll) ───────►│        User replies in thread│
     │◄─ {status: "pending"} ──────────────│◄── Socket Mode event ────────│
     │                                      │    db: status → "answered"   │
     │── GET /questions/{id} (poll) ───────►│                              │
     │◄─ {status: "answered",              │                              │
     │    answers_json: [[label]]} ─────────│                              │
     ✅ CLI resumes with answer
```

**Flow details:**

1. CLI submits a question to `POST /questions` with bearer token authorization
2. Gateway posts the question to Slack as a formatted Block Kit message
3. User replies in the thread (NOT a top-level message)
4. Gateway's Socket Mode listener captures the reply, parses it, and stores the answer in SQLite
5. CLI polls `GET /questions/{id}` until `status` is `"answered"` or `"rejected"`
6. CLI reads the `answers_json` field and resumes execution
7. If CLI times out, it can call `DELETE /questions/{id}` to post a timeout notice to Slack

## Prerequisites

- **Python 3.12+** or Docker
- **Docker Compose** (optional, recommended for deployment)
- **Slack workspace** with admin access to create and configure a new app
- **Remote server** with a public domain name (e.g., `gateway.example.com`) or public IP
- **Network access:** Gateway must have **outbound-only** access to `api.slack.com` (for Slack Socket Mode)

## Slack App Setup

Follow these steps to create and configure a Slack app for the gateway:

### 1. Create a Slack App

1. Visit https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name it (e.g., `opencode-gateway`)
4. Select your Slack workspace
5. Click **"Create App"**

### 2. Enable Socket Mode

1. In the left sidebar, go to **"Socket Mode"**
2. Toggle **"Enable Socket Mode"** to **ON**
3. A popup will ask for an **App-Level Token** name. Enter a name (e.g., `xapp-gateway`)
4. Copy the generated `xapp-...` token — this is your `SLACK_APP_TOKEN`

### 3. Configure OAuth Scopes

1. Go to **"OAuth & Permissions"** in the left sidebar
2. Under **"Scopes" → "Bot Token Scopes"**, add these scopes:
   - `chat:write` — to post messages and threads to Slack
   - `channels:history` — to read channel messages (optional, for debugging)
   - `groups:history` — to read private channel history (optional)
   - `im:history` — to read direct message history (optional)
3. Scroll to the top and click **"Install to Workspace"** (or **"Reinstall"** if already done)
4. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`

### 4. Subscribe to Events (Optional but Recommended)

For incoming thread replies to work, the Slack app must subscribe to message events:

1. Go to **"Event Subscriptions"** in the left sidebar
2. Toggle **"Enable Events"** to **ON**
3. Under **"Subscribe to bot events"**, add:
   - `message.channels` — to listen to channel messages
4. Under **"Subscribe to events on behalf of users"** (if shown), add:
   - `message` — to capture all message events
5. Click **"Save Changes"**

### 5. Invite the Bot to a Channel

1. In Slack, create a channel (e.g., `#opencode-questions`)
2. Mention the bot: `@<your-bot-name>`
3. The bot will be invited to the channel

Record the **channel name** or **channel ID** — this is your `SLACK_CHANNEL`.

## Setup & Running

### Option A: Docker Compose (Recommended)

1. **Create** `.env` from `.env.example` and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

2. **Generate** an API key:

   ```bash
   openssl rand -hex 32
   # Copy the output and paste into API_KEY= in .env
   ```

3. **Run:**

   ```bash
   docker-compose up -d
   ```

4. **Verify** the gateway is running:
   ```bash
   curl http://localhost:8080/health
   # {  "status": "ok", "version": "1.0.0" }
   ```

### Option B: Docker Manual

```bash
# Build
docker build -t slack-app-data-capture .

# Run
docker run -d \
  -p 8080:8080 \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -e SLACK_APP_TOKEN=xapp-... \
  -e SLACK_CHANNEL="#opencode-questions" \
  -e API_KEY="$(openssl rand -hex 32)" \
  -v gateway-data:/app/data \
  slack-app-data-capture
```

### Option C: Python Directly (Development)

```bash
# Install dependencies
pip install -r requirements.txt

# Create .env
cp .env.example .env
# Edit .env with your Slack credentials and API_KEY

# Run
python main.py
```

## Environment Variables

| Variable          | Required | Default             | Description                                                                                                                      |
| ----------------- | -------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `API_KEY`         | **Yes**  | N/A                 | Bearer token for all API routes (except `/health`). Generate with `openssl rand -hex 32`. Container exits at startup if missing. |
| `SLACK_BOT_TOKEN` | **Yes**  | N/A                 | Bot User OAuth Token (`xoxb-...`). Obtain from Slack App OAuth page.                                                             |
| `SLACK_APP_TOKEN` | **Yes**  | N/A                 | App-Level Token for Socket Mode (`xapp-...`). Generated in Socket Mode settings.                                                 |
| `SLACK_CHANNEL`   | **Yes**  | N/A                 | Channel name (`#opencode-questions`) or channel ID (`C0123456789`) where questions are posted.                                   |
| `PORT`            | No       | `8080`              | HTTP server port. Use port 80/443 behind a reverse proxy.                                                                        |
| `DB_PATH`         | No       | `./data/gateway.db` | SQLite database path. Must be writable and persisted (use Docker volume in production).                                          |
| `LOG_LEVEL`       | No       | `INFO`              | Logging level: `DEBUG`, `INFO`, `WARNING`, or `ERROR`.                                                                           |

**Do NOT use:** `OPENCODE_URL`, `OPENCODE_SERVER_URL`, `POLL_INTERVAL`, or any polling-related variables. The gateway uses **push-based** (CLI → gateway) and **pull-based** (Socket Mode from Slack) communication, not polling.

## API Reference

All endpoints except `/health` require bearer token authorization:

```
Authorization: Bearer <API_KEY>
```

### `GET /health`

- **Auth:** None
- **Description:** Health check
- **Response:** `{ "status": "ok", "version": "1.0.0" }`
- **Example:**
  ```bash
  curl http://gateway.example.com/health
  ```

### `POST /questions`

- **Auth:** Bearer required
- **Description:** CLI submits a question. Gateway posts to Slack and returns immediately.
- **Request body:**
  ```json
  {
    "id": "q-12345",
    "sessionID": "session-xyz",
    "questions": [
      {
        "header": "Choose a database",
        "question": "Which database should we use?",
        "options": [
          { "label": "PostgreSQL", "description": "Robust, ACID-compliant" },
          { "label": "MongoDB", "description": "Document-based, flexible" }
        ],
        "multiple": false,
        "custom": true
      }
    ]
  }
  ```
- **Response (202 Accepted):**
  ```json
  {
    "id": "q-12345",
    "status": "pending",
    "slack_ts": "1234567890.000100"
  }
  ```
- **Errors:**
  - `401 Unauthorized` — missing or invalid `Authorization` header
  - `429 Too Many Requests` — rate limited (10 failed attempts per 60 s)
  - `502 Bad Gateway` — failed to post to Slack
- **Example:**
  ```bash
  curl -X POST http://gateway.example.com/questions \
    -H "Authorization: Bearer your-api-key" \
    -H "Content-Type: application/json" \
    -d '{"id":"q-1","sessionID":"s1","questions":[{"header":"Q1","question":"Pick one","options":[{"label":"A"},{"label":"B"}]}]}'
  ```

### `GET /questions`

- **Auth:** Bearer required
- **Description:** List all questions. Optionally filter by `status`.
- **Query Parameters:**
  - `status` (optional): Filter by `pending`, `answered`, or `rejected`
- **Response:** Array of question objects
- **Example:**
  ```bash
  # List all pending questions
  curl http://gateway.example.com/questions?status=pending \
    -H "Authorization: Bearer your-api-key"
  ```

### `GET /questions/{id}`

- **Auth:** Bearer required
- **Description:** CLI polls this endpoint to check question status. When `status == "answered"`, read `answers_json`.
- **Response:**
  ```json
  {
    "id": "q-12345",
    "session_id": "session-xyz",
    "status": "answered",
    "slack_ts": "1234567890.000100",
    "answers_json": "[['PostgreSQL']]",
    "created_at": 1699123456,
    "answered_at": 1699123500
  }
  ```
- **Statuses:**
  - `pending` — awaiting user reply in Slack thread
  - `answered` — user replied; `answers_json` field is populated
  - `rejected` — user replied with `reject` or CLI timed out the question
- **Errors:**
  - `404 Not Found` — question ID does not exist
- **Example:**
  ```bash
  curl http://gateway.example.com/questions/q-12345 \
    -H "Authorization: Bearer your-api-key"
  ```

### `DELETE /questions/{id}`

- **Auth:** Bearer required
- **Description:** CLI-side timeout. Rejects a pending question and posts a timeout notice to the Slack thread.
- **Response:**
  ```json
  {
    "id": "q-12345",
    "status": "rejected"
  }
  ```
- **Errors:**
  - `404 Not Found` — question ID does not exist
  - `409 Conflict` — question already answered or rejected
- **Example:**
  ```bash
  curl -X DELETE http://gateway.example.com/questions/q-12345 \
    -H "Authorization: Bearer your-api-key"
  ```

## How Answers Work

Users reply **in the thread** of the Slack message (NOT as a top-level message). The gateway parses their reply and stores it as an array of option labels.

### Reply Formats

| Reply                                  | Behavior                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| `2`                                    | Selects option 2 (single choice)                                   |
| `1 3` or `1,3`                         | Multi-select: options 1 and 3                                      |
| `reject` or `REJECT`                   | Dismisses the question; status → `rejected`                        |
| Any other text (e.g., `custom answer`) | Stored as-is in `answers_json` (if `custom: true` in the question) |

### Parsing Rules

- Replies are trimmed and split on whitespace or commas
- If all parts are digits and valid for the option range, they are mapped to option labels
- Otherwise, the raw text is stored as a custom answer
- For multiple sub-questions in one request, the user's reply applies to the first question; subsequent questions default to their first option

### Answer Structure

The `answers_json` field is an array of arrays (one entry per sub-question):

```json
[
  ["PostgreSQL"], // First question: user picked option 1
  ["MongoDB", "PostgreSQL"], // Second question: multi-select
  ["custom answer"] // Third question: custom text
]
```

## Deployment

### Domain & Networking

- The gateway should run on a **remote server with a public static IP** or domain name
- Port `8080` (or your configured `PORT`) must be reachable from the internet
- **Inbound:** Clients (CLI) and browsers make HTTP requests to the gateway
- **Outbound:** Gateway makes HTTPS requests to `api.slack.com` for Slack API and Socket Mode
- No inbound connections from Slack — Socket Mode uses an outbound WebSocket initiated by the gateway

### Reverse Proxy Example (Nginx)

For production, run the gateway behind a reverse proxy with HTTPS:

```nginx
server {
    listen 443 ssl http2;
    server_name gateway.example.com;

    ssl_certificate /etc/letsencrypt/live/gateway.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gateway.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name gateway.example.com;
    return 301 https://$server_name$request_uri;
}
```

### CLI Configuration

On your local machine running the opencode CLI, set:

```bash
export SLACK_GATEWAY_URL=https://gateway.example.com
export SLACK_GATEWAY_KEY=<same value as API_KEY on the gateway>
```

## Security

- **Mandatory API key:** The container exits at startup if `API_KEY` is not set
- **Bearer token auth:** All endpoints except `/health` require `Authorization: Bearer <API_KEY>` header
- **Constant-time comparison:** API key validation uses HMAC with `hmac.compare_digest()` to prevent timing attacks
- **Per-IP rate limiting:** 10 failed auth attempts per 60 seconds → HTTP 429 (Too Many Requests)
- **No API documentation exposure:** `/docs`, `/redoc`, and `/openapi.json` are disabled
- **Only outbound to Slack:** The gateway never listens for inbound connections from Slack — it initiates a persistent WebSocket connection to Slack for Socket Mode events

## Data Persistence

Question data is stored in an SQLite database (`DB_PATH`, default `./data/gateway.db`).

**In Docker Compose:** The `data/` directory is mounted as a volume (`gateway-data`) to persist data across container restarts.

**In Docker manual:** Use `-v gateway-data:/app/data` to persist the database.

**In Python directly:** The `data/` directory is created automatically if it doesn't exist.

**Database schema:**

```sql
CREATE TABLE questions (
    id           TEXT PRIMARY KEY,
    session_id   TEXT,
    request_json TEXT NOT NULL,           -- Full JSON request for audit trail
    slack_channel TEXT,
    slack_ts     TEXT,                     -- Slack message timestamp
    status       TEXT NOT NULL,            -- 'pending', 'answered', or 'rejected'
    answers_json TEXT,                     -- Parsed answers: [[label1], [label2], ...]
    created_at   INTEGER NOT NULL,
    answered_at  INTEGER                   -- Timestamp when user replied or timed out
);
```

## Submodule Usage

This directory is designed to be used as a git submodule within the opencode repository:

```bash
git submodule add https://github.com/opencode/slack-app-data-capture.git slack-app-data-capture
cd slack-app-data-capture
cp .env.example .env
# Edit .env with your Slack credentials
docker-compose up -d
```

## Troubleshooting

### Container exits with "ERROR: missing required environment variable(s): SLACK_BOT_TOKEN, ..."

**Cause:** One or more required env vars are not set.

**Solution:**

1. Check your `.env` file (if using Docker Compose)
2. Ensure all four required variables are present:
   - `SLACK_BOT_TOKEN` (xoxb-...)
   - `SLACK_APP_TOKEN` (xapp-...)
   - `SLACK_CHANNEL` (#opencode-questions or C0123456789)
   - `API_KEY` (generate with `openssl rand -hex 32`)
3. Restart the container: `docker-compose down && docker-compose up -d`

### Gateway posts to Slack but no replies are captured

**Cause:** Socket Mode is not enabled or events are not subscribed.

**Solution:**

1. Go to Slack API page for your app
2. Verify **"Socket Mode"** is toggled **ON**
3. Go to **"Event Subscriptions"** and verify **"Enable Events"** is toggled **ON**
4. Check that `message.channels` is in the subscribed events
5. Restart the gateway: `docker-compose restart` or `python main.py`
6. Watch logs for `"Slack Socket Mode connected — gateway ready"`

### `POST /questions` returns 401 Unauthorized

**Cause:** Missing or invalid `Authorization` header or API key.

**Solution:**

1. Ensure the CLI is sending `Authorization: Bearer <API_KEY>` header
2. Verify the `<API_KEY>` value matches the `API_KEY` env var on the gateway
3. Check rate limiting: if more than 10 failed attempts from the same IP in 60 s, you'll get `429 Too Many Requests` — wait 60 seconds and retry

### `POST /questions` returns 502 Bad Gateway

**Cause:** Gateway failed to post the question to Slack.

**Solution:**

1. Check that `SLACK_BOT_TOKEN` is correct (should start with `xoxb-`)
2. Verify the bot is invited to the channel specified in `SLACK_CHANNEL`
3. Check gateway logs: `docker-compose logs slack-app-data-capture`
4. Verify network connectivity from the gateway to `api.slack.com`

### CLI keeps polling but never gets an answer

**Cause:** User replied to the wrong thread, or Socket Mode is not capturing events.

**Solution:**

1. Verify the user replied in the **thread** of the bot's message (not a top-level message)
2. Check gateway logs for `"Question ... answered: ..."` or `"Question ... rejected by user"`
3. If not present, Socket Mode is not capturing events — see "no replies are captured" above
4. Verify the Slack channel is correct: `SLACK_CHANNEL` should match where you posted the question
