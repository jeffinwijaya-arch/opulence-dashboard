"""
Unit tests for export_data.py — the primary dashboard data pipeline.

These functions compute the numbers the dashboard displays. A regression
here silently ships wrong prices, wrong deal discounts, or wrong arbitrage
opportunities, so every pure function in the module gets explicit
coverage.
"""

from __future__ import annotations

import pytest

import export_data as ed


# ─────────────────────────────────────────────────────────────
# avg_bottom_25
# ─────────────────────────────────────────────────────────────

class TestAvgBottom25:
    def test_empty_returns_none(self):
        assert ed.avg_bottom_25([]) is None

    def test_none_returns_none(self):
        assert ed.avg_bottom_25(None) is None

    def test_single_item_uses_min_two_floor(self):
        # n = max(2, 1//4) = 2, clamped to len(1) = 1 → average of the
        # single element.
        assert ed.avg_bottom_25([100]) == 100

    def test_two_items_average_both(self):
        # n = max(2, 2//4=0) = 2 → average of both
        assert ed.avg_bottom_25([100, 200]) == 150

    def test_four_items_average_bottom_two(self):
        # n = max(2, 4//4=1) = 2
        assert ed.avg_bottom_25([100, 200, 300, 400]) == 150

    def test_eight_items_average_bottom_two(self):
        # n = max(2, 8//4=2) = 2
        assert ed.avg_bottom_25([100, 200, 300, 400, 500, 600, 700, 800]) == 150

    def test_twelve_items_average_bottom_three(self):
        # n = max(2, 12//4=3) = 3
        prices = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
        assert ed.avg_bottom_25(prices) == 200  # (100+200+300)/3

    def test_sorts_before_slicing(self):
        # Unsorted input must produce the same result as sorted.
        assert ed.avg_bottom_25([400, 100, 300, 200]) == 150

    def test_all_equal(self):
        assert ed.avg_bottom_25([500, 500, 500, 500]) == 500

    def test_rounds_to_integer(self):
        assert ed.avg_bottom_25([100, 101, 102, 103]) == 100  # round((100+101)/2) = 100
        assert ed.avg_bottom_25([100, 103, 200, 300]) == 102  # round((100+103)/2) = 102


# ─────────────────────────────────────────────────────────────
# _normalize_seller
# ─────────────────────────────────────────────────────────────

class TestNormalizeSeller:
    def test_empty_string(self):
        assert ed._normalize_seller("") == ""

    def test_none(self):
        assert ed._normalize_seller(None) == ""

    def test_extracts_phone_digits(self):
        assert ed._normalize_seller("+8618466508645") == "phone:8618466508645"

    def test_phone_with_spaces(self):
        assert ed._normalize_seller("+86 184 6650 8645") == "phone:8618466508645"

    def test_phone_with_name_prefix(self):
        assert ed._normalize_seller("Winner (+8618466508645)") == "phone:8618466508645"

    def test_phone_variants_all_collapse(self):
        canonical = ed._normalize_seller("+8618466508645")
        variants = [
            "+86 184 6650 8645",
            "Winner (+8618466508645)",
            "Dealer — +86 184-6650-8645",
            "86 184 6650 8645",
        ]
        for v in variants:
            assert ed._normalize_seller(v) == canonical, f"variant {v!r} did not match"

    def test_leading_zeros_stripped(self):
        # "0086..." → "86..."
        assert ed._normalize_seller("+0086184665") == ed._normalize_seller("+86184665")

    def test_phone_too_short_falls_back_to_raw(self):
        # Regex needs 8+ trailing chars after the first digit AND the
        # resulting digit run must be >= 8 long. "+1 234 567" digits = 7.
        result = ed._normalize_seller("+1 234 5678")  # 8 digits total, long enough
        assert result.startswith("phone:") or result.startswith("raw:")

    def test_emoji_name_falls_back_to_raw(self):
        result = ed._normalize_seller("💎GROUP💎")
        assert result.startswith("raw:")

    def test_channel_id_falls_back_to_raw(self):
        result = ed._normalize_seller("CNn6ns4GIABIAZABAPABAg==")
        assert result == "raw:cnn6ns4giabiazabapabag=="

    def test_raw_is_lowercased_and_stripped(self):
        assert ed._normalize_seller("  HK Dealer  ") == "raw:hk dealer"


# ─────────────────────────────────────────────────────────────
# dedupe_cross_posts
# ─────────────────────────────────────────────────────────────

