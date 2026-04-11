/**
 * Tests for the market pricing logic used to value inventory.
 *
 * The module lives in two copies today — src/enhanced-pricing.js and
 * public/enhanced-pricing.js — which is itself a smell. One of these
 * tests asserts they are byte-identical so a drift between the two
 * files gets caught automatically.
 *
 * Both files attach ENHANCED_PRICING to `window`, so we load the
 * source with readFileSync + new Function rather than import (it's
 * not an ES module).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_FILE    = resolve(__dirname, '../../src/enhanced-pricing.js');
const PUBLIC_FILE = resolve(__dirname, '../../public/enhanced-pricing.js');

function loadEnhancedPricing(file) {
  const code = readFileSync(file, 'utf8');
  // The file ends with `window.ENHANCED_PRICING = ENHANCED_PRICING;`.
  // jsdom provides `window`, but it's nicer to run in an isolated
  // sandbox: rewrite the last line to return the object directly so
  // we don't stomp on globals between tests.
  const rewritten = code.replace(
    'window.ENHANCED_PRICING = ENHANCED_PRICING;',
    'return ENHANCED_PRICING;'
  );
  // eslint-disable-next-line no-new-func
  return (new Function(rewritten))();
}

let ENHANCED_PRICING;

beforeAll(() => {
  ENHANCED_PRICING = loadEnhancedPricing(SRC_FILE);
});

// ─────────────────────────────────────────────────────────────
// File-duplication check
// ─────────────────────────────────────────────────────────────

describe('src vs public enhanced-pricing.js parity', () => {
  it('src and public copies are byte-identical', () => {
    const a = readFileSync(SRC_FILE, 'utf8');
    const b = readFileSync(PUBLIC_FILE, 'utf8');
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────
// detectVariant
// ─────────────────────────────────────────────────────────────

describe('detectVariant', () => {
  it('returns "default" for empty description', () => {
    expect(ENHANCED_PRICING.detectVariant('')).toBe('default');
  });

  it('detects casino_green from the word casino', () => {
    expect(ENHANCED_PRICING.detectVariant('Rolex Day-Date Casino dial')).toBe('casino_green');
  });

  it('detects casino_green from "money"', () => {
    expect(ENHANCED_PRICING.detectVariant('Day-Date money dial edition')).toBe('casino_green');
  });

  it('detects casino_green from green + 228238', () => {
    expect(ENHANCED_PRICING.detectVariant('228238 green dial')).toBe('casino_green');
  });

  it('prefers black_diamond_baguette over black_diamond when both present', () => {
    expect(ENHANCED_PRICING.detectVariant('228238 black diamond baguette dial')).toBe('black_diamond_baguette');
  });

  it('detects plain black_diamond', () => {
    expect(ENHANCED_PRICING.detectVariant('228238 black diamond dial')).toBe('black_diamond');
  });

  it('detects ghost', () => {
    expect(ENHANCED_PRICING.detectVariant('126519LN ghost dial')).toBe('ghost');
  });

  it('detects grey_black from grey black', () => {
    expect(ENHANCED_PRICING.detectVariant('126519LN grey black dial')).toBe('grey_black');
  });

  it('detects grey_black from gray black (American spelling)', () => {
    expect(ENHANCED_PRICING.detectVariant('126519LN gray black dial')).toBe('grey_black');
  });

  it('detects champagne', () => {
    expect(ENHANCED_PRICING.detectVariant('228238 champagne dial')).toBe('champagne');
  });

  it('is case-insensitive', () => {
    expect(ENHANCED_PRICING.detectVariant('CASINO GREEN')).toBe('casino_green');
    expect(ENHANCED_PRICING.detectVariant('Ghost')).toBe('ghost');
  });
});

// ─────────────────────────────────────────────────────────────
// detectCondition
// ─────────────────────────────────────────────────────────────

describe('detectCondition', () => {
  it('returns "excellent" by default', () => {
    expect(ENHANCED_PRICING.detectCondition('some random watch')).toBe('excellent');
  });

  it('detects BNIB from "bnib"', () => {
    expect(ENHANCED_PRICING.detectCondition('Rolex BNIB 2024')).toBe('bnib');
  });

  it('detects BNIB from "brand new"', () => {
    expect(ENHANCED_PRICING.detectCondition('Brand new in box')).toBe('bnib');
  });

  it('detects BNIB from "full set"', () => {
    expect(ENHANCED_PRICING.detectCondition('Full set, original papers')).toBe('bnib');
  });

  it('detects BNIB from "unworn"', () => {
    expect(ENHANCED_PRICING.detectCondition('Unworn, factory stickers')).toBe('bnib');
  });

  it('detects BNIB from 2025 MM/YYYY date pattern', () => {
    expect(ENHANCED_PRICING.detectCondition('Rolex dated 06/2025')).toBe('bnib');
  });

  it('detects BNIB from 2026 MM/YYYY date pattern', () => {
    expect(ENHANCED_PRICING.detectCondition('Rolex dated 12/2026')).toBe('bnib');
  });

  it('ignores out-of-range month in date pattern', () => {
    // 13/2025 is not a valid date → should not flag as BNIB
    expect(ENHANCED_PRICING.detectCondition('Rolex 13/2025 weird')).toBe('excellent');
  });

  it('ignores pre-2025 date pattern', () => {
    expect(ENHANCED_PRICING.detectCondition('Rolex from 06/2022')).toBe('excellent');
  });

  it('detects BNIB from full month name + year', () => {
    expect(ENHANCED_PRICING.detectCondition('Purchased March 2025')).toBe('bnib');
    expect(ENHANCED_PRICING.detectCondition('December 2026 delivery')).toBe('bnib');
  });

  it('is case-insensitive', () => {
    expect(ENHANCED_PRICING.detectCondition('RETAIL READY')).toBe('bnib');
  });
});

// ─────────────────────────────────────────────────────────────
// calculateMarketValue
// ─────────────────────────────────────────────────────────────

describe('calculateMarketValue', () => {
  it('returns null for unknown ref', () => {
    expect(ENHANCED_PRICING.calculateMarketValue('UNKNOWN', 'anything')).toBeNull();
  });

  it('handles 228238 Casino Green BNIB', () => {
    const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green Full Set');
    expect(r).not.toBeNull();
    expect(r.variant).toBe('casino_green');
    expect(r.condition).toBe('bnib');
    // base market = 41550 * 1.45 = 60247.5
    expect(r.baseMarket).toBe(60248);
    // BNIB final = 60247.5 * 1.25 = 75309.375 → 75309
    expect(r.marketValue).toBe(75309);
    expect(r.marketMultiplier).toBe(1.45);
    expect(r.bnibPremium).toBe(0.25);
  });

  it('handles 228238 Pre-owned (0.92 discount)', () => {
    const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green pre-owned watch only');
    // base market = 41550 * 1.45 = 60247.5
    // pre-owned = 60247.5 * 0.92 = 55427.7 → 55428
    expect(r.marketValue).toBe(55428);
    expect(r.bnibPremium).toBe(0); // condition not BNIB → premium reported as 0
  });

  it('handles default variant for ref with specialVariants but unknown variant', () => {
    const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Full Set');
    expect(r.variant).toBe('default');
    expect(r.marketMultiplier).toBe(1.20);
    expect(r.bnibPremium).toBe(0.18);
  });

  it('handles ref without specialVariants entry using global fallback', () => {
    // 126500LN has retail but no specialVariants entry → falls back
    // to the default 1.20 multiplier / 0.18 BNIB premium.
    const r = ENHANCED_PRICING.calculateMarketValue('126500LN', 'bnib');
    // base market = 16100 * 1.20 = 19320
    // BNIB = 19320 * 1.18 = 22797.6 → 22798
    expect(r.marketValue).toBe(22798);
    expect(r.variant).toBe('default');
    expect(r.marketMultiplier).toBe(1.20);
    expect(r.bnibPremium).toBe(0.18);
  });

  it('handles 126519LN Ghost BNIB', () => {
    const r = ENHANCED_PRICING.calculateMarketValue('126519LN', 'Ghost BNIB');
    expect(r.variant).toBe('ghost');
    expect(r.marketMultiplier).toBe(1.38);
    // base = 39650 * 1.38 = 54717 → BNIB = 54717 * 1.25 = 68396.25 → 68396
    expect(r.marketValue).toBe(68396);
  });

  describe('costVsMarket analysis buckets', () => {
    it('EXCELLENT when cost/market < 5%', () => {
      // Find a cost producing exactly < 5% premium
      const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green bnib', 75000);
      // marketValue ≈ 75309; 75000/75309 - 1 = -0.4%
      expect(r.analysis).toBe('EXCELLENT');
    });

    it('GOOD when cost/market between 5 and 12%', () => {
      // marketValue ≈ 75309; cost at +8% → 81334
      const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green bnib', 81334);
      expect(r.analysis).toBe('GOOD');
    });

    it('PREMIUM when cost/market between 12 and 20%', () => {
      const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green bnib', 87358);
      expect(r.analysis).toBe('PREMIUM');
    });

    it('EXPENSIVE when cost/market >= 20%', () => {
      const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green bnib', 100000);
      expect(r.analysis).toBe('EXPENSIVE');
    });

    it('no analysis field when cost omitted', () => {
      const r = ENHANCED_PRICING.calculateMarketValue('228238', 'Casino Green bnib');
      expect(r.analysis).toBeUndefined();
      expect(r.costVsMarket).toBeUndefined();
    });
  });
});
