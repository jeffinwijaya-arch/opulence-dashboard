#!/usr/bin/env python3
"""
Export price analyzer data → JSON files for the Opulence Dashboard.

Run after every `parse_v4.py refresh` to update dashboard data.

Usage:
    python3 export_data.py              # Export all data
    python3 export_data.py --upload     # Export + upload to Cloudflare KV

Pipeline:
    WhatsApp → ../price_analyzer/parse_v4.py → rolex_listings.json
                                             ↓
                                     export_data.py (this file)
                                             ↓
                  public/data/{bundle,refs,listings,summary,...}.json

Before computing the rollups, this script now:

  1. Merges in public/data/manual_listings.json — a version-controlled
     channel for listings parse_v4 missed (dealers you talk with
     directly, groups you're not scraping, etc). Same schema as
     listings.json, with an extra `source: "manual:..."` tag for
     traceability.

  2. Deduplicates cross-posts. The old pipeline counted every copy of
     a listing in every WhatsApp group as a separate comparable, which
     inflated counts by ~2x and hid the fact that single dealers were
     cross-posting the same offer in 4+ groups. Dedupe runs in two
     passes:
        a) phone-normalized seller identity — catches "Winner (+86…)",
           "+86 184 …", "+8618466508645" all being one dealer;
        b) content identity (ref + price + dial + cond + year) — catches
           cross-posts where the seller string is a WhatsApp channel
           id or an emoji-only group name with no phone at all.
     When collapsing, the kept record's `group` field becomes a
     slash-joined list of every group the cross-post appeared in,
     and `x_post_count` records how many copies were merged.

Keep compute_ref_stats() / compute_deals() / compute_arbitrage() in
sync with scripts/rebuild_dashboard_data.py — the two pipelines MUST
produce identical output from identical input, so changes here
should land there too (and vice versa).
"""

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


# ─────────────────────────────────────────────────────────────
# Stats helpers
# ─────────────────────────────────────────────────────────────

