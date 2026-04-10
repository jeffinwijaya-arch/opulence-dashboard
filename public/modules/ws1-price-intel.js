/**
 * MK Opulence — ws1-price-intel
 * Price Intelligence workstream module.
 *
 * Features:
 *   1. Deal scoring algorithm — 0-100 score (discount 40%, freshness 20%,
 *      seller reliability 20%, condition 20%), badge on each deal card
 *   2. Price confidence indicator on lookups — HIGH/MEDIUM/LOW with color coding
 *   3. Price trend arrows on lookup results — tracks b25 in localStorage, shows
 *      30-day directional change on repeat visits
 */

(function () {
    'use strict';

    const MOD_ID = 'ws1-price-intel';

    // =========================================================
    // SECTION 1 — DEAL SCORING
    // =========================================================

    function buildSellerMap() {
        const sellers = (window.DATA && window.DATA.sellers) || [];
        const map = {};
        sellers.forEach(s => {
            const phone = (s.seller || '').replace(/[^0-9]/g, '');
            if (phone) map[phone] = s;
        });
        return map;
    }

    function extractPhone(str) {
        const m = (str || '').match(/\d{8,}/);
        return m ? m[0] : '';
    }

    function scoreDeal(deal, sellerMap) {
        // 1. Discount vs market B25 (40%) ————————————————————
        const dealPrice = deal.price_usd || deal.price || 0;
        const marketB25 = deal.avg_price || 0;
        let discountScore = 0;
        if (marketB25 > 0 && dealPrice > 0) {
            const discPct = (marketB25 - dealPrice) / marketB25 * 100;
            // 20 %+ below market = 100, scales linearly; negative = 0
            discountScore = Math.min(100, Math.max(0, discPct / 20 * 100));
        } else if (deal.est_margin_pct) {
            discountScore = Math.min(100, Math.max(0, deal.est_margin_pct / 20 * 100));
        }

        // 2. Freshness / days-on-market (20%) —————————————————
        // Fresh listings are more actionable; stale ones may have hidden issues
        let freshnessScore = 50; // neutral when timestamp is unknown
        const tsRaw = deal.ts || deal.created_at || '';
        if (tsRaw) {
            const ts = new Date(tsRaw);
            if (!isNaN(ts.getTime())) {
                const daysOld = (Date.now() - ts.getTime()) / 86400000;
                freshnessScore = daysOld < 2  ? 95
                    : daysOld < 7   ? 80
                    : daysOld < 14  ? 60
                    : daysOld < 30  ? 40
                    : 20;
            }
        }

        // 3. Seller reliability (20%) —————————————————————————
        // More listings history = higher trust; cross-reference global sellers map
        let reliabilityScore = 35;
        const sellerListings = deal.seller_listings || 0;
        if (sellerListings > 0) {
            reliabilityScore = Math.min(100, 20 + Math.log(sellerListings + 1) / Math.log(200) * 80);
        }
        const phone = extractPhone(deal.seller || deal.phone || '');
        if (phone && sellerMap[phone]) {
            const cnt = sellerMap[phone].count || 0;
            if (cnt > sellerListings) {
                reliabilityScore = Math.min(100, 20 + Math.log(cnt + 1) / Math.log(200) * 80);
            }
        }

        // 4. Condition premium (20%) ——————————————————————————
        const cond = deal.condition || deal.condition_bucket || '';
        const condScore = cond === 'BNIB'       ? 100
            : cond === 'Like New'               ? 75
            : cond === 'Pre-owned'              ? 45
            : 50;

        const total = discountScore  * 0.40
                    + freshnessScore * 0.20
                    + reliabilityScore * 0.20
                    + condScore      * 0.20;

        return {
            score: Math.round(total),
            breakdown: {
                discount:    Math.round(discountScore),
                freshness:   Math.round(freshnessScore),
                reliability: Math.round(reliabilityScore),
                condition:   Math.round(condScore)
            }
        };
    }

    function computeAllScores() {
        const deals = (window.DATA && window.DATA.deals) || [];
        if (!deals.length) return;
        const sellerMap = buildSellerMap();
        deals.forEach(d => {
            const r = scoreDeal(d, sellerMap);
            d._ws1Score = r.score;
            d._ws1Breakdown = r.breakdown;
        });
        console.log('[' + MOD_ID + '] scored ' + deals.length + ' deals');
    }

    function scoreColor(score) {
        return score >= 70 ? 'var(--green)'
             : score >= 50 ? 'var(--accent)'
             : 'var(--text-2)';
    }

    function scoreLabel(score) {
        return score >= 75 ? 'PRIME'
             : score >= 60 ? 'GOOD'
             : score >= 45 ? 'FAIR'
             : 'WEAK';
    }

    // Read active region from DOM (avoids depending on private `currentDealsRegion` let)
    function getActiveRegion() {
        const tabs = document.querySelectorAll('#deals-market-section .tabs .tab');
        for (const tab of tabs) {
            if (!tab.classList.contains('active')) continue;
            const t = tab.textContent.trim();
            if (t === 'US')          return 'US';
            if (t.startsWith('HK')) return 'HK';
            return 'all';
        }
        return 'all';
    }

    // Replicate applyDealsFilter's filter logic to get the visible deals in order
    function getVisibleDeals() {
        const q          = (document.getElementById('deals-search')?.value || '').toLowerCase();
        const tierFilter = document.getElementById('deals-tier')?.value || '';
        const region     = getActiveRegion();

        let f = (window.DATA && window.DATA.deals) || [];
        if (region !== 'all') f = f.filter(d => d.region === region);
        if (tierFilter)       f = f.filter(d => d.tier === tierFilter);
        if (q) {
            const terms = typeof window.searchTerms === 'function'
                ? window.searchTerms(q)
                : q.split(/\s+/);
            const match = typeof window.matchesSearch === 'function'
                ? window.matchesSearch.bind(window)
                : (text, ts) => ts.every(t => text.toLowerCase().includes(t));
            f = f.filter(d => match([d.ref, d.model, d.dial, d.seller, d.group].join(' '), terms));
        }
        return f.slice(0, 30);
    }

    function injectScoreBadges() {
        const cards = document.querySelectorAll('#deals-cards .deal-card');
        if (!cards.length) return;

        const visible = getVisibleDeals();
        cards.forEach((card, idx) => {
            if (card.querySelector('.ws1-score-badge')) return; // already there
            const d = visible[idx];
            if (!d || d._ws1Score == null) return;

            const score  = d._ws1Score;
            const bd     = d._ws1Breakdown || {};
            const color  = scoreColor(score);
            const label  = scoreLabel(score);

            const badge = document.createElement('span');
            badge.className = 'ws1-score-badge';
            badge.title = [
                'Deal Score: ' + score + '/100',
                'Discount:    ' + bd.discount    + '/100 (40%)',
                'Freshness:   ' + bd.freshness   + '/100 (20%)',
                'Seller:      ' + bd.reliability + '/100 (20%)',
                'Condition:   ' + bd.condition   + '/100 (20%)'
            ].join('\n');
            badge.style.cssText =
                'display:inline-flex;align-items:center;gap:3px;' +
                'border:1px solid ' + color + ';border-radius:3px;' +
                'padding:1px 5px;font-family:var(--mono);font-size:0.63rem;' +
                'color:' + color + ';cursor:default;white-space:nowrap;' +
                'margin-left:6px;vertical-align:middle;flex-shrink:0;';
            badge.innerHTML =
                '<b>' + score + '</b>' +
                '<span style="opacity:0.7;font-size:0.58rem;">' + label + '</span>';

            // Inject into the ref+model div (left side of the first flex row)
            const headerRow = card.querySelector('div[style*="justify-content:space-between"]');
            if (headerRow && headerRow.firstElementChild) {
                headerRow.firstElementChild.appendChild(badge);
            }
        });
    }

    // =========================================================
    // SECTION 2 — PRICE CONFIDENCE INDICATOR
    // =========================================================

    function injectConfidenceIndicator() {
        const result = document.getElementById('lookup-result');
        if (!result || result.querySelector('.ws1-confidence')) return;

        const summaryP = result.querySelector('p');
        if (!summaryP) return;

        // Find the span containing the listing count (e.g. "148 listings | 2 dials")
        const countSpan = Array.from(summaryP.querySelectorAll('span'))
            .find(s => /\d+\s+listings?/.test(s.textContent));
        if (!countSpan) return;

        const countMatch = countSpan.textContent.match(/(\d+)\s+listings?/);
        if (!countMatch) return;
        const count = parseInt(countMatch[1], 10);

        let level, color, dots, hint;
        if (count > 20) {
            level = 'HIGH';   color = 'var(--green)';  dots = '●●●';
            hint  = count + ' comparables — reliable pricing data';
        } else if (count >= 5) {
            level = 'MEDIUM'; color = 'var(--accent)'; dots = '●●○';
            hint  = count + ' comparables — moderate confidence';
        } else {
            level = 'LOW';    color = 'var(--red)';    dots = '●○○';
            hint  = count + ' comparable' + (count !== 1 ? 's' : '') + ' — limited data, use caution';
        }

        const el = document.createElement('div');
        el.className = 'ws1-confidence';
        el.style.cssText =
            'display:flex;align-items:center;gap:6px;' +
            'margin-top:4px;margin-bottom:2px;';
        el.innerHTML =
            '<span style="font-family:var(--mono);font-size:0.6rem;letter-spacing:2px;color:' + color + ';">' + dots + '</span>' +
            '<span style="font-size:0.65rem;font-weight:700;color:' + color + ';font-family:var(--mono);">' + level + ' CONFIDENCE</span>' +
            '<span style="font-size:0.63rem;color:var(--text-2);">' + hint + '</span>';

        // Insert between the condition tags paragraph and the condition bar
        summaryP.insertAdjacentElement('afterend', el);
    }

    // =========================================================
    // SECTION 3 — PRICE TREND ARROWS (localStorage persistence)
    // =========================================================

    const HISTORY_KEY = 'mk_ws1_price_history';

    function loadHistory() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch (e) { return {}; }
    }

    function saveHistory(hist) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch (e) {}
    }

    // Call once on init to snapshot current b25 values per ref
    function snapshotRefPrices() {
        const refs = (window.DATA && window.DATA.refs) || {};
        const keys = Object.keys(refs);
        if (!keys.length) return;

        const hist   = loadHistory();
        const now    = Date.now();
        const cutoff = now - 35 * 86400000; // keep 35 days max

        keys.forEach(ref => {
            const b25 = refs[ref].b25 || 0;
            if (!b25) return;
            if (!hist[ref]) hist[ref] = [];
            hist[ref] = hist[ref].filter(e => e.ts > cutoff);
            const last = hist[ref][hist[ref].length - 1];
            // Don't duplicate within 12 h
            if (!last || now - last.ts > 12 * 3600000) {
                hist[ref].push({ ts: now, b25 });
            }
        });
        saveHistory(hist);
    }

    function calcTrend(ref) {
        const hist    = loadHistory();
        const entries = hist[ref];
        if (!entries || entries.length < 2) return null;

        const sorted  = [...entries].sort((a, b) => a.ts - b.ts);
        const latest  = sorted[sorted.length - 1];
        const now     = Date.now();
        // Baseline: oldest entry within 30-day window, or the oldest available
        const baseline = sorted.find(e => e.ts <= now - 30 * 86400000) || sorted[0];
        if (baseline === latest || !baseline.b25) return null;

        const changePct = (latest.b25 - baseline.b25) / baseline.b25 * 100;
        return Math.abs(changePct) >= 0.5 ? changePct : null; // ignore noise
    }

    function injectTrendArrow() {
        const result = document.getElementById('lookup-result');
        if (!result) return;

        // Remove any stale arrow from a previous lookup
        result.querySelectorAll('.ws1-trend').forEach(el => el.remove());

        const h2 = result.querySelector('h2');
        if (!h2) return;

        // First child text node holds the ref code
        const refText = (h2.childNodes[0]?.textContent || '').trim().split(/\s/)[0];
        if (!refText) return;

        const trend = calcTrend(refText);
        if (trend === null) return;

        const up    = trend > 0;
        const color = up ? 'var(--green)' : 'var(--red)';
        const arrow = up ? '▲' : '▼';

        // Compute window length in days for tooltip
        const hist    = loadHistory();
        const entries = (hist[refText] || []).sort((a, b) => a.ts - b.ts);
        const days    = entries.length >= 2
            ? Math.round((entries[entries.length - 1].ts - entries[0].ts) / 86400000)
            : 30;

        const span = document.createElement('span');
        span.className = 'ws1-trend';
        span.title = 'Price trend (' + days + 'd): ' + (up ? '+' : '') + trend.toFixed(1) + '%';
        span.style.cssText =
            'margin-left:10px;font-size:0.78rem;font-weight:600;' +
            'font-family:var(--mono);color:' + color + ';';
        span.textContent = arrow + ' ' + Math.abs(trend).toFixed(1) + '%';

        h2.appendChild(span);
    }

    // =========================================================
    // MODULE LIFECYCLE
    // =========================================================

    function init() {
        console.log('[' + MOD_ID + '] init');

        computeAllScores();
        snapshotRefPrices();

        // Wrap applyDealsFilter to inject score badges after each render
        if (typeof window.applyDealsFilter === 'function') {
            const _origFilter = window.applyDealsFilter;
            window.applyDealsFilter = function () {
                _origFilter.apply(this, arguments);
                injectScoreBadges();
            };
        }

        // Wrap doLookup to inject confidence indicator + trend arrow after each search
        if (typeof window.doLookup === 'function') {
            const _origLookup = window.doLookup;
            window.doLookup = async function () {
                await _origLookup.apply(this, arguments);
                try { injectConfidenceIndicator(); } catch (e) {}
                try { injectTrendArrow(); }          catch (e) {}
            };
        }
    }

    function render() {
        computeAllScores();
        if (document.querySelector('#deals-cards .deal-card')) {
            injectScoreBadges();
        }
    }

    function cleanup() {}

    window.MKModules.register(MOD_ID, { init, render, cleanup });
})();
