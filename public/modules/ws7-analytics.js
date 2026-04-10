/**
 * MK Opulence — ws7-analytics
 * Market Analytics: CSS donut, top movers, HK vs US price gap, region bars.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws7-analytics', { init, render, cleanup })
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    var MOD_ID = 'ws7-analytics';
    var MK = window.MKModules;

    // ── Brand palette ──
    var BRAND_COLORS = {
        Rolex:   '#C9A84C',
        AP:      '#1a73e8',
        Patek:   '#4a90d9',
        RM:      '#e74c3c',
        Tudor:   '#c0392b',
        VC:      '#7c3aed',
        Cartier: '#e67e22',
        IWC:     '#1abc9c'
    };
    var OTHER_COLOR = '#555';

    // ── Cached data ──
    var _moversData = null;

    // ═══════════════════════════════════════════════════
    // STYLES
    // ═══════════════════════════════════════════════════

    function injectStyles() {
        if (document.getElementById('ws7-styles')) return;
        var style = document.createElement('style');
        style.id = 'ws7-styles';
        style.textContent = `
            /* ── Brand Donut ── */
            .ws7-donut-wrap {
                display: flex;
                align-items: center;
                gap: 18px;
                padding: 14px 16px;
                flex-wrap: wrap;
            }
            .ws7-donut {
                width: 150px;
                height: 150px;
                border-radius: 50%;
                position: relative;
                flex-shrink: 0;
            }
            .ws7-donut-hole {
                position: absolute;
                top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                width: 80px; height: 80px;
                border-radius: 50%;
                background: var(--bg-1, #111);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }
            .ws7-donut-hole-num {
                font-size: 1.1rem;
                font-weight: 800;
                font-family: var(--mono);
                color: var(--text-0);
                line-height: 1;
            }
            .ws7-donut-hole-label {
                font-size: 0.55rem;
                color: var(--text-2);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: 2px;
            }
            .ws7-legend {
                flex: 1;
                min-width: 140px;
            }
            .ws7-legend-row {
                display: flex;
                align-items: center;
                gap: 7px;
                font-size: 0.72rem;
                padding: 3px 0;
                font-family: var(--mono);
            }
            .ws7-legend-dot {
                width: 9px; height: 9px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            .ws7-legend-label { color: var(--text-1); min-width: 54px; }
            .ws7-legend-count { color: var(--text-2); min-width: 48px; text-align: right; }
            .ws7-legend-pct { color: var(--accent, #C9A84C); margin-left: auto; font-weight: 700; min-width: 44px; text-align: right; }

            /* ── Top Movers ── */
            .ws7-mover-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 0;
                border-bottom: 1px solid var(--border, rgba(255,255,255,0.04));
            }
            .ws7-mover-row:last-child { border-bottom: none; }
            .ws7-mover-ref {
                font-weight: 700;
                font-family: var(--mono);
                font-size: 0.78rem;
                color: var(--text-0);
            }
            .ws7-mover-model {
                font-size: 0.65rem;
                color: var(--text-2);
                margin-left: 4px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .ws7-mover-info { min-width: 0; flex: 1; overflow: hidden; }
            .ws7-mover-price {
                font-family: var(--mono);
                font-size: 0.72rem;
                color: var(--text-1);
                white-space: nowrap;
            }
            .ws7-mover-change {
                font-family: var(--mono);
                font-size: 0.75rem;
                font-weight: 700;
                min-width: 72px;
                text-align: right;
                white-space: nowrap;
            }
            .ws7-up { color: var(--green, #00e676); }
            .ws7-down { color: var(--red, #ff1744); }
            .ws7-section-label {
                font-size: 0.6rem;
                text-transform: uppercase;
                letter-spacing: 0.8px;
                font-weight: 700;
                margin: 10px 0 4px;
                padding-left: 2px;
            }

            /* ── Price Gap Table ── */
            .ws7-gap-table {
                width: 100%;
                border-collapse: collapse;
                font-family: var(--mono);
                font-size: 0.72rem;
            }
            .ws7-gap-table th {
                text-align: left;
                padding: 6px 8px;
                color: var(--text-2);
                font-size: 0.6rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-bottom: 1px solid var(--border);
                font-weight: 600;
            }
            .ws7-gap-table th.r { text-align: right; }
            .ws7-gap-table td {
                padding: 5px 8px;
                border-bottom: 1px solid var(--border);
                color: var(--text-1);
            }
            .ws7-gap-table td.r { text-align: right; }
            .ws7-gap-table tr:last-child td { border-bottom: none; }
            .ws7-arb-badge {
                display: inline-block;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 0.62rem;
                font-weight: 700;
            }
            .ws7-arb-hot { background: rgba(0,230,118,0.12); color: var(--green); border: 1px solid rgba(0,230,118,0.2); }
            .ws7-arb-mild { background: rgba(255,193,7,0.12); color: var(--orange, #ffc107); border: 1px solid rgba(255,193,7,0.2); }
            .ws7-arb-none { background: rgba(255,255,255,0.04); color: var(--text-2); border: 1px solid var(--border); }

            /* ── Region Bars ── */
            .ws7-region-bar-wrap {
                padding: 14px 16px;
            }
            .ws7-region-row {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 10px;
            }
            .ws7-region-row:last-child { margin-bottom: 0; }
            .ws7-region-label {
                font-family: var(--mono);
                font-size: 0.75rem;
                font-weight: 700;
                color: var(--text-0);
                min-width: 32px;
            }
            .ws7-region-bar-bg {
                flex: 1;
                height: 22px;
                background: var(--bg-2, rgba(255,255,255,0.03));
                border-radius: 4px;
                overflow: hidden;
                position: relative;
            }
            .ws7-region-bar-fill {
                height: 100%;
                border-radius: 4px;
                transition: width 0.6s ease;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                padding-right: 8px;
            }
            .ws7-region-bar-text {
                font-family: var(--mono);
                font-size: 0.65rem;
                font-weight: 700;
                color: rgba(0,0,0,0.7);
                white-space: nowrap;
            }
            .ws7-region-count {
                font-family: var(--mono);
                font-size: 0.72rem;
                color: var(--text-2);
                min-width: 58px;
                text-align: right;
            }
        `;
        document.head.appendChild(style);
    }

    // ═══════════════════════════════════════════════════
    // 1. BRAND MARKET SHARE DONUT (CSS conic-gradient)
    // ═══════════════════════════════════════════════════

    function renderBrandDonut() {
        var brands = (window.DATA && window.DATA.summary && window.DATA.summary.brands) || {};
        if (!Object.keys(brands).length) return;

        // Remove old
        var old = document.getElementById('ws7-brand-donut-card');
        if (old) old.remove();

        var metricsGrid = document.getElementById('metrics-grid');
        if (!metricsGrid) return;

        // Build sorted entries
        var entries = Object.entries(brands).sort(function(a, b) { return b[1] - a[1]; });
        var total = entries.reduce(function(s, e) { return s + e[1]; }, 0);
        if (total === 0) return;

        // Segment data — group small brands into "Other"
        var segments = [];
        var otherCount = 0;
        entries.forEach(function(e) {
            var brand = e[0], count = e[1];
            if (BRAND_COLORS[brand]) {
                segments.push({ label: brand, value: count, color: BRAND_COLORS[brand] });
            } else {
                otherCount += count;
            }
        });
        if (otherCount > 0) {
            segments.push({ label: 'Other', value: otherCount, color: OTHER_COLOR });
        }

        // Build conic-gradient stops
        var cumPct = 0;
        var gradStops = [];
        segments.forEach(function(seg) {
            var pct = (seg.value / total) * 100;
            gradStops.push(seg.color + ' ' + cumPct.toFixed(2) + '%');
            cumPct += pct;
            gradStops.push(seg.color + ' ' + cumPct.toFixed(2) + '%');
        });
        var conicGrad = 'conic-gradient(from 0deg, ' + gradStops.join(', ') + ')';

        // Legend
        var legendHtml = segments.map(function(seg) {
            var pct = ((seg.value / total) * 100).toFixed(1);
            return '<div class="ws7-legend-row">'
                + '<span class="ws7-legend-dot" style="background:' + seg.color + ';"></span>'
                + '<span class="ws7-legend-label">' + seg.label + '</span>'
                + '<span class="ws7-legend-count">' + seg.value.toLocaleString() + '</span>'
                + '<span class="ws7-legend-pct">' + pct + '%</span>'
                + '</div>';
        }).join('');

        var card = document.createElement('div');
        card.id = 'ws7-brand-donut-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>Brand Distribution</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + total.toLocaleString() + ' listings</span></div>'
            + '<div class="ws7-donut-wrap">'
            + '<div class="ws7-donut" style="background:' + conicGrad + ';">'
            + '<div class="ws7-donut-hole">'
            + '<span class="ws7-donut-hole-num">' + segments.length + '</span>'
            + '<span class="ws7-donut-hole-label">Brands</span>'
            + '</div></div>'
            + '<div class="ws7-legend">' + legendHtml + '</div>'
            + '</div>';

        metricsGrid.parentNode.insertBefore(card, metricsGrid.nextSibling);
    }

    // ═══════════════════════════════════════════════════
    // 2. TOP MOVERS WIDGET
    // ═══════════════════════════════════════════════════

    function renderTopMovers() {
        var movers = _moversData;
        if (!movers || !movers.length) return;

        var old = document.getElementById('ws7-movers-card');
        if (old) old.remove();

        // Sort by spread_pct descending
        var sorted = movers.slice().sort(function(a, b) { return b.spread_pct - a.spread_pct; });

        // Top 10 widest spread (big price moves up), bottom 10 tightest (stable/down)
        var topUp = sorted.slice(0, 10);
        var topDown = sorted.slice(-10).reverse();

        var fmt = MK.formatPrice;

        function buildRow(m, isUp) {
            var color = isUp ? 'ws7-up' : 'ws7-down';
            var arrow = isUp ? '\u25B2' : '\u25BC';
            var pctLabel = m.spread_pct.toFixed(1) + '%';
            return '<div class="ws7-mover-row">'
                + '<div class="ws7-mover-info">'
                + '<span class="ws7-mover-ref">' + m.ref + '</span>'
                + '<span class="ws7-mover-model">' + (m.model || '') + '</span>'
                + '</div>'
                + '<span class="ws7-mover-price">' + fmt(m.median) + '</span>'
                + '<span class="ws7-mover-change ' + color + '">'
                + arrow + ' ' + pctLabel + '</span>'
                + '</div>';
        }

        var html = '<div class="card-head"><span>Top Movers</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">by price spread</span></div>'
            + '<div style="padding:8px 12px;">'
            + '<div class="ws7-section-label ws7-up">Widest Spread (Most Volatile)</div>';

        topUp.forEach(function(m) { html += buildRow(m, true); });

        html += '<div class="ws7-section-label ws7-down" style="margin-top:14px;">Tightest Spread (Most Stable)</div>';

        topDown.forEach(function(m) { html += buildRow(m, false); });

        html += '</div>';

        var card = document.createElement('div');
        card.id = 'ws7-movers-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = html;

        // Insert after brand donut or deals grid
        var insertAfter = document.getElementById('ws7-brand-donut-card');
        if (!insertAfter) {
            var dealsGrid = document.getElementById('dash-deals');
            if (dealsGrid) {
                var gridParent = dealsGrid.closest('[style*="grid-template-columns"]');
                insertAfter = gridParent || dealsGrid;
            }
        }
        if (insertAfter) {
            insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
        } else {
            var mg = document.getElementById('metrics-grid');
            if (mg) mg.parentNode.insertBefore(card, mg.nextSibling);
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. HK vs US PRICE GAP TABLE
    // ═══════════════════════════════════════════════════

    function renderPriceGapTable() {
        var refs = (window.DATA && window.DATA.refs) || {};
        if (!Object.keys(refs).length) return;

        var old = document.getElementById('ws7-price-gap-card');
        if (old) old.remove();

        // Find refs with both HK and US b25 data
        var eligible = [];
        Object.keys(refs).forEach(function(ref) {
            var r = refs[ref];
            if (r.hk_b25 && r.us_b25 && r.hk_count >= 2 && r.us_count >= 1) {
                var gapPct = ((r.us_b25 - r.hk_b25) / r.hk_b25) * 100;
                eligible.push({
                    ref: ref,
                    model: r.model || '',
                    brand: r.brand || '',
                    hk_b25: r.hk_b25,
                    us_b25: r.us_b25,
                    gap_pct: gapPct,
                    arb_profit: r.arb_profit_est || 0,
                    arb_spread: r.arb_spread_pct || 0,
                    count: r.count || 0
                });
            }
        });

        // Sort by absolute gap descending, take top 15
        eligible.sort(function(a, b) { return Math.abs(b.gap_pct) - Math.abs(a.gap_pct); });
        var top15 = eligible.slice(0, 15);
        if (!top15.length) return;

        var fmt = MK.formatPrice;

        var rows = top15.map(function(d) {
            var gapColor = d.gap_pct > 3 ? 'ws7-up' : d.gap_pct < -3 ? 'ws7-down' : '';
            var gapSign = d.gap_pct > 0 ? '+' : '';

            // Arbitrage potential badge
            var arbClass, arbLabel;
            var absGap = Math.abs(d.gap_pct);
            if (absGap > 5) {
                arbClass = 'ws7-arb-hot';
                arbLabel = 'HOT';
            } else if (absGap > 2) {
                arbClass = 'ws7-arb-mild';
                arbLabel = 'MILD';
            } else {
                arbClass = 'ws7-arb-none';
                arbLabel = 'LOW';
            }

            return '<tr>'
                + '<td><span style="font-weight:700;color:var(--text-0);">' + d.ref + '</span>'
                + '<br><span style="font-size:0.6rem;color:var(--text-2);">' + d.model + '</span></td>'
                + '<td class="r">' + fmt(d.hk_b25) + '</td>'
                + '<td class="r">' + fmt(d.us_b25) + '</td>'
                + '<td class="r ' + gapColor + '" style="font-weight:700;">' + gapSign + d.gap_pct.toFixed(1) + '%</td>'
                + '<td class="r"><span class="ws7-arb-badge ' + arbClass + '">' + arbLabel + '</span></td>'
                + '</tr>';
        }).join('');

        var card = document.createElement('div');
        card.id = 'ws7-price-gap-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>HK vs US Price Gap</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + 'Top ' + top15.length + ' refs with both regions</span></div>'
            + '<div style="overflow-x:auto;padding:4px 0;">'
            + '<table class="ws7-gap-table">'
            + '<thead><tr>'
            + '<th>Ref / Model</th>'
            + '<th class="r">HK B25</th>'
            + '<th class="r">US B25</th>'
            + '<th class="r">Gap %</th>'
            + '<th class="r">Arb</th>'
            + '</tr></thead>'
            + '<tbody>' + rows + '</tbody>'
            + '</table></div>';

        // Insert after movers card
        var insertAfter = document.getElementById('ws7-movers-card')
            || document.getElementById('ws7-brand-donut-card');
        if (insertAfter) {
            insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
        } else {
            var mg = document.getElementById('metrics-grid');
            if (mg) mg.parentNode.insertBefore(card, mg.nextSibling);
        }
    }

    // ═══════════════════════════════════════════════════
    // 4. REGION DISTRIBUTION BAR
    // ═══════════════════════════════════════════════════

    function renderRegionBars() {
        var regions = (window.DATA && window.DATA.summary && window.DATA.summary.regions) || {};
        if (!Object.keys(regions).length) return;

        var old = document.getElementById('ws7-region-bar-card');
        if (old) old.remove();

        // Build region entries sorted by count
        var entries = Object.entries(regions).sort(function(a, b) { return b[1] - a[1]; });
        var total = entries.reduce(function(s, e) { return s + e[1]; }, 0);
        if (total === 0) return;

        var REGION_COLORS = {
            HK: '#C9A84C',
            US: '#4a90d9',
            EU: '#7c3aed'
        };

        var barsHtml = entries.map(function(e) {
            var region = e[0], count = e[1];
            var pct = (count / total) * 100;
            var color = REGION_COLORS[region] || '#666';
            var barWidth = Math.max(pct, 1.5); // minimum visible width

            return '<div class="ws7-region-row">'
                + '<span class="ws7-region-label">' + region + '</span>'
                + '<div class="ws7-region-bar-bg">'
                + '<div class="ws7-region-bar-fill" style="width:' + barWidth.toFixed(1) + '%;background:' + color + ';">'
                + (pct > 8 ? '<span class="ws7-region-bar-text">' + pct.toFixed(1) + '%</span>' : '')
                + '</div></div>'
                + '<span class="ws7-region-count">' + count.toLocaleString() + '</span>'
                + '</div>';
        }).join('');

        var card = document.createElement('div');
        card.id = 'ws7-region-bar-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>Region Distribution</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + total.toLocaleString() + ' total</span></div>'
            + '<div class="ws7-region-bar-wrap">' + barsHtml + '</div>';

        // Insert after price gap table
        var insertAfter = document.getElementById('ws7-price-gap-card')
            || document.getElementById('ws7-movers-card')
            || document.getElementById('ws7-brand-donut-card');
        if (insertAfter) {
            insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
        } else {
            var mg = document.getElementById('metrics-grid');
            if (mg) mg.parentNode.insertBefore(card, mg.nextSibling);
        }
    }

    // ═══════════════════════════════════════════════════
    // MODULE LIFECYCLE
    // ═══════════════════════════════════════════════════

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();
        _loadMovers();

        MK.on('data-loaded', function() {
            _loadMovers();
            render();
        });
    }

    function _loadMovers() {
        if (window.DATA && window.DATA.movers) {
            _moversData = window.DATA.movers;
            return;
        }
        fetch('/data/bundle.json')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (d && d.movers) {
                    _moversData = d.movers;
                    if (window.DATA) window.DATA.movers = d.movers;
                    renderTopMovers();
                }
            })
            .catch(function(e) {
                console.warn('[' + MOD_ID + '] Failed to load movers:', e);
            });
    }

    function render() {
        var dashPage = document.getElementById('page-dashboard');
        if (dashPage) {
            setTimeout(function() {
                renderBrandDonut();
                renderTopMovers();
                renderPriceGapTable();
                renderRegionBars();
            }, 200);
        }
    }

    function cleanup() {
        var ids = ['ws7-brand-donut-card', 'ws7-movers-card', 'ws7-price-gap-card', 'ws7-region-bar-card', 'ws7-styles'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
        _moversData = null;
    }

    // Register
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
