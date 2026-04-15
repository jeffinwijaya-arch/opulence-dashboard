"""
Invoice → Telegram delivery — reliability patch.
================================================

Drop-in reference for the Telegram-send side of the invoice flow. The
current `price_analyzer` backend creates the invoice PDF correctly
(see price_analyzer/invoices/INV-NNNNNN.pdf), but its auto-send path
goes through a detached "raw Telegram API" call that isn't tied to
the user's active chat/reply flow. When that call silently misses,
the invoice PDF exists on disk while the user never receives it. The
user-visible symptom is a "Sold!" toast + a "created & sent!" message
on the frontend, with no PDF arriving in the bot chat afterwards.

This reference does two things:

1. Provides a `/api/internal-invoices/<id>/send-telegram` endpoint
   that the dashboard now calls from the Sell-modal success state and
   from every invoice row in the Invoices list. This is the manual
   override — the user taps a button and the PDF lands in their chat,
   deterministically.

2. Provides a helper function `send_invoice_to_telegram(invoice_id,
   chat_id)` that the sale-completion flow should call instead of
   whatever "old raw API" call it's doing today. Crucially, the
   helper uses the SAME bot + chat-resolution pipeline that the
   conversational Mochi Khai bot uses, so every invoice lands in the
   chat the user is actually talking to.

This file is NOT wired into any Flask app in this repo — it lives
here as a reference, same pattern as claude_code_mirror.py and
claude_code_send_images.py. Copy it into the price_analyzer repo,
register the blueprint, and replace the broken auto-send call in the
sale-complete handler with the helper.

Dependencies
------------
- Flask
- requests  (for the Telegram Bot API call — stdlib is sufficient too,
             but every real backend already has requests)

Security
--------
- Only sends to a chat_id the backend explicitly knows about. We do
  NOT accept a chat_id from the HTTP request — that would let anyone
  with dashboard access fan out invoices to arbitrary Telegram chats.
- Resolves the default chat via a shared helper
  (`resolve_user_chat_id()`) so the conversational bot and the
  invoice send speak to the same place. This is the single most
  important change vs. the old path.
- Rate-limits manual resends to 1 per invoice per 10 seconds so a
  stuck UI button-spam can't turn into a Telegram ban.

Expected frontend contract
--------------------------
    POST /api/internal-invoices/<id>/send-telegram
    (no body needed)

    200 OK                         { "ok": true, "message_id": 12345 }
    404 Not Found                  { "ok": false, "error": "invoice_not_found" }
    409 Conflict (rate-limited)    { "ok": false, "error": "slow_down" }
    500                            { "ok": false, "error": "..." }
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

import requests  # type: ignore[import-untyped]
from flask import Blueprint, jsonify


invoice_telegram_bp = Blueprint("invoice_telegram", __name__)


# ─────────────────────────────────────────────────────────────
# Config — pull from env, same as the rest of price_analyzer does
# ─────────────────────────────────────────────────────────────

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
INVOICES_DIR = Path(os.environ.get("INVOICES_DIR", "price_analyzer/invoices"))

# Min seconds between manual resends of the same invoice. Prevents
# an accidental double-tap from firing the same PDF twice.
MIN_RESEND_INTERVAL_SEC = 10


# ─────────────────────────────────────────────────────────────
# The critical helper — the ONE bot/chat resolver
# ─────────────────────────────────────────────────────────────
#
# This is the core of the fix. The "old code" path the Mochi Khai bot
# was describing picks a chat_id from a stale config file or a different
# constant, so invoices and conversational replies diverge. We resolve
# the chat the same way the conversational bot does — presumably from
# a sessions table, or from the TELEGRAM_DEFAULT_CHAT_ID env var in
# single-user deployments.
#
# Replace this stub with whatever your conversational bot actually
# does. If you don't have one central resolver, MAKE this the central
# resolver and route the conversational bot through it too.

def resolve_user_chat_id(user_id: Optional[str] = None) -> Optional[str]:
    """
    Return the Telegram chat_id that the current user's conversational
    bot replies into. If you have a multi-user setup with per-user
    chat_ids stored alongside their account, look it up here.
    """
    if user_id:
        # Example: chat = db.session.query(UserChat).filter_by(user_id=user_id).first()
        #          return chat.chat_id if chat else None
        pass
    # Single-user fallback — same env var the Mochi Khai bot uses.
    return os.environ.get("TELEGRAM_DEFAULT_CHAT_ID") or None


# ─────────────────────────────────────────────────────────────
# The actual sender — callable from both the endpoint AND from
# the sale-complete flow inside price_analyzer.
# ─────────────────────────────────────────────────────────────

def send_invoice_to_telegram(
    invoice_id: int,
    chat_id: Optional[str] = None,
    caption: Optional[str] = None,
) -> dict:
    """
    Send an invoice PDF to a Telegram chat. Returns a dict shaped like
    the HTTP response body so callers (the endpoint below AND the
    sale-complete flow) can surface it uniformly.

    If chat_id is None, resolves the user's chat via the shared
    resolver. This is the behaviour the sale-complete flow should use:
    don't pass chat_id at all, let the helper route it.
    """
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN not configured"}

    invoice = _load_invoice(invoice_id)
    if invoice is None:
        return {"ok": False, "error": "invoice_not_found"}

    pdf_path = INVOICES_DIR / f"INV-{invoice_id:06d}.pdf"
    if not pdf_path.exists():
        return {"ok": False, "error": f"pdf missing at {pdf_path}"}

    if chat_id is None:
        chat_id = resolve_user_chat_id(invoice.get("user_id"))
    if not chat_id:
        return {"ok": False, "error": "no chat configured for user"}

    if caption is None:
        num = invoice.get("invoice_number") or f"INV-{invoice_id:06d}"
        buyer = invoice.get("customer_name") or "buyer"
        total = invoice.get("total") or invoice.get("amount") or 0
        caption = f"Invoice {num} — {buyer} — ${int(float(total)):,}"

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"
    with pdf_path.open("rb") as fh:
        files = {"document": (pdf_path.name, fh, "application/pdf")}
        data = {"chat_id": chat_id, "caption": caption}
        try:
            resp = requests.post(url, data=data, files=files, timeout=30)
        except requests.RequestException as e:
            return {"ok": False, "error": f"network: {e}"}

    try:
        body = resp.json()
    except ValueError:
        return {"ok": False, "error": f"non-JSON response: HTTP {resp.status_code}"}

    if not resp.ok or not body.get("ok"):
        return {"ok": False, "error": body.get("description") or f"HTTP {resp.status_code}"}

    message_id = (body.get("result") or {}).get("message_id")
    # Record the send so you can audit "did the user actually receive
    # invoice X?" months later. Also drives the rate-limit below.
    _record_invoice_send(invoice_id, chat_id, message_id)
    return {"ok": True, "message_id": message_id}


def _load_invoice(invoice_id: int) -> Optional[dict]:
    """
    Stub — replace with your real invoice-lookup. Should return at
    least {id, invoice_number, customer_name, total, user_id} or
    None.
    """
    # Example:
    #   return db.session.query(Invoice).filter_by(id=invoice_id).first().as_dict()
    return None


# In-memory "last sent at" map. Swap for Redis/DB if you run more
# than one worker — otherwise the rate limit is per-worker.
_LAST_SEND_TS: "dict[int, float]" = {}


def _record_invoice_send(invoice_id: int, chat_id: str, message_id) -> None:
    _LAST_SEND_TS[invoice_id] = time.time()
    # Also persist to your audit log / invoices table:
    #   db.session.query(Invoice).filter_by(id=invoice_id).update({
    #       "last_sent_telegram_at": datetime.utcnow(),
    #       "last_sent_telegram_chat": chat_id,
    #       "last_sent_telegram_message_id": message_id,
    #   })


def _is_rate_limited(invoice_id: int) -> bool:
    last = _LAST_SEND_TS.get(invoice_id)
    if last is None:
        return False
    return (time.time() - last) < MIN_RESEND_INTERVAL_SEC


# ─────────────────────────────────────────────────────────────
# The endpoint
# ─────────────────────────────────────────────────────────────

@invoice_telegram_bp.route(
    "/api/internal-invoices/<int:invoice_id>/send-telegram", methods=["POST"]
)
def http_send_invoice_to_telegram(invoice_id: int):
    if _is_rate_limited(invoice_id):
        return jsonify({"ok": False, "error": "slow_down"}), 409
    result = send_invoice_to_telegram(invoice_id)
    if not result.get("ok"):
        # Map the error to an HTTP status the frontend can branch on.
        if result.get("error") == "invoice_not_found":
            return jsonify(result), 404
        return jsonify(result), 500
    return jsonify(result), 200


# ─────────────────────────────────────────────────────────────
# WIRING NOTES
# ─────────────────────────────────────────────────────────────
#
# 1) Register the blueprint in your Flask app:
#
#        from invoice_telegram_send import invoice_telegram_bp
#        app.register_blueprint(invoice_telegram_bp)
#
# 2) In the sale-complete flow, REPLACE the old raw-Telegram-API call
#    with the helper, so every sold watch auto-sends through the same
#    resolver the conversational bot uses:
#
#        # OLD (flaky — different chat_id, silently missed):
#        #   requests.post(
#        #       f"https://api.telegram.org/bot{TOKEN}/sendDocument",
#        #       data={"chat_id": SOME_OLD_CONSTANT, ...},
#        #       files={"document": open(pdf_path, "rb")},
#        #   )
#
#        # NEW — deterministic, routes through the shared resolver:
#        result = send_invoice_to_telegram(invoice.id)
#        if not result["ok"]:
#            logger.warning("invoice auto-send failed: %s", result["error"])
#            # The user's dashboard will still show a "Send to Telegram"
#            # button on the Sold modal + in the Invoices list, so they
#            # can retry manually. Don't fail the whole sale over this.
#
# 3) Configure these env vars:
#
#        TELEGRAM_BOT_TOKEN=<your bot token>
#        TELEGRAM_DEFAULT_CHAT_ID=<your personal chat id>
#        INVOICES_DIR=price_analyzer/invoices    # default shown
#
# 4) Smoke test:
#
#        $ curl -X POST http://localhost:5000/api/internal-invoices/736/send-telegram
#        {"ok": true, "message_id": 12345}
#
#    And it should land in your bot chat.
