"""
Unit tests for scripts/rebuild_dashboard_data.py.

This is the second-laptop rebuild path. Its math MUST match
export_data.py exactly (enforced by test_parity.py), but the functions
are tested here independently against the `price` output schema so
regressions get localized to the right file.
"""

from __future__ import annotations

import json

import pytest

import rebuild_dashboard_data as rdd


# ─────────────────────────────────────────────────────────────
# avg_bottom_25 — mirror of export_data
# ─────────────────────────────────────────────────────────────

class TestAvgBottom25:
    def test_empty_returns_none(self):
        assert rdd.avg_bottom_25([]) is None

    def test_single_uses_floor_of_two(self):
        assert rdd.avg_bottom_25([100]) == 100

    def test_four_items(self):
        assert rdd.avg_bottom_25([100, 200, 300, 400]) == 150

    def test_twelve_items(self):
        assert rdd.avg_bottom_25(list(range(100, 1300, 100))) == 200


# ─────────────────────────────────────────────────────────────
# _normalize_seller
# ─────────────────────────────────────────────────────────────

class TestNormalizeSeller:
    def test_empty(self):
        assert rdd._normalize_seller("") == ""

    def test_phone_variants_collapse(self):
        canonical = rdd._normalize_seller("+8618466508645")
        for v in ["+86 184 6650 8645", "Winner (+8618466508645)", "86 184 6650 8645"]:
            assert rdd._normalize_seller(v) == canonical

    def test_channel_id_falls_back(self):
        assert rdd._normalize_seller("CNn6ns4GIABIAZABAPABAg==").startswith("raw:")


# ─────────────────────────────────────────────────────────────
# dedupe — note it uses `price` not `price_usd`
# ─────────────────────────────────────────────────────────────

class TestDedupe:
    def test_empty(self):
        out, collapsed = rdd.dedupe([])
        assert out == []
        assert collapsed == 0

    def test_drops_missing_ref(self):
        out, _ = rdd.dedupe([
            {"ref": "", "price": 100},
            {"ref": "A", "price": 100, "seller": "x"},
        ])
        assert len(out) == 1

    def test_drops_zero_price(self):
        out, _ = rdd.dedupe([{"ref": "A", "price": 0, "seller": "x"}])
        assert out == []

    def test_phone_cross_posts_collapse(self):
        out, collapsed = rdd.dedupe([
            {"ref": "A", "price": 100, "seller": "+8618466508645", "group": "G1"},
            {"ref": "A", "price": 100, "seller": "Winner (+8618466508645)", "group": "G2"},
        ])
        assert len(out) == 1
        assert collapsed == 1
        assert out[0]["x_post_count"] == 2
        assert out[0]["group"] == "G1 / G2"

    def test_content_cross_posts_collapse(self):
        out, collapsed = rdd.dedupe([
            {"ref": "228238", "price": 60000, "seller": "CH1",
             "dial": "Green", "condition": "BNIB", "year": "2025", "group": "G1"},
            {"ref": "228238", "price": 60000, "seller": "CH2",
             "dial": "Green", "condition": "BNIB", "year": "2025", "group": "G2"},
        ])
        assert len(out) == 1
        assert collapsed == 1

    def test_ref_case_insensitive(self):
        out, collapsed = rdd.dedupe([
            {"ref": "126610ln", "price": 100, "seller": "+8618466508645"},
            {"ref": "126610LN", "price": 100, "seller": "+8618466508645"},
        ])
        assert len(out) == 1
        assert collapsed == 1


# ─────────────────────────────────────────────────────────────
# compute_ref_stats
# ─────────────────────────────────────────────────────────────

class TestComputeRefStats:
    def test_empty(self):
        assert rdd.compute_ref_stats([]) == {}

    def test_basic_rollup(self):
        listings = [
            {"ref": "A", "price": 100, "region": "US",
             "condition": "BNIB", "dial": "Black"},
            {"ref": "A", "price": 200, "region": "US",
             "condition": "BNIB", "dial": "Black"},
            {"ref": "A", "price": 300, "region": "HK",
             "condition": "Pre-owned", "dial": "Black"},
            {"ref": "A", "price": 400, "region": "HK",
             "condition": "Pre-owned", "dial": "Black"},
        ]
        s = rdd.compute_ref_stats(listings)["A"]
        assert s["count"] == 4
        assert s["low"] == 100
        assert s["high"] == 400
        assert s["avg"] == 250
        assert s["b25"] == 150
        assert s["us_count"] == 2
        assert s["hk_count"] == 2
        assert s["us_b25"] == 150
        assert s["hk_b25"] == 350
        # arb_spread_pct = (150 - 350) / 350 * 100 = -57.142...
        assert s["arb_spread_pct"] == -57.1
        assert s["arb_profit_est"] == -650

    def test_skips_when_no_price(self):
        stats = rdd.compute_ref_stats([{"ref": "A", "price": None}])
        assert stats == {}

    def test_dial_unknown_when_missing(self):
        stats = rdd.compute_ref_stats([
            {"ref": "A", "price": 100},
            {"ref": "A", "price": 200},
        ])
        assert "Unknown" in stats["A"]["dials"]


# ─────────────────────────────────────────────────────────────
# compute_deals
# ─────────────────────────────────────────────────────────────

