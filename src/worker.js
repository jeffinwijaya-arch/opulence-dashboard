/**
 * Opulence Dashboard — Cloudflare Worker
 * Serves static files from /public and API from KV or static JSON.
 *
 * Route contract for /api/{key}:
 *   1. If env.MARKET_DATA (KV) has `data:{key}`, serve it as JSON.
 *   2. Else, try `/data/{key}.json` via env.ASSETS. If 200, re-wrap
 *      with CORS + cache headers and serve.
 *   3. Else, return a clean JSON 404 of the form
 *        { "ok": false, "error": "endpoint_not_available", "key": "..." }
 *      with CORS headers set.
 *
 *      This step is important: without it, missing endpoints fall
 *      through to the Pages default HTML 404 page, and any frontend
 *      code that does `await fetch(...).then(r => r.json())` crashes
 *      with a SyntaxError on the first `<` of the HTML document. That
 *      crash is how the Price Intelligence page ends up showing a
 *      cryptic "Failed to load" state — the real problem is one layer
 *      up, in the endpoint that returned HTML where JSON was expected.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers — applied to every response we generate below.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API routes — serve from KV or fall through to static JSON,
    // and fall through cleanly to a JSON 404 if neither is present.
    if (path.startsWith("/api/")) {
      const key = path.replace("/api/", "").replace(/\/$/, "");

      // 1) Try KV first.
      if (env.MARKET_DATA) {
        const value = await env.MARKET_DATA.get(`data:${key}`);
        if (value) {
          return new Response(value, {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
              "Cache-Control": "public, max-age=300",
            },
          });
        }
      }

      // 2) Fall through to static /data/{key}.json.
      const assetRes = await env.ASSETS.fetch(
        new Request(`${url.origin}/data/${key}.json`, request)
      );
      if (assetRes.status === 200) {
        // Re-wrap the body so CORS + cache headers are consistent
        // regardless of what the static asset handler set. This also
        // normalizes the Content-Type so Safari's strict MIME sniffer
        // doesn't treat a .json that was served with text/plain as
        // something else.
        const body = await assetRes.text();
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
            "Cache-Control": "public, max-age=300",
          },
        });
      }

      // 3) Endpoint has no KV entry and no static fallback. Return
      // a clean JSON 404 so callers can inspect .ok / .json() without
      // crashing on HTML.
      return new Response(
        JSON.stringify({ ok: false, error: "endpoint_not_available", key }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Non-API paths: pass through to static assets unchanged.
    return env.ASSETS.fetch(request);
  },
};
