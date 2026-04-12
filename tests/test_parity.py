"""
Parity tests: export_data.py and scripts/rebuild_dashboard_data.py must
produce identical output from the same input.

Why this exists:
    export_data.py is the primary pipeline that runs on the owner's
    laptop after parse_v4. rebuild_dashboard_data.py is the "second
    laptop" path that rebuilds from the repo alone. They've drifted
    before — a bug fix in one was forgotten in the other — and when
    they drift, the dashboard numbers depend on which machine last
    ran the pipeline.

    The module docstrings say this out loud (export_data.py:40-43
    "Keep compute_ref_stats() / compute_deals() / compute_arbitrage()
    in sync..."). Nothing enforced it until now. This file does.

The two pipelines use slightly different internal schemas:
    - export_data.py uses `price_usd`
    - rebuild_dashboard_data.py uses `price`

So we feed each pipeline the schema-appropriate version of the same
fixture and assert the outputs match.
"""

from __future__ import annotations

import json

import pytest

import export_data as ed
import rebuild_dashboard_data as rdd


def _canonical(obj):
    """
    Serialize to JSON with sorted keys so dict ordering doesn't
    produce false diffs. Any nested dicts and lists pass through
    json.dumps' stable ordering.
    """
    return json.dumps(obj, sort_keys=True, default=str)


