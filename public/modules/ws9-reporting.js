/**
 * MK Opulence — ws9-reporting
 * Financial reporting: Weekly P&L card on overview, Profit-by-ref on portfolio.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws9-reporting', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws9-reporting';
    const MK = window.MKModules;
    const DEFAULT_BUDGET = 200000;

    let _inventoryCache = null;
    let _initialized = false;

    // ── Helpers ──

    function parseNum(v) {
        const n = parseFloat(String(v || '0').replace(/[$,]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function fmt(n) {
        return '$' + Math.round(Math.abs(n)).toLocaleString();
    }

    function fmtSigned(n) {
        if (n >= 0) return '+$' + Math.round(n).toLocaleString();
        return '-$' + Math.round(Math.abs(n)).toLocaleString();
    }

    function isWithinDays(dateStr, days) {
        if (!dateStr) return false;
        const d = new Date(dateStr + 'T00:00:00');
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        cutoff.setHours(0, 0, 0, 0);
        return d >= cutoff;
    }

    // ── Data Fetching ──

    async function fetchInventory() {
        if (_inventoryCache) return _inventoryCache;
        try {
            const r = await fetch('/api/inventory/rows');
            const d = await r.json();
            if (d.ok) _inventoryCache = d.rows || [];
            else _inventoryCache = [];
        } catch (e) {
            console.error('[' + MOD_ID + '] fetch error:', e);
            _inventoryCache = [];
        }
        return _inventoryCache;
    }

    // ── Weekly P&L Card (Overview Page) ──

    function injectWeeklyPnlCard(items) {
        const anchor = document.getElementById('metrics-grid');
        if (!anchor) return;

        // Remove old card if re-rendering
        const old = document.getElementById('ws9-weekly-pnl');
        if (old) old.remove();

        // Compute metrics
        const soldThisWeek = items.filter(r =>
            r.sold === 'Yes' && isWithinDays(r.sale_date, 7) && parseNum(r.cost_price) > 0
        );
        const realizedPnl = soldThisWeek.reduce((s, r) =>
            s + (parseNum(r.sold_price) - parseNum(r.cost_price)), 0);
        const soldCount = soldThisWeek.length;

        const unsold = items.filter(r => r.sold !== 'Yes');
        const capitalDeployed = unsold.reduce((s, r) => s + parseNum(r.cost_price), 0);
        const capitalAvailable = Math.max(0, DEFAULT_BUDGET - capitalDeployed);

        const pnlColor = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';

        const card = document.createElement('div');
        card.id = 'ws9-weekly-pnl';
        card.className = 'card';
        card.style.cssText = 'margin-top:8px;margin-bottom:8px;';
        card.innerHTML = `
            <div class="card-head"><span>Weekly P&L</span><span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">Last 7 days</span></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;padding:10px;">
                <div style="background:var(--card-2);border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em;">Realized P&L</div>
                    <div style="font-size:1.1rem;font-weight:700;color:${pnlColor};margin-top:4px;font-family:var(--mono);">${fmtSigned(realizedPnl)}</div>
                </div>
                <div style="background:var(--card-2);border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em;">Sold</div>
                    <div style="font-size:1.1rem;font-weight:700;color:var(--text-0);margin-top:4px;font-family:var(--mono);">${soldCount}</div>
                </div>
                <div style="background:var(--card-2);border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em;">Capital Deployed</div>
                    <div style="font-size:1.1rem;font-weight:700;color:var(--accent);margin-top:4px;font-family:var(--mono);">${fmt(capitalDeployed)}</div>
                </div>
                <div style="background:var(--card-2);border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em;">Available</div>
                    <div style="font-size:1.1rem;font-weight:700;color:var(--text-1);margin-top:4px;font-family:var(--mono);">${fmt(capitalAvailable)}</div>
                </div>
            </div>
        `;

        // Insert after metrics-grid
        anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }

    // ── Profit by Ref (Portfolio Page) ──

    function injectProfitByRef(items) {
        const tabsEl = document.getElementById('portfolio-tabs');
        if (!tabsEl) return;

        // Add tab if not present
        if (!document.getElementById('ws9-pf-tab')) {
            const tab = document.createElement('div');
            tab.className = 'tab';
            tab.id = 'ws9-pf-tab';
            tab.textContent = 'Profit/Ref';
            tab.onclick = function() {
                // Deactivate all portfolio tabs
                tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderProfitByRefContent(items);
            };
            tabsEl.appendChild(tab);
        }

        // If this tab is active, render it
        const tab = document.getElementById('ws9-pf-tab');
        if (tab && tab.classList.contains('active')) {
            renderProfitByRefContent(items);
        }
    }

    function renderProfitByRefContent(items) {
        const container = document.getElementById('portfolio-content');
        if (!container) return;

        // Group sold watches by ref
        const byRef = {};
        items.forEach(r => {
            if (r.sold !== 'Yes') return;
            const cost = parseNum(r.cost_price);
            const sold = parseNum(r.sold_price);
            if (cost <= 0 || sold <= 0) return;
            const ref = (r.description || '').match(/\b(1[12]\d{4}[A-Z]*)\b/)?.[1] || r.ref || 'Unknown';
            if (!byRef[ref]) byRef[ref] = { profit: 0, count: 0, totalCost: 0, totalSold: 0 };
            byRef[ref].profit += (sold - cost);
            byRef[ref].count += 1;
            byRef[ref].totalCost += cost;
            byRef[ref].totalSold += sold;
        });

        // Sort by total profit descending, take top 10
        const sorted = Object.entries(byRef)
            .map(([ref, d]) => ({
                ref,
                profit: d.profit,
                count: d.count,
                margin: d.totalCost > 0 ? ((d.totalSold - d.totalCost) / d.totalCost * 100) : 0,
                avgProfit: d.count > 0 ? d.profit / d.count : 0
            }))
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 10);

        if (sorted.length === 0) {
            container.innerHTML = '<p style="color:var(--text-2);padding:20px 0;">No sold watches with profit data yet.</p>';
            return;
        }

        // Find max profit for bar width scaling
        const maxProfit = Math.max(...sorted.map(d => Math.abs(d.profit)), 1);

        let html = `
            <div class="card" style="margin-top:8px;">
                <div class="card-head"><span>Top 10 Most Profitable References</span></div>
                <div class="tbl-wrap">
                    <table class="tbl">
                        <thead><tr>
                            <th>Ref</th>
                            <th class="right">Total Profit</th>
                            <th class="right">Avg Margin</th>
                            <th class="right">Count</th>
                            <th class="right">Avg Profit</th>
                            <th style="min-width:100px;"></th>
                        </tr></thead>
                        <tbody>
        `;

        sorted.forEach(d => {
            const pColor = d.profit >= 0 ? 'var(--green)' : 'var(--red)';
            const barW = Math.round(Math.abs(d.profit) / maxProfit * 100);
            const barColor = d.profit >= 0 ? 'rgba(48,209,88,0.25)' : 'rgba(255,59,48,0.25)';
            html += `<tr>
                <td class="ref" style="font-weight:600;cursor:pointer;" onclick="lookupRef('${d.ref}')">${d.ref}</td>
                <td class="right" style="font-weight:700;color:${pColor};font-family:var(--mono);">${fmtSigned(d.profit)}</td>
                <td class="right" style="font-family:var(--mono);">${d.margin.toFixed(1)}%</td>
                <td class="right">${d.count}</td>
                <td class="right" style="font-family:var(--mono);color:${pColor};">${fmtSigned(d.avgProfit)}</td>
                <td><div style="background:${barColor};height:14px;border-radius:3px;width:${barW}%;min-width:2px;"></div></td>
            </tr>`;
        });

        html += '</tbody></table></div></div>';
        container.innerHTML = html;
    }

    // ── Profit by Channel (Portfolio Page) ──

    function classifyChannel(boughtFrom) {
        if (!boughtFrom) return 'Unknown';
        var src = boughtFrom.trim();
        var lower = src.toLowerCase();

        // Known WhatsApp group patterns
        if (lower.includes('whatsapp') || lower.includes('wa ') || lower.includes('wa:')) {
            var match = src.match(/(?:whatsapp|wa)[:\s]+(.+)/i);
            return match ? 'WA: ' + match[1].trim() : 'WhatsApp';
        }

        // Common channel keywords
        if (lower.includes('chrono24') || lower.includes('c24')) return 'Chrono24';
        if (lower.includes('ebay')) return 'eBay';
        if (lower.includes('instagram') || lower.includes('ig ') || lower.includes('ig:')) return 'Instagram';
        if (lower.includes('store') || lower.includes('boutique') || lower.includes('ad ') || lower.includes('authorized')) return 'Store/AD';
        if (lower.includes('auction') || lower.includes('phillips') || lower.includes("christie") || lower.includes("sotheby")) return 'Auction';

        // Use seller name as-is for direct deals (short strings)
        if (src.length <= 30 && !lower.includes('@') && !lower.includes('http') && !lower.includes('.com')) {
            return src;
        }

        return src.length > 40 ? src.substring(0, 37) + '...' : src;
    }

    function injectProfitByChannel(items) {
        var tabsEl = document.getElementById('portfolio-tabs');
        if (!tabsEl) return;

        if (!document.getElementById('ws9-channel-tab')) {
            var tab = document.createElement('div');
            tab.className = 'tab';
            tab.id = 'ws9-channel-tab';
            tab.textContent = 'By Channel';
            tab.onclick = function() {
                tabsEl.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
                tab.classList.add('active');
                renderChannelContent(items);
            };
            tabsEl.appendChild(tab);
        }

        var tabEl = document.getElementById('ws9-channel-tab');
        if (tabEl && tabEl.classList.contains('active')) {
            renderChannelContent(items);
        }
    }

    function renderChannelContent(items) {
        var container = document.getElementById('portfolio-content');
        if (!container) return;

        // Group sold watches by source channel
        var byChannel = {};
        items.forEach(function(r) {
            if (r.sold !== 'Yes') return;
            var cost = parseNum(r.cost_price);
            var sold = parseNum(r.sold_price);
            if (cost <= 0 || sold <= 0) return;

            var channel = classifyChannel(r.bought_from || r.seller || '');
            if (!byChannel[channel]) {
                byChannel[channel] = { count: 0, totalCost: 0, totalRevenue: 0, totalProfit: 0 };
            }
            byChannel[channel].count += 1;
            byChannel[channel].totalCost += cost;
            byChannel[channel].totalRevenue += sold;
            byChannel[channel].totalProfit += (sold - cost);
        });

        // Sort by total profit descending
        var sorted = Object.entries(byChannel)
            .map(function(entry) {
                var ch = entry[0], d = entry[1];
                return {
                    channel: ch,
                    count: d.count,
                    totalCost: d.totalCost,
                    totalRevenue: d.totalRevenue,
                    totalProfit: d.totalProfit,
                    avgMargin: d.totalCost > 0 ? ((d.totalRevenue - d.totalCost) / d.totalCost * 100) : 0
                };
            })
            .sort(function(a, b) { return b.totalProfit - a.totalProfit; });

        if (sorted.length === 0) {
            container.innerHTML = '<p style="color:var(--text-2);padding:20px 0;">No sold watches with channel data yet.</p>';
            return;
        }

        var maxProfit = Math.max.apply(null, sorted.map(function(d) { return Math.abs(d.totalProfit); }).concat([1]));

        // Build content
        var html = '<div class="fade-in">'
            + '<div class="card" style="margin-top:8px;">'
            + '<div class="card-head"><span>Profit by Source Channel</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + sorted.length + ' channels</span></div>'
            + '<div style="padding:8px 12px;">'
            + '<canvas id="ws9-channel-bars" style="display:block;width:100%;margin-bottom:12px;"></canvas>'
            + '</div>'
            + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
            + '<th>Channel</th>'
            + '<th class="right">Watches</th>'
            + '<th class="right">Total Cost</th>'
            + '<th class="right">Revenue</th>'
            + '<th class="right">Profit</th>'
            + '<th class="right">Avg Margin</th>'
            + '<th style="min-width:80px;"></th>'
            + '</tr></thead><tbody>';

        sorted.forEach(function(d) {
            var pColor = d.totalProfit >= 0 ? 'var(--green)' : 'var(--red)';
            var barW = Math.round(Math.abs(d.totalProfit) / maxProfit * 100);
            var barColor = d.totalProfit >= 0 ? 'rgba(48,209,88,0.25)' : 'rgba(255,59,48,0.25)';
            var marginColor = d.avgMargin >= 0 ? 'var(--green)' : 'var(--red)';

            html += '<tr>'
                + '<td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + d.channel.replace(/"/g, '&quot;') + '">' + d.channel + '</td>'
                + '<td class="right">' + d.count + '</td>'
                + '<td class="right" style="font-family:var(--mono);">' + fmt(d.totalCost) + '</td>'
                + '<td class="right" style="font-family:var(--mono);">' + fmt(d.totalRevenue) + '</td>'
                + '<td class="right" style="font-family:var(--mono);font-weight:700;color:' + pColor + ';">' + fmtSigned(d.totalProfit) + '</td>'
                + '<td class="right" style="font-family:var(--mono);color:' + marginColor + ';">' + d.avgMargin.toFixed(1) + '%</td>'
                + '<td><div style="background:' + barColor + ';height:14px;border-radius:3px;width:' + barW + '%;min-width:2px;"></div></td>'
                + '</tr>';
        });

        html += '</tbody></table></div></div></div>';
        container.innerHTML = html;

        // Draw horizontal bar chart
        setTimeout(function() {
            _drawChannelBars('ws9-channel-bars', sorted);
        }, 50);
    }

    function _drawChannelBars(canvasId, data) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || !data.length) return;

        var chartData = data.slice(0, 15);
        var barH = 22;
        var gap = 6;
        var labelW = 120;
        var padL = labelW + 10;
        var padR = 60;
        var padT = 10;
        var height = chartData.length * (barH + gap) + padT + 10;

        var containerW = canvas.parentElement ? canvas.parentElement.offsetWidth - 8 : 360;
        var width = Math.max(280, containerW);

        var dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var cs = getComputedStyle(document.documentElement);
        var textColor0 = cs.getPropertyValue('--text-0').trim() || '#ececea';
        var greenRgba = 'rgba(48,209,88,0.7)';
        var redRgba = 'rgba(255,59,48,0.7)';

        var chartW = width - padL - padR;
        var maxVal = Math.max.apply(null, chartData.map(function(d) { return Math.abs(d.totalProfit); }).concat([1]));

        chartData.forEach(function(d, i) {
            var y = padT + i * (barH + gap);

            // Channel label
            ctx.font = '500 10px "JetBrains Mono", monospace';
            ctx.fillStyle = textColor0;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            var label = d.channel.length > 16 ? d.channel.substring(0, 14) + '..' : d.channel;
            ctx.fillText(label, labelW, y + barH / 2);

            // Bar
            var barW = Math.max(2, (Math.abs(d.totalProfit) / maxVal) * chartW);
            ctx.fillStyle = d.totalProfit >= 0 ? greenRgba : redRgba;
            ctx.beginPath();
            _channelRoundRect(ctx, padL, y, barW, barH, 3);
            ctx.fill();

            // Value label
            ctx.font = '600 9px "JetBrains Mono", monospace';
            ctx.fillStyle = textColor0;
            ctx.textAlign = 'left';
            var valLabel = (d.totalProfit >= 0 ? '+$' : '-$') + Math.round(Math.abs(d.totalProfit)).toLocaleString();
            if (barW > 70) {
                ctx.fillText(valLabel, padL + barW - ctx.measureText(valLabel).width - 6, y + barH / 2);
            } else {
                ctx.fillText(valLabel, padL + barW + 6, y + barH / 2);
            }
        });
    }

    function _channelRoundRect(ctx, x, y, w, h, r) {
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

    // ── Tax Export CSV (Portfolio Page) ──

    function injectTaxExportTab(items) {
        const tabsEl = document.getElementById('portfolio-tabs');
        if (!tabsEl) return;

        if (!document.getElementById('ws9-tax-tab')) {
            const tab = document.createElement('div');
            tab.className = 'tab';
            tab.id = 'ws9-tax-tab';
            tab.textContent = 'Tax CSV';
            tab.onclick = function() {
                tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderTaxExportContent(items);
            };
            tabsEl.appendChild(tab);
        }

        const tab = document.getElementById('ws9-tax-tab');
        if (tab && tab.classList.contains('active')) {
            renderTaxExportContent(items);
        }
    }

    function renderTaxExportContent(items) {
        const container = document.getElementById('portfolio-content');
        if (!container) return;

        const sold = items.filter(r => r.sold === 'Yes' || r.sold === 1 || r.sold === true);
        const currentYear = new Date().getFullYear();

        // Build year options from available data
        const years = new Set();
        sold.forEach(r => {
            if (r.sale_date) {
                const y = new Date(r.sale_date + 'T00:00:00').getFullYear();
                if (!isNaN(y)) years.add(y);
            }
        });
        if (years.size === 0) years.add(currentYear);
        const sortedYears = Array.from(years).sort((a, b) => b - a);

        let html = `
            <div class="card" style="margin-top:8px;">
                <div class="card-head"><span>Tax Export</span></div>
                <div class="card-body" style="padding:16px;">
                    <p style="color:var(--text-1);margin-bottom:12px;">Export sold watch data as CSV for tax reporting. Includes cost basis, sale price, and holding period.</p>
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        <label style="color:var(--text-2);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;">Year</label>
                        <select id="ws9-tax-year" style="background:var(--card-2);color:var(--text-0);border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:0.85rem;">
                            ${sortedYears.map(y => '<option value="' + y + '"' + (y === currentYear ? ' selected' : '') + '>' + y + '</option>').join('')}
                        </select>
                        <button id="ws9-tax-export-btn" style="background:var(--green, #00e676);color:var(--bg-0, #0d0d12);border:none;border-radius:8px;padding:10px 20px;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;transition:opacity 0.15s;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download Tax CSV
                        </button>
                    </div>
                    <div id="ws9-tax-preview" style="margin-top:16px;"></div>
                </div>
            </div>
        `;
        container.innerHTML = html;

        // Wire up the export button
        document.getElementById('ws9-tax-export-btn').addEventListener('click', function() {
            const year = parseInt(document.getElementById('ws9-tax-year').value);
            exportTaxCSV(items, year);
        });

        // Show preview for selected year
        const yearSelect = document.getElementById('ws9-tax-year');
        yearSelect.addEventListener('change', function() {
            renderTaxPreview(items, parseInt(yearSelect.value));
        });
        renderTaxPreview(items, parseInt(yearSelect.value));
    }

    function renderTaxPreview(items, year) {
        const preview = document.getElementById('ws9-tax-preview');
        if (!preview) return;

        const sold = getSoldForYear(items, year);
        if (sold.length === 0) {
            preview.innerHTML = '<p style="color:var(--text-2);">No sold watches found for ' + year + '.</p>';
            return;
        }

        const totals = sold.reduce((acc, r) => {
            acc.cost += r._cost;
            acc.revenue += r._sold;
            acc.profit += r._profit;
            return acc;
        }, { cost: 0, revenue: 0, profit: 0 });

        const profitColor = totals.profit >= 0 ? 'var(--green)' : 'var(--red)';
        preview.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;">
                <div style="background:var(--card-2);border-radius:8px;padding:10px;">
                    <div style="font-size:0.6rem;color:var(--text-2);text-transform:uppercase;">Watches Sold</div>
                    <div style="font-size:1.1rem;font-weight:700;color:var(--text-0);margin-top:4px;">${sold.length}</div>
                </div>
                <div style="background:var(--card-2);border-radius:8px;padding:10px;">
                    <div style="font-size:0.6rem;color:var(--text-2);text-transform:uppercase;">Total Cost</div>
                    <div style="font-size:1.1rem;font-weight:700;color:var(--text-1);margin-top:4px;font-family:var(--mono);">${fmt(totals.cost)}</div>
                </div>
                <div style="background:var(--card-2);border-radius:8px;padding:10px;">
                    <div style="font-size:0.6rem;color:var(--text-2);text-transform:uppercase;">Total Revenue</div>
                    <div style="font-size:1.1rem;font-weight:700;color:var(--accent);margin-top:4px;font-family:var(--mono);">${fmt(totals.revenue)}</div>
                </div>
                <div style="background:var(--card-2);border-radius:8px;padding:10px;">
                    <div style="font-size:0.6rem;color:var(--text-2);text-transform:uppercase;">Net P&L</div>
                    <div style="font-size:1.1rem;font-weight:700;color:${profitColor};margin-top:4px;font-family:var(--mono);">${fmtSigned(totals.profit)}</div>
                </div>
            </div>
        `;
    }

    function getSoldForYear(items, year) {
        return items
            .filter(r => {
                if (r.sold !== 'Yes' && r.sold !== 1 && r.sold !== true) return false;
                if (!r.sale_date) return false;
                const d = new Date(r.sale_date + 'T00:00:00');
                return d.getFullYear() === year;
            })
            .map(r => {
                const cost = parseNum(r.cost_price);
                const soldPrice = parseNum(r.sold_price);
                const profit = soldPrice - cost;
                const buyDate = r.buy_date ? new Date(r.buy_date + 'T00:00:00') : null;
                const saleDate = new Date(r.sale_date + 'T00:00:00');
                const holdingDays = buyDate ? Math.round((saleDate - buyDate) / 86400000) : '';
                const ref = (r.description || '').match(/\b(1[12]\d{4}[A-Z]*)\b/)?.[1] || r.ref || '';
                return {
                    sale_date: r.sale_date,
                    description: (r.description || '').replace(/"/g, '""'),
                    ref: ref,
                    serial: r.serial || '',
                    _cost: cost,
                    _sold: soldPrice,
                    _profit: profit,
                    _holdingDays: holdingDays
                };
            })
            .sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''));
    }

    function exportTaxCSV(items, year) {
        const sold = getSoldForYear(items, year);
        if (sold.length === 0) {
            if (typeof showToast === 'function') showToast('No sold watches for ' + year, 'warning');
            return;
        }

        const rows = [['Date Sold', 'Description', 'Reference', 'Serial', 'Cost Basis', 'Sale Price', 'Profit/Loss', 'Holding Period (days)']];
        let totalCost = 0, totalRevenue = 0, totalPnl = 0;

        sold.forEach(r => {
            totalCost += r._cost;
            totalRevenue += r._sold;
            totalPnl += r._profit;
            rows.push([
                r.sale_date,
                '"' + r.description + '"',
                r.ref,
                r.serial,
                r._cost.toFixed(2),
                r._sold.toFixed(2),
                r._profit.toFixed(2),
                r._holdingDays
            ]);
        });

        // Summary row
        rows.push([]);
        rows.push(['TOTALS', '', '', '', totalCost.toFixed(2), totalRevenue.toFixed(2), totalPnl.toFixed(2), '']);

        const csv = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mk_opulence_tax_' + year + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof showToast === 'function') showToast('Exported ' + sold.length + ' records for ' + year, 'success');
    }

    // ── Monthly P&L Summary (Portfolio Page) ──

    function injectMonthlyPnlTab(items) {
        const tabsEl = document.getElementById('portfolio-tabs');
        if (!tabsEl) return;

        if (!document.getElementById('ws9-monthly-tab')) {
            const tab = document.createElement('div');
            tab.className = 'tab';
            tab.id = 'ws9-monthly-tab';
            tab.textContent = 'Monthly P&L';
            tab.onclick = function() {
                tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderMonthlyPnlContent(items);
            };
            tabsEl.appendChild(tab);
        }

        const tab = document.getElementById('ws9-monthly-tab');
        if (tab && tab.classList.contains('active')) {
            renderMonthlyPnlContent(items);
        }
    }

    function getMonthlyData(items) {
        const byMonth = {};
        items.forEach(r => {
            if (r.sold !== 'Yes' && r.sold !== 1 && r.sold !== true) return;
            if (!r.sale_date) return;
            const cost = parseNum(r.cost_price);
            const soldPrice = parseNum(r.sold_price);
            if (cost <= 0 || soldPrice <= 0) return;
            const d = new Date(r.sale_date + 'T00:00:00');
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            if (!byMonth[key]) byMonth[key] = { revenue: 0, cost: 0, profit: 0, count: 0 };
            byMonth[key].revenue += soldPrice;
            byMonth[key].cost += cost;
            byMonth[key].profit += (soldPrice - cost);
            byMonth[key].count += 1;
        });

        // Generate last 12 months
        const now = new Date();
        const months = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
            const data = byMonth[key] || { revenue: 0, cost: 0, profit: 0, count: 0 };
            const margin = data.revenue > 0 ? ((data.profit / data.revenue) * 100) : 0;
            months.push({ key, label, ...data, margin, isCurrent: i === 0 });
        }
        return months;
    }

    function renderMonthlyPnlContent(items) {
        const container = document.getElementById('portfolio-content');
        if (!container) return;

        const months = getMonthlyData(items);

        // Table
        let html = `
            <div class="card" style="margin-top:8px;">
                <div class="card-head"><span>Monthly P&L Summary</span><span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">Last 12 months</span></div>
                <div class="tbl-wrap">
                    <table class="tbl">
                        <thead><tr>
                            <th>Month</th>
                            <th class="right"># Sold</th>
                            <th class="right">Revenue</th>
                            <th class="right">Cost</th>
                            <th class="right">Profit</th>
                            <th class="right">Avg Margin</th>
                        </tr></thead>
                        <tbody>
        `;

        months.forEach(m => {
            const pColor = m.profit >= 0 ? 'var(--green)' : (m.profit < 0 ? 'var(--red)' : 'var(--text-2)');
            const rowStyle = m.isCurrent ? 'background:rgba(0,122,255,0.08);' : '';
            const currentBadge = m.isCurrent ? ' <span style="font-size:0.55rem;background:var(--accent);color:#fff;padding:1px 5px;border-radius:3px;vertical-align:middle;margin-left:4px;">NOW</span>' : '';
            html += `<tr style="${rowStyle}">
                <td style="font-weight:600;">${m.label}${currentBadge}</td>
                <td class="right">${m.count}</td>
                <td class="right" style="font-family:var(--mono);">${m.revenue > 0 ? fmt(m.revenue) : '-'}</td>
                <td class="right" style="font-family:var(--mono);">${m.cost > 0 ? fmt(m.cost) : '-'}</td>
                <td class="right" style="font-weight:700;color:${pColor};font-family:var(--mono);">${m.count > 0 ? fmtSigned(m.profit) : '-'}</td>
                <td class="right" style="font-family:var(--mono);">${m.count > 0 ? m.margin.toFixed(1) + '%' : '-'}</td>
            </tr>`;
        });

        html += '</tbody></table></div></div>';

        // Bar chart card
        html += `
            <div class="card" style="margin-top:8px;">
                <div class="card-head"><span>Monthly Profit Trend</span></div>
                <div class="card-body" style="padding:12px;">
                    <canvas id="ws9-monthly-chart" width="600" height="220" style="width:100%;max-height:220px;"></canvas>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Draw the bar chart
        requestAnimationFrame(function() { drawMonthlyChart(months); });
    }

    function drawMonthlyChart(months) {
        const canvas = document.getElementById('ws9-monthly-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        const W = rect.width;
        const H = rect.height;

        // Reverse so oldest is on left
        const data = months.slice().reverse();
        const values = data.map(d => d.profit);
        const maxVal = Math.max(...values.map(v => Math.abs(v)), 1);

        const padding = { top: 20, bottom: 40, left: 10, right: 10 };
        const chartW = W - padding.left - padding.right;
        const chartH = H - padding.top - padding.bottom;
        const barW = Math.max(chartW / data.length * 0.7, 12);
        const gap = (chartW - barW * data.length) / (data.length + 1);
        const zeroY = padding.top + chartH / 2;

        // Zero line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, zeroY);
        ctx.lineTo(W - padding.right, zeroY);
        ctx.stroke();

        // Bars
        data.forEach(function(m, i) {
            const x = padding.left + gap + i * (barW + gap);
            const barH = (Math.abs(m.profit) / maxVal) * (chartH / 2);
            const y = m.profit >= 0 ? zeroY - barH : zeroY;

            ctx.fillStyle = m.profit >= 0 ? 'rgba(48,209,88,0.7)' : 'rgba(255,59,48,0.7)';
            ctx.beginPath();
            const r = Math.min(3, barW / 2);
            if (m.profit >= 0) {
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + barW, y, x + barW, y + barH, r);
                ctx.arcTo(x + barW, y + barH, x, y + barH, 0);
                ctx.arcTo(x, y + barH, x, y, 0);
                ctx.arcTo(x, y, x + barW, y, r);
            } else {
                ctx.moveTo(x, y);
                ctx.arcTo(x + barW, y, x + barW, y + barH, 0);
                ctx.arcTo(x + barW, y + barH, x, y + barH, r);
                ctx.arcTo(x, y + barH, x, y, r);
                ctx.arcTo(x, y, x + barW, y, 0);
            }
            ctx.fill();

            // Month label below
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '9px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const shortLabel = m.label.split(' ')[0].substring(0, 3);
            ctx.fillText(shortLabel, x + barW / 2, H - padding.bottom + 14);

            // Value label on bar
            if (m.count > 0) {
                ctx.fillStyle = m.profit >= 0 ? 'rgba(48,209,88,0.9)' : 'rgba(255,59,48,0.9)';
                ctx.font = 'bold 8px -apple-system, sans-serif';
                const valLabel = (m.profit >= 0 ? '+' : '-') + '$' + Math.round(Math.abs(m.profit) / 1000) + 'k';
                const labelY = m.profit >= 0 ? y - 4 : y + barH + 10;
                ctx.fillText(valLabel, x + barW / 2, labelY);
            }
        });
    }

    // ── Module Lifecycle ──

    async function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        _initialized = true;

        // Listen for data refreshes
        MK.on('data-loaded', () => {
            _inventoryCache = null;
            render();
        });

        await render();
    }

    async function render() {
        if (!_initialized) return;
        const items = await fetchInventory();
        injectWeeklyPnlCard(items);
        injectProfitByRef(items);
        injectProfitByChannel(items);
        injectTaxExportTab(items);
        injectMonthlyPnlTab(items);
    }

    function cleanup() {
        const el = document.getElementById('ws9-weekly-pnl');
        if (el) el.remove();
        const tab = document.getElementById('ws9-pf-tab');
        if (tab) tab.remove();
        const channelTab = document.getElementById('ws9-channel-tab');
        if (channelTab) channelTab.remove();
        const taxTab = document.getElementById('ws9-tax-tab');
        if (taxTab) taxTab.remove();
        const monthlyTab = document.getElementById('ws9-monthly-tab');
        if (monthlyTab) monthlyTab.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