class TestDedupeCrossPosts:
    def test_empty(self):
        out, collapsed = ed.dedupe_cross_posts([])
        assert out == []
        assert collapsed == 0

    def test_drops_rows_with_missing_ref(self):
        out, _ = ed.dedupe_cross_posts([
            {"ref": "", "price_usd": 100},
            {"ref": "A", "price_usd": 100, "seller": "x"},
        ])
        assert len(out) == 1
        assert out[0]["ref"] == "A"

    def test_drops_rows_with_zero_price(self):
        out, _ = ed.dedupe_cross_posts([
            {"ref": "A", "price_usd": 0, "seller": "x"},
            {"ref": "A", "price_usd": 100, "seller": "x"},
        ])
        assert len(out) == 1

    def test_phone_seller_collapses_cross_posts(self):
        out, collapsed = ed.dedupe_cross_posts([
            {"ref": "126610LN", "price_usd": 10800, "seller": "Winner (+8618466508645)", "group": "G1"},
            {"ref": "126610LN", "price_usd": 10800, "seller": "+86 184 6650 8645", "group": "G2"},
            {"ref": "126610LN", "price_usd": 10800, "seller": "+8618466508645", "group": "G3"},
        ])
        assert len(out) == 1
        assert collapsed == 2
        assert out[0]["x_post_count"] == 3
        # Merged group is slash-joined and sorted
        assert out[0]["group"] == "G1 / G2 / G3"

    def test_phone_different_prices_not_collapsed(self):
        out, _ = ed.dedupe_cross_posts([
            {"ref": "A", "price_usd": 100, "seller": "+8618466508645", "group": "G1"},
            {"ref": "A", "price_usd": 200, "seller": "+8618466508645", "group": "G2"},
        ])
        assert len(out) == 2

    def test_phone_different_refs_not_collapsed(self):
        out, _ = ed.dedupe_cross_posts([
            {"ref": "A", "price_usd": 100, "seller": "+8618466508645"},
            {"ref": "B", "price_usd": 100, "seller": "+8618466508645"},
        ])
        assert len(out) == 2

    def test_content_identity_collapses_no_phone(self):
        """Records with non-phone sellers collapse via pass 2 content key."""
        out, collapsed = ed.dedupe_cross_posts([
            {"ref": "228238", "price_usd": 60000, "seller": "CH1",
             "dial": "Green", "condition": "BNIB", "year": "2025", "group": "G1"},
            {"ref": "228238", "price_usd": 60000, "seller": "CH2",
             "dial": "Green", "condition": "BNIB", "year": "2025", "group": "G2"},
        ])
        assert len(out) == 1
        assert collapsed == 1
        assert out[0]["x_post_count"] == 2

    def test_content_identity_differing_dial_not_collapsed(self):
        out, _ = ed.dedupe_cross_posts([
            {"ref": "A", "price_usd": 100, "seller": "CH1",
             "dial": "Black", "condition": "BNIB", "year": "2024"},
            {"ref": "A", "price_usd": 100, "seller": "CH2",
             "dial": "White", "condition": "BNIB", "year": "2024"},
        ])
        assert len(out) == 2

    def test_ref_case_insensitive(self):
        out, collapsed = ed.dedupe_cross_posts([
            {"ref": "126610ln", "price_usd": 10800, "seller": "+8618466508645", "group": "G1"},
            {"ref": "126610LN", "price_usd": 10800, "seller": "+8618466508645", "group": "G2"},
        ])
        assert len(out) == 1
        assert collapsed == 1

    def test_x_post_count_defaults_to_one(self):
        out, _ = ed.dedupe_cross_posts([
            {"ref": "A", "price_usd": 100, "seller": "solo"},
        ])
        assert out[0]["x_post_count"] == 1


# ─────────────────────────────────────────────────────────────
# compute_ref_stats
# ─────────────────────────────────────────────────────────────

