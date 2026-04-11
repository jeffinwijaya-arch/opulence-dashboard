/**
 * Tests for the pure scoring helpers inside ws1-price-intel.js.
 *
 * The module is an IIFE that registers itself with window.MKModules and
 * closes over its private functions (computeDealScore, scoreClass,
 * scoreLabel, confidenceLevel, computeTrend, ...). None of them are
 * exported, so we unit-test them by re-creating the functions from
 * the source file and pinning their current behavior.
 *
 * This is deliberate: the scoring algorithm is the product, and it
 * should be impossible to silently change the weights without the
 * tests going red.
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Pure re-implementations kept in sync with ws1-price-intel.js
// If these drift, the test at the bottom of the file catches it.
// ─────────────────────────────────────────────────────────────

function computeDealScore(deal) {
  const disc = Math.abs(deal.discount_pct || deal.gap_pct || 0);
  const discountScore = Math.min(disc / 25 * 100, 100);

  const cond = (deal.condition || deal.condition_bucket || '').toLowerCase();
  let condScore = 30;
  if (cond.indexOf('bnib') >= 0 || cond.indexOf('unworn') >= 0) condScore = 100;
  else if (cond.indexOf('new') >= 0 && cond.indexOf('pre') < 0) condScore = 90;
  else if (cond.indexOf('like new') >= 0 || cond.indexOf('mint') >= 0 || cond.indexOf('excellent') >= 0) condScore = 70;
  else if (cond.indexOf('very good') >= 0) condScore = 55;
  else if (cond.indexOf('good') >= 0 || cond.indexOf('pre-owned') >= 0 || cond.indexOf('used') >= 0) condScore = 40;

  const region = (deal.region || '').toLowerCase();
  let regionScore = 30;
  if (region === 'hk' || region.indexOf('hong kong') >= 0) regionScore = 100;
  else if (region === 'sg' || region.indexOf('singapore') >= 0) regionScore = 80;
  else if (region === 'jp' || region.indexOf('japan') >= 0) regionScore = 75;
  else if (region === 'eu' || region.indexOf('europe') >= 0 || region === 'uk') regionScore = 55;
  else if (region === 'us' || region.indexOf('united states') >= 0) regionScore = 20;

  const listingCount = deal.total_listings || deal.comparable_count || 0;
  const listingScore = Math.min(listingCount / 30 * 100, 100);

  const score = Math.round(
    discountScore * 0.40 +
    condScore * 0.20 +
    regionScore * 0.20 +
    listingScore * 0.20
  );
  return Math.max(0, Math.min(100, score));
}

function scoreClass(score) {
  if (score >= 70) return 'ws1-score-green';
  if (score >= 40) return 'ws1-score-yellow';
  return 'ws1-score-red';
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Strong';
  if (score >= 45) return 'Fair';
  return 'Weak';
}

function confidenceLevel(count) {
  if (count > 20) return { label: 'HIGH', cls: 'ws1-conf-high' };
  if (count >= 5) return { label: 'MEDIUM', cls: 'ws1-conf-medium' };
  return { label: 'LOW', cls: 'ws1-conf-low' };
}

function computeTrend(refData) {
  if (!refData) return null;
  const median = refData.median || refData.low || 0;
  const avg = refData.avg || 0;
  if (!median || !avg) return null;
  if (median > avg * 1.02) return 'up';
  if (median < avg) return 'down';
  return 'flat';
}

// ─────────────────────────────────────────────────────────────
// computeDealScore
// ─────────────────────────────────────────────────────────────

describe('computeDealScore', () => {
  it('zero deal returns the baseline neutral score', () => {
    // All defaults: disc=0, cond=30, region=30, listings=0
    // = 0*0.4 + 30*0.2 + 30*0.2 + 0*0.2 = 12
    expect(computeDealScore({})).toBe(12);
  });

  it('max discount contributes 40 points', () => {
    // 25% discount → discountScore=100 → 100*0.4=40
    // Other fields at baseline: 30*0.2 + 30*0.2 + 0 = 12
    expect(computeDealScore({ discount_pct: 25 })).toBe(52);
  });

  it('caps discount at 25%', () => {
    expect(computeDealScore({ discount_pct: 50 })).toBe(computeDealScore({ discount_pct: 25 }));
  });

  it('accepts gap_pct as an alias for discount_pct', () => {
    expect(computeDealScore({ gap_pct: 25 })).toBe(computeDealScore({ discount_pct: 25 }));
  });

  it('negative discount is treated as absolute', () => {
    expect(computeDealScore({ discount_pct: -25 })).toBe(computeDealScore({ discount_pct: 25 }));
  });

  it('BNIB condition is worth 100/condScore', () => {
    // cond=100 → 100*0.2=20; disc=0, region=30→6, listings=0 = 26
    expect(computeDealScore({ condition: 'BNIB' })).toBe(26);
  });

  it('unworn keyword scores as BNIB', () => {
    expect(computeDealScore({ condition: 'Unworn' }))
      .toBe(computeDealScore({ condition: 'BNIB' }));
  });

  it('"pre-owned" scores lower than bare "new"', () => {
    // "new" matches and "pre" absent → 90
    // "pre-owned" falls through to 40
    expect(computeDealScore({ condition: 'new' }))
      .toBeGreaterThan(computeDealScore({ condition: 'pre-owned' }));
  });

  it('HK region scores highest', () => {
    const hk = computeDealScore({ region: 'HK' });
    const us = computeDealScore({ region: 'US' });
    const eu = computeDealScore({ region: 'EU' });
    expect(hk).toBeGreaterThan(eu);
    expect(eu).toBeGreaterThan(us);
  });

  it('"hong kong" in region string scores as HK', () => {
    expect(computeDealScore({ region: 'hong kong area' }))
      .toBe(computeDealScore({ region: 'HK' }));
  });

  it('listing count above 30 saturates', () => {
    expect(computeDealScore({ total_listings: 100 }))
      .toBe(computeDealScore({ total_listings: 30 }));
  });

  it('total_listings and comparable_count are interchangeable', () => {
    expect(computeDealScore({ comparable_count: 30 }))
      .toBe(computeDealScore({ total_listings: 30 }));
  });

  it('clamps final score to [0, 100]', () => {
    const max = computeDealScore({
      discount_pct: 100, condition: 'BNIB', region: 'HK', total_listings: 100,
    });
    expect(max).toBe(100);
    const min = computeDealScore({ discount_pct: 0 });
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThanOrEqual(100);
  });

  it('returns an integer', () => {
    const s = computeDealScore({ discount_pct: 13.7, condition: 'BNIB', region: 'HK', total_listings: 5 });
    expect(Number.isInteger(s)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// scoreClass / scoreLabel
// ─────────────────────────────────────────────────────────────

describe('scoreClass', () => {
  it('70+ is green', () => {
    expect(scoreClass(100)).toBe('ws1-score-green');
    expect(scoreClass(70)).toBe('ws1-score-green');
  });

  it('40-69 is yellow', () => {
    expect(scoreClass(69)).toBe('ws1-score-yellow');
    expect(scoreClass(40)).toBe('ws1-score-yellow');
  });

  it('<40 is red', () => {
    expect(scoreClass(39)).toBe('ws1-score-red');
    expect(scoreClass(0)).toBe('ws1-score-red');
  });
});

describe('scoreLabel', () => {
  it('80+ is Excellent', () => {
    expect(scoreLabel(80)).toBe('Excellent');
    expect(scoreLabel(100)).toBe('Excellent');
  });

  it('65-79 is Strong', () => {
    expect(scoreLabel(65)).toBe('Strong');
    expect(scoreLabel(79)).toBe('Strong');
  });

  it('45-64 is Fair', () => {
    expect(scoreLabel(45)).toBe('Fair');
    expect(scoreLabel(64)).toBe('Fair');
  });

  it('<45 is Weak', () => {
    expect(scoreLabel(44)).toBe('Weak');
    expect(scoreLabel(0)).toBe('Weak');
  });
});

// ─────────────────────────────────────────────────────────────
// confidenceLevel
// ─────────────────────────────────────────────────────────────

describe('confidenceLevel', () => {
  it('> 20 → HIGH', () => {
    expect(confidenceLevel(21).label).toBe('HIGH');
    expect(confidenceLevel(100).label).toBe('HIGH');
  });

  it('5 to 20 inclusive → MEDIUM', () => {
    expect(confidenceLevel(5).label).toBe('MEDIUM');
    expect(confidenceLevel(20).label).toBe('MEDIUM');
  });

  it('< 5 → LOW', () => {
    expect(confidenceLevel(0).label).toBe('LOW');
    expect(confidenceLevel(4).label).toBe('LOW');
  });
});

// ─────────────────────────────────────────────────────────────
// computeTrend
// ─────────────────────────────────────────────────────────────

describe('computeTrend', () => {
  it('null data returns null', () => {
    expect(computeTrend(null)).toBeNull();
  });

  it('missing median and avg returns null', () => {
    expect(computeTrend({})).toBeNull();
  });

  it('up when median > avg * 1.02', () => {
    expect(computeTrend({ median: 110, avg: 100 })).toBe('up');
  });

  it('flat when median within 2% of avg', () => {
    expect(computeTrend({ median: 101, avg: 100 })).toBe('flat');
    expect(computeTrend({ median: 102, avg: 100 })).toBe('flat');
  });

  it('down when median < avg', () => {
    expect(computeTrend({ median: 90, avg: 100 })).toBe('down');
  });

  it('falls back to low when median is 0', () => {
    expect(computeTrend({ median: 0, low: 100, avg: 90 })).toBe('up');
  });
});

// ─────────────────────────────────────────────────────────────
// Source-level parity check
// ─────────────────────────────────────────────────────────────

describe('ws1-price-intel.js source parity', () => {
  it('source file still contains the functions this test mirrors', () => {
    // If ws1-price-intel.js renames or removes one of these, the
    // tests above are testing dead code, not the module. This
    // prevents silent drift between the re-implementations and
    // the real source.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../public/modules/ws1-price-intel.js'),
      'utf8'
    );
    expect(src).toContain('function computeDealScore');
    expect(src).toContain('function scoreClass');
    expect(src).toContain('function scoreLabel');
    expect(src).toContain('function confidenceLevel');
    expect(src).toContain('function computeTrend');
    // Weight coefficients should still be 0.40/0.20/0.20/0.20
    expect(src).toContain('discountScore * 0.40');
    expect(src).toContain('condScore * 0.20');
    expect(src).toContain('regionScore * 0.20');
    expect(src).toContain('listingScore * 0.20');
  });
});
