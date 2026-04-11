#!/usr/bin/env node
/**
 * Claude Code synthetic monitor
 * ─────────────────────────────
 * Hits the full round-trip the dashboard uses:
 *
 *   1. GET  /api/mission-control/claude-sessions
 *   2. GET  /api/mission-control/claude-sessions/:id           (resume)
 *   3. POST /api/mission-control/claude-code/send { ping }
 *   4. GET  /api/mission-control/claude-code/poll/:task_id     (until done)
 *
 * and reports PASS/FAIL + latency per step. Exit code is 0 on success,
 * 1 on any failure — so it drops straight into cron, GitHub Actions,
 * a Cloudflare Worker, or whatever else you want polling it.
 *
 * Usage:
 *   node scripts/claude-code-monitor.js --base https://your-dashboard.example.com
 *   node scripts/claude-code-monitor.js --base http://localhost:5000 --timeout 60
 *   BASE_URL=https://... node scripts/claude-code-monitor.js
 *
 * Flags:
 *   --base <url>       Base URL (no trailing slash). Defaults to $BASE_URL.
 *   --session <id>     Use a specific session instead of picking the first.
 *   --timeout <sec>    Per-poll budget (default 60s).
 *   --cookie <header>  Optional Cookie header for auth'd endpoints.
 *   --json             Machine-readable output (one JSON object).
 *   --quiet            Only print on failure.
 *
 * No dependencies — pure Node 18+ (uses the built-in fetch).
 */

'use strict';

const args = process.argv.slice(2);
function flag(name, def) {
    const i = args.indexOf('--' + name);
    if (i === -1) return def;
    const v = args[i + 1];
    if (v == null || v.startsWith('--')) return true;
    return v;
}

const BASE    = flag('base', process.env.BASE_URL || '').replace(/\/$/, '');
const SESSION = flag('session', process.env.CC_SESSION || null);
const TIMEOUT = parseInt(flag('timeout', '120'), 10) * 1000;
const COOKIE  = flag('cookie', process.env.CC_COOKIE || null);
const JSON_OUT = flag('json', false);
const QUIET    = flag('quiet', false);

if (!BASE) {
    console.error('error: --base <url> (or $BASE_URL) is required');
    process.exit(2);
}

const headers = { 'Content-Type': 'application/json', 'X-Monitor': 'claude-code-synthetic/1' };
if (COOKIE) headers['Cookie'] = COOKIE;

const results = [];
function record(step, ok, ms, err, extra) {
    const row = { step, ok, ms, err: err || null };
    if (extra) Object.assign(row, extra);
    results.push(row);
}

function summarize() {
    const pass = results.every(r => r.ok);
    const totalMs = results.reduce((s, r) => s + (r.ms || 0), 0);
    return { pass, total_ms: totalMs, base: BASE, ts: new Date().toISOString(), results };
}

function log(...a) { if (!QUIET) console.log(...a); }
function report() {
    const s = summarize();
    if (JSON_OUT) {
        console.log(JSON.stringify(s, null, 2));
    } else if (!QUIET || !s.pass) {
        const badge = s.pass ? 'PASS' : 'FAIL';
        console.log(`\n[${badge}] claude-code monitor — total ${s.total_ms}ms`);
        for (const r of s.results) {
            const mark = r.ok ? '  ok' : 'FAIL';
            console.log(`  ${mark}  ${r.step.padEnd(22)} ${String(r.ms).padStart(6)}ms${r.err ? '  — ' + r.err : ''}`);
        }
        console.log('');
    }
    return s.pass;
}

async function timed(step, fn) {
    const t0 = Date.now();
    try {
        const out = await fn();
        record(step, true, Date.now() - t0, null, out && out._extra);
        return out && out.value !== undefined ? out.value : out;
    } catch (e) {
        record(step, false, Date.now() - t0, (e && e.message) || String(e));
        throw e;
    }
}

async function fetchJson(method, path, body) {
    const url = BASE + path;
    const ctrl = new AbortController();
    // The /send endpoint is synchronous and can take 30-60s for a real
    // Claude turn with tool use, so give every monitor fetch the full
    // TIMEOUT budget (default 60s, configurable via --timeout).
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
        const r = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal
        });
        clearTimeout(timer);
        const text = await r.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* non-json */ }
        if (!r.ok) {
            const err = new Error(`HTTP ${r.status} ${r.statusText}`);
            err.status = r.status;
            err.body = text.slice(0, 200);
            throw err;
        }
        return data;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

async function run() {
    // 1. List sessions
    let sessions;
    try {
        const d = await timed('list sessions', async () => ({
            value: await fetchJson('GET', '/api/mission-control/claude-sessions')
        }));
        sessions = (d && d.sessions) || [];
        if (!sessions.length) {
            record('pick session', false, 0, 'no sessions available');
            return report();
        }
    } catch (e) {
        return report();
    }

    // 2. Pick target + resume
    const target = SESSION
        ? sessions.find(s => s.session_id === SESSION)
        : sessions[0];
    if (!target) {
        record('pick session', false, 0, SESSION ? `session ${SESSION} not found` : 'no sessions');
        return report();
    }
    log(`  using session ${target.session_id} (${target.project_name || ''})`);

    try {
        await timed('resume / load msgs', async () => ({
            value: await fetchJson('GET', '/api/mission-control/claude-sessions/' + target.session_id)
        }));
    } catch (e) { return report(); }

    // 3. Send ping — the backend's /send is a synchronous endpoint
    //    so we get the response back in the same round-trip. No
    //    task_id, no polling. The TIMEOUT flag controls the fetch's
    //    own AbortController inside fetchJson().
    try {
        const d = await timed('send + response', async () => ({
            value: await fetchJson('POST', '/api/mission-control/claude-code/send', {
                session_id: target.session_id,
                message: 'ping (synthetic monitor — reply with "pong")',
                project_path: target.project_path || ''
            })
        }));
        if (!d || typeof d.response !== 'string' || d.response.length === 0) {
            record('validate response', false, 0, 'empty or missing response field');
            return report();
        }
        record('validate response', true, 0);
    } catch (_) { return report(); }

    return report();
}

run().then(pass => {
    process.exit(pass ? 0 : 1);
}).catch(e => {
    console.error('monitor crashed:', e && e.stack || e);
    process.exit(2);
});
