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
    // 4. CURRENCY IMPACT DASHBOARD
    // ═══════════════════════════════════════════════════

    var _fxRate = null; // cached HKD/USD rate

    function _fetchFxRate(cb) {
        if (_fxRate) { cb(_fxRate); return; }
        fetch('/api/fx/rates')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(d) {
                if (d && d.rates && d.rates.USD_HKD) {
                    _fxRate = d.rates.USD_HKD.rate;
                } else if (d && d.rates && d.rates.HKD_USD) {
                    _fxRate = 1 / d.rates.HKD_USD.rate;
                } else {
                    // Fallback: use syncInfo
                    var si = (window.DATA && window.DATA.syncInfo) || {};
                    _fxRate = si.fx_hkd_per_usd || 7.78;
                }
                cb(_fxRate);
            })
            .catch(function() {
                var si = (window.DATA && window.DATA.syncInfo) || {};
                _fxRate = si.fx_hkd_per_usd || 7.78;
                cb(_fxRate);
            });
    }

    function renderCurrencyImpact() {
        _fetchFxRate(function(currentRate) {
            _renderCurrencyImpactWithRate(currentRate);
        });
    }

    function _renderCurrencyImpactWithRate(currentRate) {
        var arbs = (window.DATA && window.DATA.arbitrage) || [];
        if (!arbs.length || !currentRate) return;

        // Remove old card
        var old = document.getElementById('ws7-fx-impact-card');
        if (old) old.remove();

        // Calculate average arb profit and how HKD changes affect it
        // Most arbs are HK->US: buy in HKD, sell in USD
        // If HKD strengthens (rate drops, fewer HKD per USD), buying costs more in USD terms
        var hkToUsArbs = arbs.filter(function(a) { return a.direction === 'hk_to_us'; });
        if (!hkToUsArbs.length) hkToUsArbs = arbs;

        var avgBuy = 0, avgSell = 0, avgProfit = 0, avgFee = 0;
        hkToUsArbs.forEach(function(a) {
            avgBuy += (a.buy_price || a.hk_price || 0);
            avgSell += (a.sell_price || a.us_price || 0);
            avgProfit += (a.realistic_profit || a.profit || 0);
            avgFee += (a.import_fee || 0);
        });
        var n = hkToUsArbs.length;
        avgBuy /= n;
        avgSell /= n;
        avgProfit /= n;
        avgFee /= n;

        // Sensitivity: HKD change from -3% to +3%
        // "HKD strengthens X%" means rate decreases (fewer HKD per USD)
        // Buy price in USD = hk_price_hkd / rate
        // If rate was R and changes by pct: new rate = R * (1 - pct/100)
        // For HK->US arbs: buy in HK at hk_price (already USD-equiv), sell in US
        // The HK price in USD = (hk_price_in_hkd) / rate
        // Since existing buy_price is already in USD, we recalc:
        // original hk_price_hkd = buy_price_usd * currentRate
        // new buy_price_usd = hk_price_hkd / newRate
        var avgBuyHkd = avgBuy * currentRate;

        var steps = [-3, -2, -1, 0, 1, 2, 3];
        var sensData = steps.map(function(pct) {
            // HKD strengthens = rate drops (fewer HKD per USD)
            var newRate = currentRate * (1 - pct / 100);
            var newBuyUsd = avgBuyHkd / newRate;
            var newProfit = avgSell - newBuyUsd - avgFee;
            var profitChange = newProfit - avgProfit;
            var marginPct = avgSell > 0 ? (newProfit / avgSell * 100) : 0;
            return {
                pct: pct,
                rate: newRate,
                profit: newProfit,
                change: profitChange,
                margin: marginPct
            };
        });

        // Build sensitivity table HTML
        var tableHtml = '<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:0.72rem;">'
            + '<thead><tr style="border-bottom:1px solid var(--border);">'
            + '<th style="text-align:left;padding:6px 8px;color:var(--text-2);font-size:0.62rem;text-transform:uppercase;">HKD Change</th>'
            + '<th style="text-align:right;padding:6px 8px;color:var(--text-2);font-size:0.62rem;text-transform:uppercase;">Rate</th>'
            + '<th style="text-align:right;padding:6px 8px;color:var(--text-2);font-size:0.62rem;text-transform:uppercase;">Avg Profit</th>'
            + '<th style="text-align:right;padding:6px 8px;color:var(--text-2);font-size:0.62rem;text-transform:uppercase;">Impact</th>'
            + '<th style="text-align:right;padding:6px 8px;color:var(--text-2);font-size:0.62rem;text-transform:uppercase;">Margin</th>'
            + '</tr></thead><tbody>';

        sensData.forEach(function(s) {
            var isCurrent = s.pct === 0;
            var rowBg = isCurrent ? 'background:var(--accent-dim);' : '';
            var label = s.pct === 0 ? 'Current' : (s.pct > 0 ? '+' + s.pct + '% stronger' : Math.abs(s.pct) + '% weaker');
            var changeColor = s.change > 0 ? 'var(--green)' : s.change < 0 ? 'var(--red)' : 'var(--text-1)';
            var profitColor = s.profit > 0 ? 'var(--green)' : 'var(--red)';
            var changeSign = s.change > 0 ? '+$' : s.change < 0 ? '-$' : '$';
            var changeVal = Math.abs(Math.round(s.change)).toLocaleString();

            tableHtml += '<tr style="border-bottom:1px solid var(--border);' + rowBg + '">'
                + '<td style="padding:6px 8px;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-1)') + ';font-weight:' + (isCurrent ? '700' : '400') + ';">' + label + '</td>'
                + '<td style="padding:6px 8px;text-align:right;color:var(--text-1);">' + s.rate.toFixed(4) + '</td>'
                + '<td style="padding:6px 8px;text-align:right;color:' + profitColor + ';font-weight:600;">$' + Math.round(s.profit).toLocaleString() + '</td>'
                + '<td style="padding:6px 8px;text-align:right;color:' + changeColor + ';font-weight:600;">' + (isCurrent ? '--' : changeSign + changeVal) + '</td>'
                + '<td style="padding:6px 8px;text-align:right;color:' + profitColor + ';">' + s.margin.toFixed(1) + '%</td>'
                + '</tr>';
        });

        tableHtml += '</tbody></table>';

        // Canvas chart dimensions
        var chartH = 160;

        var card = document.createElement('div');
        card.id = 'ws7-fx-impact-card';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>Currency Impact</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">HKD/USD rate: ' + currentRate.toFixed(4) + ' | ' + n + ' arb opps</span></div>'
            + '<div style="padding:8px 12px;">'
            + '<div style="font-size:0.65rem;color:var(--text-2);margin-bottom:8px;">How HKD/USD rate changes affect average HK→US arbitrage profit</div>'
            + '<canvas id="ws7-fx-impact-canvas" style="display:block;width:100%;margin-bottom:12px;"></canvas>'
            + tableHtml
            + '</div>';

        // Insert in deals/arb section area
        var arbSection = document.getElementById('deals-arb-section');
        if (arbSection) {
            arbSection.appendChild(card);
        } else {
            // Fallback: after price gap chart or movers
            var insertAfter = document.getElementById('ws7-price-gap-card')
                || document.getElementById('ws7-movers-card')
                || document.getElementById('ws7-brand-donut-card');
            if (insertAfter) {
                insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
            }
        }

        // Draw line chart
        _drawFxImpactChart('ws7-fx-impact-canvas', sensData, chartH);
    }

    function _drawFxImpactChart(canvasId, data, height) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || !data.length) return;

        var containerW = canvas.parentElement ? canvas.parentElement.offsetWidth - 24 : 360;
        var width = Math.max(280, containerW);

        var dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var cs = getComputedStyle(document.documentElement);
        var textColor1 = cs.getPropertyValue('--text-1').trim() || '#a8a6a0';
        var textColor2 = cs.getPropertyValue('--text-2').trim() || '#5c5b57';
        var borderColor = cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.04)';
        var greenColor = cs.getPropertyValue('--green').trim() || '#00e676';
        var redColor = cs.getPropertyValue('--red').trim() || '#ff1744';
        var accentColor = cs.getPropertyValue('--accent').trim() || '#C9A84C';

        // Chart area
        var padL = 60, padR = 16, padT = 20, padB = 30;
        var cw = width - padL - padR;
        var ch = height - padT - padB;

        // Find min/max profit for Y scale
        var profits = data.map(function(d) { return d.profit; });
        var minP = Math.min.apply(null, profits);
        var maxP = Math.max.apply(null, profits);
        var range = maxP - minP || 1;
        minP -= range * 0.1;
        maxP += range * 0.1;
        range = maxP - minP;

        // Gridlines
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 0.5;
        for (var g = 0; g <= 4; g++) {
            var gy = padT + (g / 4) * ch;
            ctx.beginPath();
            ctx.moveTo(padL, gy);
            ctx.lineTo(padL + cw, gy);
            ctx.stroke();
            var gVal = maxP - (g / 4) * range;
            ctx.font = '500 9px "JetBrains Mono", monospace';
            ctx.fillStyle = textColor2;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('$' + Math.round(gVal).toLocaleString(), padL - 6, gy);
        }

        // X-axis labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '500 9px "JetBrains Mono", monospace';
        data.forEach(function(d, i) {
            var x = padL + (i / (data.length - 1)) * cw;
            var label = d.pct === 0 ? 'Now' : (d.pct > 0 ? '+' + d.pct + '%' : d.pct + '%');
            ctx.fillStyle = d.pct === 0 ? accentColor : textColor2;
            ctx.fillText(label, x, height - padB + 8);
        });

        // Draw line with gradient
        ctx.beginPath();
        data.forEach(function(d, i) {
            var x = padL + (i / (data.length - 1)) * cw;
            var y = padT + ((maxP - d.profit) / range) * ch;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Fill area under line
        var lastX = padL + cw;
        var lastY = padT + ((maxP - data[data.length - 1].profit) / range) * ch;
        ctx.lineTo(lastX, padT + ch);
        ctx.lineTo(padL, padT + ch);
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
        grad.addColorStop(0, 'rgba(201,168,76,0.18)');
        grad.addColorStop(1, 'rgba(201,168,76,0.02)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Draw dots
        data.forEach(function(d, i) {
            var x = padL + (i / (data.length - 1)) * cw;
            var y = padT + ((maxP - d.profit) / range) * ch;
            ctx.beginPath();
            ctx.arc(x, y, d.pct === 0 ? 5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = d.pct === 0 ? accentColor : (d.profit >= 0 ? greenColor : redColor);
            ctx.fill();
            if (d.pct === 0) {
                ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });

        // Zero profit line if it fits
        if (minP < 0 && maxP > 0) {
            var zeroY = padT + ((maxP - 0) / range) * ch;
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = redColor;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(padL, zeroY);
            ctx.lineTo(padL + cw, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = '500 8px "JetBrains Mono", monospace';
            ctx.fillStyle = redColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('Break-even', padL + 4, zeroY - 3);
        }

        // Title
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = textColor1;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Profit vs HKD Strength', padL, 4);
    }

    // ═══════════════════════════════════════════════════
    // 5. SEASONAL PRICE PATTERNS
    // ═══════════════════════════════════════════════════

    var _seasonalCache = null;

    /**
     * Fetch price history for top refs and compute monthly averages.
     * Uses /api/price_history_bulk which returns { ref: [b25 values] }
     * Also tries /api/price_history/<ref> for richer data with dates.
     */
    async function loadSeasonalData() {
        if (_seasonalCache) return _seasonalCache;

        try {
            var refs = (window.DATA && window.DATA.refs) || {};
            if (!Object.keys(refs).length) return null;

            // Pick top 10 refs by volume
            var topRefs = Object.entries(refs)
                .filter(function(e) { return e[1] && (e[1].count || 0) >= 5; })
                .sort(function(a, b) { return (b[1].count || 0) - (a[1].count || 0); })
                .slice(0, 10)
                .map(function(e) { return e[0]; });

            if (!topRefs.length) return null;

            var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

            // Fetch history for each ref in parallel
            var historyPromises = topRefs.map(function(ref) {
                return fetch('/api/price_history/' + encodeURIComponent(ref))
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(d) { return { ref: ref, history: d }; })
                    .catch(function() { return { ref: ref, history: null }; });
            });

            var histResults = await Promise.all(historyPromises);

            var results = [];
            histResults.forEach(function(item) {
                var history = item.history;
                var ref = item.ref;
                if (!history || !Array.isArray(history) || history.length < 2) return;

                // Group by month index (0-11)
                var monthBuckets = {};
                for (var m = 0; m < 12; m++) monthBuckets[m] = [];

                history.forEach(function(point) {
                    var val = point.b25 || point.value || point.median;
                    var dateStr = point.d || point.date;
                    if (!val || !dateStr) return;
                    var parts = dateStr.split('-');
                    if (parts.length < 2) return;
                    var monthIdx = parseInt(parts[1], 10) - 1;
                    if (monthIdx >= 0 && monthIdx < 12) {
                        monthBuckets[monthIdx].push(val);
                    }
                });

                // Compute monthly averages
                var monthlyAvgs = [];
                var yearlySum = 0;
                var yearlyCount = 0;

                for (var m = 0; m < 12; m++) {
                    var bucket = monthBuckets[m];
                    if (bucket.length > 0) {
                        var avg = bucket.reduce(function(s, v) { return s + v; }, 0) / bucket.length;
                        monthlyAvgs.push({ month: m, avg: avg, label: MONTH_NAMES[m], count: bucket.length });
                        yearlySum += avg;
                        yearlyCount++;
                    } else {
                        monthlyAvgs.push({ month: m, avg: null, label: MONTH_NAMES[m], count: 0 });
                    }
                }

                if (yearlyCount < 2) return;

                var yearlyMean = yearlySum / yearlyCount;

                // Compute pct deviation from yearly mean
                var withPct = monthlyAvgs.map(function(ma) {
                    if (ma.avg === null) return Object.assign({}, ma, { pct: null });
                    return Object.assign({}, ma, { pct: ((ma.avg - yearlyMean) / yearlyMean) * 100 });
                });

                // Best month to buy (lowest avg), best month to sell (highest avg)
                var populated = withPct.filter(function(m) { return m.avg !== null; });
                if (!populated.length) return;
                var bestBuy = populated.reduce(function(best, m) { return m.avg < best.avg ? m : best; }, populated[0]);
                var bestSell = populated.reduce(function(best, m) { return m.avg > best.avg ? m : best; }, populated[0]);

                var refInfo = refs[ref] || {};
                results.push({
                    ref: ref,
                    model: refInfo.model || '',
                    months: withPct,
                    yearlyMean: yearlyMean,
                    bestBuy: bestBuy,
                    bestSell: bestSell,
                    dataMonths: yearlyCount
                });
            });

            _seasonalCache = results;
            return results;

        } catch (e) {
            console.warn('[' + MOD_ID + '] Failed to load seasonal data:', e);
            return null;
        }
    }

    function renderSeasonalCard() {
        var old = document.getElementById('ws7-seasonal-card');
        if (old) old.remove();

        loadSeasonalData().then(function(data) {
            if (!data || !data.length) return;

            var fmt = window.MKModules.formatPrice;
            var now = new Date();
            var currentMonth = now.getMonth(); // 0-11

            // Build insights
            var insightsHtml = data.map(function(d) {
                var buyPct = d.bestBuy.pct !== null ? Math.abs(d.bestBuy.pct).toFixed(1) : '?';
                var sellPct = d.bestSell.pct !== null ? Math.abs(d.bestSell.pct).toFixed(1) : '?';
                return '<div style="padding:6px 0;border-bottom:1px solid var(--border);">'
                    + '<div style="font-weight:600;font-family:var(--mono);font-size:0.78rem;color:var(--accent);">' + d.ref
                    + '<span style="font-weight:400;color:var(--text-2);margin-left:6px;font-size:0.68rem;">' + d.model + '</span>'
                    + '<span style="font-weight:400;color:var(--text-3);margin-left:6px;font-size:0.62rem;">(' + d.dataMonths + ' mo data)</span></div>'
                    + '<div style="display:flex;gap:12px;margin-top:3px;font-size:0.72rem;">'
                    + '<span style="color:var(--green);">Buy: ' + d.bestBuy.label + ' (' + buyPct + '% below mean)</span>'
                    + '<span style="color:var(--red);">Sell: ' + d.bestSell.label + ' (' + sellPct + '% above mean)</span>'
                    + '</div></div>';
            }).join('');

            // Build mini bar chart for each ref showing monthly deviation
            var chartHtml = '';
            data.forEach(function(d) {
                var bars = d.months.map(function(m) {
                    var isCurrent = m.month === currentMonth;
                    var borderStyle = isCurrent ? 'border:2px solid var(--accent);' : '';
                    if (m.avg === null) {
                        return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:0;">'
                            + '<div style="height:40px;display:flex;align-items:flex-end;justify-content:center;width:100%;">'
                            + '<div style="width:80%;height:2px;background:var(--border);border-radius:1px;' + borderStyle + '"></div></div>'
                            + '<span style="font-size:0.5rem;color:var(--text-3);">' + m.label.charAt(0) + '</span></div>';
                    }

                    var pct = m.pct || 0;
                    var maxBarH = 36;
                    var barH = Math.min(maxBarH, Math.max(3, Math.abs(pct) / 3 * maxBarH));
                    var color = pct >= 0 ? 'var(--green)' : 'var(--red)';
                    var opacity = isCurrent ? '1' : '0.7';

                    return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:0;">'
                        + '<div style="height:40px;display:flex;align-items:' + (pct >= 0 ? 'flex-end' : 'flex-start') + ';justify-content:center;width:100%;">'
                        + '<div style="width:80%;height:' + barH + 'px;background:' + color + ';border-radius:2px;opacity:' + opacity + ';' + borderStyle + '" title="' + m.label + ': ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%"></div></div>'
                        + '<span style="font-size:0.5rem;color:' + (isCurrent ? 'var(--accent)' : 'var(--text-3)') + ';font-weight:' + (isCurrent ? '700' : '400') + ';">' + m.label.charAt(0) + '</span></div>';
                }).join('');

                chartHtml += '<div style="margin-bottom:10px;">'
                    + '<div style="font-family:var(--mono);font-size:0.7rem;font-weight:600;color:var(--text-0);margin-bottom:4px;">' + d.ref + '</div>'
                    + '<div style="display:flex;gap:1px;align-items:center;">' + bars + '</div></div>';
            });

            var card = document.createElement('div');
            card.id = 'ws7-seasonal-card';
            card.className = 'card';
            card.style.marginTop = '16px';
            card.innerHTML = '<div class="card-head"><span>Seasonal Price Patterns</span>'
                + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">Top ' + data.length + ' refs by volume</span></div>'
                + '<div style="padding:10px 14px;">'
                + '<div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--accent);font-weight:600;margin-bottom:8px;">Monthly Price vs Yearly Mean</div>'
                + '<div style="margin-bottom:16px;">' + chartHtml + '</div>'
                + '<div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-2);font-weight:600;margin-bottom:6px;">Buy / Sell Insights</div>'
                + insightsHtml
                + '</div>';

            // Inject on lookup page after lookup-market-summary
            var target = document.getElementById('lookup-market-summary');
            if (target) {
                target.parentNode.insertBefore(card, target.nextSibling);
                return;
            }

            // Fallback: inject on dashboard after other ws7 cards
            var fallback = document.getElementById('ws7-fx-impact-card')
                || document.getElementById('ws7-price-gap-card')
                || document.getElementById('ws7-movers-card')
                || document.getElementById('ws7-brand-donut-card');
            if (fallback) {
                fallback.parentNode.insertBefore(card, fallback.nextSibling);
            }
        });
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
            _seasonalCache = null; // bust cache on data reload
            render();
        });

        // Hook into showPage to render seasonal card on lookup page
        var origShowPage = window.showPage;
        if (origShowPage && !origShowPage._ws7Hooked) {
            window.showPage = function() {
                origShowPage.apply(this, arguments);
                var pageName = arguments[0];
                if (pageName === 'lookup') {
                    setTimeout(function() { renderSeasonalCard(); }, 600);
                }
            };
            window.showPage._ws7Hooked = true;
        }
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
        // Dashboard page widgets
        var dashPage = document.getElementById('page-dashboard');
        if (dashPage) {
            setTimeout(function() {
                renderBrandDonut();
                renderTopMovers();
                renderPriceGapChart();
                renderCurrencyImpact();
            }, 200);
        }

        // Seasonal card on lookup page
        var lookupPage = document.getElementById('page-lookup');
        if (lookupPage && lookupPage.offsetParent !== null) {
            setTimeout(function() { renderSeasonalCard(); }, 400);
        }
    }

    function cleanup() {
        var ids = ['ws7-brand-donut-card', 'ws7-movers-card', 'ws7-price-gap-card', 'ws7-fx-impact-card', 'ws7-seasonal-card'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });
        _seasonalCache = null;
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
