/**
 * Tests for src/worker.js — the Cloudflare Pages function that routes
 * /api/* requests to KV or static JSON.
 *
 * These are pure function tests: we import the default export and call
 * its `fetch` with a Request + a mock `env` that stubs MARKET_DATA and
 * ASSETS. This catches routing regressions without needing wrangler
 * running.
 */

import { describe, it, expect } from 'vitest';
import worker from '../../src/worker.js';

function makeEnv({ kv = {}, assetHandler = null } = {}) {
  return {
    MARKET_DATA: {
      async get(key) {
        return Object.prototype.hasOwnProperty.call(kv, key) ? kv[key] : null;
      },
    },
    ASSETS: {
      fetch: assetHandler || (async (req) => {
        return new Response('STATIC:' + new URL(req.url).pathname, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    },
  };
}

describe('CORS preflight', () => {
  it('returns empty body with CORS headers on OPTIONS', async () => {
    const req = new Request('https://example.test/api/deals', { method: 'OPTIONS' });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(await res.text()).toBe('');
  });
});

describe('KV hit', () => {
  it('serves /api/deals from MARKET_DATA when present', async () => {
    const kv = { 'data:deals': '[{"ref":"A","price":100}]' };
    const env = makeEnv({ kv });
    const req = new Request('https://example.test/api/deals');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    const body = await res.text();
    expect(body).toBe('[{"ref":"A","price":100}]');
  });

  it('strips trailing slash when building KV key', async () => {
    const kv = { 'data:deals': '"from-kv"' };
    const env = makeEnv({ kv });
    const req = new Request('https://example.test/api/deals/');
    const res = await worker.fetch(req, env);
    expect(await res.text()).toBe('"from-kv"');
  });
});

describe('KV miss falls through to static', () => {
  it('delegates to env.ASSETS when KV returns null', async () => {
    let capturedUrl = null;
    const env = makeEnv({
      kv: {},
      assetHandler: async (req) => {
        capturedUrl = new URL(req.url).pathname;
        return new Response('{"from":"static"}', { status: 200 });
      },
    });
    const req = new Request('https://example.test/api/deals');
    const res = await worker.fetch(req, env);
    expect(capturedUrl).toBe('/data/deals.json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"from":"static"}');
  });

  it('re-wraps static 200 response with CORS + cache headers', async () => {
    // Pre-fix, the raw static response was returned as-is — with
    // whatever Content-Type the static handler set and no CORS. This
    // test locks in the normalization.
    const env = makeEnv({
      kv: {},
      assetHandler: async () => new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    });
    const res = await worker.fetch(new Request('https://example.test/api/deals'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    expect(await res.text()).toBe('{"ok":true}');
  });

  it('falls through when MARKET_DATA binding is absent entirely', async () => {
    let capturedUrl = null;
    const env = {
      // No MARKET_DATA at all
      ASSETS: {
        fetch: async (req) => {
          capturedUrl = new URL(req.url).pathname;
          return new Response('{"ok":true}', { status: 200 });
        },
      },
    };
    const req = new Request('https://example.test/api/arbitrage');
    const res = await worker.fetch(req, env);
    expect(capturedUrl).toBe('/data/arbitrage.json');
    expect(res.status).toBe(200);
  });
});

describe('endpoint_not_available fallback (JSON 404)', () => {
  // This is the main user-visible bugfix: before, a missing /api/*
  // endpoint fell through to the Cloudflare Pages HTML 404 page.
  // Frontend code that did fetch(...).then(r=>r.json()) crashed on
  // the first `<` of the HTML document, bubbling up as an opaque
  // "Failed to load" on the Price Intelligence page. Now it gets
  // a clean JSON 404 the caller can branch on.

  it('returns JSON 404 when neither KV nor static has the endpoint', async () => {
    const env = makeEnv({
      kv: {},
      assetHandler: async (req) => {
        // Simulate Pages default 404 response for an unknown file
        return new Response('<html><body>Not Found</body></html>', {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        });
      },
    });
    const res = await worker.fetch(
      new Request('https://example.test/api/smart_search?q=126610LN'),
      env
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: 'endpoint_not_available',
      key: 'smart_search',
    });
  });

  it('returns JSON 404 for arbitrarily nested missing endpoints', async () => {
    const env = makeEnv({
      kv: {},
      assetHandler: async () => new Response('nope', { status: 404 }),
    });
    const res = await worker.fetch(
      new Request('https://example.test/api/inventory/all'),
      env
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('endpoint_not_available');
    expect(body.key).toBe('inventory/all');
  });

  it('does NOT return HTML for missing endpoints', async () => {
    // Regression: pre-fix the worker returned whatever env.ASSETS
    // returned, which on a missing static asset is an HTML error
    // page. This is the exact path that caused fetch(...).json() on
    // the frontend to throw SyntaxError.
    const env = makeEnv({
      kv: {},
      assetHandler: async () => new Response('<!doctype html><h1>404</h1>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      }),
    });
    const res = await worker.fetch(
      new Request('https://example.test/api/does_not_exist'),
      env
    );
    expect(res.headers.get('Content-Type')).not.toMatch(/html/i);
    // The body must be parseable as JSON — i.e. frontend callers
    // won't crash inside r.json().
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('KV hit still wins over missing static', async () => {
    // Sanity check: the 404 fallback only fires when BOTH KV and
    // static miss. A KV hit for an unknown static key should still
    // serve the KV value.
    const env = makeEnv({
      kv: { 'data:custom': '{"from":"kv"}' },
      assetHandler: async () => new Response('nope', { status: 404 }),
    });
    const res = await worker.fetch(
      new Request('https://example.test/api/custom'),
      env
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"from":"kv"}');
  });
});

describe('non-API routes', () => {
  it('passes through to ASSETS untouched', async () => {
    let captured = null;
    const env = makeEnv({
      assetHandler: async (req) => {
        captured = req.url;
        return new Response('html');
      },
    });
    const req = new Request('https://example.test/index.html');
    await worker.fetch(req, env);
    expect(captured).toBe('https://example.test/index.html');
  });

  it('passes through /modules/ws1-price-intel.js', async () => {
    let captured = null;
    const env = makeEnv({
      assetHandler: async (req) => {
        captured = new URL(req.url).pathname;
        return new Response('');
      },
    });
    await worker.fetch(new Request('https://example.test/modules/ws1-price-intel.js'), env);
    expect(captured).toBe('/modules/ws1-price-intel.js');
  });

  it('does NOT add CORS headers to non-API routes', async () => {
    // CORS should only apply to /api/*. Static HTML/JS served from
    // the same origin as the page doesn't need it and adding it
    // would confuse the CSP audit story.
    const env = makeEnv({
      assetHandler: async () => new Response('<!doctype html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    });
    const res = await worker.fetch(new Request('https://example.test/'), env);
    // The worker doesn't touch the response, so CORS header is
    // whatever the asset handler set (i.e. nothing).
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
