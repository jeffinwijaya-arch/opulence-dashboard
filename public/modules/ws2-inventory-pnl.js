/**
 * MK Opulence — ws2-inventory-pnl
 * Inventory P&L workstream module.
 *
 * Features:
 *   1. Portfolio heat map — compact colored squares injected into the
 *      Portfolio Summary tab: green (>5% profit), yellow (0-5%), red (loss).
 *      Tile size is proportional to capital deployed (cost_price).
 */

(function () {
    'use strict';

    const MOD_ID = 'ws2-inventory-pnl';

    // =========================================================
    // STYLES
    // =========================================================

    function injectStyles() {
        if (document.getElementById('ws2-pnl-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws2-pnl-styles';
        style.textContent = `
            .ws2-hm-legend {
                display: flex;
                gap: 14px;
                align-items: center;
                flex-wrap: wrap;
                font-size: 0.65rem;
                color: var(--text-2);
                margin-bottom: 8px;
            }
            .ws2-hm-legend-dot {
                width: 9px;
                height: 9px;
                border-radius: 2px;
                display: inline-block;
                vertical-align: middle;
                margin-right: 3px;
            }
            .ws2-hm-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 3px;
            }
            .ws2-hm-tile {
                display: inline-flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                border-radius: 3px;
                border: 1px solid transparent;
                cursor: pointer;
                padding: 4px 6px;
                text-align: center;
                transition: transform 0.1s, filter 0.1s;
                box-sizing: border-box;
                overflow: hidden;
            }
            .ws2-hm-tile:hover {
                transform: scale(1.1);
                filter: brightness(1.25);
                z-index: 2;
                position: relative;
            }
            .ws2-hm-tile-ref {
                font-family: var(--mono);
                font-weight: 700;
                color: var(--text-0);
                line-height: 1.1;
                white-space: nowrap;
            }
            .ws2-hm-tile-pct {
                font-family: var(--mono);
                font-weight: 600;
                margin-top: 2px;
                line-height: 1.1;
            }
            .ws2-hm-tile-cost {
                font-family: var(--mono);
                color: rgba(255,255,255,0.45);
                margin-top: 1px;
                line-height: 1;
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function fmt(n) {
        if (n == null || isNaN(n)) return '—';
        return '$' + Math.round(n).toLocaleString('en-US');
    }

    // =========================================================
    // HEAT MAP — build and inject into Portfolio Summary
    // =========================================================

    /**
     * Build the heat-map HTML from inventory items.
     * Items come from /api/inventory (portfolio-enriched endpoint):
     *   i.sold        — boolean (falsy = still in inventory)
     *   i.profit_pct  — number (% P&L vs cost)
     *   i.profit_loss — number (dollar P&L)
     *   i.cost_price  — number
     *   i.ref         — string
     *   i.days_held   — number
     *   i.posted      — boolean
     *   i.at_store    — boolean
     */
    function buildHeatmap(items) {
        // Active (unsold) positions only
        const active = items.filter(i => !i.sold);
        if (!active.length) {
            return '<div style="padding:12px;color:var(--text-2);font-size:0.8rem;">No active positions</div>';
        }

        // Sort: biggest capital first so large tiles cluster top-left
        active.sort((a, b) => (b.cost_price || 0) - (a.cost_price || 0));

        const totalCap = active.reduce((s, i) => s + (i.cost_price || 0), 0) || 1;

        const tiles = active.map(i => {
            const pct  = i.profit_pct  != null ? i.profit_pct  : 0;
            const cost = i.cost_price  || 0;
            const weight = cost / totalCap;

            // Tile side-length: min 48 px, scales with capital weight, cap at 110 px
            const side = Math.min(110, Math.max(48, Math.round(48 + weight * 700)));
            const large = side >= 68;
            const small = side < 56;

            // ── Color bucket ──────────────────────────────────
            // green  : profit_pct > 5 %
            // yellow : 0 % ≤ profit_pct ≤ 5 %
            // red    : profit_pct < 0 %
            let bg, borderColor, pctColor;
            if (pct > 5) {
                // Green — scale intensity from 5 % to 20 %+
                const t = Math.min(1, (pct - 5) / 15);
                bg          = `rgba(0,200,83,${(0.15 + t * 0.30).toFixed(2)})`;
                borderColor = `rgba(0,200,83,${(0.30 + t * 0.30).toFixed(2)})`;
                pctColor    = 'var(--green)';
            } else if (pct >= 0) {
                // Yellow (accent) — scale intensity from 0 % to 5 %
                const t = pct / 5;
                bg          = `rgba(212,175,55,${(0.10 + t * 0.25).toFixed(2)})`;
                borderColor = `rgba(212,175,55,${(0.25 + t * 0.25).toFixed(2)})`;
                pctColor    = 'var(--accent)';
            } else {
                // Red — scale intensity from 0 % to -15 %
                const t = Math.min(1, Math.abs(pct) / 15);
                bg          = `rgba(255,23,68,${(0.10 + t * 0.30).toFixed(2)})`;
                borderColor = `rgba(255,23,68,${(0.25 + t * 0.30).toFixed(2)})`;
                pctColor    = 'var(--red)';
            }

            const pctStr  = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
            const refSize = small ? '0.58rem' : large ? '0.75rem' : '0.65rem';
            const pctSize = small ? '0.55rem' : large ? '0.68rem' : '0.6rem';

            const status = i.posted ? 'LISTED'
                : i.at_store        ? 'AT STORE'
                : 'IN HAND';

            const tooltip = [
                i.ref,
                'Cost: '      + fmt(cost),
                'P&L: '       + pctStr + (i.profit_loss != null ? ' (' + fmt(i.profit_loss) + ')' : ''),
                'Status: '    + status,
                'Days held: ' + (i.days_held || 0) + 'd',
            ].join('\n');

            return `<div class="ws2-hm-tile"
                title="${tooltip.replace(/"/g, '&quot;')}"
                onclick="lookupRef('${i.ref}')"
                style="background:${bg};border-color:${borderColor};width:${side}px;height:${side}px;">
                <div class="ws2-hm-tile-ref" style="font-size:${refSize};">${i.ref}</div>
                <div class="ws2-hm-tile-pct" style="color:${pctColor};font-size:${pctSize};">${pctStr}</div>
                ${large ? `<div class="ws2-hm-tile-cost" style="font-size:0.55rem;">${fmt(cost)}</div>` : ''}
            </div>`;
        }).join('');

        // Stats summary
        const profitable = active.filter(i => (i.profit_pct || 0) > 5).length;
        const flat       = active.filter(i => (i.profit_pct || 0) >= 0 && (i.profit_pct || 0) <= 5).length;
        const underwater = active.filter(i => (i.profit_pct || 0) < 0).length;

        const legend = `<div class="ws2-hm-legend">
            <span>Size = capital deployed</span>
            <span><span class="ws2-hm-legend-dot" style="background:rgba(0,200,83,0.45);"></span>Profit &gt;5% (${profitable})</span>
            <span><span class="ws2-hm-legend-dot" style="background:rgba(212,175,55,0.35);"></span>Flat 0–5% (${flat})</span>
            <span><span class="ws2-hm-legend-dot" style="background:rgba(255,23,68,0.40);"></span>Loss (${underwater})</span>
            <span style="margin-left:auto;color:var(--text-3);">${active.length} positions · ${fmt(totalCap)} deployed</span>
        </div>`;

        return legend + `<div class="ws2-hm-grid">${tiles}</div>`;
    }

    /**
     * Inject a heat-map card at the bottom of the Portfolio Summary tab.
     * `items` — the full inventory array passed to renderPfSummary.
     */
    function injectHeatmapCard(items) {
        const container = document.querySelector('#portfolio-content .fade-in');
        if (!container) return;
        if (container.querySelector('.ws2-heatmap-card')) return; // already present

        if (!items || !items.length) return;

        const card = document.createElement('div');
        card.className = 'card ws2-heatmap-card';
        card.style.marginTop = '8px';
        card.innerHTML =
            '<div class="card-head">' +
                '<span>Portfolio Heat Map</span>' +
                '<span style="font-size:0.63rem;color:var(--text-2);font-weight:400;' +
                      'text-transform:none;letter-spacing:0;">' +
                    'active positions · color = profit tier · size = capital' +
                '</span>' +
            '</div>' +
            '<div class="card-body" style="padding:10px 12px;">' +
                buildHeatmap(items) +
            '</div>';

        container.appendChild(card);
    }

    // =========================================================
    // MODULE LIFECYCLE
    // =========================================================

    function init() {
        console.log('[' + MOD_ID + '] init');
        injectStyles();

        // Wrap renderPfSummary — inject heat map after every Summary render
        if (typeof window.renderPfSummary === 'function') {
            const _orig = window.renderPfSummary;
            window.renderPfSummary = function (c, p, items) {
                _orig.call(this, c, p, items);
                // DOM settles after _orig sets innerHTML; use rAF + small delay
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        try { injectHeatmapCard(items); }
                        catch (e) { console.warn('[' + MOD_ID + '] heatmap inject:', e); }
                    }, 50);
                });
            };
        }
    }

    function render() {
        // Called on data refresh — re-inject if summary tab is visible
        const container = document.querySelector('#portfolio-content .fade-in');
        if (container && !container.querySelector('.ws2-heatmap-card')) {
            try { injectHeatmapCard(window.inventoryItems || []); }
            catch (e) {}
        }
    }

    function cleanup() {}

    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
