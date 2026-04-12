/**
 * Opulence Dashboard — Cloudflare Worker (Advanced Mode)
 *
 * Serves static files, JSON API from KV/static, and watch vision
 * recognition via the Anthropic API. Everything in one deploy.
 *
 * Routes:
 *   GET  /api/{key}                → KV → static /data/{key}.json → JSON 404
 *   POST /api/vision/identify      → Claude Vision watch identification
 *   POST /api/vision/warranty-card → Claude Vision warranty card reading
 *   GET  /api/vision/health        → healthcheck
 *   GET  /*                        → static assets from /public
 *
 * Environment bindings (set in Cloudflare Pages dashboard):
 *   MARKET_DATA     — KV namespace (optional, for live data)
 *   ANTHROPIC_API_KEY — secret for Claude Vision API
 */

// ─────────────────────────────────────────────────────────────
// Vision prompts
// ─────────────────────────────────────────────────────────────

const IDENTIFY_PROMPT = `You are an expert luxury watch appraiser. Analyze this watch photo and identify the exact model.

Return ONLY a JSON object:
{
  "reference": "exact reference number (e.g. 126610LN, 5711/1A-010)",
  "brand": "Rolex | Patek Philippe | Audemars Piguet | Tudor | etc.",
  "model": "model name (e.g. Submariner Date, Nautilus, Royal Oak)",
  "dial": "dial color/description (e.g. Black, Blue Sunburst, Wimbledon)",
  "bracelet": "bracelet type (e.g. Oyster, Jubilee, President, Rubber)",
  "bezel": "bezel description (e.g. Black Ceramic, Pepsi, Fluted)",
  "condition": "BNIB | Like New | Pre-owned | Unknown",
  "confidence": 0.0 to 1.0,
  "reasoning": "key identifying features used"
}

Be precise with reference suffixes (LN, LV, BLNR, BLRO for Rolex; full material code for AP). If uncertain, give best guess with lower confidence.`;

const WARRANTY_CARD_PROMPT = `You are an expert at reading luxury watch warranty cards. Extract all information.

Return ONLY a JSON object:
{
  "reference": "reference number exactly as printed",
  "serial_number": "serial number exactly as printed",
  "purchase_date": "date as MM/YYYY or DD/MM/YYYY",
  "dealer": "dealer name as printed",
  "brand": "watch brand",
  "model": "model name if visible",
  "confidence": 0.0 to 1.0,
  "raw_text": "all readable text, line by line",
  "reasoning": "what you can/cannot read clearly"
}

Read EVERY character carefully. A single wrong digit in a serial number makes it useless.`;


// ─────────────────────────────────────────────────────────────
// Vision handler
// ─────────────────────────────────────────────────────────────

async function callClaudeVision(apiKey, imageBytes, mediaType, prompt) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(imageBytes)));

  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: b64 },
        },
        { type: "text", text: prompt },
      ],
    }],
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  let text = data.content?.[0]?.text || "";

  // Strip markdown fences
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(text);
}


function guessMediaType(contentType, fileName) {
  if (contentType && contentType.includes("png")) return "image/png";
  if (contentType && contentType.includes("webp")) return "image/webp";
  if (fileName) {
    const ext = fileName.split(".").pop().toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "heic") return "image/heic";
  }
  return "image/jpeg";
}


async function loadRefsData(env, url) {
  // Load refs.json for cross-referencing
  try {
    const res = await env.ASSETS.fetch(new Request(`${url.origin}/data/refs.json`));
    if (res.ok) return await res.json();
  } catch (_) {}
  return {};
}


function enrichResult(result, refs) {
  const ref = result.reference || "";
  const info = refs[ref] || refs[ref.toUpperCase()] || null;
  if (info) {
    result.market_price_b25 = info.b25 || null;
    result.market_price_low = info.low || null;
    result.market_price_high = info.high || null;
    result.market_listings = info.count || 0;
    if (!result.brand) result.brand = info.brand || "";
    if (!result.model) result.model = info.model || "";
    // Dial premium
    if (result.dial && info.dials) {
      const dialLower = result.dial.toLowerCase();
      const overall = info.b25 || 0;
      for (const [name, dInfo] of Object.entries(info.dials)) {
        if (dialLower.includes(name.toLowerCase()) || name.toLowerCase().includes(dialLower)) {
          const db25 = dInfo.b25 || dInfo.median || 0;
          if (db25 && overall) {
            const pct = ((db25 - overall) / overall) * 100;
            result.dial_premium = Math.abs(pct) < 2 ? "baseline" : (pct >= 0 ? "+" : "") + pct.toFixed(0) + "%";
          }
          break;
        }
      }
    }
  } else {
    // Fuzzy: find refs starting with same prefix
    const prefix = ref.replace(/[A-Z]+$/, "");
    const alts = [];
    for (const [r, rInfo] of Object.entries(refs)) {
      if (r.startsWith(prefix) && r !== ref) {
        alts.push({ ref: r, model: rInfo.model || "", b25: rInfo.b25 || null });
      }
    }
    alts.sort((a, b) => (b.b25 || 0) - (a.b25 || 0));
    if (alts.length > 0) {
      result.alternates = alts.slice(0, 3);
      // Use first alt for pricing if high confidence match
      if (alts[0].b25) {
        result.market_price_b25 = alts[0].b25;
      }
    }
  }
  return result;
}


