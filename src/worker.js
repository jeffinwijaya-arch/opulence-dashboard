/**
 * Opulence Dashboard — Cloudflare Worker
 * Serves static files from /public and API from KV or static JSON
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API routes — serve from KV or fall through to static
    if (path.startsWith("/api/")) {
      const key = path.replace("/api/", "").replace(/\/$/, "");
      
      // Try KV first
      if (env.MARKET_DATA) {
        const value = await env.MARKET_DATA.get(`data:${key}`);
        if (value) {
          return new Response(value, {
            headers: { "Content-Type": "application/json", ...corsHeaders, "Cache-Control": "public, max-age=300" },
          });
        }
      }

      // Fallback: try static /data/{key}.json
      return env.ASSETS.fetch(new Request(`${url.origin}/data/${key}.json`, request));
    }

    // Static files
    return env.ASSETS.fetch(request);
  },
};
