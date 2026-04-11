/**
 * MK Opulence — ws7-analytics
 * Market Analytics: CSS donut, top movers, HK vs US price gap, region bars,
 * and HKD/USD Currency Impact Simulator.
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

    // ── Currency simulator state ──
    var FX_BASELINE = 7.78;   // HKD per USD baseline used when bundle was generated
    var _currencyRate = 7.78; // live slider value

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

            /* ── Currency Impact Simulator ── */
            .ws7-fx-slider-wrap {
                padding: 10px 16px 4px;
            }
            .ws7-fx-slider {
                width: 100%;
                appearance: none;
                -webkit-appearance: none;
                height: 4px;
                border-radius: 2px;
                background: var(--bg-2, rgba(255,255,255,0.06));
                outline: none;
                cursor: pointer;
            }
            .ws7-fx-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--accent, #C9A84C);
                cursor: pointer;
                box-shadow: 0 0 6px rgba(201,168,76,0.5);
            }
            .ws7-fx-slider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--accent, #C9A84C);
                cursor: pointer;
                border: none;
                box-shadow: 0 0 6px rgba(201,168,76,0.5);
            }
            .ws7-fx-slider-labels {
                display: flex;
                justify-content: space-between;
                font-size: 0.58rem;
                color: var(--text-2);
                font-family: var(--mono);
                padding: 2px 16px 6px;
            }
            .ws7-fx-summary {
                font-family: var(--mono);
                font-size: 0.72rem;
                color: var(--text-1);
                padding: 6px 16px 8px;
                border-bottom: 1px solid var(--border, rgba(255,255,255,0.04));
                line-height: 1.5;
            }
            .ws7-fx-table {
                width: 100%;
                border-collapse: collapse;
                font-family: var(--mono);
                font-size: 0.7rem;
            }
            .ws7-fx-table th {
                text-align: left;
                padding: 6px 8px;
                color: var(--text-2);
                font-size: 0.58rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-bottom: 1px solid var(--border);
                font-weight: 600;
            }
            .ws7-fx-table th.r { text-align: right; }
            .ws7-fx-table td {
                padding: 5px 8px;
                border-bottom: 1px solid var(--border, rgba(255,255,255,0.04));
                color: var(--text-1);
                vertical-align: middle;
            }
            .ws7-fx-table td.r { text-align: right; }
            .ws7-fx-table tr:last-child td { border-bottom: none; }
            .ws7-fx-profit { font-weight: 700; font-family: var(--mono); }
            .ws7-fx-profit.pos { color: var(--green, #00e676); }
            .ws7-fx-profit.neg { color: var(--red, #ff1744); }
            .ws7-fx-be-badge {
                display: inline-block;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 0.58rem;
                font-weight: 700;
            }
            .ws7-fx-be-safe { background: rgba(0,230,118,0.12); color: var(--green, #00e676); border: 1px solid rgba(0,230,118,0.2); }
            .ws7-fx-be-warn { background: rgba(255,193,7,0.12); color: var(--orange, #ffc107); border: 1px solid rgba(255,193,7,0.2); }
            .ws7-fx-be-dead { background: rgba(255,23,68,0.10); color: var(--red, #ff1744); border: 1px solid rgba(255,23,68,0.2); }
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
    // 5. HKD/USD CURRENCY IMPACT SIMULATOR
    // ═══════════════════════════════════════════════════

    /**
     * Compute arb profit & break-even FX rate for a ref at a given HKD/USD rate.
     * hk_b25 is stored in USD normalized at FX_BASELINE (7.78). We reverse to HKD,
     * then re-cost at the requested rate.
     *
     * Fees = $150 shipping + 1.5% insurance + $40 wire + $35 FedEx label
     */
    function _computeFxArb(r, rate) {
        var hkdPrice = r.hk_b25 * FX_BASELINE;      // reverse to raw HKD
        var usdCost  = hkdPrice / rate;               // re-cost at slider rate
        var insurance = Math.round(r.us_b25 * 0.015);
        var fees      = 150 + insurance + 40 + 35;
        var profit    = r.us_b25 - usdCost - fees;
        var netFloor  = r.us_b25 - fees;
        var breakEven = netFloor > 0 ? hkdPrice / netFloor : 0;
        return {
            hkdPrice:   hkdPrice,
            usdCost:    usdCost,
            fees:       fees,
            profit:     profit,
            breakEven:  breakEven
        };
    }

    /** Re-render just the table body + summary when slider moves — no DOM teardown. */
    function _updateFxTable(topRefs, rate) {
        var tbody    = document.getElementById('ws7-fx-tbody');
        var summary  = document.getElementById('ws7-fx-summary');
        var rateBadge = document.getElementById('ws7-fx-rate-badge');
        if (!tbody) return;

        var fmt = MK.formatPrice;

        // Update rate badge
        if (rateBadge) {
            var changePct = ((rate - FX_BASELINE) / FX_BASELINE * 100);
            var changeStr = Math.abs(changePct) > 0.05
                ? ' (' + (changePct > 0 ? '+' : '') + changePct.toFixed(1) + '%)'
                : '';
            rateBadge.textContent = '1 USD = ' + rate.toFixed(2) + ' HKD' + changeStr;
        }

        var totalProfit    = 0;
        var profitableCount = 0;
        var baseTotal      = 0;

        var rows = topRefs.map(function(item) {
            var calc     = _computeFxArb(item.r, rate);
            var baseCalc = _computeFxArb(item.r, FX_BASELINE);
            totalProfit   += calc.profit;
            baseTotal     += baseCalc.profit;
            if (calc.profit > 0) profitableCount++;

            var profitCls  = calc.profit > 0 ? 'pos' : 'neg';
            var profitSign = calc.profit > 0 ? '+' : '';

            // Break-even safety badge
            var beClass, beTitle;
            if (!calc.breakEven || calc.breakEven <= 0) {
                beClass = 'ws7-fx-be-dead';
                beTitle = 'N/A';
            } else if (rate < calc.breakEven) {
                // Already underwater at this rate
                beClass = 'ws7-fx-be-dead';
                beTitle = calc.breakEven.toFixed(2) + '\u26A0';
            } else if (rate < calc.breakEven * 1.05) {
                // Within 5% of break-even — at risk
                beClass = 'ws7-fx-be-warn';
                beTitle = calc.breakEven.toFixed(2);
            } else {
                beClass = 'ws7-fx-be-safe';
                beTitle = calc.breakEven.toFixed(2);
            }

            return '<tr>'
                + '<td style="font-weight:700;color:var(--text-0);">' + item.ref + '</td>'
                + '<td style="color:var(--text-2);font-size:0.63rem;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + item.model + '</td>'
                + '<td class="r" style="color:var(--text-2);">HK$' + Math.round(calc.hkdPrice).toLocaleString() + '</td>'
                + '<td class="r">' + fmt(calc.usdCost) + '</td>'
                + '<td class="r">' + fmt(item.r.us_b25) + '</td>'
                + '<td class="r"><span class="ws7-fx-profit ' + profitCls + '">' + profitSign + fmt(calc.profit) + '</span></td>'
                + '<td class="r"><span class="ws7-fx-be-badge ' + beClass + '">' + beTitle + '</span></td>'
                + '</tr>';
        });

        tbody.innerHTML = rows.join('');

        // Summary line
        if (summary) {
            var totalSign  = totalProfit > 0 ? '+' : '';
            var poolColor  = totalProfit > 0 ? 'var(--green)' : 'var(--red)';
            var delta      = totalProfit - baseTotal;
            var deltaAbs   = Math.abs(delta);
            var deltaStr   = '';
            if (deltaAbs > 100) {
                deltaStr = ' <span style="color:var(--text-2);">('
                    + (delta >= 0 ? '+' : '') + fmt(delta) + ' vs baseline)</span>';
            }
            summary.innerHTML = 'At <strong style="color:var(--accent);">' + rate.toFixed(2) + ' HKD/USD</strong>: '
                + '<span style="color:' + poolColor + ';font-weight:700;">'
                + totalSign + fmt(totalProfit)
                + '</span> total arb pool &mdash; '
                + profitableCount + '/' + topRefs.length + ' refs profitable'
                + deltaStr;
        }
    }

    /** Build the currency simulator card and wire up the slider. */
    function renderCurrencyImpact() {
        var refs = (window.DATA && window.DATA.refs) || {};
        if (!Object.keys(refs).length) return;

        // Collect refs with HK arb data
        var eligible = [];
        Object.keys(refs).forEach(function(ref) {
            var r = refs[ref];
            if (r.hk_b25 && r.us_b25 && r.hk_count >= 2 && r.us_count >= 1) {
                var baseCalc = _computeFxArb(r, FX_BASELINE);
                // Include refs that aren't catastrophically underwater at baseline
                if (baseCalc.profit > -2000) {
                    eligible.push({ ref: ref, model: r.model || '', r: r, baseProfit: baseCalc.profit });
                }
            }
        });

        if (eligible.length < 2) return;

        // Sort by baseline profit descending — show best arb refs first
        eligible.sort(function(a, b) { return b.baseProfit - a.baseProfit; });
        var topRefs = eligible.slice(0, 12);

        // Remove stale card
        var old = document.getElementById('ws7-currency-card');
        if (old) old.remove();

        var card = document.createElement('div');
        card.id = 'ws7-currency-card';
        card.className = 'card';
        card.style.marginTop = '8px';

        card.innerHTML = '<div class="card-head">'
            + '<span>HKD/USD Currency Impact</span>'
            + '<span id="ws7-fx-rate-badge" style="font-size:0.68rem;color:var(--accent);font-weight:700;font-family:var(--mono);margin-left:8px;"></span>'
            + '</div>'
            + '<div class="ws7-fx-slider-wrap">'
            + '<input type="range" class="ws7-fx-slider" id="ws7-fx-slider"'
            + ' min="6.50" max="8.50" step="0.01" value="' + _currencyRate + '">'
            + '</div>'
            + '<div class="ws7-fx-slider-labels">'
            + '<span>6.50 (USD weak \u2193)</span>'
            + '<span style="color:var(--accent);">7.78 baseline</span>'
            + '<span>8.50 (USD strong \u2191)</span>'
            + '</div>'
            + '<div class="ws7-fx-summary" id="ws7-fx-summary"></div>'
            + '<div style="overflow-x:auto;padding:4px 0;">'
            + '<table class="ws7-fx-table">'
            + '<thead><tr>'
            + '<th>Ref</th>'
            + '<th>Model</th>'
            + '<th class="r">Buy (HKD)</th>'
            + '<th class="r">USD Cost</th>'
            + '<th class="r">US Price</th>'
            + '<th class="r">Arb Profit</th>'
            + '<th class="r">B/E Rate</th>'
            + '</tr></thead>'
            + '<tbody id="ws7-fx-tbody"></tbody>'
            + '</table></div>'
            + '<div style="padding:4px 16px 8px;font-size:0.58rem;color:var(--text-2);font-family:var(--mono);">'
            + 'Fees: $150 ship + 1.5% ins + $40 wire + $35 FedEx &nbsp;|&nbsp; '
            + 'B/E Rate = rate below which trade loses money &nbsp;|&nbsp; '
            + 'Baseline: ' + FX_BASELINE + ' HKD/USD'
            + '</div>';

        // Insert after region bar
        var insertAfter = document.getElementById('ws7-region-bar-card')
            || document.getElementById('ws7-price-gap-card')
            || document.getElementById('ws7-movers-card')
            || document.getElementById('ws7-brand-donut-card');
        if (insertAfter) {
            insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
        } else {
            var mg = document.getElementById('metrics-grid');
            if (mg) mg.parentNode.insertBefore(card, mg.nextSibling);
        }

        // Initial populate
        _updateFxTable(topRefs, _currencyRate);

        // Wire slider
        var slider = document.getElementById('ws7-fx-slider');
        if (slider) {
            slider.addEventListener('input', function() {
                _currencyRate = parseFloat(this.value);
                _updateFxTable(topRefs, _currencyRate);
            });
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
                renderCurrencyImpact();
            }, 200);
        }
    }

    function cleanup() {
        var ids = [
            'ws7-brand-donut-card',
            'ws7-movers-card',
            'ws7-price-gap-card',
            'ws7-region-bar-card',
            'ws7-currency-card',
            'ws7-styles'
        ];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
        _moversData = null;
    }

    // Register
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
