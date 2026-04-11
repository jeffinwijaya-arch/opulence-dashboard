/**
 * Tests for src/worker.js — the Cloudflare Pages function that routes
 * /api/* requests to KV or static JSON.
 *
 * These are pure function tests: we import the default export and call
 * its `fetch` with a Request + a mock `env` that stubs MARKET_DATA and
 * ASSETS. This catches routing regressions without needing wrangler
 * running.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
        return new Response('{"from":"static"}');
      },
    });
    const req = new Request('https://example.test/api/deals');
    const res = await worker.fetch(req, env);
    expect(capturedUrl).toBe('/data/deals.json');
    expect(await res.text()).toBe('{"from":"static"}');
  });

  it('falls through when MARKET_DATA binding is absent entirely', async () => {
    let capturedUrl = null;
    const env = {
      // No MARKET_DATA at all
      ASSETS: {
        fetch: async (req) => {
          capturedUrl = new URL(req.url).pathname;
          return new Response('ok');
        },
      },
    };
    const req = new Request('https://example.test/api/arbitrage');
    await worker.fetch(req, env);
    expect(capturedUrl).toBe('/data/arbitrage.json');
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
});