def avg_bottom_25(prices):
    """Average of bottom 25% of prices. Min 2 items. If <2 eligible, use lowest."""
    if not prices:
        return None
    sorted_p = sorted(prices)
    n = max(2, len(sorted_p) // 4)
    n = min(n, len(sorted_p))
    return round(sum(sorted_p[:n]) / n)


# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────

ANALYZER_DIR   = Path(__file__).parent.parent / "price_analyzer"
LISTINGS_FILE  = ANALYZER_DIR / "rolex_listings.json"
WHOLESALE_FILE = ANALYZER_DIR / "rolex_wholesale.json"
REFERENCE_FILE = ANALYZER_DIR / "reference_data.json"
OUTPUT_DIR     = Path(__file__).parent / "public" / "data"
MANUAL_FILE    = OUTPUT_DIR / "manual_listings.json"

sys.path.insert(0, str(ANALYZER_DIR))
try:
    from parse_v4 import extract_dial  # noqa: F401 — used by the wholesale path below
except Exception:
    # parse_v4 isn't available in every environment (e.g. when running
    # from the dashboard repo only). The manual-merge + dedupe paths
    # don't need it. For a full export the user's machine will have
    # parse_v4 on the sibling path.
    extract_dial = None


# ─────────────────────────────────────────────────────────────
# Manual listings merge
# ─────────────────────────────────────────────────────────────

def load_manual_listings():
    """
    Load public/data/manual_listings.json and convert each record from
    the listings.json output schema (field name: `price`) to the
    internal schema used here (`price_usd`). Comment objects (entries
    with `_comment` and no `ref`) are skipped silently so the file can
    carry human-readable documentation.
    """
    if not MANUAL_FILE.exists():
        return []
    try:
        with open(MANUAL_FILE) as f:
            raw = json.load(f)
    except Exception as e:
        print(f"  ! {MANUAL_FILE.name} is not valid JSON: {e}")
        return []
    out = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        ref = entry.get("ref")
        price = entry.get("price")
        if not ref or price is None:
            continue  # comment row or incomplete record
        out.append({
            "ref": str(ref),
            "model": entry.get("model", ""),
            "brand": entry.get("brand", "Rolex"),
            "price_usd": float(price),
            "dial": entry.get("dial", ""),
            "bracelet": entry.get("bracelet", ""),
            "condition": entry.get("condition", ""),
            "completeness": entry.get("completeness", ""),
            "region": entry.get("region", ""),
            "seller": entry.get("seller", ""),
            "group": entry.get("group", ""),
            "year": entry.get("year", ""),
            "source": entry.get("source", "manual"),
        })
    return out


# ─────────────────────────────────────────────────────────────
# Cross-post dedupe
# ─────────────────────────────────────────────────────────────

_PHONE_RX    = re.compile(r"\+?\d[\d\s\-()]{7,}")
_DIGITS_ONLY = re.compile(r"\D+")


def _normalize_seller(seller):
    """
    Collapse the many string variants of a single dealer's name into
    one canonical id. Same dealer posts as "Winner (+8618466508645)"
    in one group and "+86 184 6650 8645" in another; phone-digit
    extraction catches both. Sellers with no phone (WhatsApp channel
    ids, emoji names) fall back to lowercase-trimmed raw string.
    """
    if not seller:
        return ""
    s = str(seller)
    phone_match = _PHONE_RX.search(s)
    if phone_match:
        digits = _DIGITS_ONLY.sub("", phone_match.group(0)).lstrip("0")
        if len(digits) >= 8:
            return "phone:" + digits
    return "raw:" + s.strip().lower()


def dedupe_cross_posts(listings):
    """
    Two-pass dedupe.

    Pass 1 — phone-normalized seller match:
        key = (ref, rounded price_usd, normalized seller)
        catches "same dealer, same watch, same price, N groups"

    Pass 2 — content match on whatever survived pass 1:
        key = (ref, rounded price_usd, dial, condition, year)
        catches cross-posts where the seller string is a WhatsApp
        channel id / emoji group / missing phone entirely

    Returns (deduped_listings, collapsed_count).
    """
    def merge_group(existing, incoming):
        groups = set()
        if existing.get("group"):
            groups.update(str(existing["group"]).split(" / "))
        if incoming.get("group"):
            groups.update(str(incoming["group"]).split(" / "))
        existing["group"] = " / ".join(sorted(g for g in groups if g))
        existing["x_post_count"] = existing.get("x_post_count", 1) + 1
        return existing

    # Pass 1
    pass1 = []
    seen_phone = {}
    collapsed = 0
    for l in listings:
        ref = str(l.get("ref", "")).upper()
        price = round(float(l.get("price_usd", 0) or 0))
        if not ref or not price:
            continue
        seller_key = _normalize_seller(l.get("seller"))
        if not seller_key.startswith("phone:"):
            rec = dict(l)
            rec.setdefault("x_post_count", 1)
            pass1.append(rec)
            continue
        key = (ref, price, seller_key)
        if key in seen_phone:
            merge_group(seen_phone[key], l)
            collapsed += 1
        else:
            rec = dict(l)
            rec.setdefault("x_post_count", 1)
            seen_phone[key] = rec
            pass1.append(rec)

    # Pass 2
    final = []
    seen_content = {}
    for rec in pass1:
        ref = str(rec.get("ref", "")).upper()
        price = round(float(rec.get("price_usd", 0) or 0))
        dial = (rec.get("dial") or "").strip().lower()
        cond = (rec.get("condition") or "").strip().lower()
        year = (rec.get("year") or "").strip()
        ckey = (ref, price, dial, cond, year)
        if ckey in seen_content:
            merge_group(seen_content[ckey], rec)
            collapsed += 1
        else:
            seen_content[ckey] = rec
            final.append(rec)

    return final, collapsed


# ─────────────────────────────────────────────────────────────
# Load listings (parse_v4 output + manual supplement)
# ─────────────────────────────────────────────────────────────

def load_listings():
    """Load retail listings + wholesale offers into a unified list."""
    with open(LISTINGS_FILE) as f:
        listings = json.load(f)

    # Merge wholesale offers with enrichment
    # NOTE: Wholesale merge disabled — wholesale index (rolex_wholesale.json) is
    # derived from rolex_listings.json and may have stale/wrong prices. All data
    # comes from rolex_listings.json which has the authoritative currency-
    # corrected prices.
    if False and WHOLESALE_FILE.exists():
        with open(WHOLESALE_FILE) as f:
            wholesale = json.load(f)
        for ref, data in wholesale.items():
            if not isinstance(data, dict) or "offers" not in data:
                continue
            valid_offers = [o for o in data["offers"] if o.get("price_usd") or o.get("pusd") or o.get("price")]
            if not valid_offers:
                continue
            data["offers"] = valid_offers
            model = data.get("model", "")
            brand = data.get("brand", "Rolex")
            for offer in data["offers"]:
                current_dial = offer.get("dial", "")
                current_condition = offer.get("cond", offer.get("condition", ""))
                completeness = "Full Set"
                condition = current_condition
                if not condition or condition.lower() in ("", "unknown"):
                    condition = "BNIB"
                elif condition.lower() in ("pre-owned", "preowned", "used"):
                    condition = "Pre-owned"
                elif condition.lower() in ("bnib", "new", "mint"):
                    condition = "BNIB"
                dial = current_dial
                if not dial or dial.lower() in ("", "unknown", "blue", "black", "white", "green", "silver"):
                    text_fields = []
                    if offer.get("orig"):
                        text_fields.append(offer["orig"])
                    if offer.get("seller"):
                        text_fields.append(offer["seller"])
                    if offer.get("group"):
                        text_fields.append(offer["group"])
                    combined_text = " ".join(text_fields)
                    if combined_text and extract_dial is not None:
                        extracted_dial = extract_dial(combined_text, ref)
                        if extracted_dial and extracted_dial != dial:
                            if not dial or len(extracted_dial) > len(dial):
                                dial = extracted_dial
                pusd = offer.get("price_usd") or offer.get("pusd") or offer.get("price") or 0
                if pusd and pusd >= 2500:
                    listings.append({
                        "ref": ref,
                        "model": model,
                        "brand": brand,
                        "price_usd": pusd,
                        "dial": dial,
                        "bracelet": offer.get("bracelet", ""),
                        "condition": condition,
                        "completeness": completeness,
                        "region": offer.get("region", ""),
                        "seller": offer.get("seller", ""),
                        "group": offer.get("group", ""),
                        "year": offer.get("year", ""),
                        "source": "wholesale",
                    })
    return listings


def load_reference():
    with open(REFERENCE_FILE) as f:
        return json.load(f)


# ─────────────────────────────────────────────────────────────
# Rollups
# ─────────────────────────────────────────────────────────────

def compute_ref_stats(listings):
    """Compute per-reference statistics."""
    by_ref = defaultdict(list)
    for l in listings:
        by_ref[l["ref"]].append(l)

    stats = {}
    for ref, items in by_ref.items():
        prices = [x["price_usd"] for x in items if x.get("price_usd")]
        if not prices:
            continue

        us_prices = [x["price_usd"] for x in items if x.get("region") == "US" and x.get("price_usd")]
        hk_prices = [x["price_usd"] for x in items if x.get("region") == "HK" and x.get("price_usd")]

        conditions = defaultdict(int)
        for x in items:
            conditions[x.get("condition", "Unknown")] += 1

        dials = defaultdict(list)
        for x in items:
            d = x.get("dial", "Unknown")
            if x.get("price_usd"):
                dials[d].append(x["price_usd"])

        dial_stats = {}
        for d, dp in dials.items():
            b25 = avg_bottom_25(dp)
            dial_stats[d] = {
                "count": len(dp),
                "low": min(dp),
                "high": max(dp),
                "avg": round(statistics.mean(dp)),
                "b25": b25,
                "median": b25,  # backward compat
            }

        model = items[0].get("model", "")
        brand = items[0].get("brand", "Rolex")
        overall_b25 = avg_bottom_25(prices)

        s = {
            "ref": ref,
            "model": model,
            "brand": brand,
            "count": len(items),
            "low": min(prices),
            "high": max(prices),
            "avg": round(statistics.mean(prices)),
            "b25": overall_b25,
            "median": overall_b25,  # backward compat
            "conditions": dict(conditions),
            "dials": dial_stats,
            "us_count": len(us_prices),
            "hk_count": len(hk_prices),
        }
        if us_prices:
            s["us_b25"] = avg_bottom_25(us_prices)
            s["us_median"] = s["us_b25"]  # backward compat
            s["us_low"] = min(us_prices)
        if hk_prices:
            s["hk_b25"] = avg_bottom_25(hk_prices)
            s["hk_median"] = s["hk_b25"]  # backward compat
            s["hk_low"] = min(hk_prices)

        if us_prices and hk_prices:
            us_med = avg_bottom_25(us_prices)
            hk_med = avg_bottom_25(hk_prices)
            s["arb_spread_pct"] = round((us_med - hk_med) / hk_med * 100, 1)
            s["arb_profit_est"] = round(us_med - hk_med - 450)  # ~$450 import cost

        stats[ref] = s
    return stats


def compute_deals(listings, ref_stats):
    """Find best deals — listings significantly below median."""
    deals = []
    for l in listings:
        ref = l["ref"]
        if ref not in ref_stats:
            continue
        s = ref_stats[ref]
        benchmark = s.get("us_median", s["median"])
        price = l.get("price_usd", 0)
        if not price or not benchmark or benchmark <= 0:
            continue
        discount = (benchmark - price) / benchmark * 100
        if discount >= 7:
            deals.append({
                "ref": ref,
                "model": s.get("model", ""),
                "brand": s.get("brand", "Rolex"),
                "dial": l.get("dial", ""),
                "price": round(price),
                "benchmark": round(benchmark),
                "discount_pct": round(discount, 1),
                "condition": l.get("condition", ""),
                "completeness": l.get("completeness", ""),
                "region": l.get("region", ""),
                "seller": l.get("seller", ""),
                "group": l.get("group", ""),
            })
    deals.sort(key=lambda x: -x["discount_pct"])
    return deals[:100]


def compute_arbitrage(ref_stats):
    """Find HK→US arbitrage opportunities."""
    arbs = []
    for ref, s in ref_stats.items():
        if "arb_profit_est" not in s or s["arb_profit_est"] < 500:
            continue
        arbs.append({
            "ref": ref,
            "model": s.get("model", ""),
            "brand": s.get("brand", "Rolex"),
            "hk_median": s.get("hk_median"),
            "hk_low": s.get("hk_low"),
            "us_median": s.get("us_median"),
            "spread_pct": s.get("arb_spread_pct"),
            "profit_est": s["arb_profit_est"],
            "hk_count": s.get("hk_count", 0),
            "us_count": s.get("us_count", 0),
        })
    arbs.sort(key=lambda x: -x["profit_est"])
    return arbs


def compute_market_summary(listings, ref_stats):
    """Overall market health indicators."""
    prices = [x["price_usd"] for x in listings if x.get("price_usd")]
    brands = defaultdict(int)
    regions = defaultdict(int)
    conditions = defaultdict(int)
    groups = set()
    sellers = set()
    for l in listings:
        brands[l.get("brand", "Unknown")] += 1
        regions[l.get("region", "?")] += 1
        conditions[l.get("condition", "Unknown")] += 1
        if l.get("group"):
            groups.add(l["group"])
        if l.get("seller"):
            sellers.add(l["seller"])
    top_refs = sorted(ref_stats.values(), key=lambda x: -x["count"])[:20]
    return {
        "total_listings": len(listings),
        "unique_refs": len(ref_stats),
        "unique_sellers": len(sellers),
        "unique_groups": len(groups),
        "avg_price": round(statistics.mean(prices)) if prices else 0,
        "median_price": round(statistics.median(prices)) if prices else 0,
        "brands": dict(brands),
        "regions": dict(regions),
        "conditions": dict(conditions),
        "top_refs": [{
            "ref": r["ref"],
            "model": r.get("model", ""),
            "count": r["count"],
            "low": r["low"],
            "avg": r["avg"],
            "median": r["median"],
        } for r in top_refs],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def compute_market_movers(ref_stats):
    """Refs with significant price dispersion (high std dev relative to median)."""
    movers = []
    for ref, s in ref_stats.items():
        if s["count"] < 3:
            continue
        spread = (s["high"] - s["low"]) / s["median"] * 100 if s["median"] > 0 else 0
        movers.append({
            "ref": ref,
            "model": s.get("model", ""),
            "median": s["median"],
            "low": s["low"],
            "high": s["high"],
            "spread_pct": round(spread, 1),
            "count": s["count"],
        })
    movers.sort(key=lambda x: -x["spread_pct"])
    return movers[:30]


def compute_sellers_leaderboard(listings):
    """Top sellers by volume and average discount."""
    by_seller = defaultdict(list)
    for l in listings:
        s = l.get("seller", "")
        if s:
            by_seller[s].append(l)
    board = []
    for seller, items in by_seller.items():
        prices = [x["price_usd"] for x in items if x.get("price_usd")]
        regions = set(x.get("region", "") for x in items)
        groups = set(x.get("group", "") for x in items)
        board.append({
            "seller": seller,
            "count": len(items),
            "avg_price": round(statistics.mean(prices)) if prices else 0,
            "regions": list(regions),
            "groups": list(groups)[:3],
        })
    board.sort(key=lambda x: -x["count"])
    return board[:50]


def build_listings_index(listings):
    """Lightweight listing index for search/browse."""
    return [{
        "ref": l["ref"],
        "price": round(l.get("price_usd", 0)),
        "dial": l.get("dial", ""),
        "bracelet": l.get("bracelet", ""),
        "condition": l.get("condition", ""),
        "completeness": l.get("completeness", ""),
        "region": l.get("region", ""),
        "seller": l.get("seller", ""),
        "group": l.get("group", ""),
        "model": l.get("model", ""),
        "brand": l.get("brand", "Rolex"),
        "year": l.get("year", ""),
    } for l in listings if l.get("price_usd") and l.get("price_usd") >= 3000]


# ─────────────────────────────────────────────────────────────
# Export
# ─────────────────────────────────────────────────────────────

def export_all():
    print("📊 Loading listings...")
    listings = load_listings()
    print(f"  {len(listings):,} listings loaded from rolex_listings.json")

    # Merge manual supplement (listings the parser missed).
    manual = load_manual_listings()
    if manual:
        listings.extend(manual)
        print(f"  + {len(manual)} manual listing(s) from {MANUAL_FILE.name}")

    # Collapse cross-posts BEFORE computing stats — otherwise every
    # rollup is inflated by the cross-post multiplier (~2x).
    deduped, collapsed = dedupe_cross_posts(listings)
    if collapsed:
        print(f"  − collapsed {collapsed:,} cross-post duplicates")
    print(f"  = {len(deduped):,} unique listings after dedupe")
    listings = deduped

    # Wholesale enrichment stats (if any slipped through).
    wholesale_listings = [l for l in listings if l.get("source") == "wholesale"]
    if wholesale_listings:
        total = len(wholesale_listings)
        full_set = len([l for l in wholesale_listings if l.get("completeness") == "Full Set"])
        bnib = len([l for l in wholesale_listings if l.get("condition") == "BNIB"])
        dial = len([l for l in wholesale_listings if l.get("dial") and l.get("dial") != ""])
        print(f"  📦 Wholesale offers: {total:,}")
        print(f"     ✅ Full Set: {full_set:,} ({full_set/total*100:.1f}%)")
        print(f"     🆕 BNIB:     {bnib:,} ({bnib/total*100:.1f}%)")
        print(f"     🎨 Dial:     {dial:,} ({dial/total*100:.1f}%)")

    print("📈 Computing reference stats...")
    ref_stats = compute_ref_stats(listings)
    print(f"  {len(ref_stats):,} refs analyzed")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "summary":   compute_market_summary(listings, ref_stats),
        "deals":     compute_deals(listings, ref_stats),
        "arbitrage": compute_arbitrage(ref_stats),
        "movers":    compute_market_movers(ref_stats),
        "sellers":   compute_sellers_leaderboard(listings),
        "refs":      ref_stats,
        "listings":  build_listings_index(listings),
    }

    for key, value in data.items():
        outfile = OUTPUT_DIR / f"{key}.json"
        with open(outfile, "w") as f:
            json.dump(value, f, separators=(",", ":"))
        size = outfile.stat().st_size
        print(f"  ✅ {key}.json ({size:,} bytes)")

    # Combined bundle for initial load (excludes the big listings index).
    bundle = {k: v for k, v in data.items() if k != "listings"}
    bundle_file = OUTPUT_DIR / "bundle.json"
    with open(bundle_file, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))
    print(f"  ✅ bundle.json ({bundle_file.stat().st_size:,} bytes)")

    # Post-merge audit for manually-touched refs — so the owner can
    # immediately see whether the manual entries landed correctly.
    manual_refs = sorted({m["ref"] for m in manual})
    if manual_refs:
        print("\n📋 Post-merge audit for manually-touched refs:")
        for ref in manual_refs:
            s = ref_stats.get(ref)
            if not s:
                print(f"   {ref}: MISSING (neither parser nor manual had usable records)")
                continue
            print(
                f"   {ref}: {s['count']} listings · b25 ${s['b25']:,} · "
                f"low ${int(s['low']):,} · high ${int(s['high']):,} · "
                f"US {s.get('us_count', 0)} (${s.get('us_b25', 0) or 0:,}) · "
                f"HK {s.get('hk_count', 0)} (${s.get('hk_b25', 0) or 0:,})"
            )

    print(f"\n🎯 Export complete → {OUTPUT_DIR}")
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true", help="Upload to Cloudflare KV after export")
    args = parser.parse_args()

    data = export_all()

    if args.upload:
        print("\n☁️  Uploading to Cloudflare KV...")
        for key in ["summary", "deals", "arbitrage", "movers", "sellers", "refs", "listings", "bundle"]:
            filepath = OUTPUT_DIR / f"{key}.json"
            subprocess.run([
                "wrangler", "kv", "key", "put",
                "--namespace-id", os.environ.get("KV_NAMESPACE_ID", ""),
                f"data:{key}", "--path", str(filepath),
            ], check=True)
            print(f"   ☁️  {key} uploaded")
        print("✅ All data uploaded to Cloudflare KV")
