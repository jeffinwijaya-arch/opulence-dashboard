/**
 * MK Opulence — ws7-analytics
 * Market Analytics: Brand donut, top movers, HK vs US price gap chart.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *   drawDonutChart(canvasId, segments, opts) — existing donut utility
 *
 * Rules:
 *   - Register via MKModules.register('ws7-analytics', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws7-analytics';

    // Brand colors
    const BRAND_COLORS = {
        Rolex:  '#C9A84C',
        AP:     '#1a1a2e',
        Patek:  '#4a90d9',
        RM:     '#e74c3c',
        Tudor:  '#c0392b',
        VC:     '#2c3e50'
    };
    const OTHER_COLOR = '#666';

    // ── Cached data ──
    let _moversData = null;

    // ═══════════════════════════════════════════════════
    // 1. BRAND MARKET SHARE DONUT
    // ═══════════════════════════════════════════════════

    function renderBrandDonut() {
        const brands = (window.DATA && window.DATA.summary && window.DATA.summary.brands) || {};
        if (!Object.keys(brands).length) return;

        // Remove old card if re-rendering
        const old = document.getElementById('ws7-brand-donut-card');
        if (old) old.remove();

        const metricsGrid = document.getElementById('metrics-grid');
        if (!metricsGrid) return;

        // Build sorted brand entries
        const entries = Object.entries(brands).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((s, e) => s + e[1], 0);

        // Segments for donut
        const segments = [];
        let otherCount = 0;
        entries.forEach(([brand, count]) => {
            if (BRAND_COLORS[brand]) {
                segments.push({ label: brand, value: count, color: BRAND_COLORS[brand] });
            } else {
                otherCount += count;
            }
        });
        if (otherCount > 0) {
            segments.push({ label: 'Other', value: otherCount, color: OTHER_COLOR });
        }

        // Build legend HTML
        const legendHtml = segments.map(seg => {
            const pct = ((seg.value / total) * 100).toFixed(1);
            return '<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;padding:2px 0;">'
                + '<span style="width:8px;height:8px;border-radius:50%;background:' + seg.color + ';flex-shrink:0;"></span>'
                + '<span style="color:var(--text-1);font-family:var(--mono);min-width:50px;">' + seg.label + '</span>'
                + '<span style="color:var(--text-2);font-family:var(--mono);">' + seg.value.toLocaleString() + '</span>'
                + '<span style="color:var(--text-3);font-family:var(--mono);margin-left:auto;">' + pct + '%</span>'
                + '</div>';
        }).join('');

        // Create card
        const card = document.createElement('div');
        card.id = 'ws7-brand-donut-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>Brand Distribution</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + total.toLocaleString() + ' listings</span></div>'
            + '<div style="display:flex;align-items:center;gap:16px;padding:12px 14px;">'
            + '<canvas id="ws7-brand-donut-canvas" style="flex-shrink:0;"></canvas>'
            + '<div style="flex:1;min-width:0;">' + legendHtml + '</div>'
            + '</div>';

        // Insert after metrics-grid
        metricsGrid.parentNode.insertBefore(card, metricsGrid.nextSibling);

        // Draw using existing drawDonutChart if available
        if (typeof drawDonutChart === 'function') {
            drawDonutChart('ws7-brand-donut-canvas', segments, { size: 140 });
        } else {
            _drawDonut('ws7-brand-donut-canvas', segments, 140);
        }
    }

    /**
     * Fallback donut renderer if drawDonutChart is not in scope.
     */
    function _drawDonut(canvasId, segments, size) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || !segments.length) return;
        var dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var cx = size / 2, cy = size / 2;
        var outerR = size / 2 - 4;
        var innerR = outerR * 0.62;
        var total = segments.reduce(function(s, seg) { return s + seg.value; }, 0);

        var animProgress = 0;
        function draw() {
            ctx.clearRect(0, 0, size, size);
            var startAngle = -Math.PI / 2;
            var targetAngle = animProgress * Math.PI * 2;

            segments.forEach(function(seg) {
                var sliceAngle = (seg.value / total) * Math.PI * 2;
                var endAngle = startAngle + Math.min(sliceAngle, Math.max(0, targetAngle - (startAngle + Math.PI / 2)));
                if (endAngle <= startAngle) { startAngle += sliceAngle; return; }

                ctx.beginPath();
                ctx.arc(cx, cy, outerR, startAngle, endAngle);
                ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
                ctx.closePath();
                ctx.fillStyle = seg.color;
                ctx.fill();
                ctx.strokeStyle = 'rgba(8,8,12,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();

                startAngle += sliceAngle;
            });

            if (animProgress < 1) {
                animProgress = Math.min(1, animProgress + 0.03);
                requestAnimationFrame(draw);
            }
        }
        draw();
    }

    // ═══════════════════════════════════════════════════
    // 2. TOP MOVERS WIDGET
    // ═══════════════════════════════════════════════════

    function renderTopMovers() {
        var movers = _moversData;
        if (!movers || !movers.length) return;

        // Remove old card if re-rendering
        var old = document.getElementById('ws7-movers-card');
        if (old) old.remove();

        // Sort by spread_pct descending for "gainers" (high spread = volatile / big range)
        // Top 5 highest spread = most volatile upside potential
        // Bottom 5 lowest spread = tightest / most stable
        var sorted = movers.slice().sort(function(a, b) { return b.spread_pct - a.spread_pct; });
        var topGainers = sorted.slice(0, 5);
        var topLosers = sorted.slice(-5).reverse(); // lowest spread = tightest priced

        var fmt = window.MKModules.formatPrice;

        function buildRow(m, isGainer) {
            var color = isGainer ? 'var(--green)' : 'var(--red)';
            var arrow = isGainer ? '\u25B2' : '\u25BC';
            var spreadLabel = m.spread_pct.toFixed(1) + '%';
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">'
                + '<div style="min-width:0;flex:1;">'
                + '<span style="font-weight:600;font-family:var(--mono);font-size:0.78rem;color:var(--text-0);">' + m.ref + '</span>'
                + '<span style="font-size:0.65rem;color:var(--text-2);margin-left:6px;">' + (m.model || '') + '</span>'
                + '</div>'
                + '<span style="font-family:var(--mono);font-size:0.75rem;color:var(--text-1);">' + fmt(m.median) + '</span>'
                + '<span style="font-family:var(--mono);font-size:0.75rem;font-weight:700;color:' + color + ';min-width:58px;text-align:right;">'
                + arrow + ' ' + spreadLabel + '</span>'
                + '</div>';
        }

        var html = '<div class="card-head"><span>Top Movers</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">by price spread</span></div>'
            + '<div style="padding:8px 12px;">'
            + '<div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--green);font-weight:600;margin-bottom:4px;">Widest Spread</div>';

        topGainers.forEach(function(m) { html += buildRow(m, true); });

        html += '<div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--red);font-weight:600;margin:10px 0 4px;">Tightest Spread</div>';

        topLosers.forEach(function(m) { html += buildRow(m, false); });

        html += '</div>';

        var card = document.createElement('div');
        card.id = 'ws7-movers-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = html;

        // Insert after the deals/arb grid (the 2-col grid with dash-deals and dash-arb)
        var dealsGrid = document.getElementById('dash-deals');
        if (dealsGrid) {
            var gridParent = dealsGrid.closest('[style*="grid-template-columns"]');
            if (gridParent) {
                gridParent.parentNode.insertBefore(card, gridParent.nextSibling);
            } else {
                // Fallback: insert after brand donut
                var donut = document.getElementById('ws7-brand-donut-card');
                if (donut) {
                    donut.parentNode.insertBefore(card, donut.nextSibling);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // 3. HK vs US PRICE GAP CHART
    // ═══════════════════════════════════════════════════

    function renderPriceGapChart() {
        var refs = (window.DATA && window.DATA.refs) || {};
        if (!Object.keys(refs).length) return;

        // Remove old card if re-rendering
        var old = document.getElementById('ws7-price-gap-card');
        if (old) old.remove();

        // Get refs with both HK and US data, sorted by count
        var eligible = [];
        Object.keys(refs).forEach(function(ref) {
            var r = refs[ref];
            if (r.hk_b25 && r.us_b25 && r.count >= 5) {
                eligible.push({
                    ref: ref,
                    model: r.model || '',
                    count: r.count,
                    hk_b25: r.hk_b25,
                    us_b25: r.us_b25,
                    spread_pct: r.arb_spread_pct || 0
                });
            }
        });

        eligible.sort(function(a, b) { return b.count - a.count; });
        var top20 = eligible.slice(0, 20);

        if (!top20.length) return;

        // Canvas dimensions
        var barHeight = 20;
        var labelWidth = 90;
        var valueWidth = 60;
        var chartPadding = 12;
        var canvasWidth = 400;
        var canvasHeight = top20.length * (barHeight + 6) + 40; // 6px gap + header

        var fmt = window.MKModules.formatPrice;

        // Build card
        var card = document.createElement('div');
        card.id = 'ws7-price-gap-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>HK vs US Price Gap</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">Top ' + top20.length + ' by volume</span></div>'
            + '<div style="padding:8px 0;overflow-x:auto;">'
            + '<canvas id="ws7-price-gap-canvas" style="display:block;margin:0 auto;"></canvas>'
            + '</div>';

        // Insert after movers card, or after deals grid
        var moversCard = document.getElementById('ws7-movers-card');
        var insertAfter = moversCard || document.getElementById('ws7-brand-donut-card');
        if (insertAfter) {
            insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
        } else {
            var metricsGrid = document.getElementById('metrics-grid');
            if (metricsGrid) {
                metricsGrid.parentNode.insertBefore(card, metricsGrid.nextSibling);
            }
        }

        // Draw the chart on canvas
        _drawPriceGapBars('ws7-price-gap-canvas', top20, canvasWidth, canvasHeight, barHeight, labelWidth, valueWidth, chartPadding);
    }

    function _drawPriceGapBars(canvasId, data, width, height, barH, labelW, valueW, pad) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Responsive width: use container width
        var containerW = canvas.parentElement ? canvas.parentElement.offsetWidth : width;
        width = Math.max(320, containerW - 16);

        var dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var HK_COLOR = '#4a90d9';
        var US_COLOR = '#C9A84C';

        // Compute max price for scale
        var maxPrice = 0;
        data.forEach(function(d) {
            maxPrice = Math.max(maxPrice, d.hk_b25, d.us_b25);
        });

        var chartLeft = labelW + pad;
        var chartRight = width - valueW - pad;
        var chartWidth = chartRight - chartLeft;
        var gapY = 6;
        var headerH = 28;

        // Resolve CSS variable colors
        var computedStyle = getComputedStyle(document.documentElement);
        var textColor0 = computedStyle.getPropertyValue('--text-0').trim() || '#ececea';
        var textColor1 = computedStyle.getPropertyValue('--text-1').trim() || '#a8a6a0';
        var textColor2 = computedStyle.getPropertyValue('--text-2').trim() || '#5c5b57';
        var borderColor = computedStyle.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.04)';

        // Header labels
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = HK_COLOR;
        ctx.textAlign = 'right';
        ctx.fillText('HK B25', chartLeft + chartWidth * 0.3, 12);
        ctx.fillStyle = US_COLOR;
        ctx.fillText('US B25', chartLeft + chartWidth * 0.7, 12);
        ctx.fillStyle = textColor2;
        ctx.textAlign = 'right';
        ctx.fillText('Spread', width - pad, 12);

        // Draw bars
        data.forEach(function(d, i) {
            var y = headerH + i * (barH + gapY);
            var hkW = (d.hk_b25 / maxPrice) * chartWidth;
            var usW = (d.us_b25 / maxPrice) * chartWidth;

            // Ref label
            ctx.font = '600 10px "JetBrains Mono", monospace';
            ctx.fillStyle = textColor0;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.ref, labelW, y + barH / 2);

            // HK bar (top half)
            var halfBar = barH / 2 - 1;
            ctx.fillStyle = HK_COLOR;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            _roundRect(ctx, chartLeft, y, hkW, halfBar, 2);
            ctx.fill();

            // US bar (bottom half)
            ctx.fillStyle = US_COLOR;
            ctx.beginPath();
            _roundRect(ctx, chartLeft, y + halfBar + 2, usW, halfBar, 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            // Price labels on bars
            ctx.font = '500 8px "JetBrains Mono", monospace';
            ctx.fillStyle = textColor0;
            ctx.textAlign = 'left';
            if (hkW > 50) {
                ctx.fillText('$' + Math.round(d.hk_b25).toLocaleString(), chartLeft + hkW - 48, y + halfBar / 2 + 1);
            }
            if (usW > 50) {
                ctx.fillText('$' + Math.round(d.us_b25).toLocaleString(), chartLeft + usW - 48, y + halfBar + 2 + halfBar / 2 + 1);
            }

            // Spread label
            var spreadColor = d.spread_pct > 0 ? '#00e676' : d.spread_pct < 0 ? '#ff1744' : textColor2;
            ctx.font = '700 10px "JetBrains Mono", monospace';
            ctx.fillStyle = spreadColor;
            ctx.textAlign = 'right';
            var sign = d.spread_pct > 0 ? '+' : '';
            ctx.fillText(sign + d.spread_pct.toFixed(1) + '%', width - pad, y + barH / 2);
        });
    }

    /** Canvas rounded rect helper */
    function _roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ═══════════════════════════════════════════════════
    // INIT & RENDER
    // ═══════════════════════════════════════════════════

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');

        // Fetch movers data from bundle.json
        _loadMovers();

        // Listen for data refresh
        window.MKModules.on('data-loaded', function() {
            _loadMovers();
            render();
        });
    }

    function _loadMovers() {
        // First try DATA directly (bundle may already be loaded)
        if (window.DATA && window.DATA.movers) {
            _moversData = window.DATA.movers;
            return;
        }
        // Fetch from bundle.json
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
        // Only render on dashboard page
        var dashPage = document.getElementById('page-dashboard');
        if (!dashPage) return;

        // Small delay to ensure metrics-grid is populated
        setTimeout(function() {
            renderBrandDonut();
            renderTopMovers();
            renderPriceGapChart();
        }, 200);
    }

    function cleanup() {
        var ids = ['ws7-brand-donut-card', 'ws7-movers-card', 'ws7-price-gap-card'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
