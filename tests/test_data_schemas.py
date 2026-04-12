"""
Validate public/data/*.json against their schemas.

The frontend reads these files and trusts their shape. Any pipeline
regression that produces a malformed file (missing keys, negative
counts, wrong types, threshold drift) will silently break the
dashboard. These tests catch that before deploy.

Schemas are defined in tests/schemas/data_schemas.py so they can be
shared with other tests (e.g. a future E2E suite that validates
fetched API responses).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from tests.schemas.data_schemas import SCHEMAS

DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"


def _collect_errors(validator, instance):
    """Return all validation errors as readable strings."""
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in validator.iter_errors(instance)
    ]


@pytest.mark.parametrize("filename,schema", list(SCHEMAS.items()))
def test_data_file_matches_schema(filename, schema):
    """
    Parametrized schema validation for every file in public/data/.
    One test-id per file so failures report which file broke.
    """
    path = DATA_DIR / filename
    if not path.exists():
        pytest.skip(f"{filename} not present in public/data/")
    with path.open() as f:
        data = json.load(f)
    validator = Draft7Validator(schema)
    errors = _collect_errors(validator, data)
    # Print the first 20 errors so failures are actionable
    assert not errors, (
        f"\n{filename} failed schema validation with {len(errors)} error(s):\n  - "
        + "\n  - ".join(errors[:20])
        + ("\n  ... (more)" if len(errors) > 20 else "")
    )


class TestInvariantsBeyondSchema:
    """
    Cross-cutting invariants that JSON Schema can't express cleanly.
    """

    def test_deals_sorted_by_discount_desc(self):
        path = DATA_DIR / "deals.json"
        if not path.exists():
            pytest.skip("deals.json missing")
        deals = json.loads(path.read_text())
        discounts = [d["discount_pct"] for d in deals]
        assert discounts == sorted(discounts, reverse=True), (
            "deals.json is not sorted by discount_pct descending")

    def test_arbitrage_sorted_by_profit_desc(self):
        path = DATA_DIR / "arbitrage.json"
        if not path.exists():
            pytest.skip("arbitrage.json missing")
        arbs = json.loads(path.read_text())
        profits = [a["profit_est"] for a in arbs]
        assert profits == sorted(profits, reverse=True)

    def test_movers_sorted_by_spread_desc(self):
        path = DATA_DIR / "movers.json"
        if not path.exists():
            pytest.skip("movers.json missing")
        movers = json.loads(path.read_text())
        spreads = [m["spread_pct"] for m in movers]
        assert spreads == sorted(spreads, reverse=True)

    def test_sellers_sorted_by_count_desc(self):
        path = DATA_DIR / "sellers.json"
        if not path.exists():
            pytest.skip("sellers.json missing")
        sellers = json.loads(path.read_text())
        counts = [s["count"] for s in sellers]
        assert counts == sorted(counts, reverse=True)

    def test_refs_dial_counts_sum_le_total(self):
        """Sum of dial counts should be <= total count per ref."""
        path = DATA_DIR / "refs.json"
        if not path.exists():
            pytest.skip("refs.json missing")
        refs = json.loads(path.read_text())
        for ref, s in refs.items():
            dial_sum = sum(d["count"] for d in s["dials"].values())
            assert dial_sum <= s["count"], (
                f"{ref}: dial sum {dial_sum} > total {s['count']}")

    def test_refs_low_le_high(self):
        path = DATA_DIR / "refs.json"
        if not path.exists():
            pytest.skip("refs.json missing")
        refs = json.loads(path.read_text())
        for ref, s in refs.items():
            assert s["low"] <= s["high"], f"{ref}: low {s['low']} > high {s['high']}"

    def test_bundle_matches_individual_files(self):
        """
        bundle.json should contain the same per-section data as the
        individual files (it's derived from them). Spot check that
        the counts line up.
        """
        bpath = DATA_DIR / "bundle.json"
        if not bpath.exists():
            pytest.skip("bundle.json missing")
        bundle = json.loads(bpath.read_text())

        for key in ["deals", "arbitrage", "movers", "sellers"]:
            fpath = DATA_DIR / f"{key}.json"
            if not fpath.exists():
                continue
            standalone = json.loads(fpath.read_text())
            assert len(bundle[key]) == len(standalone), (
                f"bundle.{key} has {len(bundle[key])} items but "
                f"{key}.json has {len(standalone)}")
