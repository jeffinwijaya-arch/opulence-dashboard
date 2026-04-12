#!/usr/bin/env python3
"""
watch_recognition.py — Watch identification engine for MK Opulence.

Two modes:
  1. Watch photo → identify exact reference, model, dial, condition
  2. Warranty card photo → extract serial, reference, date, dealer

Uses Claude Vision as the primary identification engine, cross-referenced
against the live refs.json market database for validation and pricing.

Usage:
    # As a library
    from scripts.watch_recognition import WatchRecognizer
    rec = WatchRecognizer(api_key="sk-ant-...")
    result = rec.identify_watch("path/to/photo.jpg")
    card = rec.read_warranty_card("path/to/card.jpg")

    # CLI
    python3 scripts/watch_recognition.py identify photo.jpg
    python3 scripts/watch_recognition.py warranty-card card.jpg
    python3 scripts/watch_recognition.py --help

Requires: ANTHROPIC_API_KEY env var or passed directly.
"""

from __future__ import annotations

import base64
import json
import hashlib
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import anthropic


# ─────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────

@dataclass
class WatchIdentification:
    """Result of identifying a watch from a photo."""
    reference: str = ""
    brand: str = ""
    model: str = ""
    dial: str = ""
    bracelet: str = ""
    bezel: str = ""
    condition: str = ""
    confidence: float = 0.0           # 0.0 – 1.0
    reasoning: str = ""
    # Market data from refs.json (filled by cross-reference)
    market_price_b25: Optional[int] = None
    market_price_low: Optional[int] = None
    market_price_high: Optional[int] = None
    market_listings: int = 0
    dial_premium: Optional[str] = None  # e.g. "+15% vs base"
    # Alternate candidates
    alternates: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


@dataclass
class WarrantyCardReading:
    """Result of reading a warranty card."""
    reference: str = ""
    serial_number: str = ""
    purchase_date: str = ""           # MM/YYYY or full date
    dealer: str = ""
    brand: str = ""
    model: str = ""
    confidence: float = 0.0
    raw_text: str = ""
    reasoning: str = ""
    # Validation
    reference_valid: bool = False     # True if ref exists in refs.json
    serial_format_valid: bool = False
    # Market data
    market_price_b25: Optional[int] = None

    def to_dict(self):
        return asdict(self)


# ─────────────────────────────────────────────────────────────
# Reference database
# ─────────────────────────────────────────────────────────────

