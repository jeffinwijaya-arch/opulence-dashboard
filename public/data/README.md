# public/data/

Static JSON served directly by the Cloudflare Worker in `src/worker.js`.
The dashboard reads these on load (`bundle.json` for the core refs +
summary, individual files for the heavier datasets).

## Files

| file              | description                                                          |
|-------------------|----------------------------------------------------------------------|
| `bundle.json`     | initial-load bundle — summary + deals + arbitrage + movers + sellers + refs |
| `refs.json`       | per-reference stats (b25, median, low, high, US/HK breakdown, dial breakdown) |
| `listings.json`   | deduplicated per-listing index (ref, price, dial, seller, group, region, …) |
| `summary.json`    | market-wide rollup (total listings, unique refs, brand/region/condition mix) |
| `deals.json`      | listings priced ≥7% below their US median                            |
| `arbitrage.json`  | refs where HK→US arbitrage profit ≥ $500 after import costs          |
| `movers.json`     | refs with the highest price dispersion (top 30 by spread %)          |
| `sellers.json`    | top 50 sellers by volume with avg price / regions / groups           |
| `manual_listings.json` | **version-controlled supplement for listings the parser missed** |

## Data pipeline

```
WhatsApp scraper
    ↓
../price_analyzer/parse_v4.py                 ← NOT in this repo (sibling dir)
    ↓
rolex_listings.json                           ← parse_v4 output
    ↓
export_data.py               ← reads rolex_listings.json + merges manual_listings.json + dedupes cross-posts
    ↓
public/data/{bundle,refs,listings,...}.json   ← committed here
    ↓
Cloudflare Worker (src/worker.js)             ← serves /api/* from these files
    ↓
dashboard (public/index.html)
```

### manual_listings.json

The parser only sees what the WhatsApp scraper is subscribed to, and
some formats it just doesn't handle (conversational listings like
"26K + 350 to complete" from a US dealer). When you find a real
listing the Price Intelligence lookup is missing, add an entry here
and run `scripts/rebuild_dashboard_data.py` (or re-run `export_data.py`
if you have the full `parse_v4` setup). Both pipelines merge this file
automatically.

Schema matches `listings.json`:

```json
{
  "ref":          "268655",
  "price":        26350,
  "dial":         "Black",
  "bracelet":     "Oysterflex",
  "condition":    "BNIB",           // BNIB | Pre-owned | Like New
  "completeness": "Full Set",       // Full Set | Watch Only | Partial
  "region":       "US",             // US | HK | EU | SG | AE | ...
  "seller":       "+1 (305) 954-8700",
  "group":        "RWB Lounge",     // or slash-joined list
  "model":        "Yacht-Master 37",
  "brand":        "Rolex",
  "year":         "2025",
  "source":       "manual:whatsapp-2026-04-11",
  "notes":        "optional free text — e.g. '26K + 350 = 26350 (card fee)'"
}
```

Rules:

- **`source` must start with `manual:`** so these records are
  traceable through the pipeline.
- **Cross-posts** (same dealer, same price, same ref in multiple
  WhatsApp groups) should be ONE entry here — the dedupe step would
  collapse them anyway, but keeping them consolidated at the source
  reduces noise.
- **Comment objects** — any entry that has a `_comment` field and no
  `ref` is skipped. Use these to leave notes in the file.
- **Remove entries** once the parser starts indexing them correctly.
  This file is meant to be a patch, not a permanent dataset.

## Cross-post dedupe

`export_data.py` and `scripts/rebuild_dashboard_data.py` both apply
a two-pass dedupe before computing any rollup. The old pipeline
counted every copy of a listing in every WhatsApp group as a
separate comparable, which inflated counts by ~2x and hid the fact
that single dealers were cross-posting the same offer in 4+ groups.

**Pass 1 — phone-normalized seller identity:**
Extracts digits from the `seller` string. A single dealer shows up
as `Winner (+8618466508645)` in one group and `+86 184 6650 8645`
in another; both collapse to `phone:8618466508645`.

**Pass 2 — content identity:**
For records with no usable phone (WhatsApp channel ids, emoji-only
names), dedupe on `(ref, rounded price, dial, condition, year)`.
Five-attribute match is specific enough that the false-positive
rate is effectively zero for real watch listings — two dealers
independently pricing the exact same spec to the dollar is not
a realistic collision.

When a cross-post is collapsed, the kept record's `group` field
becomes a slash-joined list of every group the cross-post appeared
in, and an `x_post_count` field records how many copies were merged
(so downstream code can tell a 1-group listing from a consolidated
4-group cross-post).

## Regenerating this directory from scratch

### With parse_v4 (the normal pipeline, needs `../price_analyzer/`):

```bash
python3 export_data.py
```

### Without parse_v4 (from this repo alone):

```bash
python3 scripts/rebuild_dashboard_data.py
```

The rebuild script reads the current `listings.json` as baseline,
merges `manual_listings.json`, dedupes, and regenerates every file
in this directory using the exact same math as `export_data.py`.
Use it when you just added to `manual_listings.json` and want to
push a data fix without touching the scraper setup.

## Invariant

`export_data.py` and `scripts/rebuild_dashboard_data.py` MUST
produce identical output from identical input. If you change the
stats / dedupe / rollup math in one, change it in the other. Both
files document this at the top.
