#!/usr/bin/env python3
"""
rebuild_dashboard_data.py — regenerate dashboard price data from this repo alone.
==================================================================================

The full data pipeline is:

    WhatsApp scraper → ../price_analyzer/parse_v4.py → rolex_listings.json
                                                     ↓
                                            export_data.py (this repo)
                                                     ↓
                                public/data/{bundle,refs,listings,...}.json

That pipeline has two real-world failure modes:

    1. The scraper isn't subscribed to a group the dealer posts in, so
       whole categories of listings never reach parse_v4 in the first
       place (the US RWB/Timepieces/SELL-Bay/MDA dealers, for example).

    2. parse_v4 runs on someone else's laptop, so if export_data.py
       is broken or rolex_listings.json is stale, the dashboard can't
       be rebuilt from this repo by a second person.

This script fixes both. It reads the CURRENT public/data/listings.json
as its baseline (which is the normalized output format, not parse_v4's
internal format), merges in public/data/manual_listings.json for any
listings that never made it through the pipeline, collapses obvious
cross-posts (same ref + same price + same seller posted in multiple
groups = one listing, not N), and recomputes bundle.json, refs.json
and listings.json using the SAME b25 formula as export_data.py so
there is no schema drift.

No external dependencies. Pure stdlib. Run it any time manual listings
are added or the data looks wrong:

    python3 scripts/rebuild_dashboard_data.py

It prints a summary of what changed (new refs, updated refs, dedupe
count) so you can see exactly what hit the frontend.
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT           = Path(__file__).resolve().parent.parent
DATA_DIR       = ROOT / "public" / "data"
LISTINGS_FILE  = DATA_DIR / "listings.json"
MANUAL_FILE    = DATA_DIR / "manual_listings.json"
BUNDLE_FILE    = DATA_DIR / "bundle.json"
REFS_FILE      = DATA_DIR / "refs.json"
SUMMARY_FILE   = DATA_DIR / "summary.json"
DEALS_FILE     = DATA_DIR / "deals.json"
ARBITRAGE_FILE = DATA_DIR / "arbitrage.json"
MOVERS_FILE    = DATA_DIR / "movers.json"
SELLERS_FILE   = DATA_DIR / "sellers.json"


# ─────────────────────────────────────────────────────────────
# Stats helpers — MUST match export_data.py so the two pipelines
# produce identical output when given the same input.
# ─────────────────────────────────────────────────────────────

def avg_bottom_25(prices):
    """Average of the bottom 25% of prices, min 2 items."""
    if not prices:
        return None
    sorted_p = sorted(prices)
    n = max(2, len(sorted_p) // 4)
    n = min(n, len(sorted_p))
    return round(sum(sorted_p[:n]) / n)


def load_json(path, default):
    if not path.exists():
        return default
    with path.open() as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as e:
            print(f"  ! {path.name} is not valid JSON: {e}", file=sys.stderr)
            return default


def load_listings():
    """
    Load the current listings.json, then merge in manual_listings.json
    for anything the parser missed. Normalizes shape (both files use
    the output schema: `price` not `price_usd`).
    """
    base = load_json(LISTINGS_FILE, [])
    manual_raw = load_json(MANUAL_FILE, [])
    # Drop comment objects (entries that contain _comment and nothing
    # else useful). This lets us keep human-readable documentation
    # right inside manual_listings.json without breaking the loader.
    manual = [m for m in manual_raw if isinstance(m, dict) and m.get("ref") and m.get("price") is not None]
    dropped = len(manual_raw) - len(manual)
    if dropped:
        print(f"  - skipped {dropped} comment/empty entr{'y' if dropped == 1 else 'ies'} in manual_listings.json")
    return list(base), manual


import re

_PHONE_RX = re.compile(r"\+?\d[\d\s\-()]{7,}")
_DIGITS_ONLY = re.compile(r"\D+")


def _normalize_seller(seller):
    """
    The same dealer shows up with three different seller strings in
    the wild — "Winner (+8618466508645)", "+86 184 6650 8645", and
    some base64-ish WhatsApp channel id like "CNn6ns4GIABIAZABAPABAg==".
    Phone-digit normalization catches the first two. The third has no
    phone, so it falls back to the raw string. Neither is perfect,
    but combined with the content-based dedupe key below they're
    enough to collapse real cross-posts.
    """
    if not seller:
        return ""
    s = str(seller)
    phone_match = _PHONE_RX.search(s)
    if phone_match:
        digits = _DIGITS_ONLY.sub("", phone_match.group(0))
        # Strip leading zeros / country-code variants (e.g. "0086..."
        # and "86..." both become "86...").
        digits = digits.lstrip("0")
        if len(digits) >= 8:
            return "phone:" + digits
    return "raw:" + s.strip().lower()


def dedupe(listings):
    """
    Collapse obvious cross-posts. A single listing posted by one
    dealer in N different WhatsApp groups should count as ONE, not N.

    Two-pass dedupe:

      Pass 1 — exact phone-normalized seller identity
        Key = (ref, rounded price, normalized seller)
        Catches the "Winner (+86...)", "+86 184...", "+8618466508645"
        case where the seller text varies but the phone is the same.

      Pass 2 — content identity (for records with no usable phone)
        Key = (ref, rounded price, dial, condition, year)
        Catches cross-posts where the seller is a WhatsApp channel
        id / emoji / name with no phone at all. Five-attribute match
        is specific enough that the false-positive rate is basically
        zero for real watch listings.

    When collapsing, the kept record's `group` field becomes a
    slash-joined list of every group the cross-post appeared in
    so the data is not lost. An `x_post_count` field is added so
    downstream code can tell a single listing from a consolidated
    cross-post.
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

    # Pass 1: phone-normalized seller match.
    seen = {}
    pass1_survivors = []
    collapsed_pass1 = 0
    for l in listings:
        ref = str(l.get("ref", "")).upper()
        price = round(float(l.get("price", 0) or 0))
        if not ref or not price:
            continue
        seller_key = _normalize_seller(l.get("seller"))
        # Records with no normalizable seller skip pass 1 and go
        # straight to pass 2.
        if not seller_key.startswith("phone:"):
            rec = dict(l)
            rec.setdefault("x_post_count", 1)
            pass1_survivors.append(rec)
            continue
        key = (ref, price, seller_key)
        if key in seen:
            merge_group(seen[key], l)
            collapsed_pass1 += 1
        else:
            rec = dict(l)
            rec.setdefault("x_post_count", 1)
            seen[key] = rec
            pass1_survivors.append(rec)

    # Pass 2: content-based dedupe on whatever is left. Build a
    # separate index and walk pass1_survivors in order.
    content_seen = {}
    final = []
    collapsed_pass2 = 0
    for rec in pass1_survivors:
        ref = str(rec.get("ref", "")).upper()
        price = round(float(rec.get("price", 0) or 0))
        dial = (rec.get("dial") or "").strip().lower()
        cond = (rec.get("condition") or "").strip().lower()
        year = (rec.get("year") or "").strip()
        ckey = (ref, price, dial, cond, year)
        if ckey in content_seen:
            merge_group(content_seen[ckey], rec)
            collapsed_pass2 += 1
        else:
            content_seen[ckey] = rec
            final.append(rec)

    return final, collapsed_pass1 + collapsed_pass2