class ReferenceDatabase:
    """
    Loads refs.json and provides fast lookup + fuzzy matching for
    cross-referencing recognition results against known references.
    """

    def __init__(self, refs_path: Optional[Path] = None):
        if refs_path is None:
            refs_path = Path(__file__).resolve().parent.parent / "public" / "data" / "refs.json"
        self.refs: dict = {}
        self._model_to_refs: dict[str, list[str]] = {}
        self._all_refs: list[str] = []
        if refs_path.exists():
            with refs_path.open() as f:
                self.refs = json.load(f)
            self._all_refs = sorted(self.refs.keys())
            for ref, info in self.refs.items():
                model = (info.get("model") or "").lower()
                if model:
                    self._model_to_refs.setdefault(model, []).append(ref)

    def lookup(self, ref: str) -> Optional[dict]:
        """Exact lookup by reference number."""
        return self.refs.get(ref) or self.refs.get(ref.upper())

    def fuzzy_match(self, ref: str, brand: str = "", model: str = "") -> list[dict]:
        """
        Find closest matching references. Returns list of
        {ref, score, info} sorted by score descending.
        """
        ref_upper = ref.upper().strip()
        candidates = []

        # Exact match
        exact = self.lookup(ref_upper)
        if exact:
            candidates.append({"ref": ref_upper, "score": 1.0, "info": exact})
            return candidates

        # Prefix match (e.g. "12661" matches "126610LN", "126610LV")
        for known_ref in self._all_refs:
            if known_ref.startswith(ref_upper) or ref_upper.startswith(known_ref):
                score = len(ref_upper) / max(len(known_ref), len(ref_upper))
                candidates.append({"ref": known_ref, "score": score, "info": self.refs[known_ref]})

        # Model-based search
        if model:
            model_lower = model.lower()
            for m, refs in self._model_to_refs.items():
                if model_lower in m or m in model_lower:
                    for r in refs:
                        if not any(c["ref"] == r for c in candidates):
                            candidates.append({"ref": r, "score": 0.5, "info": self.refs[r]})

        candidates.sort(key=lambda x: -x["score"])
        return candidates[:5]

    def get_dial_premium(self, ref: str, dial: str) -> Optional[str]:
        """
        Calculate dial premium/discount relative to the overall b25
        for this reference. Returns a string like "+15%" or "-8%".
        """
        info = self.lookup(ref)
        if not info or not info.get("dials") or not info.get("b25"):
            return None
        overall_b25 = info["b25"]
        if not overall_b25:
            return None

        # Find matching dial (case-insensitive partial match)
        dial_lower = dial.lower()
        for dial_name, dial_info in info["dials"].items():
            if dial_lower in dial_name.lower() or dial_name.lower() in dial_lower:
                dial_b25 = dial_info.get("b25") or dial_info.get("median")
                if dial_b25 and overall_b25:
                    pct = ((dial_b25 - overall_b25) / overall_b25) * 100
                    if abs(pct) < 2:
                        return "baseline"
                    return f"{pct:+.0f}%"
        return None

    def enrich(self, result: WatchIdentification) -> WatchIdentification:
        """
        Fill in market data from refs.json for a recognition result.
        """
        info = self.lookup(result.reference)
        if info:
            result.market_price_b25 = info.get("b25")
            result.market_price_low = info.get("low")
            result.market_price_high = info.get("high")
            result.market_listings = info.get("count", 0)
            if result.dial:
                result.dial_premium = self.get_dial_premium(result.reference, result.dial)
            if not result.brand:
                result.brand = info.get("brand", "")
            if not result.model:
                result.model = info.get("model", "")
        else:
            # Try fuzzy matching
            matches = self.fuzzy_match(result.reference, result.brand, result.model)
            if matches:
                best = matches[0]
                if best["score"] >= 0.8:
                    info = best["info"]
                    result.market_price_b25 = info.get("b25")
                    result.market_price_low = info.get("low")
                    result.market_price_high = info.get("high")
                    result.market_listings = info.get("count", 0)
                result.alternates = [
                    {"ref": m["ref"], "model": m["info"].get("model", ""),
                     "score": m["score"], "b25": m["info"].get("b25")}
                    for m in matches[:3]
                ]
        return result

    def enrich_card(self, card: WarrantyCardReading) -> WarrantyCardReading:
        """Fill in market data for a warranty card reading."""
        info = self.lookup(card.reference)
        if info:
            card.reference_valid = True
            card.market_price_b25 = info.get("b25")
            if not card.brand:
                card.brand = info.get("brand", "")
            if not card.model:
                card.model = info.get("model", "")
        return card


# ─────────────────────────────────────────────────────────────
# Result cache
# ─────────────────────────────────────────────────────────────

class ResultCache:
    """
    Simple file-based cache keyed on image content hash.
    Prevents re-calling the API for the same photo.
    """

    def __init__(self, cache_dir: Optional[Path] = None):
        if cache_dir is None:
            cache_dir = Path(__file__).resolve().parent.parent / ".cache" / "vision"
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _key(self, image_bytes: bytes, mode: str) -> str:
        h = hashlib.sha256(image_bytes).hexdigest()[:16]
        return f"{mode}_{h}"

    def get(self, image_bytes: bytes, mode: str) -> Optional[dict]:
        key = self._key(image_bytes, mode)
        path = self.cache_dir / f"{key}.json"
        if path.exists():
            try:
                data = json.loads(path.read_text())
                # Cache entries older than 24h are stale
                if time.time() - data.get("_ts", 0) < 86400:
                    return data
            except Exception:
                pass
        return None

    def put(self, image_bytes: bytes, mode: str, result: dict) -> None:
        key = self._key(image_bytes, mode)
        path = self.cache_dir / f"{key}.json"
        result["_ts"] = time.time()
        path.write_text(json.dumps(result))


