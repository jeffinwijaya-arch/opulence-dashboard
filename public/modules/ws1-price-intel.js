/**
 * MK Opulence — ws1-price-intel
 * Price Intelligence module: deal scoring, price confidence, trend arrows.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws1-price-intel', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws1-price-intel';
    const MK = window.MKModules;

    // ─── Styles ───────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ws1-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws1-styles';
        style.textContent = `
            .ws1-score-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 32px;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.68rem;
                font-weight: 700;
                font-family: var(--mono);
                letter-spacing: 0.3px;
            }
            .ws1-score-green {
                background: rgba(0,230,118,0.12);
                color: var(--green);
                border: 1px solid rgba(0,230,118,0.25);
            }
            .ws1-score-yellow {
                background: rgba(255,193,7,0.12);
                color: var(--orange);
                border: 1px solid rgba(255,193,7,0.25);
            }
            .ws1-score-red {
                background: rgba(255,23,68,0.10);
                color: var(--red);
                border: 1px solid rgba(255,23,68,0.2);
            }
            .ws1-confidence-badge {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.65rem;
                font-weight: 700;
                font-family: var(--mono);
                letter-spacing: 0.5px;
                margin-left: 6px;
                vertical-align: middle;
            }
            .ws1-conf-high {
                background: rgba(0,230,118,0.12);
                color: var(--green);
                border: 1px solid rgba(0,230,118,0.25);
            }
            .ws1-conf-medium {
                background: rgba(255,193,7,0.12);
                color: var(--orange);
                border: 1px solid rgba(255,193,7,0.25);
            }
            .ws1-conf-low {
                background: rgba(255,23,68,0.10);
                color: var(--red);
                border: 1px solid rgba(255,23,68,0.2);
            }
            .ws1-trend {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                font-size: 0.68rem;
                font-weight: 700;
                font-family: var(--mono);
                vertical-align: middle;
                margin-left: 4px;
            }
            .ws1-trend-up { color: var(--green); }
            .ws1-trend-down { color: var(--red); }
            .ws1-trend-flat { color: var(--text-2); }
        `;
        document.head.appendChild(style);
    }

    // ─── 1. Deal Scoring ──────────────────────────────────────────────

    /**
     * Compute a 0-100 deal score:
     *   discount_pct * 0.4 + days_freshness * 0.2 + seller_reliability * 0.2 + condition_premium * 0.2
     */
    function computeDealScore(deal) {
        // Discount component (0-100): higher discount = better score
        // Cap discount at 25% for normalization
        const disc = Math.abs(deal.discount_pct || deal.gap_pct || 0);
        const discountScore = Math.min(disc / 25 * 100, 100);

        // Freshness component (0-100): newer = better
        // Use timestamp if available, otherwise default to moderate freshness
        let freshnessScore = 50;
        if (deal.ts) {
            const dealDate = new Date(deal.ts);
            const now = new Date();
            const daysDiff = (now - dealDate) / (1000 * 60 * 60 * 24);
            // Fresh = 0 days -> 100, stale = 7+ days -> 0
            freshnessScore = Math.max(0, Math.min(100, (1 - daysDiff / 7) * 100));
        }

        // Seller reliability (0-100): more listings from seller = more reliable
        const sellerListings = deal.seller_listings || 0;
        const sellerScore = Math.min(sellerListings / 20 * 100, 100);

        // Condition premium (0-100): BNIB > Like New > Pre-owned
        const cond = (deal.condition || deal.condition_bucket || '').toLowerCase();
        let condScore = 30;
        if (cond.includes('bnib') || cond.includes('new') || cond.includes('unworn')) condScore = 100;
        else if (cond.includes('like new') || cond.includes('mint') || cond.includes('excellent')) condScore = 70;
        else if (cond.includes('pre-owned') || cond.includes('used') || cond.includes('good')) condScore = 40;

        const score = Math.round(
            discountScore * 0.4 +
            freshnessScore * 0.2 +
            sellerScore * 0.2 +
            condScore * 0.2
        );
        return Math.max(0, Math.min(100, score));
    }

    function scoreClass(score) {
        if (score >= 70) return 'ws1-score-green';
        if (score >= 40) return 'ws1-score-yellow';
        return 'ws1-score-red';
    }

    function scoreBadgeHtml(score) {
        return '<span class="ws1-score-badge ' + scoreClass(score) + '">' + score + '</span>';
    }

    /**
     * Inject deal scores into #deals-cards after they render.
     */
    function injectDealScores() {
        const container = document.getElementById('deals-cards');
        if (!container) return;
        const deals = window.DATA?.deals;
        if (!deals || !deals.length) return;

        const cards = container.querySelectorAll('.deal-card');
        cards.forEach(function(card, idx) {
            if (idx >= deals.length) return;
            if (card.querySelector('.ws1-score-badge')) return; // already injected

            var deal = deals[idx];
            var score = computeDealScore(deal);
            deal._ws1Score = score; // cache on deal object

            // Inject score badge in the top-right area, next to the discount
            var topRow = card.querySelector('div > div:last-child');
            if (topRow && topRow.style && topRow.style.textAlign === 'right') {
                var badge = document.createElement('div');
                badge.style.marginTop = '3px';
                badge.innerHTML = 'Score: ' + scoreBadgeHtml(score);
                badge.style.fontSize = '0.68rem';
                badge.style.fontFamily = 'var(--mono)';
                topRow.appendChild(badge);
            } else {
                // Fallback: prepend to card top-level
                var firstDiv = card.querySelector('div');
                if (firstDiv) {
                    var wrapper = document.createElement('span');
                    wrapper.style.marginLeft = '6px';
                    wrapper.innerHTML = scoreBadgeHtml(score);
                    firstDiv.appendChild(wrapper);
                }
            }
        });
    }

    /**
     * Inject deal scores into dashboard deals table (#dash-deals).
     */
    function injectDashDealScores() {
        var table = document.getElementById('dash-deals');
        if (!table) return;
        var deals = window.DATA?.deals;
        if (!deals || !deals.length) return;

        var rows = table.querySelectorAll('tbody tr');
        rows.forEach(function(row, idx) {
            if (idx >= deals.length) return;
            if (row.querySelector('.ws1-score-badge')) return;

            var deal = deals[idx];
            var score = deal._ws1Score != null ? deal._ws1Score : computeDealScore(deal);
            deal._ws1Score = score;

            // Add score as a new cell at the end
            var td = document.createElement('td');
            td.className = 'right';
            td.innerHTML = scoreBadgeHtml(score);
            row.appendChild(td);
        });
    }

    // ─── 2. Price Confidence Indicator ────────────────────────────────

    function confidenceLevel(count) {
        if (count > 20) return { label: 'HIGH', cls: 'ws1-conf-high' };
        if (count >= 5) return { label: 'MEDIUM', cls: 'ws1-conf-medium' };
        return { label: 'LOW', cls: 'ws1-conf-low' };
    }

    function confidenceBadgeHtml(count) {
        var level = confidenceLevel(count);
        return '<span class="ws1-confidence-badge ' + level.cls + '">' + level.label + ' (' + count + ')</span>';
    }

    /**
     * Inject confidence badge into #lookup-result after it renders.
     * Looks for the listings count text and appends the badge nearby.
     */
    function injectLookupConfidence() {
        var container = document.getElementById('lookup-result');
        if (!container || !container.innerHTML.trim()) return;
        if (container.querySelector('.ws1-confidence-badge')) return; // already done

        // Find the count from the rendered text: "N listings"
        var countMatch = container.textContent.match(/(\d+)\s*listings/);
        var count = countMatch ? parseInt(countMatch[1], 10) : 0;

        // Also try to get it from DATA.refs for the current ref
        var refSearch = document.getElementById('ref-search');
        var currentRef = refSearch ? refSearch.value.trim().split(/\s+/)[0] : '';
        if (currentRef && window.DATA?.refs?.[currentRef]) {
            var refData = window.DATA.refs[currentRef];
            if (refData.count) count = Math.max(count, refData.count);
        }

        if (count === 0) return;

        // Find the paragraph with condition tags and listing count
        var h2 = container.querySelector('h2');
        if (h2) {
            // Insert confidence badge after the h2
            var badge = document.createElement('span');
            badge.innerHTML = confidenceBadgeHtml(count);
            badge.style.display = 'inline';
            h2.appendChild(badge);
        }
    }

    // ─── 3. Price Trend Arrows ────────────────────────────────────────

    /**
     * Compute trend for a reference:
     *   if current median < avg -> down (red)
     *   if median > avg * 1.02 -> up (green)
     *   else flat (grey)
     */
    function computeTrend(refData) {
        if (!refData) return null;
        var median = refData.median || refData.low || 0;
        var avg = refData.avg || 0;
        if (!median || !avg) return null;

        if (median > avg * 1.02) return 'up';
        if (median < avg) return 'down';
        return 'flat';
    }

    function trendArrowHtml(trend) {
        if (!trend) return '';
        if (trend === 'up') return '<span class="ws1-trend ws1-trend-up" title="Trending up (median > avg +2%)">&#9650;</span>';
        if (trend === 'down') return '<span class="ws1-trend ws1-trend-down" title="Trending down (median < avg)">&#9660;</span>';
        return '<span class="ws1-trend ws1-trend-flat" title="Stable (median ~ avg)">&#9654;</span>';
    }

    /**
     * Inject trend arrow into lookup result header.
     */
    function injectLookupTrend() {
        var container = document.getElementById('lookup-result');
        if (!container || !container.innerHTML.trim()) return;
        if (container.querySelector('.ws1-trend')) return;

        var refSearch = document.getElementById('ref-search');
        var currentRef = refSearch ? refSearch.value.trim().split(/\s+/)[0] : '';
        if (!currentRef || !window.DATA?.refs) return;

        var refData = window.DATA.refs[currentRef];
        var trend = computeTrend(refData);
        if (!trend) return;

        var h2 = container.querySelector('h2');
        if (h2) {
            var arrow = document.createElement('span');
            arrow.innerHTML = ' ' + trendArrowHtml(trend);
            arrow.style.display = 'inline';
            h2.appendChild(arrow);
        }
    }

    /**
     * Inject trend arrows into dashboard deals table (#dash-deals).
     */
    function injectDashDealTrends() {
        var table = document.getElementById('dash-deals');
        if (!table) return;
        var deals = window.DATA?.deals;
        var refs = window.DATA?.refs;
        if (!deals || !deals.length || !refs) return;

        var rows = table.querySelectorAll('tbody tr');
        rows.forEach(function(row, idx) {
            if (idx >= deals.length) return;
            if (row.querySelector('.ws1-trend')) return;

            var deal = deals[idx];
            var refData = refs[deal.ref];
            var trend = computeTrend(refData);
            if (!trend) return;

            // Insert trend arrow into the ref cell (second td)
            var refCell = row.querySelectorAll('td')[1];
            if (refCell) {
                var span = document.createElement('span');
                span.innerHTML = trendArrowHtml(trend);
                refCell.appendChild(span);
            }
        });
    }

    /**
     * Inject trend arrows into deals cards (#deals-cards).
     */
    function injectDealsCardTrends() {
        var container = document.getElementById('deals-cards');
        if (!container) return;
        var deals = window.DATA?.deals;
        var refs = window.DATA?.refs;
        if (!deals || !deals.length || !refs) return;

        var cards = container.querySelectorAll('.deal-card');
        cards.forEach(function(card, idx) {
            if (idx >= deals.length) return;
            if (card.querySelector('.ws1-trend')) return;

            var deal = deals[idx];
            var refData = refs[deal.ref];
            var trend = computeTrend(refData);
            if (!trend) return;

            // Find the ref span inside the card
            var refSpan = card.querySelector('.ref');
            if (refSpan) {
                var arrow = document.createElement('span');
                arrow.innerHTML = trendArrowHtml(trend);
                refSpan.parentNode.insertBefore(arrow, refSpan.nextSibling);
            }
        });
    }

    // ─── Observers & Hooks ────────────────────────────────────────────

    var _lookupObserver = null;

    function setupLookupObserver() {
        var target = document.getElementById('lookup-result');
        if (!target) return;
        if (_lookupObserver) _lookupObserver.disconnect();

        _lookupObserver = new MutationObserver(function(mutations) {
            // Debounce: only run once per batch of mutations
            if (_lookupDebounce) return;
            _lookupDebounce = true;
            requestAnimationFrame(function() {
                _lookupDebounce = false;
                injectLookupConfidence();
                injectLookupTrend();
            });
        });
        _lookupObserver.observe(target, { childList: true, subtree: false });
    }
    var _lookupDebounce = false;

    /**
     * Watch for deals cards re-rendering via MutationObserver on #deals-cards.
     */
    var _dealsObserver = null;
    var _dealsDebounce = false;

    function setupDealsObserver() {
        var target = document.getElementById('deals-cards');
        if (!target) return;
        if (_dealsObserver) _dealsObserver.disconnect();

        _dealsObserver = new MutationObserver(function() {
            if (_dealsDebounce) return;
            _dealsDebounce = true;
            requestAnimationFrame(function() {
                _dealsDebounce = false;
                injectDealScores();
                injectDealsCardTrends();
            });
        });
        _dealsObserver.observe(target, { childList: true });
    }

    /**
     * Watch for dashboard deals table re-rendering.
     */
    var _dashDealsObserver = null;
    var _dashDealsDebounce = false;

    function setupDashDealsObserver() {
        var tbody = document.querySelector('#dash-deals tbody');
        if (!tbody) return;
        if (_dashDealsObserver) _dashDealsObserver.disconnect();

        _dashDealsObserver = new MutationObserver(function() {
            if (_dashDealsDebounce) return;
            _dashDealsDebounce = true;
            requestAnimationFrame(function() {
                _dashDealsDebounce = false;
                injectDashDealScores();
                injectDashDealTrends();
            });
        });
        _dashDealsObserver.observe(tbody, { childList: true });
    }

    // ─── Module API ───────────────────────────────────────────────────

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();
        setupLookupObserver();
        setupDealsObserver();
        setupDashDealsObserver();

        // Listen for data-loaded events to re-setup observers
        // (DOM may be rebuilt after data refresh)
        document.addEventListener('mk:data-loaded', function() {
            // Re-setup observers after a tick (DOM may have been replaced)
            setTimeout(function() {
                setupLookupObserver();
                setupDealsObserver();
                setupDashDealsObserver();
                // Run injections immediately on existing content
                render();
            }, 200);
        });

        // Initial injection on whatever is already rendered
        render();
    }

    function render() {
        if (!window.DATA) return;
        injectDealScores();
        injectDealsCardTrends();
        injectDashDealScores();
        injectDashDealTrends();
        injectLookupConfidence();
        injectLookupTrend();
    }

    function cleanup() {
        if (_lookupObserver) { _lookupObserver.disconnect(); _lookupObserver = null; }
        if (_dealsObserver) { _dealsObserver.disconnect(); _dealsObserver = null; }
        if (_dashDealsObserver) { _dashDealsObserver.disconnect(); _dashDealsObserver = null; }
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
