/**
 * MK Opulence — ws2-inventory-pnl
 * Inventory P&L enhancements: portfolio heat map, aging bars, unrealized P&L trend.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws2-inventory-pnl', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws2-inventory-pnl';
    const PNL_STORAGE_KEY = 'mk_pnl_history';
    const MAX_HISTORY_DAYS = 30;

    // ── CSS injection (once) ──
    let styleInjected = false;
    function injectStyles() {
        if (styleInjected) return;
        styleInjected = true;
        const style = document.createElement('style');
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
                gap: 3px;
            }
            .ws2-heatmap-cell {
                border-radius: 3px;
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

    // ── 1. PORTFOLIO HEAT MAP ──
    // Renders a grid of colored squares into #portfolio-content, below existing content.
    function renderHeatMap() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return;

        // Get unsold inventory items from inventoryItems or invMgmtData
        let items = window.inventoryItems || [];
        if (!items.length && window.invMgmtData) {
            // Adapt invMgmtData format
            items = window.invMgmtData.filter(r => r.sold !== 'Yes').map(r => ({
                description: r.description || '',
                ref: r.ref || (r.description || '').match(/\b(\d{5,6}[A-Z]*)\b/)?.[1] || '',
                cost_price: parsePrice(r.cost_price),
                sale_price: parsePrice(r.sale_price || r.sold_price),
                sold: false,
                row: r.row
            }));
        } else {
            items = items.filter(i => !i.sold);
        }

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
        }).sort((a, b) => b.cost - a.cost); // Sort by capital deployed (largest first)

        const maxCost = Math.max(...positions.map(p => p.cost), 1);

        // Build grid cells
        const cellsHtml = positions.map((pos, idx) => {
            let color;
            if (pos.margin > 5) color = 'rgba(0,230,118,0.7)';       // green: >5% profit
            else if (pos.margin >= 0) color = 'rgba(255,202,40,0.7)'; // yellow: 0-5%
            else color = 'rgba(255,59,48,0.7)';                       // red: loss

            // Size proportional to capital deployed (min 28px, max 56px)
            const sizeRatio = pos.cost / maxCost;
            const size = Math.max(28, Math.round(28 + sizeRatio * 28));

            const ref = pos.item.ref || '';
            const desc = (pos.item.description || ref).replace(/"/g, '&quot;');
            const marginStr = pos.margin >= 0 ? '+' + pos.margin.toFixed(1) + '%' : pos.margin.toFixed(1) + '%';

            return `<div class="ws2-heatmap-cell"
                style="background:${color};width:${size}px;height:${size}px;"
                data-ws2-tip="${desc}\nCost: ${fmtPrice(pos.cost)}\nMarket: ${fmtPrice(pos.market)}\nMargin: ${marginStr}"
                ${pos.item.ref ? `onclick="if(typeof lookupRef==='function')lookupRef('${ref}')"` : ''}
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

        // Insert after the first child (metrics row) of portfolio-content
        const firstChild = container.querySelector('.fade-in');
        if (firstChild) {
            // Insert after the metrics div inside .fade-in
            const metricsDiv = firstChild.querySelector('.metrics');
            if (metricsDiv) {
                metricsDiv.insertAdjacentHTML('afterend', heatmapHtml);
            } else {
                firstChild.insertAdjacentHTML('afterbegin', heatmapHtml);
            }
        } else {
            container.insertAdjacentHTML('afterbegin', heatmapHtml);
        }

        // Attach tooltip behavior
        attachHeatmapTooltips();
    }

    // Tooltip for heatmap cells
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
                const text = this.getAttribute('data-ws2-tip') || '';
                tooltip.innerHTML = text.replace(/\n/g, '<br>');
                tooltip.style.display = 'block';
                positionTooltip(e, tooltip);
            });
            cell.addEventListener('mousemove', function(e) {
                positionTooltip(e, tooltip);
            });
            cell.addEventListener('mouseleave', function() {
                tooltip.style.display = 'none';
            });
            // Touch support for mobile
            cell.addEventListener('touchstart', function(e) {
                const text = this.getAttribute('data-ws2-tip') || '';
                tooltip.innerHTML = text.replace(/\n/g, '<br>');
                tooltip.style.display = 'block';
                const touch = e.touches[0];
                tooltip.style.left = Math.min(touch.clientX + 10, window.innerWidth - 230) + 'px';
                tooltip.style.top = (touch.clientY - 70) + 'px';
                setTimeout(() => { tooltip.style.display = 'none'; }, 2000);
            }, {passive: true});
        });
    }

    function positionTooltip(e, tooltip) {
        const x = Math.min(e.clientX + 12, window.innerWidth - 230);
        const y = Math.max(e.clientY - 60, 10);
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    }

    // ── 2. DAYS-IN-INVENTORY AGING BAR ──
    // After inventory table renders, append a colored bar to each description cell.
    function renderAgingBars() {
        const tbody = document.getElementById('im-tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        if (!rows.length) return;

        const now = new Date();
        const invData = window.invMgmtData || [];

        rows.forEach(tr => {
            // Find the row data via the checkbox data-row attribute
            const checkbox = tr.querySelector('.im-row-check');
            if (!checkbox) return;
            const rowId = parseInt(checkbox.getAttribute('data-row'));
            const watchRow = invData.find(r => r.row === rowId);
            if (!watchRow) return;

            // Use bought_date (inventory/rows format)
            const buyDate = watchRow.bought_date || '';
            const days = daysBetween(buyDate, now);

            // Get the description cell (2nd td)
            const descCell = tr.children[1];
            if (!descCell) return;

            // Remove existing aging bar if present
            const existingBar = descCell.querySelector('.ws2-aging-bar');
            if (existingBar) existingBar.remove();

            if (days === null) return;

            // Color: green <14d, yellow 14-30d, red >30d
            let color;
            if (days < 14) color = 'var(--green)';
            else if (days <= 30) color = '#ffca28';
            else color = 'var(--red)';

            // Width proportional to days (max 60d = full width)
            const widthPct = Math.min(days / 60, 1) * 100;

            const bar = document.createElement('span');
            bar.className = 'ws2-aging-bar';
            bar.style.width = widthPct + '%';
            bar.style.background = color;
            bar.title = days + 'd in inventory' + (buyDate ? ' (bought ' + buyDate + ')' : '');
            descCell.appendChild(bar);
        });
    }

    // ── 3. UNREALIZED P&L TREND ──
    // Stores daily snapshot in localStorage, draws sparkline canvas.
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
        } catch(e) {
            // localStorage full or unavailable
        }
    }

    function snapshotPnl() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return null;

        const today = todayStr();
        let history = loadPnlHistory();

        const snapshot = {
            date: today,
            total_cost: p.total_invested || 0,
            total_market_value: p.total_market_value || 0,
            unrealized_pnl: p.total_pnl || 0
        };

        // Update today's entry or append
        const todayIdx = history.findIndex(h => h.date === today);
        if (todayIdx >= 0) {
            history[todayIdx] = snapshot;
        } else {
            history.push(snapshot);
        }

        // Keep only last MAX_HISTORY_DAYS entries
        if (history.length > MAX_HISTORY_DAYS) {
            history = history.slice(-MAX_HISTORY_DAYS);
        }

        // Sort by date
        history.sort((a, b) => a.date.localeCompare(b.date));

        savePnlHistory(history);
        return history;
    }

    function renderPnlTrend() {
        const p = window.DATA && window.DATA.portfolio;
        if (!p) return;

        const history = snapshotPnl();
        if (!history || history.length < 1) return;

        // Remove old trend if exists
        const existing = document.getElementById('ws2-pnl-trend');
        if (existing) existing.remove();

        const container = document.getElementById('portfolio-content');
        if (!container) return;

        const latest = history[history.length - 1];
        const pnlColor = latest.unrealized_pnl >= 0 ? 'var(--green)' : 'var(--red)';
        const pnlSign = latest.unrealized_pnl >= 0 ? '+' : '';
        const firstDate = history[0].date.slice(5); // MM-DD
        const lastDate = history[history.length - 1].date.slice(5);

        // Calculate change from first to last
        let changeHtml = '';
        if (history.length >= 2) {
            const firstPnl = history[0].unrealized_pnl;
            const lastPnl = latest.unrealized_pnl;
            const diff = lastPnl - firstPnl;
            const diffColor = diff >= 0 ? 'var(--green)' : 'var(--red)';
            const diffSign = diff >= 0 ? '+' : '';
            changeHtml = `<span style="font-size:0.65rem;color:${diffColor};margin-left:8px;">${diffSign}${fmtPrice(diff)} (${history.length}d)</span>`;
        }

        const trendHtml = `<div id="ws2-pnl-trend" class="ws2-pnl-trend-wrap">
            <div class="ws2-pnl-trend-header">
                <span class="ws2-pnl-trend-title">Unrealized P&L Trend</span>
                <span>
                    <span class="ws2-pnl-trend-value" style="color:${pnlColor};">${pnlSign}${fmtPrice(latest.unrealized_pnl)}</span>
                    ${changeHtml}
                </span>
            </div>
            <canvas id="ws2-pnl-canvas" class="ws2-pnl-trend-canvas"></canvas>
            <div class="ws2-pnl-trend-labels">
                <span>${firstDate}</span>
                <span>${lastDate}</span>
            </div>
        </div>`;

        // Insert at the top of portfolio-content, before the first child
        const firstChild = container.querySelector('.fade-in');
        if (firstChild) {
            // Insert before the metrics div
            const metricsDiv = firstChild.querySelector('.metrics');
            if (metricsDiv) {
                metricsDiv.insertAdjacentHTML('beforebegin', trendHtml);
            } else {
                firstChild.insertAdjacentHTML('afterbegin', trendHtml);
            }
        } else {
            container.insertAdjacentHTML('afterbegin', trendHtml);
        }

        // Draw sparkline on canvas
        drawPnlSparkline(history);
    }

    function drawPnlSparkline(history) {
        const canvas = document.getElementById('ws2-pnl-canvas');
        if (!canvas || !canvas.getContext) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // Set canvas size from CSS layout
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const pad = 4;

        const values = history.map(h => h.unrealized_pnl);
        if (values.length < 2) {
            // Single point - draw a dot
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

        // Build points
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

        // Gradient fill
        const lastVal = values[values.length - 1];
        const lineColor = lastVal >= 0 ? '#00e676' : '#ff3b30';
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        if (lastVal >= 0) {
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

        // Draw endpoint dot
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
    }

    // ── LIFECYCLE ──

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();

        // Listen for portfolio renders to inject heatmap + trend
        window.MKModules.on('modules-ready', function() {
            render();
        });

        // Hook into renderPortfolio to inject after it renders
        const origRenderPortfolio = window.renderPortfolio;
        if (typeof origRenderPortfolio === 'function') {
            window.renderPortfolio = async function() {
                await origRenderPortfolio.apply(this, arguments);
                // Only inject on summary view
                setTimeout(function() {
                    renderPnlTrend();
                    renderHeatMap();
                }, 150);
            };
        }

        // Hook into renderInventoryTable to inject aging bars
        const origRenderInventoryTable = window.renderInventoryTable;
        if (typeof origRenderInventoryTable === 'function') {
            window.renderInventoryTable = function() {
                origRenderInventoryTable.apply(this, arguments);
                setTimeout(renderAgingBars, 50);
            };
        }
    }

    function render() {
        // Called on data refresh
        const portfolioContent = document.getElementById('portfolio-content');
        if (portfolioContent && portfolioContent.querySelector('.metrics')) {
            renderPnlTrend();
            renderHeatMap();
        }
        // Aging bars injected via renderInventoryTable hook
        const tbody = document.getElementById('im-tbody');
        if (tbody && tbody.children.length > 0) {
            renderAgingBars();
        }
    }

    function cleanup() {
        const heatmap = document.getElementById('ws2-heatmap');
        if (heatmap) heatmap.remove();
        const trend = document.getElementById('ws2-pnl-trend');
        if (trend) trend.remove();
        const tooltip = document.getElementById('ws2-tooltip');
        if (tooltip) tooltip.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