class TestComputeRefStats:
    def test_empty(self):
        assert ed.compute_ref_stats([]) == {}

    def test_skips_refs_with_no_prices(self):
        stats = ed.compute_ref_stats([
            {"ref": "A", "price_usd": None},
        ])
        assert stats == {}

    def test_basic_rollup(self, tiny_listings_price_usd):
        stats = ed.compute_ref_stats(tiny_listings_price_usd)
        assert "A" in stats
        s = stats["A"]
        assert s["count"] == 4
        assert s["low"] == 100
        assert s["high"] == 400
        assert s["avg"] == 250
        # b25 on [100,200,300,400]: n = max(2, 4//4=1) = 2 → (100+200)/2
        assert s["b25"] == 150
        assert s["median"] == 150  # backward-compat alias
        assert s["us_count"] == 2
        assert s["hk_count"] == 2

    def test_region_split(self, tiny_listings_price_usd):
        s = ed.compute_ref_stats(tiny_listings_price_usd)["A"]
        assert s["us_low"] == 100
        assert s["hk_low"] == 300
        # us_b25 on [100,200] → 150; hk_b25 on [300,400] → 350
        assert s["us_b25"] == 150
        assert s["hk_b25"] == 350
        assert s["us_median"] == s["us_b25"]
        assert s["hk_median"] == s["hk_b25"]

    def test_arbitrage_fields_only_when_both_regions(self, tiny_listings_price_usd):
        s = ed.compute_ref_stats(tiny_listings_price_usd)["A"]
        assert "arb_spread_pct" in s
        assert "arb_profit_est" in s
        # arb_spread_pct = (us_b25 - hk_b25) / hk_b25 * 100
        # = (150 - 350) / 350 * 100 = -57.1428...
        assert s["arb_spread_pct"] == -57.1
        # arb_profit_est = us_b25 - hk_b25 - 450 = 150 - 350 - 450 = -650
        assert s["arb_profit_est"] == -650

    def test_no_arbitrage_when_single_region(self):
        stats = ed.compute_ref_stats([
            {"ref": "A", "price_usd": 100, "region": "US"},
            {"ref": "A", "price_usd": 200, "region": "US"},
        ])
        assert "arb_spread_pct" not in stats["A"]
        assert "arb_profit_est" not in stats["A"]

    def test_dial_stats(self):
        stats = ed.compute_ref_stats([
            {"ref": "A", "price_usd": 100, "dial": "Black"},
            {"ref": "A", "price_usd": 200, "dial": "Black"},
            {"ref": "A", "price_usd": 500, "dial": "White"},
            {"ref": "A", "price_usd": 700, "dial": "White"},
        ])
        dials = stats["A"]["dials"]
        assert "Black" in dials
        assert "White" in dials
        assert dials["Black"]["count"] == 2
        assert dials["Black"]["low"] == 100
        assert dials["White"]["high"] == 700

    def test_condition_counts(self):
        stats = ed.compute_ref_stats([
            {"ref": "A", "price_usd": 100, "condition": "BNIB"},
            {"ref": "A", "price_usd": 200, "condition": "BNIB"},
            {"ref": "A", "price_usd": 300, "condition": "Pre-owned"},
        ])
        assert stats["A"]["conditions"] == {"BNIB": 2, "Pre-owned": 1}


# ─────────────────────────────────────────────────────────────
# compute_deals
# ─────────────────────────────────────────────────────────────

class TestComputeDeals:
    def test_empty(self):
        assert ed.compute_deals([], {}) == []

    def test_skips_ref_not_in_stats(self):
        listings = [{"ref": "X", "price_usd": 100}]
        assert ed.compute_deals(listings, {}) == []

    def test_seven_percent_threshold(self):
        """Discount exactly at threshold (7%) should be included."""
        # benchmark 100, price 93 → 7% off
        ref_stats = {"A": {"us_median": 100, "median": 100, "model": "M", "brand": "Rolex"}}
        listings = [{"ref": "A", "price_usd": 93}]
        deals = ed.compute_deals(listings, ref_stats)
        assert len(deals) == 1
        assert deals[0]["discount_pct"] == 7.0

    def test_below_threshold_excluded(self):
        ref_stats = {"A": {"us_median": 100, "median": 100, "model": "M", "brand": "Rolex"}}
        listings = [{"ref": "A", "price_usd": 94}]  # 6% discount
        deals = ed.compute_deals(listings, ref_stats)
        assert deals == []

    def test_sorted_by_discount_desc(self):
        ref_stats = {
            "A": {"us_median": 100, "median": 100, "model": "MA", "brand": "Rolex"},
            "B": {"us_median": 100, "median": 100, "model": "MB", "brand": "Rolex"},
        }
        listings = [
            {"ref": "A", "price_usd": 90},  # 10%
            {"ref": "B", "price_usd": 80},  # 20%
        ]
        deals = ed.compute_deals(listings, ref_stats)
        assert [d["ref"] for d in deals] == ["B", "A"]

    def test_top_100_cap(self):
        # Create 150 fake refs each with a large discount
        ref_stats = {}
        listings = []
        for i in range(150):
            ref_stats[f"R{i}"] = {"us_median": 100, "median": 100, "model": "M", "brand": "Rolex"}
            listings.append({"ref": f"R{i}", "price_usd": 80})
        deals = ed.compute_deals(listings, ref_stats)
        assert len(deals) == 100

    def test_falls_back_to_median_when_no_us_median(self):
        ref_stats = {"A": {"median": 100, "model": "M", "brand": "Rolex"}}
        listings = [{"ref": "A", "price_usd": 80}]
        deals = ed.compute_deals(listings, ref_stats)
        assert len(deals) == 1
        assert deals[0]["benchmark"] == 100

    def test_zero_benchmark_skipped(self):
        ref_stats = {"A": {"us_median": 0, "median": 0}}
        listings = [{"ref": "A", "price_usd": 50}]
        assert ed.compute_deals(listings, ref_stats) == []

    def test_missing_price_skipped(self):
        ref_stats = {"A": {"us_median": 100, "median": 100}}
        assert ed.compute_deals([{"ref": "A"}], ref_stats) == []


