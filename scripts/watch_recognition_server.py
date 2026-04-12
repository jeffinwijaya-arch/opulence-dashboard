#!/usr/bin/env python3
"""
watch_recognition_server.py — HTTP API for the watch recognition engine.

Runs as a standalone Flask server alongside the existing backend. Exposes
two endpoints the dashboard frontend calls:

    POST /api/vision/identify        — photo → reference + pricing
    POST /api/vision/warranty-card   — warranty card → serial + ref + date
    GET  /api/vision/health          — healthcheck

Accepts multipart/form-data (file upload) or application/json (base64).
Returns JSON matching the WatchIdentification / WarrantyCardReading schema.

Usage:
    # Start server (defaults to port 5100)
    ANTHROPIC_API_KEY=sk-ant-... python3 scripts/watch_recognition_server.py

    # Or with custom port
    ANTHROPIC_API_KEY=sk-ant-... python3 scripts/watch_recognition_server.py --port 5200

    # Test
    curl -X POST http://localhost:5100/api/vision/identify \
         -F "photo=@watch.jpg"

    curl -X POST http://localhost:5100/api/vision/warranty-card \
         -F "photo=@card.jpg"

The existing dashboard frontend's photo editor calls these endpoints
when the user clicks "Identify" or "Read Card". The _worker.js proxy
can forward /api/vision/* to this server if they run on different ports.

Requires: flask, anthropic, ANTHROPIC_API_KEY env var.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import time
from pathlib import Path

# Add parent to path so we can import watch_recognition
sys.path.insert(0, str(Path(__file__).resolve().parent))

from watch_recognition import WatchRecognizer, WatchIdentification, WarrantyCardReading

try:
    from flask import Flask, request, jsonify
except ImportError:
    print("Flask required: pip install flask", file=sys.stderr)
    sys.exit(1)


app = Flask(__name__)

# Lazy-init recognizer on first request (so the server starts fast
# even if the API key isn't set yet — useful in dev).
_recognizer: WatchRecognizer | None = None


def get_recognizer() -> WatchRecognizer:
    global _recognizer
    if _recognizer is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        _recognizer = WatchRecognizer(api_key=api_key)
    return _recognizer


def _extract_image(req) -> bytes:
    """
    Extract image bytes from either multipart form upload or JSON base64.
    """
    # Multipart file upload
    if "photo" in req.files:
        return req.files["photo"].read()
    if "image" in req.files:
        return req.files["image"].read()

    # JSON body with base64
    data = req.get_json(silent=True)
    if data:
        b64 = data.get("image_base64") or data.get("photo_base64") or data.get("base64")
        if b64:
            return base64.b64decode(b64)

    raise ValueError("No image provided. Send as multipart 'photo' field or JSON 'image_base64'.")


# ─────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────

@app.route("/api/vision/identify", methods=["POST"])
def identify():
    """
    Identify a watch from a photo.

    Accepts:
        multipart/form-data with 'photo' file field
        OR application/json with 'image_base64' field

    Returns:
        {
            "success": true,
            "result": { ...WatchIdentification fields... },
            "elapsed_ms": 1234
        }
    """
    t0 = time.monotonic()
    try:
        image_bytes = _extract_image(request)
        rec = get_recognizer()
        result = rec.identify_watch(image_bytes)
        elapsed = int((time.monotonic() - t0) * 1000)
        return jsonify({
            "success": True,
            "result": result.to_dict(),
            "elapsed_ms": elapsed,
        })
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/vision/warranty-card", methods=["POST"])
def warranty_card():
    """
    Read a warranty card and extract serial, reference, date.

    Accepts:
        multipart/form-data with 'photo' file field
        OR application/json with 'image_base64' field

    Returns:
        {
            "success": true,
            "result": { ...WarrantyCardReading fields... },
            "elapsed_ms": 1234
        }
    """
    t0 = time.monotonic()
    try:
        image_bytes = _extract_image(request)
        rec = get_recognizer()
        card = rec.read_warranty_card(image_bytes)
        elapsed = int((time.monotonic() - t0) * 1000)
        return jsonify({
            "success": True,
            "result": card.to_dict(),
            "elapsed_ms": elapsed,
        })
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/vision/health", methods=["GET"])
def health():
    """Healthcheck — confirms server is running and API key is set."""
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    ref_count = 0
    try:
        rec = get_recognizer()
        ref_count = len(rec.ref_db.refs)
    except Exception:
        pass
    return jsonify({
        "status": "ok" if has_key else "no_api_key",
        "api_key_set": has_key,
        "reference_count": ref_count,
        "model": "claude-sonnet-4-20250514",
    })


# CORS for development (the dashboard runs on a different port)
@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/vision/identify", methods=["OPTIONS"])
@app.route("/api/vision/warranty-card", methods=["OPTIONS"])
def cors_preflight():
    return "", 204


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Watch Recognition API Server")
    parser.add_argument("--port", type=int, default=5100, help="Port (default: 5100)")
    parser.add_argument("--host", default="0.0.0.0", help="Host (default: 0.0.0.0)")
    parser.add_argument("--debug", action="store_true", help="Flask debug mode")
    args = parser.parse_args()

    print(f"Watch Recognition API starting on {args.host}:{args.port}")
    print(f"  API key: {'set' if os.environ.get('ANTHROPIC_API_KEY') else 'NOT SET'}")
    print(f"  Endpoints:")
    print(f"    POST /api/vision/identify")
    print(f"    POST /api/vision/warranty-card")
    print(f"    GET  /api/vision/health")
    app.run(host=args.host, port=args.port, debug=args.debug)