def compute_ref_stats(listings):
    """
    Per-reference rollup. Mirrors export_data.py.compute_ref_stats()
    one-for-one. If you update the math here, also update it there.
    """
    by_ref = defaultdict(list)
    for l in listings:
        if l.get("ref") and l.get("price"):
            by_ref[l["ref"]].append(l)

    stats = {}
    for ref, items in by_ref.items():
        prices = [x["price"] for x in items if x.get("price")]
        if not prices:
            continue

        us_prices = [x["price"] for x in items if x.get("region") == "US" and x.get("price")]
        hk_prices = [x["price"] for x in items if x.get("region") == "HK" and x.get("price")]

        conditions = defaultdict(int)
        for x in items:
            conditions[x.get("condition", "Unknown")] += 1

        dials = defaultdict(list)
        for x in items:
            d = x.get("dial") or "Unknown"
            if x.get("price"):
                dials[d].append(x["price"])

        dial_stats = {}
        for d, dp in dials.items():
            b25 = avg_bottom_25(dp)
            dial_stats[d] = {
                "count": len(dp),
                "low": min(dp),
                "high": max(dp),
                "avg": round(statistics.mean(dp)),
                "b25": b25,
                "median": b25,
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
            "median": overall_b25,
            "conditions": dict(conditions),
            "dials": dial_stats,
            "us_count": len(us_prices),
            "hk_count": len(hk_prices),
        }
        if us_prices:
            s["us_b25"] = avg_bottom_25(us_prices)
            s["us_median"] = s["us_b25"]
            s["us_low"] = min(us_prices)
        if hk_prices:
            s["hk_b25"] = avg_bottom_25(hk_prices)
            s["hk_median"] = s["hk_b25"]
            s["hk_low"] = min(hk_prices)
        if us_prices and hk_prices:
            us_med = avg_bottom_25(us_prices)
            hk_med = avg_bottom_25(hk_prices)
            s["arb_spread_pct"] = round((us_med - hk_med) / hk_med * 100, 1)
            s["arb_profit_est"] = round(us_med - hk_med - 450)
        stats[ref] = s
    return stats


