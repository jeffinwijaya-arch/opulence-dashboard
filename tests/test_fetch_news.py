"""
Unit tests for fetch_news.py pure helpers.

We don't test the network-bound fetch_feed() / main() here — those need
VCR-style cassettes and this project doesn't have one. Everything that
runs on response bodies after the HTTP call is pure and testable.
"""

from __future__ import annotations

from datetime import datetime

import fetch_news as fn


class TestCleanHtml:
    def test_none(self):
        assert fn.clean_html(None) == ""

    def test_empty(self):
        assert fn.clean_html("") == ""

    def test_strips_tags(self):
        assert fn.clean_html("<p>Hello <b>world</b></p>") == "Hello world"

    def test_decodes_entities(self):
        assert fn.clean_html("Rolex &amp; Patek") == "Rolex & Patek"
        assert fn.clean_html("&lt;b&gt;") == "<b>"

    def test_strips_surrounding_whitespace(self):
        assert fn.clean_html("   hi   ") == "hi"

    def test_nested_tags(self):
        assert fn.clean_html("<div><span>a</span><span>b</span></div>") == "ab"


class TestParseDate:
    def test_empty_returns_now_iso(self):
        out = fn.parse_date("")
        # Parseable as ISO
        assert datetime.fromisoformat(out)

    def test_none_returns_now_iso(self):
        out = fn.parse_date(None)
        assert datetime.fromisoformat(out)

    def test_rfc_2822_with_offset(self):
        out = fn.parse_date("Mon, 06 Jan 2025 12:00:00 +0000")
        dt = datetime.fromisoformat(out)
        assert dt.year == 2025
        assert dt.month == 1
        assert dt.day == 6

    def test_iso_8601_with_offset(self):
        out = fn.parse_date("2025-06-15T09:30:00+0000")
        dt = datetime.fromisoformat(out)
        assert dt.year == 2025
        assert dt.month == 6

    def test_naive_datetime(self):
        out = fn.parse_date("2025-03-20 14:00:00")
        # Returns an ISO-ish string; the exact format depends on the
        # successful strptime match, but it should start with 2025-03.
        assert "2025-03-20" in out

    def test_unparseable_returns_raw(self):
        assert fn.parse_date("not a date") == "not a date"


class TestRelevanceScore:
    def test_no_keywords_zero(self):
        assert fn.relevance_score("Cooking recipes", "how to bake") == 0

    def test_single_keyword_ten(self):
        assert fn.relevance_score("Rolex news", "") == 10

    def test_multiple_keywords_sum(self):
        # "rolex" and "market" both match → 20
        assert fn.relevance_score("Rolex market update", "") == 20

    def test_keywords_in_description_count(self):
        assert fn.relevance_score("News today", "the auction record broke") == 20

    def test_case_insensitive(self):
        assert fn.relevance_score("ROLEX DAYTONA", "") == 20

    def test_capped_at_100(self):
        # Stuff many keywords into a single string
        title = "rolex patek audemars price market auction record daytona submariner nautilus royal oak gmt-master"
        assert fn.relevance_score(title, "") == 100