class TestPipelineParity:
    def test_avg_bottom_25_matches(self):
        samples = [
            [],
            [100],
            [100, 200],
            [100, 200, 300, 400],
            list(range(1, 101)),
            [500, 500, 500, 500],
            [1.5, 2.5, 3.5, 4.5],
        ]
        for s in samples:
            assert ed.avg_bottom_25(list(s)) == rdd.avg_bottom_25(list(s)), (
                f"avg_bottom_25 disagrees on {s!r}")

    def test_normalize_seller_matches(self):
        samples = [
            "",
            None,
            "+8618466508645",
            "+86 184 6650 8645",
            "Winner (+8618466508645)",
            "CNn6ns4GIABIAZABAPABAg==",
            "💎GROUP💎",
            "  HK Dealer  ",
            "+0086 184 6650 8645",
        ]
        for s in samples:
            assert ed._normalize_seller(s) == rdd._normalize_seller(s), (
                f"_normalize_seller disagrees on {s!r}")

    def test_dedupe_matches(self, listings_price_usd, listings_price):
        # Each pipeline uses its own schema
        out_ed, coll_ed = ed.dedupe_cross_posts(list(listings_price_usd))
        out_rdd, coll_rdd = rdd.dedupe(list(listings_price))

        assert coll_ed == coll_rdd, (
            f"collapsed count disagrees: export_data={coll_ed} rebuild={coll_rdd}")
        assert len(out_ed) == len(out_rdd)

        # Translate both to a canonical comparison shape: tuple keys.
        def key(r, price_field):
            return (
                str(r.get("ref", "")).upper(),
                round(float(r.get(price_field, 0) or 0)),
                (r.get("dial") or "").strip().lower(),
                (r.get("condition") or "").strip().lower(),
                (r.get("year") or "").strip(),
                r.get("x_post_count", 1),
                r.get("group", ""),
            )

        ed_keys = sorted(key(r, "price_usd") for r in out_ed)
        rdd_keys = sorted(key(r, "price") for r in out_rdd)
        assert ed_keys == rdd_keys

    def test_compute_ref_stats_matches(self, listings_price_usd, listings_price):
        # Dedupe first so we're comparing post-dedupe rollups (that's what
        # ships to the dashboard).
        deduped_ed, _ = ed.dedupe_cross_posts(list(listings_price_usd))
        deduped_rdd, _ = rdd.dedupe(list(listings_price))

        stats_ed = ed.compute_ref_stats(deduped_ed)
        stats_rdd = rdd.compute_ref_stats(deduped_rdd)

        assert set(stats_ed.keys()) == set(stats_rdd.keys())

        # Compare every per-ref numeric field; updated_at isn't produced here.
        for ref in stats_ed:
            a = stats_ed[ref]
            b = stats_rdd[ref]
            for field in [
                "count", "low", "high", "avg", "b25", "median",
                "us_count", "hk_count",
                "us_b25", "us_median", "us_low",
                "hk_b25", "hk_median", "hk_low",
                "arb_spread_pct", "arb_profit_est",
            ]:
                if field in a or field in b:
                    assert a.get(field) == b.get(field), (
                        f"{ref}.{field} disagrees: {a.get(field)} vs {b.get(field)}")
            assert a["conditions"] == b["conditions"]
            # Dials rollups should match ignoring dict ordering
            assert _canonical(a["dials"]) == _canonical(b["dials"])

    def test_compute_deals_matches(self, listings_price_usd, listings_price):
        deduped_ed, _ = ed.dedupe_cross_posts(list(listings_price_usd))
        deduped_rdd, _ = rdd.dedupe(list(listings_price))
        stats_ed = ed.compute_ref_stats(deduped_ed)
        stats_rdd = rdd.compute_ref_stats(deduped_rdd)

        deals_ed = ed.compute_deals(deduped_ed, stats_ed)
        deals_rdd = rdd.compute_deals(deduped_rdd, stats_rdd)

        assert len(deals_ed) == len(deals_rdd)
        # Compare refs + discount_pct + benchmark per position
        for a, b in zip(deals_ed, deals_rdd):
            assert a["ref"] == b["ref"]
            assert a["price"] == b["price"]
            assert a["benchmark"] == b["benchmark"]
            assert a["discount_pct"] == b["discount_pct"]

    def test_compute_arbitrage_matches(self, listings_price_usd, listings_price):
        deduped_ed, _ = ed.dedupe_cross_posts(list(listings_price_usd))
        deduped_rdd, _ = rdd.dedupe(list(listings_price))
        arbs_ed = ed.compute_arbitrage(ed.compute_ref_stats(deduped_ed))
        arbs_rdd = rdd.compute_arbitrage(rdd.compute_ref_stats(deduped_rdd))
        assert _canonical(arbs_ed) == _canonical(arbs_rdd)

    def test_compute_movers_matches(self, listings_price_usd, listings_price):
        deduped_ed, _ = ed.dedupe_cross_posts(list(listings_price_usd))
        deduped_rdd, _ = rdd.dedupe(list(listings_price))
        ed_movers = ed.compute_market_movers(ed.compute_ref_stats(deduped_ed))
        rdd_movers = rdd.compute_movers(rdd.compute_ref_stats(deduped_rdd))
        assert _canonical(ed_movers) == _canonical(rdd_movers)

    def test_compute_summary_matches(self, listings_price_usd, listings_price):
        """
        compute_market_summary / compute_summary stamp a `updated_at`
        field, so we compare everything except that.
        """
        deduped_ed, _ = ed.dedupe_cross_posts(list(listings_price_usd))
        deduped_rdd, _ = rdd.dedupe(list(listings_price))
        sum_ed = ed.compute_market_summary(deduped_ed, ed.compute_ref_stats(deduped_ed))
        sum_rdd = rdd.compute_summary(deduped_rdd, rdd.compute_ref_stats(deduped_rdd))

        for key in ["total_listings", "unique_refs", "unique_sellers", "unique_groups",
                    "avg_price", "median_price", "brands", "regions", "conditions"]:
            assert sum_ed[key] == sum_rdd[key], f"{key} disagrees"

        # top_refs should match element-for-element
        assert _canonical(sum_ed["top_refs"]) == _canonical(sum_rdd["top_refs"])

    def test_compute_sellers_matches(self, listings_price_usd, listings_price):
        deduped_ed, _ = ed.dedupe_cross_posts(list(listings_price_usd))
        deduped_rdd, _ = rdd.dedupe(list(listings_price))
        sellers_ed = ed.compute_sellers_leaderboard(deduped_ed)
        sellers_rdd = rdd.compute_sellers(deduped_rdd)
        # Both sort by -count; sets-of-regions/groups can differ in
        # list order inside the record, so compare in a stable way.
        assert len(sellers_ed) == len(sellers_rdd)
        for a, b in zip(sellers_ed, sellers_rdd):
            assert a["seller"] == b["seller"]
            assert a["count"] == b["count"]
            assert a["avg_price"] == b["avg_price"]
            assert set(a["regions"]) == set(b["regions"])
            assert set(a["groups"]) == set(b["groups"])
