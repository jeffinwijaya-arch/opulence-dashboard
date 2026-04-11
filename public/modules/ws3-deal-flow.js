/**
 * MK Opulence — ws3-deal-flow
 * Deal Flow & Arbitrage enhancements.
 *
 * Features:
 *   1. Enhanced arbitrage calculator with full cost breakdown and True Margin column
 *   2. Snipe alert badge on deal cards (discount_pct > 10) with pulsing gold glow
 *      + "Snipes Only" filter button
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws3-deal-flow', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws3-deal-flow';
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    const fmt = n => window.MKModules.formatPrice(n);
    const pct = (n, d) => window.MKModules.formatPct(n, d);

    // ── Fee constants for true cost calculation ──
    const FEES = {
        SHIPPING: 150,
        INSURANCE_RATE: 0.015,  // 1.5% of value
        WIRE_FEE: 40,
        FEDEX_LABEL: 35
    };

    let snipesOnly = false;

    // ── CSS injection ──
    function injectStyles() {
        if (document.getElementById('ws3-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws3-styles';
        style.textContent = `
            /* Snipe badge */
            .deal-card.snipe-card {
                border-color: var(--accent) !important;
                animation: snipe-pulse 2s ease-in-out infinite;
                position: relative;
            }
            @keyframes snipe-pulse {
                0%, 100% {
                    box-shadow: 0 0 4px rgba(212,175,55,0.15), 0 0 12px rgba(212,175,55,0.05);
                }
                50% {
                    box-shadow: 0 0 8px rgba(212,175,55,0.4), 0 0 24px rgba(212,175,55,0.15), 0 0 40px rgba(212,175,55,0.06);
                }
            }
            .snipe-badge {
                display: inline-block;
                background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light, #e8c84a) 100%);
                color: var(--bg-0);
                font-size: 0.6rem;
                font-weight: 800;
                letter-spacing: 1.2px;
                text-transform: uppercase;
                padding: 2px 8px;
                border-radius: 3px;
                margin-left: 6px;
                font-family: var(--mono);
                vertical-align: middle;
                animation: snipe-badge-flash 2s ease-in-out infinite;
            }
            @keyframes snipe-badge-flash {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            /* Snipes Only filter button */
            .ws3-snipes-btn {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                border: 1px solid var(--border-strong);
                border-radius: 4px;
                background: var(--bg-2);
                color: var(--text-1);
                font-size: 0.72rem;
                font-family: var(--mono);
                cursor: pointer;
                transition: all 0.15s;
                white-space: nowrap;
            }
            .ws3-snipes-btn:hover {
                border-color: var(--accent);
                color: var(--accent);
            }
            .ws3-snipes-btn.active {
                background: rgba(212,175,55,0.12);
                border-color: var(--accent);
                color: var(--accent);
                font-weight: 600;
            }

            /* True Margin column highlight */
            .true-margin-cell {
                font-weight: 700;
                font-family: var(--mono);
                font-variant-numeric: tabular-nums;
            }

            /* Cost breakdown tooltip */
            .arb-cost-tooltip {
                position: relative;
                cursor: help;
            }
            .arb-cost-tooltip .cost-tip {
                display: none;
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: var(--bg-3);
                border: 1px solid var(--border-strong);
                border-radius: 6px;
                padding: 8px 12px;
                font-size: 0.68rem;
                font-family: var(--mono);
                color: var(--text-1);
                white-space: nowrap;
                z-index: 100;
                box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                pointer-events: none;
                min-width: 180px;
            }
            .arb-cost-tooltip .cost-tip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 5px solid transparent;
                border-top-color: var(--border-strong);
            }
            .arb-cost-tooltip:hover .cost-tip {
                display: block;
            }
            .cost-tip-row {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 1px 0;
            }
            .cost-tip-row.total {
                border-top: 1px solid var(--border-strong);
                margin-top: 4px;
                padding-top: 4px;
                font-weight: 600;
                color: var(--accent);
            }
        `;
        document.head.appendChild(style);
    }

    // ── Calculate true costs for an arb opportunity ──
    function calcTrueCosts(a) {
        const buyP = a.buy_price || 0;
        const sellP = a.sell_price || 0;
        const value = Math.max(buyP, sellP);

        const shipping = FEES.SHIPPING;
        const insurance = Math.round(value * FEES.INSURANCE_RATE);
        const wire = FEES.WIRE_FEE;
        const fedex = FEES.FEDEX_LABEL;
        const existingFees = a.import_fee || a.fees || 0;
        const totalAllFees = shipping + insurance + wire + fedex + existingFees;
        const trueNetProfit = sellP - buyP - totalAllFees;
        const trueMargin = buyP > 0 ? (trueNetProfit / (buyP + totalAllFees) * 100) : 0;

        return {
            shipping,
            insurance,
            wire,
            fedex,
            existingFees,
            totalAllFees,
            trueNetProfit,
            trueMargin
        };
    }

    // ── Build cost tooltip HTML ──
    function costTooltipHtml(costs) {
        return `<div class="cost-tip">
            <div class="cost-tip-row"><span>Shipping</span><span>${fmt(costs.shipping)}</span></div>
            <div class="cost-tip-row"><span>Insurance (1.5%)</span><span>${fmt(costs.insurance)}</span></div>
            <div class="cost-tip-row"><span>Wire transfer</span><span>${fmt(costs.wire)}</span></div>
            <div class="cost-tip-row"><span>FedEx label</span><span>${fmt(costs.fedex)}</span></div>
            ${costs.existingFees > 0 ? `<div class="cost-tip-row"><span>Import/duties</span><span>${fmt(costs.existingFees)}</span></div>` : ''}
            <div class="cost-tip-row total"><span>Total fees</span><span>${fmt(costs.totalAllFees)}</span></div>
        </div>`;
    }

    // ── Enhance arbitrage table ──
    function enhanceArbTable() {
        const table = document.getElementById('arb-table');
        if (!table) return;

        // Add True Margin header if not present
        const thead = table.querySelector('thead tr');
        if (thead && !thead.querySelector('.ws3-true-margin-th')) {
            // Insert True Margin column after Margin column
            const marginTh = thead.querySelectorAll('th');
            // Headers: Reference, Model, Buy, Sell, Fees, Net Profit, Margin, Conf, Depth
            // We insert "True Margin" after Margin (index 6)
            const trueMarginTh = document.createElement('th');
            trueMarginTh.className = 'right ws3-true-margin-th';
            trueMarginTh.textContent = 'True Margin';
            trueMarginTh.style.color = 'var(--accent)';
            if (marginTh[7]) {
                thead.insertBefore(trueMarginTh, marginTh[7]);
            } else {
                thead.appendChild(trueMarginTh);
            }
        }

        // Enhance each row
        const rows = table.querySelectorAll('tbody tr');
        const dir = document.getElementById('arb-direction')?.value || 'hk_to_us';
        const q = (document.getElementById('arb-search')?.value || '').toLowerCase();
        let arbs = (window.DATA?.arbitrage || []);
        if (dir !== 'all') arbs = arbs.filter(a => a.direction === dir);
        if (q) arbs = arbs.filter(a => [a.ref, a.model, a.dial || '', a.bracelet || ''].join(' ').toLowerCase().includes(q));

        rows.forEach((row, idx) => {
            const a = arbs[idx];
            if (!a) return;

            const costs = calcTrueCosts(a);

            // Update Fees cell (index 4) with tooltip
            const feesCell = row.cells[4];
            if (feesCell && !feesCell.querySelector('.arb-cost-tooltip')) {
                const originalText = feesCell.textContent;
                feesCell.innerHTML = `<div class="arb-cost-tooltip">${fmt(costs.totalAllFees)}${costTooltipHtml(costs)}</div>`;
                feesCell.className = 'right dim';
            }

            // Update Net Profit cell (index 5) with true net profit
            const profitCell = row.cells[5];
            if (profitCell) {
                const profitCls = costs.trueNetProfit > 0 ? 'green' : 'red';
                profitCell.innerHTML = fmt(costs.trueNetProfit);
                profitCell.className = `right ${profitCls}`;
                profitCell.style.fontWeight = '700';
            }

            // Insert True Margin cell if not already there
            if (!row.querySelector('.ws3-true-margin-td')) {
                const trueMarginTd = document.createElement('td');
                trueMarginTd.className = 'right ws3-true-margin-td true-margin-cell';
                const tmCls = costs.trueMargin > 0 ? 'pos' : 'neg';
                trueMarginTd.innerHTML = `<span class="pill ${tmCls}">${costs.trueMargin.toFixed(1)}%</span>`;
                // Insert after Margin cell (index 6)
                if (row.cells[7]) {
                    row.insertBefore(trueMarginTd, row.cells[7]);
                } else {
                    row.appendChild(trueMarginTd);
                }
            }
        });
    }

    // ── Add snipe badges to deal cards ──
    function enhanceDealCards() {
        const cards = document.querySelectorAll('#deals-cards .deal-card');
        const deals = window._dealsFiltered || window.DATA?.deals || [];

        cards.forEach((card, idx) => {
            const d = deals[idx];
            if (!d) return;

            const disc = d.discount_pct || d.gap_pct || 0;

            if (disc > 10) {
                // Add snipe class for pulsing gold border
                if (!card.classList.contains('snipe-card')) {
                    card.classList.add('snipe-card');
                }

                // Add SNIPE badge next to ref if not already present
                if (!card.querySelector('.snipe-badge')) {
                    const refSpan = card.querySelector('.ref');
                    if (refSpan) {
                        const badge = document.createElement('span');
                        badge.className = 'snipe-badge';
                        badge.textContent = 'SNIPE';
                        refSpan.insertAdjacentElement('afterend', badge);
                    }
                }
            }
        });
    }

    // ── Inject Snipes Only button into filter bar ──
    function injectSnipesButton() {
        const filterBar = document.querySelector('#deals-market-section > div:first-child');
        if (!filterBar || filterBar.querySelector('.ws3-snipes-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'ws3-snipes-btn';
        btn.textContent = 'Snipes Only';
        btn.addEventListener('click', () => {
            snipesOnly = !snipesOnly;
            btn.classList.toggle('active', snipesOnly);
            applySnipeFilter();
        });
        filterBar.appendChild(btn);
    }

    // ── Apply snipe filtering ──
    function applySnipeFilter() {
        const cards = document.querySelectorAll('#deals-cards .deal-card');
        const deals = window._dealsFiltered || window.DATA?.deals || [];

        if (!snipesOnly) {
            // Show all cards
            cards.forEach(c => c.style.display = '');
            return;
        }

        cards.forEach((card, idx) => {
            const d = deals[idx];
            if (!d) { card.style.display = 'none'; return; }
            const disc = d.discount_pct || d.gap_pct || 0;
            card.style.display = disc > 10 ? '' : 'none';
        });
    }

    // ── Hook into existing renderArbitrage ──
    function hookArbitrage() {
        const origRenderArbitrage = window.renderArbitrage;
        if (origRenderArbitrage && !origRenderArbitrage._ws3Hooked) {
            window.renderArbitrage = function() {
                origRenderArbitrage.apply(this, arguments);
                // Enhance after the original renders
                setTimeout(() => enhanceArbTable(), 0);
            };
            window.renderArbitrage._ws3Hooked = true;
        }
    }

    // ── Hook into existing applyDealsFilter ──
    function hookDeals() {
        const origApplyDealsFilter = window.applyDealsFilter;
        if (origApplyDealsFilter && !origApplyDealsFilter._ws3Hooked) {
            window.applyDealsFilter = function() {
                origApplyDealsFilter.apply(this, arguments);
                // Enhance after the original renders
                setTimeout(() => {
                    enhanceDealCards();
                    applySnipeFilter();
                }, 0);
            };
            window.applyDealsFilter._ws3Hooked = true;
        }
    }

    // ── Module init ──
    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();
        injectSnipesButton();
        hookArbitrage();
        hookDeals();
    }

    // ── Module render (called on data refresh) ──
    function render() {
        // Re-inject button if DOM was rebuilt
        injectSnipesButton();

        // Enhance deal cards if visible
        const marketSection = document.getElementById('deals-market-section');
        if (marketSection && marketSection.style.display !== 'none') {
            setTimeout(() => {
                enhanceDealCards();
                applySnipeFilter();
            }, 0);
        }

        // Enhance arb table if visible
        const arbSection = document.getElementById('deals-arb-section');
        if (arbSection && arbSection.style.display !== 'none') {
            setTimeout(() => enhanceArbTable(), 0);
        }
    }

    function cleanup() {
        // Remove injected styles
        const style = document.getElementById('ws3-styles');
        if (style) style.remove();
        snipesOnly = false;
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