# ─────────────────────────────────────────────────────────────
# Recognition engine
# ─────────────────────────────────────────────────────────────

# Prompt for watch identification
IDENTIFY_PROMPT = """You are an expert luxury watch appraiser and identifier. Analyze this watch photo and identify the exact model.

Return a JSON object with these fields:
{
  "reference": "exact reference number (e.g. 126610LN, 5711/1A-010, 15500ST.OO.1220ST.01)",
  "brand": "Rolex | Patek Philippe | Audemars Piguet | Tudor | Omega | etc.",
  "model": "model name (e.g. Submariner Date, Nautilus, Royal Oak)",
  "dial": "dial color/description (e.g. Black, Blue Sunburst, Wimbledon, Ice Blue)",
  "bracelet": "bracelet type (e.g. Oyster, Jubilee, President, Rubber)",
  "bezel": "bezel description (e.g. Black Ceramic, Pepsi, Root Beer, Fluted)",
  "condition": "BNIB | Like New | Pre-owned | Unknown (based on visible wear)",
  "confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation of key identifying features you used"
}

Key identification features to look for:
- Case material and finish (steel, gold, two-tone, platinum)
- Bezel type and insert (ceramic, aluminum, fluted, smooth, gem-set)
- Dial details (color, indices, lume plots, date window, subdials)
- Crown guards, case shape, lug shape
- Bracelet style, clasp type
- Movement visible through caseback
- Size cues relative to wrist or other objects

Be precise with the reference number. For Rolex, include the suffix (LN, LV, BLNR, BLRO, etc.). For AP, include the full reference with material code. For Patek, include the dash suffix.

If you cannot confidently identify the exact reference, give your best guess with a lower confidence score and explain what's ambiguous.

Return ONLY the JSON object, no markdown fences or extra text."""

# Prompt for warranty card reading
WARRANTY_CARD_PROMPT = """You are an expert at reading luxury watch warranty cards and certificates. Extract all information from this warranty card image.

Return a JSON object with these fields:
{
  "reference": "watch reference number exactly as printed",
  "serial_number": "serial number exactly as printed",
  "purchase_date": "date in MM/YYYY or DD/MM/YYYY format as printed",
  "dealer": "authorized dealer name as printed",
  "brand": "watch brand (Rolex, Patek Philippe, Audemars Piguet, etc.)",
  "model": "model name if printed on card",
  "confidence": 0.0 to 1.0,
  "raw_text": "all readable text on the card, line by line",
  "reasoning": "what you can/cannot read clearly"
}

Common warranty card formats:
- Rolex: green card with reference, serial, dealer, date. Serial is 8 chars alphanumeric.
- Patek Philippe: certificate with reference, movement number, case number
- AP: card with reference, serial, dealer stamp
- Tudor: similar to Rolex format

Read EVERY character carefully. Serial numbers and reference numbers must be exact — a single wrong digit makes the data useless. If a character is ambiguous, note it in reasoning.

Return ONLY the JSON object, no markdown fences or extra text."""