function enrichCard(card, refs) {
  const ref = card.reference || "";
  const info = refs[ref] || refs[ref.toUpperCase()] || null;
  if (info) {
    card.reference_valid = true;
    card.market_price_b25 = info.b25 || null;
    if (!card.brand) card.brand = info.brand || "";
    if (!card.model) card.model = info.model || "";
  } else {
    card.reference_valid = false;
  }
  // Validate serial format
  const serial = (card.serial_number || "").replace(/\s/g, "");
  card.serial_format_valid = /^[A-Z0-9]{6,10}$/i.test(serial);
  return card;
}


async function extractImageFromRequest(request) {
  const ct = request.headers.get("Content-Type") || "";

  if (ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    const file = fd.get("photo") || fd.get("image");
    if (!file) throw new Error("No 'photo' or 'image' field in form data");
    const bytes = await file.arrayBuffer();
    const mediaType = guessMediaType(file.type, file.name);
    return { bytes, mediaType };
  }

  if (ct.includes("application/json")) {
    const data = await request.json();
    const b64 = data.image_base64 || data.photo_base64 || data.base64;
    if (!b64) throw new Error("No image_base64 field in JSON body");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes: bytes.buffer, mediaType: "image/jpeg" };
  }

  throw new Error("Send as multipart form (field: photo) or JSON (field: image_base64)");
}


async function handleVision(request, env, path, corsHeaders) {
  const url = new URL(request.url);

  // Health check
  if (path === "/api/vision/health") {
    const hasKey = !!(env.ANTHROPIC_API_KEY);
    let refCount = 0;
    try { refCount = Object.keys(await loadRefsData(env, url)).length; } catch (_) {}
    return new Response(JSON.stringify({
      status: hasKey ? "ok" : "no_api_key",
      api_key_set: hasKey,
      reference_count: refCount,
    }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  }

  // Require POST for identify and warranty-card
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "POST required" }), {
      status: 405, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      success: false,
      error: "ANTHROPIC_API_KEY not configured. Set it in Cloudflare Pages → Settings → Environment Variables.",
    }), { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }

  const t0 = Date.now();

  try {
    const { bytes, mediaType } = await extractImageFromRequest(request);
    const refs = await loadRefsData(env, url);

    if (path === "/api/vision/identify") {
      let result = await callClaudeVision(apiKey, bytes, mediaType, IDENTIFY_PROMPT);
      result = enrichResult(result, refs);
      return new Response(JSON.stringify({
        success: true, result, elapsed_ms: Date.now() - t0,
      }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (path === "/api/vision/warranty-card") {
      let card = await callClaudeVision(apiKey, bytes, mediaType, WARRANTY_CARD_PROMPT);
      card = enrichCard(card, refs);
      return new Response(JSON.stringify({
        success: true, result: card, elapsed_ms: Date.now() - t0,
      }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
  } catch (e) {
    return new Response(JSON.stringify({
      success: false, error: e.message, elapsed_ms: Date.now() - t0,
    }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }

  return null; // not a vision route
}


// ─────────────────────────────────────────────────────────────
// Main worker
// ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── Vision routes (handled first — before the static fallback) ──
    if (path.startsWith("/api/vision/")) {
      const visionResp = await handleVision(request, env, path, corsHeaders);
      if (visionResp) return visionResp;
    }

    // ── Standard API routes: KV → static JSON → JSON 404 ──
    if (path.startsWith("/api/")) {
      const key = path.replace("/api/", "").replace(/\/$/, "");

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

      const assetRes = await env.ASSETS.fetch(
        new Request(`${url.origin}/data/${key}.json`, request)
      );
      if (assetRes.status === 200) {
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

      return new Response(
        JSON.stringify({ ok: false, error: "endpoint_not_available", key }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ── Static assets ──
    return env.ASSETS.fetch(request);
  },
};
