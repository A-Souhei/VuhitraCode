"""
Slack ↔ opencode question gateway.

Architecture (push-based):
  1. The local opencode CLI pushes a question  →  POST /questions  (CLI → gateway)
  2. Gateway posts the question to Slack via Block Kit
  3. User replies in the Slack thread
  4. Gateway stores the answer in SQLite, status → "answered"
  5. CLI polls  GET /questions/{id}  until status is "answered" or "rejected"
  6. CLI reads the answers and resumes

The gateway never connects back to the CLI — it has no knowledge of where the
CLI lives. The CLI is always the initiator and the poller.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Optional

import aiosqlite
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from pydantic import BaseModel
from slack_sdk import WebClient
from slack_sdk.socket_mode.aiohttp import SocketModeClient
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.socket_mode.response import SocketModeResponse

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_APP_TOKEN = os.getenv("SLACK_APP_TOKEN", "")
SLACK_CHANNEL   = os.getenv("SLACK_CHANNEL", "")
DB_PATH         = os.getenv("DB_PATH", "./data/gateway.db")
LOG_LEVEL       = os.getenv("LOG_LEVEL", "INFO").upper()
PORT            = int(os.getenv("PORT", "8080"))
API_KEY         = os.getenv("API_KEY", "")

# ---------------------------------------------------------------------------
# Startup validation — fail fast if required env vars are missing
# ---------------------------------------------------------------------------

_REQUIRED = {
    "SLACK_BOT_TOKEN": SLACK_BOT_TOKEN,
    "SLACK_APP_TOKEN": SLACK_APP_TOKEN,
    "SLACK_CHANNEL":   SLACK_CHANNEL,
    "API_KEY":         API_KEY,
}
_missing = [k for k, v in _REQUIRED.items() if not v]
if _missing:
    raise SystemExit(
        f"ERROR: missing required environment variable(s): {', '.join(_missing)}\n"
        "Set them via -e flags or --env-file when running the container."
    )

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("gateway")

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

os.makedirs(os.path.dirname(DB_PATH) if os.path.dirname(DB_PATH) else ".", exist_ok=True)


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS questions (
                id           TEXT PRIMARY KEY,
                session_id   TEXT,
                request_json TEXT NOT NULL,
                slack_channel TEXT,
                slack_ts     TEXT,
                status       TEXT NOT NULL DEFAULT 'pending',
                answers_json TEXT,
                created_at   INTEGER NOT NULL,
                answered_at  INTEGER
            )
        """)
        await db.commit()
    log.info("DB initialised at %s", DB_PATH)


