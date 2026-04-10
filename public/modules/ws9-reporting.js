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
    }

    function cleanup() {
        const el = document.getElementById('ws9-weekly-pnl');
        if (el) el.remove();
        const tab = document.getElementById('ws9-pf-tab');
        if (tab) tab.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
