/**
 * Tests for public/modules/module-loader.js
 *
 * The loader is the error boundary for the SPA: a crash in one module
 * must not take down the others. These tests verify that contract and
 * the priority/retry/perf-tracking behaviors that go with it.
 *
 * module-loader.js is an IIFE that attaches window.MKModules and
 * kicks off an auto-load of ws1..ws10 scripts. We don't want that
 * auto-load happening in tests (the files don't exist at the
 * path it expects), so we strip the bottom `(function() { ... })();`
 * block before evaluating.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOADER_FILE = resolve(__dirname, '../../public/modules/module-loader.js');

// The loader is chatty (console.log for every register/init). That's
// fine in production but turns test output into noise. Mute all four
// console methods globally for this file.
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'table').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

function loadMKModules() {
  const raw = readFileSync(LOADER_FILE, 'utf8');
  // Strip the auto-loader IIFE at the bottom. It's the final
  // `(function() { ... })();` block starting after the closing
  // brace of window.MKModules = { ... };
  const cutPoint = raw.indexOf('// Auto-load module scripts');
  const code = cutPoint >= 0 ? raw.slice(0, cutPoint) : raw;
  // Evaluate so that `window.MKModules` is set in the jsdom window.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', code)(window, document);
  // Return a fresh isolated instance by cloning the internals.
  return window.MKModules;
}

function resetMKModules(MK) {
  MK._modules = {};
  MK._loaded = new Set();
  MK._failed = new Map();
  MK._pending = new Set();
  MK._retried = new Set();
  MK._perf = {};
}

let MK;

beforeEach(() => {
  // Reset DOM and re-eval the loader fresh each test.
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete window.MKModules;
  MK = loadMKModules();
  resetMKModules(MK);
});

describe('register()', () => {
  it('stores the module and marks it pending', () => {
    const mod = { init: () => {}, render: () => {} };
    MK.register('ws1-price-intel', mod);
    expect(MK._modules['ws1-price-intel']).toBe(mod);
    expect(MK._loaded.has('ws1-price-intel')).toBe(true);
    expect(MK._pending.has('ws1-price-intel')).toBe(true);
  });

  it('honors priority: "critical" override', () => {
    MK._critical = new Set(); // clear defaults
    MK.register('ws2-inventory-pnl', { priority: 'critical', init: () => {} });
    expect(MK._critical.has('ws2-inventory-pnl')).toBe(true);
  });

  it('honors priority: "deferred" override', () => {
    MK._critical = new Set(['ws1-price-intel']);
    MK.register('ws1-price-intel', { priority: 'deferred', init: () => {} });
    expect(MK._critical.has('ws1-price-intel')).toBe(false);
  });
});

describe('_initOne()', () => {
  it('returns true when init() succeeds and records perf', async () => {
    MK.register('mod1', { init: async () => {} });
    const ok = await MK._initOne('mod1');
    expect(ok).toBe(true);
    expect(MK._failed.has('mod1')).toBe(false);
    expect(MK._pending.has('mod1')).toBe(false);
    expect(typeof MK._perf.mod1.init_ms).toBe('number');
  });

  it('catches thrown errors and records the failure', async () => {
    MK.register('crashy', { init: () => { throw new Error('boom'); } });
    const ok = await MK._initOne('crashy');
    expect(ok).toBe(false);
    expect(MK._failed.get('crashy').message).toBe('boom');
    expect(MK._pending.has('crashy')).toBe(false);
  });

  it('catches rejected promises', async () => {
    MK.register('async-crashy', { init: async () => { throw new Error('async-boom'); } });
    const ok = await MK._initOne('async-crashy');
    expect(ok).toBe(false);
    expect(MK._failed.get('async-crashy').message).toBe('async-boom');
  });

  it('treats modules without init() as successful no-ops', async () => {
    MK.register('no-init', { render: () => {} });
    const ok = await MK._initOne('no-init');
    expect(ok).toBe(true);
  });

  it('returns true and does nothing for unknown module id', async () => {
    const ok = await MK._initOne('nonexistent');
    expect(ok).toBe(true);
  });

  it('one module crash does not block others', async () => {
    const results = [];
    MK.register('a', { init: () => { results.push('a'); } });
    MK.register('b', { init: () => { throw new Error('b-boom'); } });
    MK.register('c', { init: () => { results.push('c'); } });
    await MK._initOne('a');
    await MK._initOne('b');
    await MK._initOne('c');
    expect(results).toEqual(['a', 'c']);
    expect(MK._failed.has('b')).toBe(true);
    expect(MK._failed.has('a')).toBe(false);
    expect(MK._failed.has('c')).toBe(false);
  });
});

describe('renderAll()', () => {
  it('invokes render() on every healthy module', () => {
    const seen = [];
    MK.register('a', { init: () => {}, render: () => seen.push('a') });
    MK.register('b', { init: () => {}, render: () => seen.push('b') });
    MK.renderAll();
    // ws* order driven by _initOrder, but our ids are 'a'/'b' which
    // are not in that list, so they don't render. Use real ids:
    seen.length = 0;
    resetMKModules(MK);
    MK.register('ws1-price-intel', { init: () => {}, render: () => seen.push('ws1') });
    MK.register('ws3-deal-flow', { init: () => {}, render: () => seen.push('ws3') });
    MK.renderAll();
    expect(seen).toEqual(['ws1', 'ws3']);
  });

  it('skips failed modules', () => {
    const seen = [];
    MK.register('ws1-price-intel', { render: () => seen.push('ws1') });
    MK._failed.set('ws1-price-intel', new Error('earlier failure'));
    MK.renderAll();
    expect(seen).toEqual([]);
  });

  it('catches render errors and marks the module failed', () => {
    MK.register('ws1-price-intel', {
      render: () => { throw new Error('render-boom'); },
    });
    MK.renderAll();
    expect(MK._failed.get('ws1-price-intel').message).toBe('render-boom');
  });
});

describe('status()', () => {
  it('partitions modules into loaded / failed / pending', async () => {
    MK.register('ok1', { init: () => {} });
    MK.register('ok2', { init: () => {} });
    MK.register('bad', { init: () => { throw new Error('x'); } });
    MK.register('lazy', { init: () => {} });
    await MK._initOne('ok1');
    await MK._initOne('ok2');
    await MK._initOne('bad');
    // 'lazy' remains pending
    const s = MK.status();
    expect(s.loaded.sort()).toEqual(['ok1', 'ok2']);
    expect(s.failed).toEqual(['bad']);
    expect(s.pending).toEqual(['lazy']);
  });
});

describe('formatPrice() / formatPct()', () => {
  it('formatPrice handles null/undefined/NaN', () => {
    expect(MK.formatPrice(null)).toBe('--');
    expect(MK.formatPrice(undefined)).toBe('--');
    expect(MK.formatPrice(NaN)).toBe('--');
  });

  it('formatPrice formats with $ and thousands separators', () => {
    expect(MK.formatPrice(1000)).toBe('$1,000');
    expect(MK.formatPrice(1234567)).toBe('$1,234,567');
  });

  it('formatPrice rounds to whole dollars', () => {
    expect(MK.formatPrice(99.6)).toBe('$100');
  });

  it('formatPct handles null/undefined/NaN', () => {
    expect(MK.formatPct(null)).toBe('--');
    expect(MK.formatPct(undefined)).toBe('--');
    expect(MK.formatPct(NaN)).toBe('--');
  });

  it('formatPct defaults to 1 decimal', () => {
    expect(MK.formatPct(12.345)).toBe('12.3%');
  });

  it('formatPct respects decimals parameter', () => {
    expect(MK.formatPct(12.345, 2)).toBe('12.35%');
    expect(MK.formatPct(12.345, 0)).toBe('12%');
  });
});

describe('inject() / card()', () => {
  it('inject() writes HTML into the target container', () => {
    const el = document.createElement('div');
    el.id = 'target';
    document.body.appendChild(el);
    MK.inject('target', '<span>hi</span>');
    expect(el.innerHTML).toBe('<span>hi</span>');
  });

  it('inject() is a no-op when the container is missing', () => {
    expect(() => MK.inject('nonexistent', '<span></span>')).not.toThrow();
  });

  it('card() wraps content in a card element', () => {
    const html = MK.card('Title', '<p>body</p>');
    expect(html).toContain('card-head');
    expect(html).toContain('Title');
    expect(html).toContain('<p>body</p>');
  });

  it('card() omits card-head when title is empty', () => {
    const html = MK.card('', '<p>body</p>');
    expect(html).not.toContain('card-head');
  });

  it('card() applies opts.class and opts.style', () => {
    const html = MK.card('T', 'B', { class: 'hot', style: 'color:red' });
    expect(html).toContain('class="card hot"');
    expect(html).toContain('style="color:red"');
  });
});

describe('emit() / on()', () => {
  it('dispatches events with the mk: prefix', () => {
    let received = null;
    MK.on('test-event', (e) => { received = e.detail; });
    MK.emit('test-event', { value: 42 });
    expect(received).toEqual({ value: 42 });
  });

  it('on() listens for subsequent emits', () => {
    const events = [];
    MK.on('ping', (e) => events.push(e.detail.n));
    MK.emit('ping', { n: 1 });
    MK.emit('ping', { n: 2 });
    expect(events).toEqual([1, 2]);
  });
});

describe('perfReport() / get()', () => {
  it('get() returns the module or null', () => {
    const mod = { init: () => {} };
    MK.register('x', mod);
    expect(MK.get('x')).toBe(mod);
    expect(MK.get('nope')).toBeNull();
  });

  it('perfReport() returns one row per known module that has perf data', async () => {
    MK.register('ws1-price-intel', { init: () => {} });
    await MK._initOne('ws1-price-intel');
    const rows = MK.perfReport();
    expect(rows.length).toBe(1);
    expect(rows[0].Module).toBe('ws1-price-intel');
    expect(rows[0].Status).toBe('ok');
  });
});
