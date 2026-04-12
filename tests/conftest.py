"""
Shared pytest fixtures and path setup for the opulence-dashboard test suite.

The repo has two pipeline scripts that must stay behaviorally identical:

  - export_data.py            (project root, uses `price_usd` internally)
  - scripts/rebuild_dashboard_data.py  (uses `price` — the output schema)

Both are importable as modules from tests/ thanks to the sys.path entries
below. Fixtures provide parallel listing fixtures in each schema so the
parity test can feed both pipelines the "same" data without having to
rewrite the data shape inline in every test.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"

# Make root + scripts/ importable as top-level modules.
for p in (ROOT, SCRIPTS_DIR):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)


# ─────────────────────────────────────────────────────────────
# Listing fixtures
# ─────────────────────────────────────────────────────────────

def _listings_price_usd():
    """
    Canonical listings in the export_data.py internal schema (uses
    `price_usd`). Exercises:
      - cross-posts by the same phone-number dealer
      - content-identity cross-posts (no phone)
      - US / HK region split for arbitrage math
      - multi-dial per-ref
      - filtered rows (<3000 USD, missing ref, missing price)
    """
    return [
        # 126610LN — 4 listings, one cross-post collapses from 2 → 1
        {"ref": "126610LN", "model": "Submariner", "brand": "Rolex",
         "price_usd": 10800, "dial": "Black", "bracelet": "Oyster",
         "condition": "BNIB", "completeness": "Full Set", "region": "US",
         "seller": "Winner (+8618466508645)", "group": "G1", "year": "2024"},
        {"ref": "126610LN", "model": "Submariner", "brand": "Rolex",
         "price_usd": 10800, "dial": "Black", "bracelet": "Oyster",
         "condition": "BNIB", "completeness": "Full Set", "region": "US",
         "seller": "+86 184 6650 8645", "group": "G2", "year": "2024"},
        {"ref": "126610LN", "model": "Submariner", "brand": "Rolex",
         "price_usd": 11200, "dial": "Black", "bracelet": "Oyster",
         "condition": "Pre-owned", "completeness": "Watch Only", "region": "HK",
         "seller": "HK Dealer", "group": "HK1", "year": "2023"},
        {"ref": "126610LN", "model": "Submariner", "brand": "Rolex",
         "price_usd": 9800, "dial": "Black", "bracelet": "Oyster",
         "condition": "Pre-owned", "completeness": "Watch Only", "region": "HK",
         "seller": "HK Dealer 2", "group": "HK2", "year": "2023"},

        # 126500LN — 3 listings; one below 3000 filter? No, all above.
        {"ref": "126500LN", "model": "Daytona", "brand": "Rolex",
         "price_usd": 35000, "dial": "White", "bracelet": "Oyster",
         "condition": "BNIB", "completeness": "Full Set", "region": "US",
         "seller": "US Dealer", "group": "USG", "year": "2024"},
        {"ref": "126500LN", "model": "Daytona", "brand": "Rolex",
         "price_usd": 29000, "dial": "White", "bracelet": "Oyster",
         "condition": "Pre-owned", "completeness": "Full Set", "region": "HK",
         "seller": "Alice", "group": "HK1", "year": "2023"},
        {"ref": "126500LN", "model": "Daytona", "brand": "Rolex",
         "price_usd": 31000, "dial": "Black", "bracelet": "Oyster",
         "condition": "Pre-owned", "completeness": "Full Set", "region": "HK",
         "seller": "Bob", "group": "HK2", "year": "2023"},

        # Content-identity cross-post: two identical records, channel-id
        # seller strings (no phone), must collapse in pass 2.
        {"ref": "228238", "model": "Day-Date", "brand": "Rolex",
         "price_usd": 60000, "dial": "Casino Green", "bracelet": "President",
         "condition": "BNIB", "completeness": "Full Set", "region": "US",
         "seller": "CNn6ns4GIABIAZABAPABAg==", "group": "CH1", "year": "2025"},
        {"ref": "228238", "model": "Day-Date", "brand": "Rolex",
         "price_usd": 60000, "dial": "Casino Green", "bracelet": "President",
         "condition": "BNIB", "completeness": "Full Set", "region": "US",
         "seller": "💎GROUP💎", "group": "CH2", "year": "2025"},

        # Rows that should be dropped
        {"ref": "", "price_usd": 5000},          # missing ref
        {"ref": "126334", "price_usd": 0},       # zero price
    ]


def _to_output_schema(listings):
    """Convert internal (`price_usd`) shape to output (`price`) shape."""
    out = []
    for l in listings:
        rec = {k: v for k, v in l.items() if k != "price_usd"}
        if "price_usd" in l:
            rec["price"] = l["price_usd"]
        out.append(rec)
    return out


@pytest.fixture
def listings_price_usd():
    """Listings in export_data.py's internal `price_usd` schema."""
    return _listings_price_usd()


@pytest.fixture
def listings_price():
    """Listings in rebuild_dashboard_data.py's `price` schema."""
    return _to_output_schema(_listings_price_usd())


@pytest.fixture
def tiny_listings_price_usd():
    """Minimal 2-ref fixture for sanity tests."""
    return [
        {"ref": "A", "price_usd": 100, "region": "US", "seller": "s1",
         "condition": "BNIB", "dial": "Black", "year": "2024", "group": "G"},
        {"ref": "A", "price_usd": 200, "region": "US", "seller": "s2",
         "condition": "BNIB", "dial": "Black", "year": "2024", "group": "G"},
        {"ref": "A", "price_usd": 300, "region": "HK", "seller": "s3",
         "condition": "BNIB", "dial": "Black", "year": "2024", "group": "G"},
        {"ref": "A", "price_usd": 400, "region": "HK", "seller": "s4",
         "condition": "BNIB", "dial": "Black", "year": "2024", "group": "G"},
    ]
