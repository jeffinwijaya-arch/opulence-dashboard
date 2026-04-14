"""
Claude Code /send — image-attachment patch.
============================================

Drop-in reference for adding image-attachment support to the existing
`/api/mission-control/claude-code/send` endpoint that the dashboard
already calls. The frontend in public/index.html was updated to ship
an optional `images` field on the POST body:

    {
      "session_id":   "<uuid>",
      "message":      "what watch is this?",
      "project_path": "/path/to/project",
      "images":       ["data:image/jpeg;base64,/9j/4AAQ...", ...]
    }

Each entry in `images` is a base64 data URL (the frontend downscales
big photos to <=1600px longest edge before encoding, so payloads stay
under ~1MB per image). Backends that don't know about this field just
ignore it — so text-only chat keeps working either way. This module
shows the two common ways the field can be honoured, depending on
which transport your backend uses to talk to Claude:

    - Path A — Anthropic SDK (messages.create):
          build a structured content list with {type:"image", source:...}
          blocks and pass it alongside the text.

    - Path B — Claude Code CLI subprocess (`claude --resume`):
          decode each image to a temp file on disk, then include
          `@/tmp/.../img.jpg` references in the message that gets
          piped to stdin. Claude Code expands `@path` references at
          parse time.

Pick whichever matches your existing implementation. Both are here
side-by-side so you can copy the bits you need and delete the rest.

This file is NOT wired into any Flask app in this repo — it lives
here as a reference, just like claude_code_mirror.py. Copy it into
the repo that serves `/api/mission-control/*`, replace your existing
/send handler with `handle_send()` below (or fold the image-decoding
helpers into your existing handler), and you're done.

Dependencies
------------
- Flask
- Path A only: `anthropic` Python SDK (`pip install anthropic`)
- Path B only: stdlib (tempfile, base64, subprocess)

Security
--------
- We cap per-request image count and per-image size BEFORE decoding
  so a malicious client can't OOM the box by sending a GB of base64.
- Path B writes to a per-request temp dir and deletes it after the
  turn finishes. The dir is mode 0700 so other local users can't
  read the user's screenshots.
- We only accept image/jpeg, image/png, image/webp, and image/gif.
  These are the media types Claude's vision actually supports.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import tempfile
from typing import Iterable, List, Optional, Tuple

from flask import Blueprint, jsonify, request


claude_send_bp = Blueprint("claude_send", __name__)


# ─────────────────────────────────────────────────────────────
# Limits — tune for your deployment
# ─────────────────────────────────────────────────────────────

MAX_IMAGES_PER_REQUEST = 8
MAX_IMAGE_BYTES = 5 * 1024 * 1024      # 5MB per decoded image
ALLOWED_MEDIA_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}

# data:[<media-type>][;base64],<payload>
_DATA_URL_RE = re.compile(
    r"^data:(?P<mt>[\w/+.-]+)?(?P<params>(?:;[\w=+.-]+)*)?,(?P<data>.*)$",
    re.DOTALL,
)


# ─────────────────────────────────────────────────────────────
# Shared helpers — parse + validate the `images` field
# ─────────────────────────────────────────────────────────────

class ImageError(ValueError):
    """Raised when an image payload is malformed or over-limit."""


def _decode_data_url(data_url: str) -> Tuple[str, bytes]:
    """
    Parse a `data:<mt>;base64,<b64>` URL into (media_type, raw_bytes).
    Raises ImageError on anything malformed or out-of-policy.
    """
    if not isinstance(data_url, str):
        raise ImageError("image entry is not a string")
    m = _DATA_URL_RE.match(data_url.strip())
    if not m:
        raise ImageError("not a data URL")
    mt = (m.group("mt") or "").lower()
    params = m.group("params") or ""
    payload = m.group("data") or ""
    if mt not in ALLOWED_MEDIA_TYPES:
        raise ImageError(f"unsupported media type: {mt!r}")
    if ";base64" not in params.lower():
        # We only accept base64 payloads. URL-encoded data URLs are
        # legal per the spec but almost never what anyone ships.
        raise ImageError("expected ;base64 encoding")
    # Quick byte-size gate BEFORE decoding (base64 is ~4/3 bigger
    # than the raw, so cap the string at MAX_IMAGE_BYTES * 4/3).
    if len(payload) > MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise ImageError("image too large")
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception as e:
        raise ImageError(f"invalid base64: {e}") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageError("image exceeds MAX_IMAGE_BYTES after decode")
    if not raw:
        raise ImageError("empty image")
    return mt, raw


def _coerce_images(field) -> List[Tuple[str, bytes]]:
    """
    Normalize the request body's `images` field into a list of
    (media_type, raw_bytes). Returns [] if the field is absent or
    empty — this is the path text-only turns take.
    """
    if not field:
        return []
    if not isinstance(field, list):
        raise ImageError("images must be a list")
    if len(field) > MAX_IMAGES_PER_REQUEST:
        raise ImageError(f"at most {MAX_IMAGES_PER_REQUEST} images per turn")
    out: List[Tuple[str, bytes]] = []
    for i, entry in enumerate(field):
        try:
            out.append(_decode_data_url(entry))
        except ImageError as e:
            # Prefix the index so the client knows which chip was bad.
            raise ImageError(f"image #{i + 1}: {e}") from None
    return out


# ─────────────────────────────────────────────────────────────
# Path A — Anthropic SDK (messages.create)
# ─────────────────────────────────────────────────────────────
#
# Use this if your /send handler builds a Claude turn by calling the
# Anthropic API directly (anthropic.Anthropic().messages.create(...)).
# It converts the decoded images into the structured content blocks
# the API expects and appends them alongside the text.

def build_anthropic_content(
    message: str,
    images: Iterable[Tuple[str, bytes]],
) -> list:
    """
    Build the `content` list for anthropic.messages.create(messages=[
        {"role": "user", "content": <this>}
    ]).
    """
    blocks: list = []
    # Per Anthropic's guidance, putting images BEFORE the text tends
    # to produce better captioning / reasoning, so do that here.
    for mt, raw in images:
        blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mt,
                "data": base64.b64encode(raw).decode("ascii"),
            },
        })
    if message:
        blocks.append({"type": "text", "text": message})
    if not blocks:
        # A send with neither text nor images is a no-op; the caller
        # should reject earlier, but guard here anyway.
        raise ImageError("empty message (no text, no images)")
    return blocks


# ─────────────────────────────────────────────────────────────
# Path B — Claude Code CLI subprocess (`claude --resume <id>`)
# ─────────────────────────────────────────────────────────────
#
# Use this if your /send handler is the SessionWorker-style pump from
# claude_code_mirror.py — a long-lived `claude --resume <session_id>`
# subprocess that you write user turns into via stdin. Claude Code
# expands `@path/to/file` references at parse time, so the strategy
# is: write each image to a per-request temp file, append `@path`
# references to the message string, and let the CLI pick them up.

class ImageTempDir:
    """
    Context manager that writes decoded images to a mode-0700 temp dir
    and yields absolute paths. The dir (and all files inside it) is
    deleted when the `with` block exits — so we don't accumulate user
    screenshots on disk across many turns.
    """

    def __init__(self, images: Iterable[Tuple[str, bytes]], prefix: str = "cc-send-"):
        self.images = list(images)
        self.prefix = prefix
        self.root: Optional[str] = None
        self.paths: List[str] = []

    def __enter__(self) -> List[str]:
        self.root = tempfile.mkdtemp(prefix=self.prefix)
        os.chmod(self.root, 0o700)
        for i, (mt, raw) in enumerate(self.images):
            ext = _ext_for_media_type(mt)
            path = os.path.join(self.root, f"img{i + 1:02d}{ext}")
            with open(path, "wb") as fh:
                fh.write(raw)
            os.chmod(path, 0o600)
            self.paths.append(path)
        return self.paths

    def __exit__(self, exc_type, exc, tb):
        if self.root and os.path.isdir(self.root):
            shutil.rmtree(self.root, ignore_errors=True)


def _ext_for_media_type(mt: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mt, ".bin")


def message_with_at_refs(message: str, image_paths: Iterable[str]) -> str:
    """
    Return a message suitable for `claude --resume` stdin where each
    image is referenced via the CLI's `@path` syntax. Claude Code
    loads @-referenced files into the turn automatically.
    """
    refs = " ".join(f"@{p}" for p in image_paths)
    if not message and refs:
        # Prompt-less image turn — give Claude a nudge so it knows
        # what the user actually wants (otherwise it sometimes just
        # says "OK." and stops).
        return refs + "\n\n(user attached the image(s) above; describe or act on them)"
    if message and refs:
        return f"{message}\n\n{refs}"
    return message


# ─────────────────────────────────────────────────────────────
# The endpoint — put these pieces together
# ─────────────────────────────────────────────────────────────
#
# This is the shape your existing /send handler should take after
# the image patch. Replace the two TODO blocks with whichever of
# Path A / Path B matches your existing transport.

@claude_send_bp.route(
    "/api/mission-control/claude-code/send", methods=["POST"]
)
def handle_send():
    body = request.get_json(silent=True) or {}
    session_id = (body.get("session_id") or "").strip()
    message = (body.get("message") or "").strip()
    project_path = (body.get("project_path") or "").strip() or None
    raw_images = body.get("images") or []

    if not session_id:
        return jsonify({"error": "missing session_id"}), 400

    try:
        images = _coerce_images(raw_images)
    except ImageError as e:
        return jsonify({"error": str(e)}), 400

    if not message and not images:
        return jsonify({"error": "empty turn (no text, no images)"}), 400

    # ── Path A — Anthropic SDK direct ────────────────────────
    # import anthropic
    # client = anthropic.Anthropic()
    # content = build_anthropic_content(message, images)
    # reply = client.messages.create(
    #     model="claude-opus-4-6",
    #     max_tokens=4096,
    #     system=YOUR_SYSTEM_PROMPT,
    #     messages=[{"role": "user", "content": content}],
    # )
    # return jsonify({"response": reply.content[0].text})

    # ── Path B — Claude CLI subprocess via SessionWorker ─────
    # from .claude_code_mirror import SessionWorker
    # worker = SessionWorker.get_or_create(session_id, project_path or "")
    # with ImageTempDir(images) as paths:
    #     prompt = message_with_at_refs(message, paths)
    #     reply = worker.send_and_wait(prompt)   # blocks until next assistant turn
    # return jsonify({"response": reply})

    # Until you replace these TODO blocks with your real transport,
    # fall through to a clear 501 so callers see a useful error
    # instead of a silent hang.
    return jsonify({
        "error": "image-aware /send handler not wired up yet — "
                 "see scripts/backend-ref/claude_code_send_images.py"
    }), 501
