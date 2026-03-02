#!/usr/bin/env python3
"""
Export price analyzer data → JSON files for the Opulence Dashboard.
Run after every `parse_v4.py refresh` to update dashboard data.

Usage:
    python3 export_data.py              # Export all data
    python3 export_data.py --upload     # Export + upload to Cloudflare KV
"""
import json, sys, os, subprocess, statistics, argparse
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict


def avg_bottom_25(prices):
    """Average of bottom 25% of prices. Min 2 items. If <2 eligible, use lowest."""
    if not prices:
        return None
    sorted_p = sorted(prices)
    n = max(2, len(sorted_p) // 4)
    n = min(n, len(sorted_p))
    return round(sum(sorted_p[:n]) / n)

ANALYZER_DIR = Path(__file__).parent.parent / "price_analyzer"
LISTINGS_FILE = ANALYZER_DIR / "rolex_listings.json"
WHOLESALE_FILE = ANALYZER_DIR / "rolex_wholesale.json"
REFERENCE_FILE = ANALYZER_DIR / "reference_data.json"
OUTPUT_DIR = Path(__file__).parent / "public" / "data"

sys.path.insert(0, str(ANALYZER_DIR))
from parse_v4 import extract_dial

def load_listings():
    """Load retail listings + wholesale offers into a unified list."""
    with open(LISTINGS_FILE) as f:
        listings = json.load(f)
    
    # Merge wholesale offers with enrichment
    # NOTE: Wholesale merge disabled — wholesale index (rolex_wholesale.json) is derived
    # from rolex_listings.json and may have stale/wrong prices. All data comes from
    # rolex_listings.json which has the authoritative currency-corrected prices.
    if False and WHOLESALE_FILE.exists():
        with open(WHOLESALE_FILE) as f:
            wholesale = json.load(f)
        for ref, data in wholesale.items():
            if not isinstance(data, dict) or "offers" not in data:
                continue
            # Skip refs with no valid price data
            valid_offers = [o for o in data["offers"] if o.get("price_usd") or o.get("pusd") or o.get("price")]
            if not valid_offers:
                continue
            data["offers"] = valid_offers
            model = data.get("model", "")
            brand = data.get("brand", "Rolex")
            for offer in data["offers"]:
                # Get current dial and condition
                current_dial = offer.get("dial", "")
                current_condition = offer.get("cond", offer.get("condition", ""))
                
                # Apply wholesale defaults
                # Wholesale = dealer inventory = always full set
                completeness = "Full Set"
                
                # Map condition values and default to BNIB for dealers
                condition = current_condition
                if not condition or condition.lower() in ("", "unknown"):
                    condition = "BNIB"  # Dealers typically sell new
                elif condition.lower() in ("pre-owned", "preowned", "used"):
                    condition = "Pre-owned"
                elif condition.lower() in ("bnib", "new", "mint"):
                    condition = "BNIB"
                
                # Try to enrich dial using extract_dial() on available text
                dial = current_dial
                if not dial or dial.lower() in ("", "unknown", "blue", "black", "white", "green", "silver"):
                    # Gather all text fields for dial extraction
                    text_fields = []
                    if offer.get("orig"):  # Original listing text
                        text_fields.append(offer["orig"])
                    if offer.get("seller"):
                        text_fields.append(offer["seller"])
                    if offer.get("group"):
                        text_fields.append(offer["group"])
                    
                    # Try to extract more specific dial
                    combined_text = " ".join(text_fields)
                    if combined_text:
                        extracted_dial = extract_dial(combined_text, ref)
                        if extracted_dial and extracted_dial != dial:
                            # Only replace if we got something more specific
                            if not dial or len(extracted_dial) > len(dial):
                                dial = extracted_dial
                
                pusd = offer.get("price_usd") or offer.get("pusd") or offer.get("price") or 0
                if pusd and pusd >= 2500:  # Skip entries with no/impossible price
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
        
        # Arbitrage spread
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
        
        # Compare to US median (or overall median)
        benchmark = s.get("us_median", s["median"])
        price = l.get("price_usd", 0)
        if not price or not benchmark or benchmark <= 0:
            continue
        
        discount = (benchmark - price) / benchmark * 100
        if discount >= 7:  # At least 7% below
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
    return deals[:100]  # Top 100

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
        if l.get("group"): groups.add(l["group"])
        if l.get("seller"): sellers.add(l["seller"])
    
    # Top movers (refs with highest/lowest spread from average)
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

def export_all():
    print("📊 Loading listings...")
    listings = load_listings()
    print(f"   {len(listings)} listings loaded")
    
    # Show wholesale enrichment stats
    wholesale_listings = [l for l in listings if l.get("source") == "wholesale"]
    if wholesale_listings:
        total_wholesale = len(wholesale_listings)
        full_set_count = len([l for l in wholesale_listings if l.get("completeness") == "Full Set"])
        bnib_count = len([l for l in wholesale_listings if l.get("condition") == "BNIB"])
        dial_count = len([l for l in wholesale_listings if l.get("dial") and l.get("dial") != ""])
        
        print(f"   📦 Wholesale offers: {total_wholesale:,}")
        print(f"   ✅ Completeness = 'Full Set': {full_set_count:,} ({full_set_count/total_wholesale*100:.1f}%)")
        print(f"   🆕 Condition = 'BNIB': {bnib_count:,} ({bnib_count/total_wholesale*100:.1f}%)")
        print(f"   🎨 Dial coverage: {dial_count:,} ({dial_count/total_wholesale*100:.1f}%)")
    
    print("📈 Computing reference stats...")
    ref_stats = compute_ref_stats(listings)
    print(f"   {len(ref_stats)} refs analyzed")
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    data = {
        "summary": compute_market_summary(listings, ref_stats),
        "deals": compute_deals(listings, ref_stats),
        "arbitrage": compute_arbitrage(ref_stats),
        "movers": compute_market_movers(ref_stats),
        "sellers": compute_sellers_leaderboard(listings),
        "refs": ref_stats,
        "listings": build_listings_index(listings),
    }
    
    # Write individual JSON files (for lazy loading)
    for key, value in data.items():
        outfile = OUTPUT_DIR / f"{key}.json"
        with open(outfile, "w") as f:
            json.dump(value, f, separators=(",", ":"))
        size = outfile.stat().st_size
        print(f"   ✅ {key}.json ({size:,} bytes)")
    
    # Write combined bundle (for initial load)
    bundle = {k: v for k, v in data.items() if k != "listings"}  # Skip big listing index from bundle
    bundle_file = OUTPUT_DIR / "bundle.json"
    with open(bundle_file, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))
    print(f"   ✅ bundle.json ({bundle_file.stat().st_size:,} bytes)")
    
    print(f"\n🎯 Export complete → {OUTPUT_DIR}")
    return data

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true", help="Upload to Cloudflare KV after export")
    args = parser.parse_args()
    
    data = export_all()
    
    if args.upload:
        print("\n☁️  Uploading to Cloudflare KV...")
        # Upload each data file to KV
        for key in ["summary", "deals", "arbitrage", "movers", "sellers", "refs", "listings", "bundle"]:
            filepath = OUTPUT_DIR / f"{key}.json"
            subprocess.run([
                "wrangler", "kv", "key", "put",
                "--namespace-id", os.environ.get("KV_NAMESPACE_ID", ""),
                f"data:{key}",
                "--path", str(filepath),
            ], check=True)
            print(f"   ☁️  {key} uploaded")
        print("✅ All data uploaded to Cloudflare KV")