class WatchRecognizer:
    """
    Main recognition engine. Wraps Claude Vision API with
    cross-referencing against the market database.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        refs_path: Optional[Path] = None,
        cache_dir: Optional[Path] = None,
        model: str = "claude-sonnet-4-20250514",
    ):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY required. Set it as an env var or pass api_key=."
            )
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = model
        self.ref_db = ReferenceDatabase(refs_path)
        self.cache = ResultCache(cache_dir)

    def _load_image(self, image_input) -> tuple[bytes, str]:
        """
        Accept file path, Path object, or raw bytes.
        Returns (bytes, media_type).
        """
        if isinstance(image_input, (str, Path)):
            path = Path(image_input)
            data = path.read_bytes()
            ext = path.suffix.lower()
            media_map = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".gif": "image/gif",
                ".webp": "image/webp", ".heic": "image/heic",
            }
            media_type = media_map.get(ext, "image/jpeg")
            return data, media_type
        elif isinstance(image_input, bytes):
            # Sniff format from magic bytes
            if image_input[:4] == b'\x89PNG':
                return image_input, "image/png"
            return image_input, "image/jpeg"
        else:
            raise TypeError(f"Expected file path or bytes, got {type(image_input)}")

    def _call_vision(self, image_bytes: bytes, media_type: str, prompt: str) -> str:
        """Send image to Claude Vision and return the text response."""
        b64 = base64.standard_b64encode(image_bytes).decode("ascii")
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }],
        )
        return response.content[0].text

    def _parse_json(self, text: str) -> dict:
        """Extract JSON from Claude's response, handling markdown fences."""
        # Strip markdown code fences if present
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*\n?", "", text)
            text = re.sub(r"\n?```\s*$", "", text)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON object in the text
            match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
            if match:
                return json.loads(match.group(0))
            raise ValueError(f"Could not parse JSON from response: {text[:200]}")

    def identify_watch(self, image_input, use_cache: bool = True) -> WatchIdentification:
        """
        Identify a watch from a photo.

        Args:
            image_input: File path (str/Path) or raw image bytes.
            use_cache: If True, return cached result for identical images.

        Returns:
            WatchIdentification with reference, model, dial, pricing, etc.
        """
        image_bytes, media_type = self._load_image(image_input)

        # Check cache
        if use_cache:
            cached = self.cache.get(image_bytes, "identify")
            if cached:
                cached.pop("_ts", None)
                result = WatchIdentification(**{
                    k: v for k, v in cached.items()
                    if k in WatchIdentification.__dataclass_fields__
                })
                return self.ref_db.enrich(result)

        # Call Claude Vision
        raw_text = self._call_vision(image_bytes, media_type, IDENTIFY_PROMPT)
        data = self._parse_json(raw_text)

        result = WatchIdentification(
            reference=data.get("reference", ""),
            brand=data.get("brand", ""),
            model=data.get("model", ""),
            dial=data.get("dial", ""),
            bracelet=data.get("bracelet", ""),
            bezel=data.get("bezel", ""),
            condition=data.get("condition", "Unknown"),
            confidence=float(data.get("confidence", 0)),
            reasoning=data.get("reasoning", ""),
        )

        # Cross-reference with market database
        result = self.ref_db.enrich(result)

        # Cache the result
        if use_cache:
            self.cache.put(image_bytes, "identify", result.to_dict())

        return result

    def read_warranty_card(self, image_input, use_cache: bool = True) -> WarrantyCardReading:
        """
        Read a warranty card and extract structured data.

        Args:
            image_input: File path (str/Path) or raw image bytes.
            use_cache: If True, return cached result for identical images.

        Returns:
            WarrantyCardReading with serial, reference, date, etc.
        """
        image_bytes, media_type = self._load_image(image_input)

        # Check cache
        if use_cache:
            cached = self.cache.get(image_bytes, "warranty")
            if cached:
                cached.pop("_ts", None)
                card = WarrantyCardReading(**{
                    k: v for k, v in cached.items()
                    if k in WarrantyCardReading.__dataclass_fields__
                })
                return self.ref_db.enrich_card(card)

        # Call Claude Vision
        raw_text = self._call_vision(image_bytes, media_type, WARRANTY_CARD_PROMPT)
        data = self._parse_json(raw_text)

        card = WarrantyCardReading(
            reference=data.get("reference", ""),
            serial_number=data.get("serial_number", ""),
            purchase_date=data.get("purchase_date", ""),
            dealer=data.get("dealer", ""),
            brand=data.get("brand", ""),
            model=data.get("model", ""),
            confidence=float(data.get("confidence", 0)),
            raw_text=data.get("raw_text", ""),
            reasoning=data.get("reasoning", ""),
        )

        # Validate serial number format
        serial = card.serial_number
        if serial:
            # Rolex: 8 alphanumeric chars (post-2010 random)
            # Patek: typically 6-7 digits
            # AP: varies
            card.serial_format_valid = bool(
                re.match(r'^[A-Z0-9]{6,10}$', serial.replace(" ", ""))
            )

        # Cross-reference
        card = self.ref_db.enrich_card(card)

        # Cache
        if use_cache:
            self.cache.put(image_bytes, "warranty", card.to_dict())

        return card

    def identify_batch(self, image_paths: list, use_cache: bool = True) -> list[WatchIdentification]:
        """Identify multiple watches. Returns results in order."""
        return [self.identify_watch(p, use_cache=use_cache) for p in image_paths]


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