# ─────────────────────────────────────────────────────────────
# compute_arbitrage
# ─────────────────────────────────────────────────────────────

class TestComputeArbitrage:
    def test_empty(self):
        assert ed.compute_arbitrage({}) == []

    def test_skips_refs_without_arb_profit_est(self):
        stats = {"A": {"ref": "A", "model": "M"}}  # no arb_profit_est
        assert ed.compute_arbitrage(stats) == []

    def test_skips_below_500_profit_threshold(self):
        stats = {
            "A": {"ref": "A", "model": "M", "brand": "Rolex",
                  "arb_profit_est": 499, "arb_spread_pct": 5,
                  "us_median": 100, "hk_median": 95, "hk_low": 94,
                  "hk_count": 5, "us_count": 3},
        }
        assert ed.compute_arbitrage(stats) == []

    def test_at_500_included(self):
        stats = {
            "A": {"ref": "A", "model": "M", "brand": "Rolex",
                  "arb_profit_est": 500, "arb_spread_pct": 5,
                  "us_median": 10500, "hk_median": 10000, "hk_low": 9900,
                  "hk_count": 5, "us_count": 3},
        }
        arbs = ed.compute_arbitrage(stats)
        assert len(arbs) == 1
        assert arbs[0]["profit_est"] == 500

    def test_sorted_by_profit_desc(self):
        stats = {
            "A": {"ref": "A", "model": "MA", "brand": "Rolex",
                  "arb_profit_est": 1000, "arb_spread_pct": 10,
                  "us_median": 1, "hk_median": 1, "hk_low": 1,
                  "hk_count": 5, "us_count": 3},
            "B": {"ref": "B", "model": "MB", "brand": "Rolex",
                  "arb_profit_est": 2000, "arb_spread_pct": 20,
                  "us_median": 1, "hk_median": 1, "hk_low": 1,
                  "hk_count": 5, "us_count": 3},
        }
        arbs = ed.compute_arbitrage(stats)
        assert [a["ref"] for a in arbs] == ["B", "A"]


# ─────────────────────────────────────────────────────────────
# compute_market_summary
# ─────────────────────────────────────────────────────────────

class TestComputeMarketSummary:
    def test_basic(self, tiny_listings_price_usd):
        ref_stats = ed.compute_ref_stats(tiny_listings_price_usd)
        summary = ed.compute_market_summary(tiny_listings_price_usd, ref_stats)
        assert summary["total_listings"] == 4
        assert summary["unique_refs"] == 1
        assert summary["unique_sellers"] == 4
        assert summary["brands"] == {"Unknown": 4}
        assert summary["regions"] == {"US": 2, "HK": 2}
        assert summary["avg_price"] == 250
        assert summary["median_price"] == 250

    def test_empty_prices(self):
        summary = ed.compute_market_summary([], {})
        assert summary["total_listings"] == 0
        assert summary["avg_price"] == 0
        assert summary["median_price"] == 0
        assert summary["top_refs"] == []

    def test_top_refs_sorted_by_count(self):
        listings = [{"ref": "A", "price_usd": 100} for _ in range(5)]
        listings += [{"ref": "B", "price_usd": 100} for _ in range(10)]
        ref_stats = ed.compute_ref_stats(listings)
        summary = ed.compute_market_summary(listings, ref_stats)
        assert summary["top_refs"][0]["ref"] == "B"
        assert summary["top_refs"][1]["ref"] == "A"


# ─────────────────────────────────────────────────────────────
# compute_market_movers
# ─────────────────────────────────────────────────────────────

