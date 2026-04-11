"""
Claude Code session mirror — reference Flask implementation.
============================================================

Drop-in reference for the `/api/mission-control/claude-code/stream/<session_id>`
endpoint the dashboard's live-mirror feature subscribes to. The frontend
in public/index.html already knows how to talk to this — if it gets a 200
with a well-formed SSE stream, the chat becomes a live mirror of whatever
Claude Code process owns that session. If it 404s, the frontend silently
falls back to the existing synchronous /send flow.

This file is NOT wired into any Flask app in this repo — it lives here as
a reference. Copy it into the repo that serves `/api/mission-control/*`
(the same one that already has /claude-code/send), register the blueprint,
and you're live.

Architecture
------------

Claude Code writes every turn of a session to a JSONL file at:

    ~/.claude/projects/<project-slug>/<session_id>.jsonl

Each line is a JSON object with at least {role, content, timestamp}.
The file is append-only while the session is active. We tail it like
`tail -f`, emit each new line as an SSE event, and send periodic
heartbeats so the client's EventSource doesn't time out.

This is the "Option 1 — JSONL tail" architecture from the ops plan:
read-only, zero changes to Claude itself, zero session-lock conflicts,
works against sessions that any other process is actively driving.

To pair with "Option 2 — persistent worker" (so the dashboard can also
*send* into an active session without fighting the lock), see the
SessionWorker class at the bottom of this file.

Dependencies
------------
- Flask (you already have it)
- No extra packages. Uses stdlib only.

Security
--------
- The endpoint should be behind the same auth as the rest of
  /api/mission-control/*. Anyone who can hit /stream can read the
  full contents of the session file — treat it like reading email.
- SSE respects `credentials: 'include'` — the frontend already sends
  `withCredentials: true`.

Rollout
-------
1. Drop this blueprint into the backend repo.
2. app.register_blueprint(claude_mirror_bp).
3. Deploy. The frontend auto-detects it (the existing code path
   calls /stream on every openClaudeSession and degrades silently
   on 404).
4. Verify by opening any session in the dashboard — a green "● LIVE"
   badge should appear next to the session id in the chat header.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Iterator, Optional

from flask import Blueprint, Response, abort, request, stream_with_context


claude_mirror_bp = Blueprint("claude_mirror", __name__)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _claude_projects_dir() -> Path:
    """Root dir where Claude Code stores per-project session files."""
    return Path.home() / ".claude" / "projects"


def _find_session_file(session_id: str) -> Optional[Path]:
    """
    Locate the JSONL file for a given session_id. Claude Code scopes
    sessions under a project-slug directory, so we scan all project
    subdirectories instead of requiring the caller to know the slug.
    """
    if not session_id or "/" in session_id or ".." in session_id:
        return None  # basic path-traversal guard
    root = _claude_projects_dir()
    if not root.exists():
        return None
    for project_dir in root.iterdir():
        if not project_dir.is_dir():
            continue
        candidate = project_dir / f"{session_id}.jsonl"
        if candidate.exists():
            return candidate
    return None


def _sse_event(event: str, data) -> bytes:
    """Format a single Server-Sent Events frame."""
    if not isinstance(data, str):
        data = json.dumps(data, separators=(",", ":"))
    # Each data line must be prefixed; multi-line content gets one
    # `data:` per line per SSE spec.
    lines = data.split("\n")
    body = "\n".join(f"data: {line}" for line in lines)
    return f"event: {event}\n{body}\n\n".encode("utf-8")


def _tail_jsonl(path: Path, stop: threading.Event) -> Iterator[dict]:
    """
    Generator that yields one dict per line appended to `path`,
    starting from the current end of the file. Handles file
    truncation/rotation by re-opening.
    """
    fh = None
    inode = None
    while not stop.is_set():
        try:
            if fh is None:
                fh = path.open("r", encoding="utf-8", errors="replace")
                fh.seek(0, os.SEEK_END)
                inode = os.fstat(fh.fileno()).st_ino
            line = fh.readline()
            if not line:
                # Detect rotation/truncation.
                try:
                    st = os.stat(path)
                    if st.st_ino != inode or st.st_size < fh.tell():
                        fh.close()
                        fh = None
                        continue
                except FileNotFoundError:
                    fh.close()
                    fh = None
                    time.sleep(0.5)
                    continue
                time.sleep(0.25)
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue
        except Exception as e:
            # Transient file errors — back off and retry.
            if fh:
                try: fh.close()
                except Exception: pass
                fh = None
            time.sleep(1)
    if fh:
        try: fh.close()
        except Exception: pass


def _normalize_claude_line(raw: dict) -> Optional[dict]:
    """
    Map a raw Claude Code JSONL entry to the shape the dashboard
    frontend expects: {id?, role, content, ts?, done?}.

    Claude Code's JSONL format varies slightly across versions — this
    function is the one thing you'll want to tweak after verifying the
    exact shape your backend sees. Start with `jq .` on a sample file
    and adjust the field names below.
    """
    role = raw.get("role") or raw.get("type")
    if role not in ("user", "assistant"):
        return None
    content = raw.get("content")
    if isinstance(content, list):
        # Structured content blocks — flatten text blocks into a string.
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and block.get("text"):
                    parts.append(block["text"])
                elif block.get("type") == "tool_use":
                    parts.append(f"[tool:{block.get('name','?')}]")
        content = "\n".join(parts) if parts else None
    if content is None:
        return None
    return {
        "id": raw.get("id") or raw.get("uuid"),
        "role": role,
        "content": content,
        "ts": raw.get("timestamp") or raw.get("ts"),
        "done": bool(raw.get("stop_reason")),
    }


# ─────────────────────────────────────────────────────────────
# The endpoint
# ─────────────────────────────────────────────────────────────

@claude_mirror_bp.route(
    "/api/mission-control/claude-code/stream/<session_id>", methods=["GET"]
)
def stream_session(session_id: str):
    session_file = _find_session_file(session_id)
    if session_file is None:
        abort(404)

    stop = threading.Event()

    @stream_with_context
    def generate() -> Iterator[bytes]:
        # Tell the client who we are before the first data event so
        # the EventSource fires 'open' even on slow backends.
        yield _sse_event("hello", {"session_id": session_id})

        last_heartbeat = time.time()
        try:
            for raw in _tail_jsonl(session_file, stop):
                normalized = _normalize_claude_line(raw)
                if normalized:
                    yield _sse_event("message", normalized)
                # Send a heartbeat every 15s so Safari / iOS don't
                # kill the connection as idle.
                now = time.time()
                if now - last_heartbeat > 15:
                    yield _sse_event("heartbeat", {"t": int(now)})
                    last_heartbeat = now
        finally:
            stop.set()

    response = Response(generate(), mimetype="text/event-stream")
    # Important headers for SSE to work correctly across proxies:
    response.headers["Cache-Control"] = "no-cache, no-transform"
    response.headers["X-Accel-Buffering"] = "no"      # disable nginx buffering
    response.headers["Connection"] = "keep-alive"
    # CORS for same-origin is fine; if you serve the API on a different
    # host, add the appropriate Access-Control-* headers here.
    return response


# ─────────────────────────────────────────────────────────────
# Option 2 reference — persistent worker per session
# ─────────────────────────────────────────────────────────────
#
# The live-mirror above fixes *reading*. If you also want to fix
# *sending* to an active session (without fighting the session lock),
# replace the existing synchronous /send handler with one that routes
# messages through a long-lived SessionWorker per session_id.
#
# This class is a minimal reference. Wire it up to whatever process
# supervisor you already have (supervisord, systemd, a global dict
# guarded by a lock, etc).

class SessionWorker:
    """
    Owns a single `claude --resume <session_id>` subprocess for the
    lifetime of the session. Messages from the dashboard go into an
    input queue; the worker drains the queue and writes to the
    process's stdin. Output is already mirrored via the JSONL tail
    above, so there's no need for a separate output pump here.
    """

    _registry: "dict[str, SessionWorker]" = {}
    _registry_lock = threading.Lock()

    def __init__(self, session_id: str, project_path: str):
        self.session_id = session_id
        self.project_path = project_path
        self.inbox: "queue.Queue[str]" = queue.Queue()
        self.proc: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    @classmethod
    def get_or_create(cls, session_id: str, project_path: str) -> "SessionWorker":
        with cls._registry_lock:
            w = cls._registry.get(session_id)
            if w is None or w._stop.is_set():
                w = cls(session_id, project_path)
                w.start()
                cls._registry[session_id] = w
            return w

    def start(self) -> None:
        self.proc = subprocess.Popen(
            ["claude", "--resume", self.session_id],
            cwd=self.project_path or None,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,  # output goes to the JSONL file
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        self._thread = threading.Thread(target=self._pump, daemon=True)
        self._thread.start()

    def send(self, message: str) -> None:
        """Enqueue a user message. Returns immediately — the response
        shows up on the JSONL tail (and therefore the /stream endpoint)
        when Claude finishes processing it."""
        self.inbox.put(message)

    def _pump(self) -> None:
        while not self._stop.is_set():
            try:
                msg = self.inbox.get(timeout=0.5)
            except queue.Empty:
                continue
            if self.proc is None or self.proc.stdin is None or self.proc.poll() is not None:
                self._stop.set()
                break
            try:
                self.proc.stdin.write(msg + "\n")
                self.proc.stdin.flush()
            except Exception:
                self._stop.set()
                break

    def shutdown(self) -> None:
        self._stop.set()
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=5)
            except Exception:
                try: self.proc.kill()
                except Exception: pass
