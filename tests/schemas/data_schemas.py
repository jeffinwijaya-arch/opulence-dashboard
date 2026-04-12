"""
JSON schemas for the files the frontend blindly trusts in public/data/.

Schema source-of-truth lives here rather than in a standalone .json
file so it's version-controlled alongside the tests that use it and
can reference shared definitions without JSON pointer gymnastics.

The frontend fetches these files and calls `.length`, `.keys()`,
and field accesses on them without validation — so a drift in the
pipeline silently ships wrong data. These schemas catch that.
"""

# Common leaf schemas
_NON_NEGATIVE_NUM = {"type": "number", "minimum": 0}
_NULLABLE_NON_NEG = {"type": ["number", "null"], "minimum": 0}

_DIAL_STATS = {
    "type": "object",
    "additionalProperties": False,
    "required": ["count", "low", "high", "avg"],
    "properties": {
        "count": {"type": "integer", "minimum": 1},
        "low": _NON_NEGATIVE_NUM,
        "high": _NON_NEGATIVE_NUM,
        "avg": _NON_NEGATIVE_NUM,
        "b25": _NULLABLE_NON_NEG,
        "median": _NULLABLE_NON_NEG,
    },
}

REF_STATS_ENTRY = {
    "type": "object",
    "required": ["ref", "model", "count", "low", "high", "avg", "conditions", "dials"],
    "properties": {
        "ref": {"type": "string"},
        "model": {"type": "string"},
        "brand": {"type": "string"},
        "count": {"type": "integer", "minimum": 1},
        "low": _NON_NEGATIVE_NUM,
        "high": _NON_NEGATIVE_NUM,
        "avg": _NON_NEGATIVE_NUM,
        "b25": _NULLABLE_NON_NEG,
        "median": _NULLABLE_NON_NEG,
        "conditions": {
            "type": "object",
            "additionalProperties": {"type": "integer", "minimum": 0},
        },
        "dials": {
            "type": "object",
            "additionalProperties": _DIAL_STATS,
        },
        "us_count": {"type": "integer", "minimum": 0},
        "hk_count": {"type": "integer", "minimum": 0},
        "us_b25": _NULLABLE_NON_NEG,
        "us_median": _NULLABLE_NON_NEG,
        "us_low": _NULLABLE_NON_NEG,
        "hk_b25": _NULLABLE_NON_NEG,
        "hk_median": _NULLABLE_NON_NEG,
        "hk_low": _NULLABLE_NON_NEG,
        "arb_spread_pct": {"type": "number"},
        "arb_profit_est": {"type": "number"},
    },
    # Allow the backward-compat aliases + unknown but harmless fields
    "additionalProperties": True,
}

REFS_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "additionalProperties": REF_STATS_ENTRY,
}

DEAL_ENTRY = {
    "type": "object",
    "required": ["ref", "price", "benchmark", "discount_pct"],
    "properties": {
        "ref": {"type": "string", "minLength": 1},
        "model": {"type": "string"},
        "brand": {"type": "string"},
        "dial": {"type": "string"},
        "price": {"type": "number", "minimum": 0},
        "benchmark": {"type": "number", "minimum": 0},
        # Pipelines only add deals with discount >= 7%; assert that
        # invariant here so a silent threshold regression gets caught.
        "discount_pct": {"type": "number", "minimum": 7},
        "condition": {"type": "string"},
        "completeness": {"type": "string"},
        "region": {"type": "string"},
        "seller": {"type": "string"},
        "group": {"type": "string"},
    },
    "additionalProperties": True,
}

DEALS_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "array",
    "maxItems": 100,
    "items": DEAL_ENTRY,
}

ARBITRAGE_ENTRY = {
    "type": "object",
    "required": ["ref", "profit_est", "spread_pct"],
    "properties": {
        "ref": {"type": "string", "minLength": 1},
        "model": {"type": "string"},
        "brand": {"type": "string"},
        "hk_median": _NULLABLE_NON_NEG,
        "hk_low": _NULLABLE_NON_NEG,
        "us_median": _NULLABLE_NON_NEG,
        "spread_pct": {"type": "number"},
        # Pipelines gate arbs on >= 500 profit
        "profit_est": {"type": "number", "minimum": 500},
        "hk_count": {"type": "integer", "minimum": 0},
        "us_count": {"type": "integer", "minimum": 0},
    },
    "additionalProperties": True,
}

ARBITRAGE_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "array",
    "items": ARBITRAGE_ENTRY,
}

