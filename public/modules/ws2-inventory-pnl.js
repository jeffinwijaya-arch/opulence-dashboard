/**
 * MK Opulence — ws2-inventory-pnl
 * Inventory P&L enhancements: portfolio heat map, aging alerts, weekly P&L trend,
 * capital efficiency metrics.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws2-inventory-pnl', { init, render, cleanup })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws2-inventory-pnl';
    const PNL_STORAGE_KEY = 'mk_pnl_history';
    const MAX_SNAPSHOTS = 30;
    const SPARKLINE_POINTS = 7;

    // ── CSS injection (once) ──
    let styleInjected = false;
    function injectStyles() {
        if (styleInjected) return;
        styleInjected = true;
        const style = document.createElement('style');
        style.id = 'ws2-styles';
        style.textContent = `
            /* Portfolio Heat Map */
            .ws2-heatmap-wrap {
                padding: 16px;
                background: var(--bg-2);
                border-radius: var(--radius);
                border: 1px solid var(--border);
                margin-bottom: 12px;
            }
            .ws2-heatmap-title {
                font-size: 0.7rem;
                color: var(--text-2);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                font-weight: 600;
                font-family: var(--mono);
                margin-bottom: 10px;
            }
            .ws2-heatmap-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
                gap: 6px;
            }
            .ws2-heatmap-cell {
                border-radius: 6px;
                cursor: pointer;
                transition: transform 0.1s, box-shadow 0.1s;
                position: relative;
                min-height: 28px;
            }
            .ws2-heatmap-cell:hover {
                transform: scale(1.15);
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                z-index: 2;
            }
            .ws2-heatmap-legend {
                display: flex;
                gap: 12px;
                margin-top: 10px;
                font-size: 0.65rem;
                color: var(--text-2);
                align-items: center;
            }
            .ws2-heatmap-legend-dot {
                width: 10px;
                height: 10px;
                border-radius: 2px;
                display: inline-block;
                margin-right: 3px;
                vertical-align: middle;
            }

            /* Aging Bar */
            .ws2-aging-bar {
                display: block;
                height: 3px;
                border-radius: 2px;
                margin-top: 3px;
                min-width: 2px;
                opacity: 0.85;
            }
            .ws2-aging-legend {
                display: flex;
                gap: 14px;
                padding: 6px 10px;
                font-size: 0.62rem;
                color: var(--text-2);
                font-family: var(--mono);
                align-items: center;
            }
            .ws2-aging-legend-item {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .ws2-aging-legend-bar {
                display: inline-block;
                width: 18px;
                height: 3px;
                border-radius: 2px;
            }

            /* Aging Summary Alert */
            .ws2-aging-summary {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 14px;
                background: rgba(255,59,48,0.08);
                border: 1px solid rgba(255,59,48,0.2);
                border-radius: var(--radius);
                margin-bottom: 10px;
                font-size: 0.75rem;
                color: var(--text-1);
                font-family: var(--mono);
            }
            .ws2-aging-summary-icon {
                font-size: 1.1rem;
                flex-shrink: 0;
            }
            .ws2-aging-summary .ws2-aging-count {
                color: var(--red);
                font-weight: 700;
            }
            .ws2-aging-summary .ws2-aging-capital {
                color: var(--red);
                font-weight: 700;
            }
            .ws2-aging-badges {
                display: flex;
                gap: 6px;
                margin-left: auto;
            }
            .ws2-aging-badge {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.65rem;
                font-weight: 700;
                font-family: var(--mono);
            }
            .ws2-aging-badge-green {
                background: rgba(0,230,118,0.12);
                color: var(--green);
                border: 1px solid rgba(0,230,118,0.2);
            }
            .ws2-aging-badge-yellow {
                background: rgba(255,202,40,0.12);
                color: #ffca28;
                border: 1px solid rgba(255,202,40,0.2);
            }
            .ws2-aging-badge-red {
                background: rgba(255,59,48,0.10);
                color: var(--red);
                border: 1px solid rgba(255,59,48,0.2);
            }

            /* P&L Trend Sparkline */
            .ws2-pnl-trend-wrap {
                padding: 14px 16px;
                background: var(--bg-2);
                border-radius: var(--radius);
                border: 1px solid var(--border);
                margin-bottom: 12px;
            }
            .ws2-pnl-trend-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            .ws2-pnl-trend-title {
                font-size: 0.7rem;
                color: var(--text-2);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                font-weight: 600;
                font-family: var(--mono);
            }
            .ws2-pnl-trend-value {
                font-size: 0.82rem;
                font-weight: 700;
            }
            .ws2-pnl-trend-canvas {
                width: 100%;
                height: 48px;
                display: block;
            }
            .ws2-pnl-trend-labels {
                display: flex;
                justify-content: space-between;
                font-size: 0.6rem;
                color: var(--text-2);
                margin-top: 4px;
                font-family: var(--mono);
            }

            /* Capital Efficiency Metrics */
            .ws2-capital-wrap {
                padding: 14px 16px;
                background: var(--bg-2);
                border-radius: var(--radius);
                border: 1px solid var(--border);
                margin-bottom: 12px;
            }
            .ws2-capital-title {
                font-size: 0.7rem;
                color: var(--text-2);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                font-weight: 600;
                font-family: var(--mono);
                margin-bottom: 10px;
            }
            .ws2-capital-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
                gap: 10px;
            }
            .ws2-capital-stat {
                text-align: center;
            }
            .ws2-capital-val {
                font-size: 0.95rem;
                font-weight: 700;
                font-family: var(--mono);
                line-height: 1.3;
            }
            .ws2-capital-label {
                font-size: 0.6rem;
                color: var(--text-2);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: 2px;
            }

            /* Tooltip for heatmap */
            .ws2-tooltip {
                position: fixed;
                background: var(--bg-1);
                border: 1px solid var(--border);
                border-radius: 6px;
                padding: 8px 10px;
                font-size: 0.72rem;
                color: var(--text-0);
                pointer-events: none;
                z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                max-width: 220px;
                line-height: 1.4;
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    // ── Utility ──
    function parsePrice(v) {
        const n = parseFloat(String(v || '0').replace(/[$,]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function fmtPrice(n) {
        return '$' + Math.round(n).toLocaleString();
    }

    function todayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    function daysBetween(dateStr, now) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return Math.floor((now - d) / (1000 * 60 * 60 * 24));
    }

    // Get inventory items from either source
    function getInventoryItems() {
        let items = window.inventoryItems || [];
        if (!items.length && window.invMgmtData) {
            items = window.invMgmtData.map(r => ({
                description: r.description || '',
                ref: r.ref || (r.description || '').match(/\b(\d{5,6}[A-Z]*)\b/)?.[1] || '',
                cost_price: parsePrice(r.cost_price),
                sale_price: parsePrice(r.sale_price || r.sold_price),
                sold_price: parsePrice(r.sold_price),
                market_value: parsePrice(r.market_value || r.sale_price),
                sold: r.sold === 'Yes',
                shipped: r.shipped === 'Yes',
                paid_buyer: r.paid_buyer === 'Yes',
                days_held: r.days_held || null,
                bought_date: r.bought_date || '',
                sale_date: r.sale_date || '',
                row: r.row
            }));
        }
        return items;
    }

    // ── 1. PORTFOLIO HEAT MAP ──
    function renderHeatMap() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return;

        let items = getInventoryItems().filter(i => !i.sold);
        if (!items.length) return;

        // Remove old heatmap if exists
        const existing = document.getElementById('ws2-heatmap');
        if (existing) existing.remove();

        const container = document.getElementById('portfolio-content');
        if (!container) return;

        // Calculate margin for each position
        const positions = items.map(item => {
            const cost = item.cost_price || 0;
            const market = item.market_value || item.sale_price || cost;
            const margin = cost > 0 ? ((market - cost) / cost) * 100 : 0;
            return { item, cost, market, margin };
        }).sort((a, b) => b.cost - a.cost);

        const maxCost = Math.max(...positions.map(p => p.cost), 1);

        const cellsHtml = positions.map(pos => {
            let color;
            if (pos.margin > 5) color = 'rgba(0,230,118,0.7)';
            else if (pos.margin >= 0) color = 'rgba(255,202,40,0.7)';
            else color = 'rgba(255,59,48,0.7)';

            const sizeRatio = pos.cost / maxCost;
            const size = Math.max(28, Math.round(28 + sizeRatio * 28));

            const ref = pos.item.ref || '';
            const desc = (pos.item.description || ref).replace(/"/g, '&quot;');
            const marginStr = pos.margin >= 0 ? '+' + pos.margin.toFixed(1) + '%' : pos.margin.toFixed(1) + '%';

            return `<div class="ws2-heatmap-cell"
                style="background:${color};width:${size}px;height:${size}px;"
                data-ws2-tip="${desc}\nCost: ${fmtPrice(pos.cost)}\nMarket: ${fmtPrice(pos.market)}\nMargin: ${marginStr}"
                ${ref ? `onclick="if(typeof lookupRef==='function')lookupRef('${ref}')"` : ''}
            ></div>`;
        }).join('');

        const heatmapHtml = `<div id="ws2-heatmap" class="ws2-heatmap-wrap">
            <div class="ws2-heatmap-title">Position Heat Map</div>
            <div class="ws2-heatmap-grid">${cellsHtml}</div>
            <div class="ws2-heatmap-legend">
                <span><span class="ws2-heatmap-legend-dot" style="background:rgba(0,230,118,0.7);"></span> >5% profit</span>
                <span><span class="ws2-heatmap-legend-dot" style="background:rgba(255,202,40,0.7);"></span> 0-5%</span>
                <span><span class="ws2-heatmap-legend-dot" style="background:rgba(255,59,48,0.7);"></span> Loss</span>
                <span style="margin-left:auto;font-family:var(--mono);">${positions.length} positions</span>
            </div>
        </div>`;

        const firstChild = container.querySelector('.fade-in');
        if (firstChild) {
            const metricsDiv = firstChild.querySelector('.metrics');
            if (metricsDiv) {
                metricsDiv.insertAdjacentHTML('afterend', heatmapHtml);
            } else {
                firstChild.insertAdjacentHTML('afterbegin', heatmapHtml);
            }
        } else {
            container.insertAdjacentHTML('afterbegin', heatmapHtml);
        }

        attachHeatmapTooltips();
    }

    function attachHeatmapTooltips() {
        let tooltip = document.getElementById('ws2-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'ws2-tooltip';
            tooltip.className = 'ws2-tooltip';
            document.body.appendChild(tooltip);
        }

        const cells = document.querySelectorAll('.ws2-heatmap-cell[data-ws2-tip]');
        cells.forEach(cell => {
            cell.addEventListener('mouseenter', function(e) {
                tooltip.innerHTML = (this.getAttribute('data-ws2-tip') || '').replace(/\n/g, '<br>');
                tooltip.style.display = 'block';
                positionTooltip(e, tooltip);
            });
            cell.addEventListener('mousemove', function(e) {
                positionTooltip(e, tooltip);
            });
            cell.addEventListener('mouseleave', function() {
                tooltip.style.display = 'none';
            });
            cell.addEventListener('touchstart', function(e) {
                tooltip.innerHTML = (this.getAttribute('data-ws2-tip') || '').replace(/\n/g, '<br>');
                tooltip.style.display = 'block';
                const touch = e.touches[0];
                tooltip.style.left = Math.min(touch.clientX + 10, window.innerWidth - 230) + 'px';
                tooltip.style.top = (touch.clientY - 70) + 'px';
                setTimeout(() => { tooltip.style.display = 'none'; }, 2000);
            }, {passive: true});
        });
    }

    function positionTooltip(e, tooltip) {
        tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - 230) + 'px';
        tooltip.style.top = Math.max(e.clientY - 60, 10) + 'px';
    }

    // ── 2. DAYS-IN-INVENTORY AGING ALERTS ──
    function renderAgingBars() {
        const tbody = document.getElementById('im-tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        if (!rows.length) return;

        const now = new Date();
        const invData = window.invMgmtData || [];

        rows.forEach(tr => {
            const checkbox = tr.querySelector('.im-row-check');
            if (!checkbox) return;
            const rowId = parseInt(checkbox.getAttribute('data-row'));
            const watchRow = invData.find(r => r.row === rowId);
            if (!watchRow) return;

            const buyDate = watchRow.bought_date || '';
            const days = daysBetween(buyDate, now);

            const descCell = tr.children[1];
            if (!descCell) return;

            const existingBar = descCell.querySelector('.ws2-aging-bar');
            if (existingBar) existingBar.remove();

            if (days === null) return;

            let color;
            if (days < 14) color = 'var(--green)';
            else if (days <= 30) color = '#ffca28';
            else color = 'var(--red)';

            const widthPct = Math.min(days / 60, 1) * 100;

            const bar = document.createElement('span');
            bar.className = 'ws2-aging-bar';
            bar.style.width = widthPct + '%';
            bar.style.background = color;
            bar.title = days + 'd in inventory' + (buyDate ? ' (bought ' + buyDate + ')' : '');
            descCell.appendChild(bar);
        });
    }

    // Aging summary alert — injected above inventory table
    function renderAgingSummary() {
        const existing = document.getElementById('ws2-aging-summary');
        if (existing) existing.remove();

        const items = getInventoryItems();
        const unsold = items.filter(i => !i.sold);
        if (!unsold.length) return;

        const now = new Date();
        let greenCount = 0, yellowCount = 0, redCount = 0;
        let redCapital = 0;

        unsold.forEach(item => {
            let days = item.days_held;
            if (days == null && item.bought_date) {
                days = daysBetween(item.bought_date, now);
            }
            if (days == null) days = 0;

            if (days < 14) {
                greenCount++;
            } else if (days <= 30) {
                yellowCount++;
            } else {
                redCount++;
                redCapital += (item.cost_price || 0);
            }
        });

        // Only show alert if there are aging items
        if (redCount === 0 && yellowCount === 0) return;

        const summaryEl = document.getElementById('inv-summary');
        if (!summaryEl) return;

        const alertHtml = `<div id="ws2-aging-summary" class="ws2-aging-summary">
            <span class="ws2-aging-summary-icon">&#9888;</span>
            <span>
                <span class="ws2-aging-count">${redCount}</span> watch${redCount !== 1 ? 'es' : ''} aging &gt;30 days,
                <span class="ws2-aging-capital">${fmtPrice(redCapital)}</span> capital at risk
            </span>
            <span class="ws2-aging-badges">
                <span class="ws2-aging-badge ws2-aging-badge-green">&lt;14d: ${greenCount}</span>
                <span class="ws2-aging-badge ws2-aging-badge-yellow">14-30d: ${yellowCount}</span>
                <span class="ws2-aging-badge ws2-aging-badge-red">&gt;30d: ${redCount}</span>
            </span>
        </div>`;

        summaryEl.insertAdjacentHTML('afterend', alertHtml);

        // Inject aging bar legend below summary if not present
        if (!document.getElementById('ws2-aging-legend')) {
            var legendHtml = '<div id="ws2-aging-legend" class="ws2-aging-legend">' +
                '<span style="font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Aging:</span>' +
                '<span class="ws2-aging-legend-item"><span class="ws2-aging-legend-bar" style="background:var(--green);"></span> &lt;14 days</span>' +
                '<span class="ws2-aging-legend-item"><span class="ws2-aging-legend-bar" style="background:#ffca28;"></span> 14-30 days</span>' +
                '<span class="ws2-aging-legend-item"><span class="ws2-aging-legend-bar" style="background:var(--red);"></span> &gt;30 days</span>' +
                '<span style="color:var(--text-3);">Bar width = days / 60</span>' +
            '</div>';
            var agingSummary = document.getElementById('ws2-aging-summary');
            if (agingSummary) {
                agingSummary.insertAdjacentHTML('afterend', legendHtml);
            }
        }
    }

    // ── 3. WEEKLY P&L TREND ──
    function loadPnlHistory() {
        try {
            const raw = localStorage.getItem(PNL_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch(e) {
            return [];
        }
    }

    function savePnlHistory(history) {
        try {
            localStorage.setItem(PNL_STORAGE_KEY, JSON.stringify(history));
        } catch(e) {}
    }

    function snapshotPnl() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return null;

        const today = todayStr();
        let history = loadPnlHistory();

        // Compute realized P&L from sold watches
        const items = getInventoryItems();
        const soldItems = items.filter(i => i.sold);
        const realizedPnl = soldItems.reduce((sum, i) => {
            const cost = i.cost_price || 0;
            const sold = i.sold_price || i.sale_price || 0;
            return sum + (cost > 0 ? sold - cost : 0);
        }, 0);

        const snapshot = {
            date: today,
            total_cost: p.total_invested || 0,
            total_market_value: p.total_market_value || 0,
            unrealized_pnl: p.total_pnl || 0,
            realized_pnl: realizedPnl,
            total_value: (p.total_market_value || 0) + realizedPnl
        };

        const todayIdx = history.findIndex(h => h.date === today);
        if (todayIdx >= 0) {
            history[todayIdx] = snapshot;
        } else {
            history.push(snapshot);
        }

        if (history.length > MAX_SNAPSHOTS) {
            history = history.slice(-MAX_SNAPSHOTS);
        }

        history.sort((a, b) => a.date.localeCompare(b.date));
        savePnlHistory(history);
        return history;
    }

    function renderPnlTrend() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return;

        const history = snapshotPnl();
        if (!history || history.length < 1) return;

        const existing = document.getElementById('ws2-pnl-trend');
        if (existing) existing.remove();

        const container = document.getElementById('portfolio-content');
        if (!container) return;

        // Use last 7 snapshots for the sparkline
        const recent = history.slice(-SPARKLINE_POINTS);
        const latest = recent[recent.length - 1];
        const totalValue = latest.total_value || (latest.total_market_value || 0);
        const pnlColor = latest.unrealized_pnl >= 0 ? 'var(--green)' : 'var(--red)';
        const pnlSign = latest.unrealized_pnl >= 0 ? '+' : '';
        const firstDate = recent[0].date.slice(5);
        const lastDate = recent[recent.length - 1].date.slice(5);

        let changeHtml = '';
        if (recent.length >= 2) {
            const firstVal = recent[0].total_value || recent[0].total_market_value || 0;
            const lastVal = totalValue;
            const diff = lastVal - firstVal;
            const diffColor = diff >= 0 ? 'var(--green)' : 'var(--red)';
            const diffSign = diff >= 0 ? '+' : '';
            changeHtml = `<span style="font-size:0.65rem;color:${diffColor};margin-left:8px;">${diffSign}${fmtPrice(diff)} over ${recent.length} snapshots</span>`;
        }

        const trendHtml = `<div id="ws2-pnl-trend" class="ws2-pnl-trend-wrap">
            <div class="ws2-pnl-trend-header">
                <span class="ws2-pnl-trend-title">Portfolio Value Trend (last ${recent.length} snapshots)</span>
                <span>
                    <span class="ws2-pnl-trend-value" style="color:${pnlColor};">${pnlSign}${fmtPrice(latest.unrealized_pnl)}</span>
                    ${changeHtml}
                </span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div style="display:flex;flex-direction:column;justify-content:space-between;height:48px;font-size:0.55rem;color:var(--text-3);font-family:var(--mono);text-align:right;padding-right:4px;min-width:44px;">
                    <span>${fmtPrice(Math.max(...recent.map(s => s.total_value || s.total_market_value || 0)))}</span>
                    <span>${fmtPrice(Math.min(...recent.map(s => s.total_value || s.total_market_value || 0)))}</span>
                </div>
                <div style="flex:1;min-width:0;">
                    <canvas id="ws2-pnl-canvas" class="ws2-pnl-trend-canvas"></canvas>
                    <div class="ws2-pnl-trend-labels">
                        <span>${firstDate}</span>
                        <span>${lastDate}</span>
                    </div>
                </div>
            </div>
        </div>`;

        const firstChild = container.querySelector('.fade-in');
        if (firstChild) {
            const metricsDiv = firstChild.querySelector('.metrics');
            if (metricsDiv) {
                metricsDiv.insertAdjacentHTML('beforebegin', trendHtml);
            } else {
                firstChild.insertAdjacentHTML('afterbegin', trendHtml);
            }
        } else {
            container.insertAdjacentHTML('afterbegin', trendHtml);
        }

        drawPnlSparkline(recent);
    }

    function drawPnlSparkline(history) {
        const canvas = document.getElementById('ws2-pnl-canvas');
        if (!canvas || !canvas.getContext) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const pad = 4;

        const values = history.map(s => s.total_value || s.total_market_value || 0);
        if (values.length < 2) {
            const cy = h / 2;
            ctx.fillStyle = values[0] >= 0 ? '#00e676' : '#ff3b30';
            ctx.beginPath();
            ctx.arc(w / 2, cy, 3, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const points = values.map((v, i) => ({
            x: pad + (i / (values.length - 1)) * (w - pad * 2),
            y: pad + (1 - (v - min) / range) * (h - pad * 2)
        }));

        // Draw zero line if range crosses zero
        if (min < 0 && max > 0) {
            const zeroY = pad + (1 - (0 - min) / range) * (h - pad * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(pad, zeroY);
            ctx.lineTo(w - pad, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const lastVal = values[values.length - 1];
        const firstVal = values[0];
        const lineColor = lastVal >= firstVal ? '#00e676' : '#ff3b30';
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        if (lastVal >= firstVal) {
            gradient.addColorStop(0, 'rgba(0,230,118,0.25)');
            gradient.addColorStop(1, 'rgba(0,230,118,0.02)');
        } else {
            gradient.addColorStop(0, 'rgba(255,59,48,0.02)');
            gradient.addColorStop(1, 'rgba(255,59,48,0.25)');
        }

        // Fill area
        ctx.beginPath();
        ctx.moveTo(points[0].x, h - pad);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, h - pad);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Endpoint dot
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
    }

    // ── 4. CAPITAL EFFICIENCY METRICS ──
    function renderCapitalEfficiency() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return;

        const existing = document.getElementById('ws2-capital-efficiency');
        if (existing) existing.remove();

        const container = document.getElementById('portfolio-content');
        if (!container) return;

        const items = getInventoryItems();
        const unsold = items.filter(i => !i.sold);
        const sold = items.filter(i => i.sold);

        // Total deployed capital (unsold inventory cost)
        const totalDeployed = p.total_invested || unsold.reduce((s, i) => s + (i.cost_price || 0), 0);

        // Unrealized P&L
        const unrealizedPnl = p.total_pnl || 0;

        // Realized P&L from sold watches
        const realizedPnl = sold.reduce((sum, i) => {
            const cost = i.cost_price || 0;
            const soldPrice = i.sold_price || i.sale_price || 0;
            return sum + (cost > 0 ? soldPrice - cost : 0);
        }, 0);

        // Total P&L
        const totalPnl = unrealizedPnl + realizedPnl;

        // ROI % on total capital ever deployed
        const totalEverDeployed = totalDeployed + sold.reduce((s, i) => s + (i.cost_price || 0), 0);
        const roiPct = totalEverDeployed > 0 ? ((totalPnl / totalEverDeployed) * 100).toFixed(1) : '0.0';

        // Average hold time
        const now = new Date();
        let totalDays = 0, countDays = 0;
        unsold.forEach(i => {
            let days = i.days_held;
            if (days == null && i.bought_date) {
                days = daysBetween(i.bought_date, now);
            }
            if (days != null) { totalDays += days; countDays++; }
        });
        const avgHold = countDays > 0 ? Math.round(totalDays / countDays) : (p.avg_days_held || 0);

        // Capital turnover (sold cost / avg deployed)
        const soldCost = sold.reduce((s, i) => s + (i.cost_price || 0), 0);
        const turnover = totalDeployed > 0 ? (soldCost / totalDeployed).toFixed(1) : '0.0';

        const unrealizedCls = unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
        const realizedCls = realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
        const totalPnlCls = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
        const roiCls = parseFloat(roiPct) >= 0 ? 'var(--green)' : 'var(--red)';

        const html = `<div id="ws2-capital-efficiency" class="ws2-capital-wrap">
            <div class="ws2-capital-title">Capital Efficiency</div>
            <div class="ws2-capital-grid">
                <div class="ws2-capital-stat">
                    <div class="ws2-capital-val" style="color:var(--accent);">${fmtPrice(totalDeployed)}</div>
                    <div class="ws2-capital-label">Deployed Capital</div>
                </div>
                <div class="ws2-capital-stat">
                    <div class="ws2-capital-val" style="color:${unrealizedCls};">${(unrealizedPnl >= 0 ? '+' : '') + fmtPrice(unrealizedPnl)}</div>
                    <div class="ws2-capital-label">Unrealized P&L</div>
                </div>
                <div class="ws2-capital-stat">
                    <div class="ws2-capital-val" style="color:${realizedCls};">${(realizedPnl >= 0 ? '+' : '') + fmtPrice(realizedPnl)}</div>
                    <div class="ws2-capital-label">Realized P&L</div>
                </div>
                <div class="ws2-capital-stat">
                    <div class="ws2-capital-val" style="color:${totalPnlCls};">${(totalPnl >= 0 ? '+' : '') + fmtPrice(totalPnl)}</div>
                    <div class="ws2-capital-label">Total P&L</div>
                </div>
                <div class="ws2-capital-stat">
                    <div class="ws2-capital-val" style="color:${roiCls};">${roiPct}%</div>
                    <div class="ws2-capital-label">ROI</div>
                </div>
                <div class="ws2-capital-stat">
                    <div class="ws2-capital-val">${avgHold}d</div>
                    <div class="ws2-capital-label">Avg Hold Time</div>
                </div>
            </div>
        </div>`;

        // Insert after heatmap or after metrics
        const heatmap = document.getElementById('ws2-heatmap');
        if (heatmap) {
            heatmap.insertAdjacentHTML('afterend', html);
        } else {
            const firstChild = container.querySelector('.fade-in');
            if (firstChild) {
                const metricsDiv = firstChild.querySelector('.metrics');
                if (metricsDiv) {
                    metricsDiv.insertAdjacentHTML('afterend', html);
                } else {
                    firstChild.insertAdjacentHTML('beforeend', html);
                }
            } else {
                container.insertAdjacentHTML('beforeend', html);
            }
        }
    }

    // ── LIFECYCLE ──

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();

        window.MKModules.on('modules-ready', function() {
            render();
        });

        // Hook into renderPortfolio to inject after it renders
        const origRenderPortfolio = window.renderPortfolio;
        if (typeof origRenderPortfolio === 'function') {
            window.renderPortfolio = async function() {
                await origRenderPortfolio.apply(this, arguments);
                setTimeout(function() {
                    renderPnlTrend();
                    renderHeatMap();
                    renderCapitalEfficiency();
                }, 150);
            };
        }

        // Hook into renderInventoryTable to inject aging bars + summary
        const origRenderInventoryTable = window.renderInventoryTable;
        if (typeof origRenderInventoryTable === 'function') {
            window.renderInventoryTable = function() {
                origRenderInventoryTable.apply(this, arguments);
                setTimeout(function() {
                    renderAgingBars();
                    renderAgingSummary();
                }, 50);
            };
        }

        // Hook into updateInventorySummary for aging summary on inventory page
        const origUpdateInventorySummary = window.updateInventorySummary;
        if (typeof origUpdateInventorySummary === 'function') {
            window.updateInventorySummary = function() {
                origUpdateInventorySummary.apply(this, arguments);
                setTimeout(renderAgingSummary, 50);
            };
        }
    }

    function render() {
        const portfolioContent = document.getElementById('portfolio-content');
        if (portfolioContent && portfolioContent.querySelector('.metrics')) {
            renderPnlTrend();
            renderHeatMap();
            renderCapitalEfficiency();
        }
        const tbody = document.getElementById('im-tbody');
        if (tbody && tbody.children.length > 0) {
            renderAgingBars();
            renderAgingSummary();
        }
    }

    function cleanup() {
        const ids = ['ws2-heatmap', 'ws2-pnl-trend', 'ws2-tooltip', 'ws2-capital-efficiency', 'ws2-aging-summary', 'ws2-aging-legend'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        const styleEl = document.getElementById('ws2-styles');
        if (styleEl) styleEl.remove();
        styleInjected = false;
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