class TestComputeDeals:
    def test_empty(self):
        assert rdd.compute_deals([], {}) == []

    def test_configurable_threshold(self):
        ref_stats = {"A": {"median": 100, "us_median": 100, "model": "M", "brand": "Rolex"}}
        listings = [{"ref": "A", "price": 95}]
        assert rdd.compute_deals(listings, ref_stats, threshold_pct=3.0) != []
        assert rdd.compute_deals(listings, ref_stats, threshold_pct=10.0) == []

    def test_configurable_top_cap(self):
        ref_stats = {f"R{i}": {"median": 100, "us_median": 100, "model": "M", "brand": "Rolex"} for i in range(50)}
        listings = [{"ref": f"R{i}", "price": 50} for i in range(50)]
        assert len(rdd.compute_deals(listings, ref_stats, top=10)) == 10

    def test_sorted_by_discount_desc(self):
        ref_stats = {
            "A": {"median": 100, "us_median": 100, "model": "M", "brand": "Rolex"},
            "B": {"median": 100, "us_median": 100, "model": "M", "brand": "Rolex"},
        }
        listings = [{"ref": "A", "price": 90}, {"ref": "B", "price": 80}]
        deals = rdd.compute_deals(listings, ref_stats)
        assert [d["ref"] for d in deals] == ["B", "A"]


# ─────────────────────────────────────────────────────────────
# compute_arbitrage / compute_movers / compute_summary
# ─────────────────────────────────────────────────────────────

class TestComputeArbitrage:
    def test_500_threshold(self):
        stats = {"A": {"ref": "A", "model": "M", "brand": "Rolex",
                       "arb_profit_est": 499, "arb_spread_pct": 1,
                       "us_median": 1, "hk_median": 1, "hk_low": 1,
                       "hk_count": 1, "us_count": 1}}
        assert rdd.compute_arbitrage(stats) == []

    def test_sorted(self):
        stats = {
            "A": {"ref": "A", "model": "MA", "brand": "Rolex",
                  "arb_profit_est": 1000, "arb_spread_pct": 1,
                  "us_median": 1, "hk_median": 1, "hk_low": 1,
                  "hk_count": 1, "us_count": 1},
            "B": {"ref": "B", "model": "MB", "brand": "Rolex",
                  "arb_profit_est": 2000, "arb_spread_pct": 1,
                  "us_median": 1, "hk_median": 1, "hk_low": 1,
                  "hk_count": 1, "us_count": 1},
        }
        arbs = rdd.compute_arbitrage(stats)
        assert arbs[0]["ref"] == "B"


class TestComputeMovers:
    def test_requires_three(self):
        stats = {"A": {"ref": "A", "model": "M", "count": 2,
                       "low": 1, "high": 2, "median": 1}}
        assert rdd.compute_movers(stats) == []

    def test_skip_zero_median(self):
        stats = {"A": {"ref": "A", "model": "M", "count": 5,
                       "low": 0, "high": 0, "median": 0}}
        assert rdd.compute_movers(stats) == []

    def test_top_cap(self):
        stats = {f"R{i}": {"ref": f"R{i}", "model": "M", "count": 5,
                           "low": 100, "high": 200, "median": 150} for i in range(50)}
        assert len(rdd.compute_movers(stats, top=10)) == 10


class TestComputeSummary:
    def test_empty(self):
        summary = rdd.compute_summary([], {})
        assert summary["total_listings"] == 0
        assert summary["avg_price"] == 0

    def test_top_refs_capped_at_20(self):
        listings = []
        ref_stats = {}
        for i in range(30):
            ref_stats[f"R{i}"] = {
                "ref": f"R{i}", "model": "M", "count": i + 1,
                "low": 100, "avg": 150, "median": 150,
            }
            for _ in range(i + 1):
                listings.append({"ref": f"R{i}", "price": 100})
        summary = rdd.compute_summary(listings, ref_stats)
        assert len(summary["top_refs"]) == 20


class TestComputeSellers:
    def test_top_cap(self):
        listings = [
            {"seller": f"s{i}", "price": 100, "region": "US", "group": "G"}
            for i in range(100)
        ]
        board = rdd.compute_sellers(listings, top=10)
        assert len(board) == 10


# ─────────────────────────────────────────────────────────────
# load_listings (IO path)
# ─────────────────────────────────────────────────────────────

class TestLoadListings:
    def test_missing_files_return_empty(self, monkeypatch, tmp_path):
        monkeypatch.setattr(rdd, "LISTINGS_FILE", tmp_path / "no.json")
        monkeypatch.setattr(rdd, "MANUAL_FILE", tmp_path / "no.json")
        base, manual = rdd.load_listings()
        assert base == []
        assert manual == []

    def test_filters_comment_rows(self, monkeypatch, tmp_path):
        lf = tmp_path / "listings.json"
        mf = tmp_path / "manual_listings.json"
        lf.write_text(json.dumps([{"ref": "A", "price": 100}]))
        mf.write_text(json.dumps([
            {"_comment": "doc"},
            {"ref": "B", "price": 200},
            {"ref": None, "price": 300},
        ]))
        monkeypatch.setattr(rdd, "LISTINGS_FILE", lf)
        monkeypatch.setattr(rdd, "MANUAL_FILE", mf)
        base, manual = rdd.load_listings()
        assert base == [{"ref": "A", "price": 100}]
        assert len(manual) == 1
        assert manual[0]["ref"] == "B"

    def test_malformed_manual_json(self, monkeypatch, tmp_path):
        lf = tmp_path / "listings.json"
        mf = tmp_path / "manual_listings.json"
        lf.write_text("[]")
        mf.write_text("not-json{")
        monkeypatch.setattr(rdd, "LISTINGS_FILE", lf)
        monkeypatch.setattr(rdd, "MANUAL_FILE", mf)
        base, manual = rdd.load_listings()
        assert base == []
        assert manual == []