def _format_identification(r: WatchIdentification) -> str:
    lines = [
        f"  Reference:   {r.reference}",
        f"  Brand:       {r.brand}",
        f"  Model:       {r.model}",
        f"  Dial:        {r.dial}",
        f"  Bracelet:    {r.bracelet}",
        f"  Bezel:       {r.bezel}",
        f"  Condition:   {r.condition}",
        f"  Confidence:  {r.confidence:.0%}",
    ]
    if r.market_price_b25:
        lines.append(f"  Market B25:  ${r.market_price_b25:,}")
    if r.market_price_low and r.market_price_high:
        lines.append(f"  Range:       ${r.market_price_low:,} – ${r.market_price_high:,}")
    if r.market_listings:
        lines.append(f"  Listings:    {r.market_listings}")
    if r.dial_premium:
        lines.append(f"  Dial prem:   {r.dial_premium}")
    if r.reasoning:
        lines.append(f"  Reasoning:   {r.reasoning}")
    if r.alternates:
        lines.append("  Alternates:")
        for alt in r.alternates:
            p = f" (${alt['b25']:,})" if alt.get('b25') else ""
            lines.append(f"    - {alt['ref']} {alt.get('model','')}{p} [{alt['score']:.0%}]")
    return "\n".join(lines)


def _format_card(c: WarrantyCardReading) -> str:
    lines = [
        f"  Reference:    {c.reference} {'VALID' if c.reference_valid else 'NOT IN DB'}",
        f"  Serial:       {c.serial_number} {'OK' if c.serial_format_valid else 'FORMAT?'}",
        f"  Date:         {c.purchase_date}",
        f"  Dealer:       {c.dealer}",
        f"  Brand:        {c.brand}",
        f"  Model:        {c.model}",
        f"  Confidence:   {c.confidence:.0%}",
    ]
    if c.market_price_b25:
        lines.append(f"  Market B25:   ${c.market_price_b25:,}")
    if c.reasoning:
        lines.append(f"  Reasoning:    {c.reasoning}")
    return "\n".join(lines)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Watch Recognition Engine")
    parser.add_argument("mode", choices=["identify", "warranty-card", "batch"],
                       help="Recognition mode")
    parser.add_argument("images", nargs="+", help="Image file path(s)")
    parser.add_argument("--model", default="claude-sonnet-4-20250514",
                       help="Claude model to use")
    parser.add_argument("--no-cache", action="store_true",
                       help="Skip result cache")
    parser.add_argument("--json", action="store_true",
                       help="Output raw JSON")
    args = parser.parse_args()

    try:
        rec = WatchRecognizer(model=args.model)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.mode == "identify":
        for img in args.images:
            print(f"\nIdentifying: {img}")
            result = rec.identify_watch(img, use_cache=not args.no_cache)
            if args.json:
                print(json.dumps(result.to_dict(), indent=2))
            else:
                print(_format_identification(result))

    elif args.mode == "warranty-card":
        for img in args.images:
            print(f"\nReading warranty card: {img}")
            card = rec.read_warranty_card(img, use_cache=not args.no_cache)
            if args.json:
                print(json.dumps(card.to_dict(), indent=2))
            else:
                print(_format_card(card))

    elif args.mode == "batch":
        results = rec.identify_batch(args.images, use_cache=not args.no_cache)
        for img, result in zip(args.images, results):
            print(f"\n{img}:")
            if args.json:
                print(json.dumps(result.to_dict(), indent=2))
            else:
                print(_format_identification(result))


if __name__ == "__main__":
    main()
