/**
 * MK Opulence — ws3-deal-flow
 * Deal Flow & Arbitrage workstream module.
 *
 * Features:
 *   1. Enhanced arbitrage calculator — real cost model:
 *      shipping $150, insurance 1.5% of value, wire $40, FedEx label $35
 *      → injects "True Net" column into arb table + cost banner above table
 *   2. Snipe alert badge — deal cards priced >10% below B25 get a
 *      pulsing gold border + "SNIPE" badge
 */

(function () {
    'use strict';

    const MOD_ID = 'ws3-deal-flow';

    // =========================================================
    // COST MODEL CONSTANTS
    // =========================================================
    const COSTS = {
        shipping:    150,   // FedEx International Priority (flat)
        insurancePct: 0.015, // 1.5% of declared buy value
        wireFee:     40,    // incoming wire fee
        fedexLabel:  35,    // FedEx label & handling paperwork
    };

    function fmt(n) {
        if (n == null || isNaN(n)) return '—';
        return '$' + Math.round(n).toLocaleString('en-US');
    }

    // =========================================================
    // SECTION 1 — ENHANCED ARBITRAGE CALCULATOR
    // =========================================================

    function calcTrueCosts(buyPrice) {
        const shipping  = COSTS.shipping;
        const insurance = Math.round(buyPrice * COSTS.insurancePct);
        const wire      = COSTS.wireFee;
        const label     = COSTS.fedexLabel;
        const total     = shipping + insurance + wire + label;
        return { shipping, insurance, wire, label, total };
    }

    function injectArbStyles() {
        if (document.getElementById('ws3-arb-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws3-arb-styles';
        style.textContent = `
            .ws3-true-net-th {
                color: var(--accent) !important;
                white-space: nowrap;
            }
            .ws3-true-net-td {
                font-family: var(--mono);
                white-space: nowrap;
            }
            .ws3-cost-panel {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 10px;
                background: var(--bg-2);
                border: 1px solid var(--accent-border);
                border-radius: var(--radius);
                padding: 8px 14px;
                margin-bottom: 10px;
            }
            .ws3-cost-label {
                font-size: 0.6rem;
                font-weight: 700;
                color: var(--accent);
                font-family: var(--mono);
                text-transform: uppercase;
                letter-spacing: 1px;
                flex-shrink: 0;
                margin-right: 4px;
            }
            .ws3-cost-item {
                font-size: 0.63rem;
                color: var(--text-2);
                font-family: var(--mono);
            }
            .ws3-cost-item b {
                color: var(--text-1);
            }
        `;
        document.head.appendChild(style);
    }

    function injectArbCostPanel() {
        const section = document.getElementById('deals-arb-section');
        if (!section) return;
        if (section.querySelector('.ws3-cost-panel')) return; // already present

        const panel = document.createElement('div');
        panel.className = 'ws3-cost-panel';
        panel.title = 'Fixed cost model used to compute True Net Margin';
        panel.innerHTML =
            '<span class="ws3-cost-label">Real Cost Model</span>' +
            '<span class="ws3-cost-item">Ship <b>$' + COSTS.shipping + '</b></span>' +
            '<span class="ws3-cost-item">Insurance <b>' + (COSTS.insurancePct * 100).toFixed(1) + '% of value</b></span>' +
            '<span class="ws3-cost-item">Wire <b>$' + COSTS.wireFee + '</b></span>' +
            '<span class="ws3-cost-item">Label <b>$' + COSTS.fedexLabel + '</b></span>' +
            '<span class="ws3-cost-item" style="margin-left:auto;color:var(--text-3);">True Net = Sell − Buy − all costs</span>';

        // Insert before the card that wraps the table
        const card = section.querySelector('.card');
        if (card) section.insertBefore(panel, card);
    }

    function injectTrueNetColumn() {
        const table = document.getElementById('arb-table');
        if (!table) return;

        // ------ Header TH (injected once, survives tbody re-renders) ------
        const thead = table.tHead;
        if (thead && !thead.querySelector('.ws3-true-net-th')) {
            const th = document.createElement('th');
            th.className = 'ws3-true-net-th right';
            th.textContent = 'True Net';
            const headerRow = thead.rows[0];
            if (headerRow) {
                // Insert after column index 6 (Margin), before Conf
                const refCell = headerRow.cells[7]; // "Conf" is at index 7
                if (refCell) headerRow.insertBefore(th, refCell);
                else headerRow.appendChild(th);
            }
        }

        // ------ Data cells (injected after each renderArbitrage() re-render) ------
        const dir = document.getElementById('arb-direction')?.value || 'hk_to_us';
        const q   = (document.getElementById('arb-search')?.value || '').toLowerCase();
        let arbs  = (window.DATA && window.DATA.arbitrage) || [];
        if (dir !== 'all') arbs = arbs.filter(a => a.direction === dir);
        if (q) arbs = arbs.filter(a =>
            [a.ref, a.model, a.dial || '', a.bracelet || ''].join(' ').toLowerCase().includes(q)
        );

        const tbody = table.tBodies[0];
        if (!tbody) return;

        Array.from(tbody.rows).forEach((row, idx) => {
            if (row.querySelector('.ws3-true-net-td')) return; // already injected this render

            const a = arbs[idx];
            if (!a) return;

            const buyP  = a.buy_price  || (a.direction === 'us_to_hk' ? a.us_price : a.hk_price)  || 0;
            const sellP = a.sell_price || (a.direction === 'us_to_hk' ? a.hk_price : a.us_price) || 0;
            const costs = calcTrueCosts(buyP);
            const trueNet = sellP - buyP - costs.total;
            const truePct = buyP > 0 ? (trueNet / buyP * 100) : 0;
            const color   = trueNet > 0 ? 'var(--green)' : 'var(--red)';

            const td = document.createElement('td');
            td.className = 'ws3-true-net-td right';
            td.title = [
                'True Net Calculation:',
                'Sell price:  ' + fmt(sellP),
                'Buy price:   ' + fmt(buyP),
                'Shipping:   -' + fmt(costs.shipping),
                'Insurance:  -' + fmt(costs.insurance) + ' (1.5% of ' + fmt(buyP) + ')',
                'Wire fee:   -' + fmt(costs.wire),
                'FedEx label:-' + fmt(costs.label),
                '─────────────',
                'TRUE NET:    ' + (trueNet >= 0 ? '+' : '') + fmt(trueNet),
            ].join('\n');
            td.innerHTML =
                '<span style="font-weight:700;color:' + color + ';">' +
                    (trueNet >= 0 ? '+' : '') + Math.round(trueNet).toLocaleString('en-US') +
                '</span>' +
                '<br><span style="font-size:0.6rem;color:var(--text-2);">' +
                    (truePct >= 0 ? '+' : '') + truePct.toFixed(1) + '%' +
                '</span>';

            // Insert after Margin column (index 6) — before Conf column (now at index 7)
            const refCell = row.cells[7];
            if (refCell) row.insertBefore(td, refCell);
            else row.appendChild(td);
        });
    }

    // =========================================================
    // SECTION 2 — SNIPE ALERT BADGE (>10% below B25)
    // =========================================================

    function injectSnipeStyles() {
        if (document.getElementById('ws3-snipe-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws3-snipe-styles';
        style.textContent = `
            @keyframes ws3-snipe-pulse {
                0%, 100% {
                    box-shadow: 0 0 0 0 rgba(212,175,55,0.55), var(--shadow-md, 0 4px 16px rgba(0,0,0,0.3));
                    border-color: rgba(212,175,55,0.85);
                }
                50% {
                    box-shadow: 0 0 0 7px rgba(212,175,55,0), var(--shadow-md, 0 4px 16px rgba(0,0,0,0.3));
                    border-color: rgba(212,175,55,0.35);
                }
            }
            .ws3-snipe-card {
                border-color: rgba(212,175,55,0.85) !important;
                animation: ws3-snipe-pulse 1.8s ease-in-out infinite !important;
            }
            .ws3-snipe-badge {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                background: var(--accent, #d4af37);
                color: #000;
                border-radius: 3px;
                padding: 1px 6px;
                font-family: var(--mono);
                font-size: 0.6rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                vertical-align: middle;
                flex-shrink: 0;
                cursor: default;
            }
        `;
        document.head.appendChild(style);
    }

    function getVisibleDeals() {
        const q          = (document.getElementById('deals-search')?.value || '').toLowerCase();
        const tierFilter = document.getElementById('deals-tier')?.value || '';

        // Determine active region from tab state
        let region = 'all';
        const tabs = document.querySelectorAll('#deals-market-section .tabs .tab');
        for (const tab of tabs) {
            if (!tab.classList.contains('active')) continue;
            const t = tab.textContent.trim();
            if (t === 'US')          region = 'US';
            else if (t.startsWith('HK')) region = 'HK';
            break;
        }

        let f = (window.DATA && window.DATA.deals) || [];
        if (region !== 'all') f = f.filter(d => d.region === region);
        if (tierFilter)       f = f.filter(d => d.tier === tierFilter);
        if (q) {
            f = f.filter(d =>
                [d.ref, d.model, d.dial, d.seller, d.group].join(' ').toLowerCase().includes(q)
            );
        }
        return f.slice(0, 30);
    }

    function injectSnipeBadges() {
        const cards = document.querySelectorAll('#deals-cards .deal-card');
        if (!cards.length) return;

        const visible = getVisibleDeals();

        cards.forEach((card, idx) => {
            const d = visible[idx];
            if (!d) return;

            const discPct = d.discount_pct || d.gap_pct || 0;
            const isSnipe = discPct > 10;

            // Toggle pulsing border class
            card.classList.toggle('ws3-snipe-card', isSnipe);

            if (isSnipe) {
                if (card.querySelector('.ws3-snipe-badge')) return; // already there

                const badge = document.createElement('span');
                badge.className = 'ws3-snipe-badge';
                badge.title = discPct.toFixed(1) + '% below B25 market price — potential snipe opportunity';
                badge.textContent = '\u2605 SNIPE';   // ★ SNIPE

                // Place badge in the top-right price area alongside the discount %
                const rightDiv = card.querySelector('div[style*="text-align:right"]');
                if (rightDiv) {
                    // Insert just before the right-side price column
                    rightDiv.parentElement.insertBefore(badge, rightDiv);
                } else {
                    // Fallback: prepend to the card's first row
                    const firstRow = card.querySelector('div[style*="justify-content:space-between"]');
                    if (firstRow) firstRow.prepend(badge);
                }
            } else {
                card.querySelector('.ws3-snipe-badge')?.remove();
            }
        });
    }

    // =========================================================
    // MODULE LIFECYCLE
    // =========================================================

    function init() {
        console.log('[' + MOD_ID + '] init');

        injectSnipeStyles();
        injectArbStyles();

        // Wrap applyDealsFilter → inject snipe badges after each render
        if (typeof window.applyDealsFilter === 'function') {
            const _orig = window.applyDealsFilter;
            window.applyDealsFilter = function () {
                _orig.apply(this, arguments);
                try { injectSnipeBadges(); } catch (e) { console.warn('[' + MOD_ID + '] snipe:', e); }
            };
        }

        // Wrap renderArbitrage → inject cost panel + True Net column after each render
        if (typeof window.renderArbitrage === 'function') {
            const _origArb = window.renderArbitrage;
            window.renderArbitrage = function () {
                _origArb.apply(this, arguments);
                try { injectArbCostPanel(); } catch (e) { console.warn('[' + MOD_ID + '] arb panel:', e); }
                try { injectTrueNetColumn(); } catch (e) { console.warn('[' + MOD_ID + '] true net:', e); }
            };
        }
    }

    function render() {
        // Called on data reload/refresh
        if (document.querySelector('#deals-cards .deal-card')) {
            try { injectSnipeBadges(); } catch (e) {}
        }
        const arbTbody = document.getElementById('arb-table')?.tBodies[0];
        if (arbTbody && arbTbody.rows.length) {
            try { injectArbCostPanel(); } catch (e) {}
            try { injectTrueNetColumn(); } catch (e) {}
        }
    }

    function cleanup() {}

    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