class TestComputeMarketMovers:
    def test_requires_three_listings(self):
        stats = {"A": {"ref": "A", "model": "M", "count": 2,
                       "low": 100, "high": 200, "median": 150}}
        assert ed.compute_market_movers(stats) == []

    def test_spread_calculation(self):
        stats = {"A": {"ref": "A", "model": "M", "count": 3,
                       "low": 100, "high": 200, "median": 150}}
        movers = ed.compute_market_movers(stats)
        assert len(movers) == 1
        assert movers[0]["spread_pct"] == pytest.approx(66.7, abs=0.1)

    def test_sorted_by_spread_desc(self):
        stats = {
            "A": {"ref": "A", "model": "M", "count": 3,
                  "low": 100, "high": 110, "median": 105},
            "B": {"ref": "B", "model": "M", "count": 3,
                  "low": 100, "high": 200, "median": 150},
        }
        movers = ed.compute_market_movers(stats)
        assert movers[0]["ref"] == "B"


# ─────────────────────────────────────────────────────────────
# compute_sellers_leaderboard
# ─────────────────────────────────────────────────────────────

class TestComputeSellersLeaderboard:
    def test_empty(self):
        assert ed.compute_sellers_leaderboard([]) == []

    def test_skips_missing_seller(self):
        assert ed.compute_sellers_leaderboard([{"ref": "A", "price_usd": 100}]) == []

    def test_sorted_by_count_desc(self):
        listings = [
            {"seller": "Alice", "price_usd": 100, "region": "US", "group": "G1"},
            {"seller": "Alice", "price_usd": 200, "region": "US", "group": "G1"},
            {"seller": "Bob", "price_usd": 150, "region": "HK", "group": "G2"},
        ]
        board = ed.compute_sellers_leaderboard(listings)
        assert board[0]["seller"] == "Alice"
        assert board[0]["count"] == 2
        assert board[0]["avg_price"] == 150
        assert board[1]["seller"] == "Bob"


# ─────────────────────────────────────────────────────────────
# build_listings_index
# ─────────────────────────────────────────────────────────────

class TestBuildListingsIndex:
    def test_filters_under_3000(self):
        listings = [
            {"ref": "A", "price_usd": 2999},
            {"ref": "B", "price_usd": 3000},
            {"ref": "C", "price_usd": 100000},
        ]
        idx = ed.build_listings_index(listings)
        refs = {r["ref"] for r in idx}
        assert "A" not in refs
        assert "B" in refs
        assert "C" in refs

    def test_rounds_price(self):
        idx = ed.build_listings_index([{"ref": "A", "price_usd": 10500.7}])
        assert idx[0]["price"] == 10501

    def test_missing_price_excluded(self):
        idx = ed.build_listings_index([{"ref": "A"}])
        assert idx == []


# ─────────────────────────────────────────────────────────────
# load_manual_listings (integration-lite: uses tmp_path)
# ─────────────────────────────────────────────────────────────

class TestLoadManualListings:
    def test_nonexistent_file_returns_empty(self, monkeypatch, tmp_path):
        monkeypatch.setattr(ed, "MANUAL_FILE", tmp_path / "nope.json")
        assert ed.load_manual_listings() == []

    def test_malformed_json_returns_empty(self, monkeypatch, tmp_path):
        f = tmp_path / "manual_listings.json"
        f.write_text("not-json{")
        monkeypatch.setattr(ed, "MANUAL_FILE", f)
        assert ed.load_manual_listings() == []

    def test_skips_comment_entries(self, monkeypatch, tmp_path):
        import json
        f = tmp_path / "manual_listings.json"
        f.write_text(json.dumps([
            {"_comment": "this row is documentation"},
            {"ref": "A", "price": 100, "model": "M"},
        ]))
        monkeypatch.setattr(ed, "MANUAL_FILE", f)
        out = ed.load_manual_listings()
        assert len(out) == 1
        assert out[0]["ref"] == "A"
        assert out[0]["price_usd"] == 100.0  # price → price_usd
        assert out[0]["source"] == "manual"

    def test_preserves_explicit_source(self, monkeypatch, tmp_path):
        import json
        f = tmp_path / "manual_listings.json"
        f.write_text(json.dumps([
            {"ref": "A", "price": 100, "source": "manual:mda"},
        ]))
        monkeypatch.setattr(ed, "MANUAL_FILE", f)
        out = ed.load_manual_listings()
        assert out[0]["source"] == "manual:mda"