MOVER_ENTRY = {
    "type": "object",
    "required": ["ref", "median", "low", "high", "spread_pct", "count"],
    "properties": {
        "ref": {"type": "string", "minLength": 1},
        "model": {"type": "string"},
        "median": _NON_NEGATIVE_NUM,
        "low": _NON_NEGATIVE_NUM,
        "high": _NON_NEGATIVE_NUM,
        "spread_pct": {"type": "number"},
        # Movers require >= 3 comparables
        "count": {"type": "integer", "minimum": 3},
    },
    "additionalProperties": True,
}

MOVERS_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "array",
    "maxItems": 30,
    "items": MOVER_ENTRY,
}

SELLER_ENTRY = {
    "type": "object",
    "required": ["seller", "count", "avg_price"],
    "properties": {
        "seller": {"type": "string", "minLength": 1},
        "count": {"type": "integer", "minimum": 1},
        "avg_price": {"type": "number", "minimum": 0},
        "regions": {"type": "array", "items": {"type": "string"}},
        "groups": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
    },
    "additionalProperties": True,
}

SELLERS_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "array",
    "maxItems": 50,
    "items": SELLER_ENTRY,
}

SUMMARY_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": [
        "total_listings", "unique_refs", "unique_sellers", "unique_groups",
        "avg_price", "median_price", "brands", "regions", "conditions",
        "top_refs", "updated_at",
    ],
    "properties": {
        "total_listings": {"type": "integer", "minimum": 0},
        "unique_refs": {"type": "integer", "minimum": 0},
        "unique_sellers": {"type": "integer", "minimum": 0},
        "unique_groups": {"type": "integer", "minimum": 0},
        "avg_price": _NON_NEGATIVE_NUM,
        "median_price": _NON_NEGATIVE_NUM,
        "brands": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
        "regions": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
        "conditions": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
        "top_refs": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "required": ["ref", "count", "low", "avg", "median"],
                "properties": {
                    "ref": {"type": "string"},
                    "model": {"type": "string"},
                    "count": {"type": "integer", "minimum": 1},
                    "low": _NON_NEGATIVE_NUM,
                    "avg": _NON_NEGATIVE_NUM,
                    "median": _NULLABLE_NON_NEG,
                },
                "additionalProperties": True,
            },
        },
        "updated_at": {"type": "string", "minLength": 1},
    },
    "additionalProperties": True,
}

LISTINGS_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "array",
    "items": {
        "type": "object",
        "required": ["ref", "price"],
        "properties": {
            "ref": {"type": "string", "minLength": 1},
            # build_listings_index filters price < 3000 out
            "price": {"type": "number", "minimum": 3000},
            "dial": {"type": "string"},
            "bracelet": {"type": "string"},
            "condition": {"type": "string"},
            "completeness": {"type": "string"},
            "region": {"type": "string"},
            "seller": {"type": "string"},
            "group": {"type": "string"},
            "model": {"type": "string"},
            "brand": {"type": "string"},
            "year": {"type": ["string", "number"]},
            "x_post_count": {"type": "integer", "minimum": 1},
        },
        "additionalProperties": True,
    },
}

NEWS_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["articles", "fetched_at", "sources"],
    "properties": {
        "articles": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "title", "link", "date", "source"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "title": {"type": "string"},
                    "link": {"type": "string"},
                    "desc": {"type": "string"},
                    "date": {"type": "string"},
                    "source": {"type": "string"},
                    "image": {"type": "string"},
                    "relevance": {"type": "integer", "minimum": 0, "maximum": 100},
                },
                "additionalProperties": True,
            },
        },
        "fetched_at": {"type": "string"},
        "sources": {"type": "array", "items": {"type": "string"}},
    },
}

BUNDLE_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["summary", "deals", "arbitrage", "movers", "sellers", "refs"],
    "properties": {
        "summary":   SUMMARY_SCHEMA,
        "deals":     DEALS_SCHEMA,
        "arbitrage": ARBITRAGE_SCHEMA,
        "movers":    MOVERS_SCHEMA,
        "sellers":   SELLERS_SCHEMA,
        "refs":      REFS_SCHEMA,
    },
}

# Central mapping used by test_data_schemas.py
SCHEMAS = {
    "refs.json":      REFS_SCHEMA,
    "deals.json":     DEALS_SCHEMA,
    "arbitrage.json": ARBITRAGE_SCHEMA,
    "movers.json":    MOVERS_SCHEMA,
    "sellers.json":   SELLERS_SCHEMA,
    "summary.json":   SUMMARY_SCHEMA,
    "listings.json":  LISTINGS_SCHEMA,
    "news.json":      NEWS_SCHEMA,
    "bundle.json":    BUNDLE_SCHEMA,
}