async def db_insert(req: dict, channel: str, ts: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO questions
                (id, session_id, request_json, slack_channel, slack_ts, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
            """,
            (req["id"], req.get("sessionID", ""), json.dumps(req), channel, ts, int(time.time())),
        )
        await db.commit()


async def db_set_answered(qid: str, answers: list) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE questions SET status='answered', answers_json=?, answered_at=? WHERE id=?",
            (json.dumps(answers), int(time.time()), qid),
        )
        await db.commit()


async def db_set_rejected(qid: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE questions SET status='rejected', answered_at=? WHERE id=?",
            (int(time.time()), qid),
        )
        await db.commit()


async def db_get(qid: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM questions WHERE id=?", (qid,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def db_list(status: Optional[str] = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status:
            async with db.execute(
                "SELECT * FROM questions WHERE status=? ORDER BY created_at DESC", (status,)
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]
        async with db.execute("SELECT * FROM questions ORDER BY created_at DESC") as cur:
            return [dict(r) for r in await cur.fetchall()]

# ---------------------------------------------------------------------------
# Slack helpers
# ---------------------------------------------------------------------------

slack_web: WebClient = None  # type: ignore[assignment]


def build_blocks(req: dict) -> list[dict]:
    """Build Slack Block Kit blocks for a QuestionRequest."""
    blocks: list[dict] = []
    for q in req.get("questions", []):
        blocks.append({
            "type": "header",
            "text": {"type": "plain_text", "text": q.get("header", "Question"), "emoji": True},
        })
        lines = [q.get("question", "")]
        for i, opt in enumerate(q.get("options", []), start=1):
            desc = f" — {opt['description']}" if opt.get("description") else ""
            lines.append(f"{i}. *{opt['label']}*{desc}")
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}})
    blocks.append({
        "type": "context",
        "elements": [{
            "type": "mrkdwn",
            "text": "Reply in this thread with the number(s) of your choice, or type a custom answer. To dismiss, reply `reject`.",
        }],
    })
    return blocks


async def post_to_slack(req: dict) -> Optional[str]:
    """Post question to Slack; return thread ts or None on error."""
    try:
        resp = slack_web.chat_postMessage(
            channel=SLACK_CHANNEL,
            text=f"❓ {req['questions'][0].get('question', 'New question')}",
            blocks=build_blocks(req),
        )
        return resp["ts"]
    except Exception as e:
        log.error("Failed to post question %s to Slack: %s", req["id"], e)
        return None


async def post_thread(channel: str, ts: str, text: str) -> None:
    try:
        slack_web.chat_postMessage(channel=channel, thread_ts=ts, text=text)
    except Exception as e:
        log.error("Failed to post thread reply: %s", e)

# ---------------------------------------------------------------------------
# Slack Socket Mode — incoming reply handler
# ---------------------------------------------------------------------------

def parse_answer(text: str, options: list[dict]) -> list[str]:
    """Map a Slack reply to option labels. Falls back to custom text."""
    text = text.strip()
    parts = text.replace(",", " ").split()
    if all(p.isdigit() for p in parts) and parts:
        labels = [options[int(p) - 1]["label"] for p in parts if 0 <= int(p) - 1 < len(options)]
        if labels:
            return labels
    return [text]


async def handle_slack_event(client: SocketModeClient, req: SocketModeRequest) -> None:
    if req.type != "events_api":
        return
    await client.send_socket_mode_response(SocketModeResponse(envelope_id=req.envelope_id))

    event = req.payload.get("event", {})
    if event.get("type") != "message" or event.get("bot_id"):
        return
    thread_ts = event.get("thread_ts")
    if not thread_ts:
        return  # only care about thread replies, not top-level messages

    text    = (event.get("text") or "").strip()
    channel = event.get("channel", "")

    # Look up the pending question whose Slack message this is a reply to
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM questions WHERE slack_ts=? AND status='pending'", (thread_ts,)
        ) as cur:
            row = await cur.fetchone()

    if not row:
        return  # reply to an unknown or already-answered thread — ignore

    qid          = row["id"]
    request_obj  = json.loads(row["request_json"])
    questions_list = request_obj.get("questions", [])

    if text.lower() == "reject":
        await db_set_rejected(qid)
        await post_thread(channel, thread_ts, "✅ Question dismissed.")
        log.info("Question %s rejected by user", qid)
        return

    # Build answers array — one entry per sub-question
    # For now, the user's single reply maps to the first question;
    # additional questions get their first option as a safe default.
    answers: list[list[str]] = []
    for i, q in enumerate(questions_list):
        if i == 0:
            answers.append(parse_answer(text, q.get("options", [])))
        else:
            opts = q.get("options", [])
            answers.append([opts[0]["label"]] if opts else [text])

    await db_set_answered(qid, answers)
    await post_thread(channel, thread_ts, f"✅ Answered: *{', '.join(answers[0])}*")
    log.info("Question %s answered: %s", qid, answers)

# ---------------------------------------------------------------------------
# Auth — mandatory bearer token with rate limiting
# ---------------------------------------------------------------------------

_auth_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 60.0
_RATE_LIMIT  = 10

# Pre-compute once at startup — raw key never compared in plain text
_KEY_DIGEST = hmac.new(b"gw-salt", API_KEY.encode(), hashlib.sha256).digest()


def _rate_check(ip: str) -> None:
    now    = time.monotonic()
    window = [t for t in _auth_attempts[ip] if now - t < _RATE_WINDOW]
    window.append(now)
    _auth_attempts[ip] = window
    if len(window) > _RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many auth attempts — wait 60 s")


async def auth(request: Request, authorization: Optional[str] = Header(default=None)) -> None:
    """Mandatory bearer-token auth.

    Properties:
    - Required at startup (container exits if API_KEY unset)
    - Constant-time HMAC digest comparison (no timing attacks)
    - Per-IP sliding-window rate limit: 10 failures / 60 s → HTTP 429
    - /docs, /redoc, /openapi.json disabled
    """
    ip = request.client.host if request.client else "unknown"
    _rate_check(ip)
    if not authorization or not authorization.startswith("Bearer "):
        log.warning("auth rejected — missing/malformed header from %s", ip)
        raise HTTPException(status_code=401, detail="Authorization: Bearer <API_KEY> required")
    token     = authorization[len("Bearer "):]
    candidate = hmac.new(b"gw-salt", token.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(candidate, _KEY_DIGEST):
        log.warning("auth rejected — bad token from %s", ip)
        raise HTTPException(status_code=401, detail="Invalid API key")

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class QuestionOption(BaseModel):
    label: str
    description: str = ""

class QuestionInfo(BaseModel):
    question: str
    header: str
    options: list[QuestionOption] = []
    multiple: bool = False
    custom: bool = True

class QuestionRequest(BaseModel):
    id: str
    sessionID: str = ""
    questions: list[QuestionInfo]

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global slack_web
    await init_db()

    slack_web = WebClient(token=SLACK_BOT_TOKEN)

    socket_client = SocketModeClient(app_token=SLACK_APP_TOKEN, web_client=slack_web)
    socket_client.socket_mode_request_listeners.append(handle_slack_event)
    await socket_client.connect_async()
    log.info("Slack Socket Mode connected — gateway ready")

    yield

    await socket_client.close()
    log.info("Shutdown complete")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="slack-app-data-capture",
    lifespan=lifespan,
    docs_url=None,    # no Swagger UI in production
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "1.0.0"}


@app.post("/questions", status_code=202)
async def submit_question(body: QuestionRequest, _: None = Depends(auth)) -> dict:
    """
    CLI calls this to submit a question to the gateway.
    The gateway posts it to Slack and returns immediately.
    The CLI should then poll GET /questions/{id} until status != 'pending'.
    """
    req = body.model_dump()
    existing = await db_get(req["id"])
    if existing:
        return {"id": req["id"], "status": existing["status"], "note": "already exists"}

    ts = await post_to_slack(req)
    if not ts:
        raise HTTPException(status_code=502, detail="Failed to post question to Slack")

    await db_insert(req, SLACK_CHANNEL, ts)
    log.info("Question %s submitted and posted to Slack (ts=%s)", req["id"], ts)
    return {"id": req["id"], "status": "pending", "slack_ts": ts}


@app.get("/questions")
async def list_questions(
    status: Optional[str] = Query(default=None),
    _: None = Depends(auth),
) -> list[dict]:
    """List all questions. Filter by status with ?status=pending|answered|rejected."""
    return await db_list(status)


@app.get("/questions/{qid}")
async def get_question(qid: str, _: None = Depends(auth)) -> dict:
    """
    Poll this endpoint after submitting a question.
    When status == 'answered', read the 'answers_json' field.
    When status == 'rejected', the user dismissed the question.
    """
    row = await db_get(qid)
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    return row


@app.delete("/questions/{qid}", status_code=200)
async def reject_question(qid: str, _: None = Depends(auth)) -> dict:
    """Manually reject a pending question (e.g. timeout on the CLI side)."""
    row = await db_get(qid)
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    if row["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Question already {row['status']}")
    await db_set_rejected(qid)
    if row.get("slack_ts"):
        await post_thread(row["slack_channel"], row["slack_ts"], "⏱️ Question timed out.")
    log.info("Question %s rejected via API", qid)
    return {"id": qid, "status": "rejected"}

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level=LOG_LEVEL.lower())
