/**
 * MK Opulence — ws1-price-intel
 * Price Intelligence module: deal scoring, price confidence, market depth widget.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws1-price-intel', { init, render, cleanup })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    var MOD_ID = 'ws1-price-intel';
    var MK = window.MKModules;

    // ─── Styles ───────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ws1-styles')) return;
        var style = document.createElement('style');
        style.id = 'ws1-styles';
        style.textContent = [
            '.ws1-score-badge {',
            '  display:inline-flex; align-items:center; justify-content:center;',
            '  min-width:36px; padding:3px 8px; border-radius:6px;',
            '  font-size:0.72rem; font-weight:700; font-family:var(--mono); letter-spacing:0.3px;',
            '}',
            '.ws1-score-green { background:rgba(0,230,118,0.12); color:var(--green); border:1px solid rgba(0,230,118,0.25); }',
            '.ws1-score-yellow { background:rgba(255,193,7,0.12); color:var(--orange); border:1px solid rgba(255,193,7,0.25); }',
            '.ws1-score-red { background:rgba(255,23,68,0.10); color:var(--red); border:1px solid rgba(255,23,68,0.2); }',
            '.ws1-confidence-badge {',
            '  display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:6px;',
            '  font-size:0.72rem; font-weight:700; font-family:var(--mono); letter-spacing:0.5px;',
            '  margin-left:8px; vertical-align:middle;',
            '}',
            '.ws1-conf-high { background:rgba(0,230,118,0.12); color:var(--green); border:1px solid rgba(0,230,118,0.25); }',
            '.ws1-conf-medium { background:rgba(255,193,7,0.12); color:var(--orange); border:1px solid rgba(255,193,7,0.25); }',
            '.ws1-conf-low { background:rgba(255,23,68,0.10); color:var(--red); border:1px solid rgba(255,23,68,0.2); }',
            '.ws1-trend { display:inline-flex; align-items:center; gap:2px; font-size:0.68rem; font-weight:700; font-family:var(--mono); vertical-align:middle; margin-left:4px; }',
            '.ws1-trend-up { color:var(--green); }',
            '.ws1-trend-down { color:var(--red); }',
            '.ws1-trend-flat { color:var(--text-2); }',
            '.ws1-depth-row {',
            '  display:flex; justify-content:space-between; align-items:center;',
            '  padding:5px 0; border-bottom:1px solid var(--border); cursor:pointer;',
            '  transition:background 0.1s;',
            '}',
            '.ws1-depth-row:hover { background:var(--bg-hover); }',
            '.ws1-depth-row:last-child { border-bottom:none; }',
            '.ws1-depth-ref { font-family:var(--mono); font-size:0.82rem; font-weight:600; color:var(--accent); }',
            '.ws1-depth-model { font-size:0.72rem; color:var(--text-2); margin-left:6px; }',
            '.ws1-depth-count { font-family:var(--mono); font-size:0.75rem; font-weight:700; min-width:36px; text-align:right; }',
            '.ws1-depth-bar { height:4px; border-radius:2px; margin-top:2px; transition:width 0.3s ease; }',
            '.ws1-depth-section-title {',
            '  font-size:0.6rem; font-weight:700; text-transform:uppercase; letter-spacing:1px;',
            '  color:var(--text-2); margin:10px 0 4px; font-family:var(--mono);',
            '}',
            '.ws1-depth-section-title:first-child { margin-top:0; }',
            '@media (max-width:768px) {',
            '  .ws1-score-badge { font-size:0.65rem; padding:2px 6px; min-width:28px; }',
            '  .ws1-confidence-badge { margin-left:4px; font-size:0.65rem; padding:3px 7px; }',
            '  .ws1-depth-ref { font-size:0.75rem; }',
            '  .ws1-depth-model { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px; margin-left:0; margin-top:1px; }',
            '  .ws1-depth-count { font-size:0.7rem; min-width:28px; }',
            '  .ws1-depth-section-title { font-size:0.55rem; letter-spacing:0.5px; }',
            '  #ws1-market-depth { overflow-x:hidden; }',
            '}',
            '@media (max-width:390px) {',
            '  .ws1-confidence-badge { display:block; margin-left:0; margin-top:4px; font-size:0.6rem; }',
            '  .ws1-depth-model { max-width:110px; font-size:0.65rem; }',
            '  .ws1-trend { font-size:0.6rem; }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ─── 1. Deal Scoring Algorithm ────────────────────────────────────
    //
    // Composite score 0-100:
    //   discount_pct     40% — bigger discount = higher score (cap at 25%)
    //   condition_premium 20% — BNIB > Pre-owned
    //   region_arbitrage  20% — HK listings score higher (US buyer arbitrage)
    //   listing_count     20% — more comparables = more confidence

    function computeDealScore(deal) {
        // Discount component (0-100): higher discount = better, cap at 25%
        var disc = Math.abs(deal.discount_pct || deal.gap_pct || 0);
        var discountScore = Math.min(disc / 25 * 100, 100);

        // Condition premium (0-100): BNIB > Like New > Pre-owned
        var cond = (deal.condition || deal.condition_bucket || '').toLowerCase();
        var condScore = 30;
        if (cond.indexOf('bnib') >= 0 || cond.indexOf('unworn') >= 0) condScore = 100;
        else if (cond.indexOf('new') >= 0 && cond.indexOf('pre') < 0) condScore = 90;
        else if (cond.indexOf('like new') >= 0 || cond.indexOf('mint') >= 0 || cond.indexOf('excellent') >= 0) condScore = 70;
        else if (cond.indexOf('very good') >= 0) condScore = 55;
        else if (cond.indexOf('good') >= 0 || cond.indexOf('pre-owned') >= 0 || cond.indexOf('used') >= 0) condScore = 40;

        // Region arbitrage (0-100): HK region scores highest for US buyer
        var region = (deal.region || '').toLowerCase();
        var regionScore = 30; // default neutral
        if (region === 'hk' || region.indexOf('hong kong') >= 0) regionScore = 100;
        else if (region === 'sg' || region.indexOf('singapore') >= 0) regionScore = 80;
        else if (region === 'jp' || region.indexOf('japan') >= 0) regionScore = 75;
        else if (region === 'eu' || region.indexOf('europe') >= 0 || region === 'uk') regionScore = 55;
        else if (region === 'us' || region.indexOf('united states') >= 0) regionScore = 20;

        // Listing count / confidence (0-100): more comparables = more reliable deal
        var listingCount = deal.total_listings || deal.comparable_count || 0;
        // 30+ listings = max confidence
        var listingScore = Math.min(listingCount / 30 * 100, 100);

        var score = Math.round(
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

    function scoreBadgeHtml(score) {
        return '<span class="ws1-score-badge ' + scoreClass(score) + '">' + score + '</span>';
    }

    function scoreLabel(score) {
        if (score >= 80) return 'Excellent';
        if (score >= 65) return 'Strong';
        if (score >= 45) return 'Fair';
        return 'Weak';
    }

    /**
     * Inject deal scores as badges on deal cards in #deals-cards.
     */
    function injectDealScores() {
        var container = document.getElementById('deals-cards');
        if (!container) return;
        var deals = window.DATA && window.DATA.deals;
        if (!deals || !deals.length) return;

        var cards = container.querySelectorAll('.deal-card');
        cards.forEach(function(card, idx) {
            if (idx >= deals.length) return;
            if (card.querySelector('.ws1-score-badge')) return; // already injected

            var deal = deals[idx];
            var score = computeDealScore(deal);
            deal._ws1Score = score;

            // Find the top-right div (discount area)
            var topRow = card.querySelector('div > div:last-child');
            if (topRow && topRow.style && topRow.style.textAlign === 'right') {
                var badge = document.createElement('div');
                badge.style.marginTop = '3px';
                badge.innerHTML = '<span style="font-size:0.6rem;color:var(--text-2);font-family:var(--mono);">Score </span>' + scoreBadgeHtml(score) +
                    '<span style="font-size:0.58rem;color:var(--text-2);margin-left:3px;font-family:var(--mono);">' + scoreLabel(score) + '</span>';
                badge.style.fontSize = '0.68rem';
                badge.style.fontFamily = 'var(--mono)';
                topRow.appendChild(badge);
            } else {
                // Fallback: append to first child div
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
        var deals = window.DATA && window.DATA.deals;
        if (!deals || !deals.length) return;

        // Add header if missing
        var thead = table.querySelector('thead');
        if (thead && !thead.querySelector('.ws1-th-score')) {
            var headerRow = thead.querySelector('tr');
            if (headerRow) {
                var th = document.createElement('th');
                th.className = 'right ws1-th-score';
                th.textContent = 'Score';
                th.style.fontSize = '0.65rem';
                headerRow.appendChild(th);
            }
        }

        var rows = table.querySelectorAll('tbody tr');
        rows.forEach(function(row, idx) {
            if (idx >= deals.length) return;
            if (row.querySelector('.ws1-score-badge')) return;

            var deal = deals[idx];
            var score = deal._ws1Score != null ? deal._ws1Score : computeDealScore(deal);
            deal._ws1Score = score;

            var td = document.createElement('td');
            td.className = 'right';
            td.innerHTML = scoreBadgeHtml(score);
            row.appendChild(td);
        });
    }

    // ─── 2. Price Confidence Indicator ────────────────────────────────

    function confidenceLevel(count) {
        if (count > 20) return { label: 'HIGH', cls: 'ws1-conf-high', icon: '\u25CF' };
        if (count >= 5) return { label: 'MEDIUM', cls: 'ws1-conf-medium', icon: '\u25CF' };
        return { label: 'LOW', cls: 'ws1-conf-low', icon: '\u25CF' };
    }

    function confidenceBadgeHtml(count) {
        var level = confidenceLevel(count);
        return '<span class="ws1-confidence-badge ' + level.cls + '">' +
            level.icon + ' ' + level.label + ' (' + count + ' comps)</span>';
    }

    /**
     * Inject price confidence badge into lookup results (#lookup-result).
     */
    function injectLookupConfidence() {
        var container = document.getElementById('lookup-result');
        if (!container || !container.innerHTML.trim()) return;
        if (container.querySelector('.ws1-confidence-badge')) return;

        // Try to get count from rendered text
        var countMatch = container.textContent.match(/(\d+)\s*listings/);
        var count = countMatch ? parseInt(countMatch[1], 10) : 0;

        // Also check DATA.refs for current ref
        var refSearch = document.getElementById('ref-search');
        var currentRef = refSearch ? refSearch.value.trim().split(/\s+/)[0] : '';
        if (currentRef && window.DATA && window.DATA.refs && window.DATA.refs[currentRef]) {
            var refData = window.DATA.refs[currentRef];
            if (refData.count) count = Math.max(count, refData.count);
        }

        if (count === 0) return;

        var h2 = container.querySelector('h2');
        if (h2) {
            var badge = document.createElement('span');
            badge.innerHTML = confidenceBadgeHtml(count);
            badge.style.display = 'inline';
            h2.appendChild(badge);
        }
    }

    // ─── 3. Price Trend Arrows ────────────────────────────────────────

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
        if (trend === 'up') return '<span class="ws1-trend ws1-trend-up" title="Trending up vs 30d avg: current median exceeds 30-day average by >2%">&#9650;</span>';
        if (trend === 'down') return '<span class="ws1-trend ws1-trend-down" title="Trending down vs 30d avg: current median is below the 30-day average">&#9660;</span>';
        return '<span class="ws1-trend ws1-trend-flat" title="Stable vs 30d avg: current median is within 2% of the 30-day average">&#9654;</span>';
    }

    function injectLookupTrend() {
        var container = document.getElementById('lookup-result');
        if (!container || !container.innerHTML.trim()) return;
        if (container.querySelector('.ws1-trend')) return;

        var refSearch = document.getElementById('ref-search');
        var currentRef = refSearch ? refSearch.value.trim().split(/\s+/)[0] : '';
        if (!currentRef || !window.DATA || !window.DATA.refs) return;

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

    function injectDashDealTrends() {
        var table = document.getElementById('dash-deals');
        if (!table) return;
        var deals = window.DATA && window.DATA.deals;
        var refs = window.DATA && window.DATA.refs;
        if (!deals || !deals.length || !refs) return;

        var rows = table.querySelectorAll('tbody tr');
        rows.forEach(function(row, idx) {
            if (idx >= deals.length) return;
            if (row.querySelector('.ws1-trend')) return;

            var deal = deals[idx];
            var refData = refs[deal.ref];
            var trend = computeTrend(refData);
            if (!trend) return;

            var refCell = row.querySelectorAll('td')[1];
            if (refCell) {
                var span = document.createElement('span');
                span.innerHTML = trendArrowHtml(trend);
                refCell.appendChild(span);
            }
        });
    }

    function injectDealsCardTrends() {
        var container = document.getElementById('deals-cards');
        if (!container) return;
        var deals = window.DATA && window.DATA.deals;
        var refs = window.DATA && window.DATA.refs;
        if (!deals || !deals.length || !refs) return;

        var cards = container.querySelectorAll('.deal-card');
        cards.forEach(function(card, idx) {
            if (idx >= deals.length) return;
            if (card.querySelector('.ws1-trend')) return;

            var deal = deals[idx];
            var refData = refs[deal.ref];
            var trend = computeTrend(refData);
            if (!trend) return;

            var refSpan = card.querySelector('.ref');
            if (refSpan) {
                var arrow = document.createElement('span');
                arrow.innerHTML = trendArrowHtml(trend);
                refSpan.parentNode.insertBefore(arrow, refSpan.nextSibling);
            }
        });
    }

    // ─── 4. Market Depth Widget ───────────────────────────────────────

    function buildMarketDepthWidget() {
        var refs = window.DATA && window.DATA.refs;
        if (!refs) return;

        // Remove existing widget if re-rendering
        var existing = document.getElementById('ws1-market-depth');
        if (existing) existing.remove();

        // Build sorted list of refs by listing count
        var refList = [];
        var keys = Object.keys(refs);
        for (var i = 0; i < keys.length; i++) {
            var ref = keys[i];
            var data = refs[ref];
            var count = data.count || data.total_listings || 0;
            if (count > 0) {
                refList.push({
                    ref: ref,
                    count: count,
                    model: data.model || data.brand || '',
                    avg: data.avg || data.b25 || data.median || 0
                });
            }
        }

        if (refList.length < 2) return;

        refList.sort(function(a, b) { return b.count - a.count; });

        var maxCount = refList[0].count;
        var top5 = refList.slice(0, 5);
        var bottom5 = refList.slice(-5).reverse();

        var fmt = MK.formatPrice;

        function renderRow(item, barColor) {
            var pct = Math.max(5, Math.round(item.count / maxCount * 100));
            var priceStr = item.avg > 0 ? fmt(item.avg) : '';
            return '<div class="ws1-depth-row" onclick="if(typeof lookupRef===\'function\')lookupRef(\'' + item.ref + '\')">' +
                '<div style="flex:1;min-width:0;">' +
                    '<span class="ws1-depth-ref">' + item.ref + '</span>' +
                    (item.model ? '<span class="ws1-depth-model">' + item.model + '</span>' : '') +
                    '<div class="ws1-depth-bar" style="width:' + pct + '%;background:' + barColor + ';"></div>' +
                '</div>' +
                '<div style="text-align:right;margin-left:8px;">' +
                    '<span class="ws1-depth-count" style="color:' + barColor + ';">' + item.count + '</span>' +
                    (priceStr ? '<div style="font-size:0.62rem;color:var(--text-2);font-family:var(--mono);">' + priceStr + '</div>' : '') +
                '</div>' +
            '</div>';
        }

        var html = '<div class="ws1-depth-section-title">Most Liquid (highest listing count)</div>';
        for (var j = 0; j < top5.length; j++) {
            html += renderRow(top5[j], 'var(--green)');
        }

        html += '<div class="ws1-depth-section-title" style="margin-top:14px;">Least Liquid (lowest listing count)</div>';
        for (var k = 0; k < bottom5.length; k++) {
            html += renderRow(bottom5[k], 'var(--red)');
        }

        // Summary stats
        var totalListings = 0;
        for (var m = 0; m < refList.length; m++) totalListings += refList[m].count;
        var avgPerRef = Math.round(totalListings / refList.length);
        var medianIdx = Math.floor(refList.length / 2);
        var medianCount = refList[medianIdx] ? refList[medianIdx].count : 0;

        html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:0.65rem;color:var(--text-2);font-family:var(--mono);">' +
            '<span>' + refList.length + ' refs tracked</span>' +
            '<span>Avg ' + avgPerRef + '/ref</span>' +
            '<span>Median ' + medianCount + '</span>' +
        '</div>';

        var widgetCard = MK.card('Market Depth', '<div style="padding:8px 10px;">' + html + '</div>');

        var wrapper = document.createElement('div');
        wrapper.id = 'ws1-market-depth';
        wrapper.style.marginTop = '8px';
        wrapper.innerHTML = widgetCard;

        // Insert on the dashboard page, after the Top Deals / Arbitrage grid
        var dashPage = document.getElementById('page-dashboard');
        if (!dashPage) return;

        // Find the grid that contains Top Deals and Arbitrage, insert after it
        var grids = dashPage.querySelectorAll('div[style*="grid-template-columns"]');
        var targetGrid = null;
        for (var g = 0; g < grids.length; g++) {
            if (grids[g].querySelector('#dash-deals') || grids[g].querySelector('#dash-arb')) {
                targetGrid = grids[g];
                break;
            }
        }

        if (targetGrid && targetGrid.nextSibling) {
            targetGrid.parentNode.insertBefore(wrapper, targetGrid.nextSibling);
        } else if (dashPage) {
            // Fallback: append before the news card
            var newsCard = dashPage.querySelector('#news-feed');
            if (newsCard && newsCard.closest('.card')) {
                dashPage.insertBefore(wrapper, newsCard.closest('.card'));
            } else {
                dashPage.appendChild(wrapper);
            }
        }
    }

    // ─── Observers & Hooks ────────────────────────────────────────────

    var _lookupObserver = null;
    var _lookupDebounce = false;

    function setupLookupObserver() {
        var target = document.getElementById('lookup-result');
        if (!target) return;
        if (_lookupObserver) _lookupObserver.disconnect();

        _lookupObserver = new MutationObserver(function() {
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
        document.addEventListener('mk:data-loaded', function() {
            setTimeout(function() {
                setupLookupObserver();
                setupDealsObserver();
                setupDashDealsObserver();
                render();
            }, 200);
        });

        // Initial render
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
        buildMarketDepthWidget();
    }

    function cleanup() {
        if (_lookupObserver) { _lookupObserver.disconnect(); _lookupObserver = null; }
        if (_dealsObserver) { _dealsObserver.disconnect(); _dealsObserver = null; }
        if (_dashDealsObserver) { _dashDealsObserver.disconnect(); _dashDealsObserver = null; }
        var depth = document.getElementById('ws1-market-depth');
        if (depth) depth.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