def compute_deals(listings, ref_stats, top=100, threshold_pct=7.0):
    deals = []
    for l in listings:
        ref = l.get("ref")
        if ref not in ref_stats:
            continue
        s = ref_stats[ref]
        benchmark = s.get("us_median", s.get("median"))
        price = l.get("price")
        if not price or not benchmark or benchmark <= 0:
            continue
        discount = (benchmark - price) / benchmark * 100
        if discount >= threshold_pct:
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
    return deals[:top]


def compute_arbitrage(ref_stats):
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


def compute_movers(ref_stats, top=30):
    movers = []
    for ref, s in ref_stats.items():
        if s["count"] < 3:
            continue
        median = s.get("median") or 0
        if median <= 0:
            continue
        spread = (s["high"] - s["low"]) / median * 100
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
    return movers[:top]


def compute_summary(listings, ref_stats):
    prices = [x["price"] for x in listings if x.get("price")]
    brands, regions, conditions = defaultdict(int), defaultdict(int), defaultdict(int)
    groups, sellers = set(), set()
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


def compute_sellers(listings, top=50):
    by_seller = defaultdict(list)
    for l in listings:
        s = l.get("seller", "")
        if s:
            by_seller[s].append(l)
    board = []
    for seller, items in by_seller.items():
        prices = [x["price"] for x in items if x.get("price")]
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
    return board[:top]


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

def main():
    print(f"→ rebuilding dashboard data in {DATA_DIR}")

    base, manual = load_listings()
    print(f"  {len(base):,} listings from listings.json + {len(manual)} manual")

    combined = base + manual

    # Snapshot pre-dedupe stats for the delta summary.
    pre_count_by_ref = defaultdict(int)
    for l in combined:
        pre_count_by_ref[l.get("ref", "")] += 1

    deduped, collapsed = dedupe(combined)
    print(f"  collapsed {collapsed} cross-post duplicate{'' if collapsed == 1 else 's'}")
    print(f"  {len(deduped):,} unique listings after dedupe")

    ref_stats = compute_ref_stats(deduped)
    print(f"  {len(ref_stats):,} refs analyzed")

    summary   = compute_summary(deduped, ref_stats)
    deals     = compute_deals(deduped, ref_stats)
    arbitrage = compute_arbitrage(ref_stats)
    movers    = compute_movers(ref_stats)
    sellers   = compute_sellers(deduped)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Update the individual files. bundle.json is the initial-load
    # bundle the dashboard fetches first.
    outputs = {
        LISTINGS_FILE:  deduped,
        REFS_FILE:      ref_stats,
        SUMMARY_FILE:   summary,
        DEALS_FILE:     deals,
        ARBITRAGE_FILE: arbitrage,
        MOVERS_FILE:    movers,
        SELLERS_FILE:   sellers,
    }
    for path, value in outputs.items():
        with path.open("w") as f:
            json.dump(value, f, separators=(",", ":"))
        size = path.stat().st_size
        print(f"  ✓ {path.name} ({size:,} bytes)")

    bundle = {
        "summary":   summary,
        "deals":     deals,
        "arbitrage": arbitrage,
        "movers":    movers,
        "sellers":   sellers,
        "refs":      ref_stats,
    }
    with BUNDLE_FILE.open("w") as f:
        json.dump(bundle, f, separators=(",", ":"))
    print(f"  ✓ {BUNDLE_FILE.name} ({BUNDLE_FILE.stat().st_size:,} bytes)")

    # Print a small audit of anything that changed in the refs the
    # user is most likely watching — specifically any ref referenced
    # in manual_listings.json.
    manual_refs = sorted({m["ref"] for m in manual})
    if manual_refs:
        print("\n→ post-merge audit for manually-touched refs:")
        for ref in manual_refs:
            s = ref_stats.get(ref)
            if not s:
                print(f"    {ref}: MISSING — parser + manual both had no valid records")
                continue
            print(f"    {ref}: {s['count']} listings · b25 ${s['b25']:,} · "
                  f"low ${s['low']:,} · high ${s['high']:,} · "
                  f"US {s.get('us_count', 0)} (${s.get('us_b25', 0) or 0:,}) · "
                  f"HK {s.get('hk_count', 0)} (${s.get('hk_b25', 0) or 0:,})")

    print("\n✓ done")


if __name__ == "__main__":
    main()
