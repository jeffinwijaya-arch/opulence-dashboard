/**
 * MK Opulence — ws10-automation
 * Auto-price suggestions for unpriced watches + stale listing detection.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws10-automation', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws10-automation';
    const MK = window.MKModules;
    const STALE_DAYS = 7;
    const STALE_DROP_MIN = 0.03;
    const STALE_DROP_MAX = 0.05;

    let _initialized = false;
    let _inventoryCache = null;
    let _postingsCache = null;

    // ── Helpers ──

    function parseNum(v) {
        const n = parseFloat(String(v || '0').replace(/[$,]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function fmt(n) {
        return '$' + Math.round(Math.abs(n)).toLocaleString();
    }

    function daysSince(dateStr) {
        if (!dateStr) return Infinity;
        const d = new Date(dateStr + 'T00:00:00');
        const now = new Date();
        return Math.floor((now - d) / 86400000);
    }

    function extractRef(desc) {
        if (!desc) return null;
        const m = desc.match(/\b(1[12]\d{4}[A-Z]*)\b/);
        return m ? m[1] : null;
    }

    // ── Data Fetching ──

    async function fetchInventoryRows() {
        if (_inventoryCache) return _inventoryCache;
        try {
            const r = await fetch('/api/inventory/rows');
            const d = await r.json();
            _inventoryCache = d.ok ? (d.rows || []) : [];
        } catch (e) {
            console.error('[' + MOD_ID + '] inventory fetch:', e);
            _inventoryCache = [];
        }
        return _inventoryCache;
    }

    async function fetchPostings() {
        if (_postingsCache) return _postingsCache;
        try {
            const r = await fetch('/api/my-postings');
            const d = await r.json();
            _postingsCache = d.postings || d || [];
            if (!Array.isArray(_postingsCache)) _postingsCache = [];
        } catch (e) {
            console.error('[' + MOD_ID + '] postings fetch:', e);
            _postingsCache = [];
        }
        return _postingsCache;
    }

    // ── Feature 1: Auto-Price Suggestions ──

    function getUnpricedWatches(items) {
        const refs = (window.DATA && window.DATA.refs) ? window.DATA.refs : {};
        const unpriced = [];

        items.forEach(w => {
            if (w.sold === 'Yes') return;
            const sp = parseNum(w.sale_price);
            if (sp > 0) return; // already has sale price

            const ref = extractRef(w.description) || w.ref;
            if (!ref) return;

            const refData = refs[ref];
            if (!refData) return;

            const usLow = refData.us_low || 0;
            const b25 = refData.b25 || refData.median || 0;
            let suggested = 0;
            if (usLow > 0) {
                suggested = usLow - 100;
            } else if (b25 > 0) {
                suggested = b25;
            }
            if (suggested <= 0) return;

            unpriced.push({
                row: w.row || w.id,
                ref: ref,
                description: w.description || '',
                costPrice: parseNum(w.cost_price),
                suggestedPrice: Math.round(suggested),
                source: usLow > 0 ? 'US Low - $100' : 'B25'
            });
        });

        return unpriced;
    }

    function injectAutoPriceBanner(items) {
        // Only show on inventory page
        const invPage = document.getElementById('page-inventory');
        if (!invPage) return;

        // Remove old banner
        const old = document.getElementById('ws10-autoprice-banner');
        if (old) old.remove();

        const unpriced = getUnpricedWatches(items);
        if (unpriced.length === 0) return;

        const banner = document.createElement('div');
        banner.id = 'ws10-autoprice-banner';
        banner.style.cssText = 'background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.2);border-radius:8px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;';
        banner.innerHTML = `
            <div style="flex:1;min-width:0;">
                <span style="font-size:0.78rem;color:var(--text-1);font-weight:600;">${unpriced.length} watch${unpriced.length !== 1 ? 'es' : ''} need pricing</span>
                <span style="font-size:0.65rem;color:var(--text-2);margin-left:8px;">Market-based suggestions ready</span>
            </div>
            <button id="ws10-autoprice-btn" style="background:var(--accent);color:var(--bg-1);border:none;border-radius:6px;padding:6px 14px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:var(--mono);">Auto-Fill Prices</button>
        `;

        // Insert at top of inventory page, after page-head
        const pageHead = invPage.querySelector('.page-head');
        if (pageHead && pageHead.nextSibling) {
            invPage.insertBefore(banner, pageHead.nextSibling);
        } else {
            invPage.prepend(banner);
        }

        // Attach click handler
        document.getElementById('ws10-autoprice-btn').onclick = async function() {
            await applyAutoPrice(unpriced);
        };
    }

    async function applyAutoPrice(unpriced) {
        const btn = document.getElementById('ws10-autoprice-btn');
        if (!btn) return;
        btn.disabled = true;
        btn.textContent = 'Applying...';

        let success = 0;
        let failed = 0;

        for (const w of unpriced) {
            try {
                const r = await fetch('/api/inventory/' + w.row + '/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sale_price: String(w.suggestedPrice) })
                });
                const d = await r.json();
                if (d.ok) success++;
                else failed++;
            } catch (e) {
                failed++;
            }
        }

        if (typeof showToast === 'function') {
            if (failed === 0) {
                showToast('Priced ' + success + ' watch' + (success !== 1 ? 'es' : '') + ' successfully');
            } else {
                showToast('Priced ' + success + ', failed ' + failed, 'error');
            }
        }

        // Refresh
        _inventoryCache = null;
        btn.textContent = 'Done (' + success + '/' + unpriced.length + ')';
        btn.style.opacity = '0.6';

        // Reload inventory page if the function exists
        if (typeof loadInventoryPage === 'function') {
            setTimeout(loadInventoryPage, 500);
        }
    }

    // ── Feature 2: Stale Listing Detector ──

    function injectStaleBanner(postings) {
        // Only show on postings page
        const postingsPage = document.getElementById('page-postings');
        if (!postingsPage) return;

        // Remove old banner
        const old = document.getElementById('ws10-stale-banner');
        if (old) old.remove();

        // Find stale postings
        const stale = postings.filter(p => {
            const posted = p.posted_at || p.posted_date || '';
            if (!posted) return false;
            return daysSince(posted.slice(0, 10)) > STALE_DAYS;
        });

        if (stale.length === 0) return;

        // Calculate average suggested drop
        let totalDrop = 0;
        let dropCount = 0;
        stale.forEach(p => {
            const price = parseNum(p.price);
            if (price > 0) {
                const dropPct = STALE_DROP_MIN + Math.random() * (STALE_DROP_MAX - STALE_DROP_MIN);
                totalDrop += price * dropPct;
                dropCount++;
            }
        });
        const avgDrop = dropCount > 0 ? Math.round(totalDrop / dropCount) : 0;

        const banner = document.createElement('div');
        banner.id = 'ws10-stale-banner';
        banner.style.cssText = 'background:rgba(255,59,48,0.06);border:1px solid rgba(255,59,48,0.18);border-radius:8px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;';
        banner.innerHTML = `
            <div style="flex:1;min-width:0;">
                <span style="font-size:0.78rem;color:var(--red);font-weight:600;">${stale.length} listing${stale.length !== 1 ? 's' : ''} stale >${STALE_DAYS} days</span>
                ${avgDrop > 0 ? `<span style="font-size:0.65rem;color:var(--text-2);margin-left:8px;">Avg suggested drop: ${fmt(avgDrop)}</span>` : ''}
            </div>
            <button id="ws10-stale-review-btn" style="background:var(--red);color:white;border:none;border-radius:6px;padding:6px 14px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:var(--mono);">Review Stale</button>
        `;

        // Insert at top of postings page, after page-head
        const pageHead = postingsPage.querySelector('.page-head');
        if (pageHead && pageHead.nextSibling) {
            postingsPage.insertBefore(banner, pageHead.nextSibling);
        } else {
            postingsPage.prepend(banner);
        }

        // Attach click handler
        document.getElementById('ws10-stale-review-btn').onclick = function() {
            filterToStalePostings(stale);
        };
    }

    function filterToStalePostings(staleList) {
        // Get the active postings table body and cards
        const tbody = document.getElementById('postings-active-tbody');
        const cardsEl = document.getElementById('postings-active-cards');
        const staleIds = new Set(staleList.map(p => String(p.message_id || p.id)));

        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                // Check if this row's posting is in stale list by matching ref or description
                // We'll use a visual approach: dim non-stale rows
                row.style.display = '';
            });
        }

        // Re-render with only stale postings
        if (typeof renderActivePostings === 'function') {
            renderActivePostings(staleList);
        } else {
            // Fallback: render stale list in the table ourselves
            if (tbody) {
                tbody.innerHTML = staleList.map(p => {
                    const desc = (p.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const posted = (p.posted_at || p.posted_date || '').slice(0, 10);
                    const price = p.price ? '$' + Number(p.price).toLocaleString() : '--';
                    const age = daysSince(posted);
                    const sugDrop = parseNum(p.price) > 0
                        ? fmt(parseNum(p.price) * ((STALE_DROP_MIN + STALE_DROP_MAX) / 2))
                        : '--';
                    return `<tr>
                        <td style="vertical-align:middle;">${p.photo ? '<img src="/api/posting-photo/' + p.photo + '" style="width:50px;height:50px;object-fit:cover;border-radius:6px;">' : ''}</td>
                        <td style="font-weight:600;">${p.ref || '--'}</td>
                        <td style="max-width:300px;font-size:0.72rem;white-space:pre-line;line-height:1.35;word-break:break-word;">${desc}</td>
                        <td class="right" style="font-family:monospace;font-weight:600;">${price}</td>
                        <td class="right" style="color:var(--red);font-weight:600;">${age}d old</td>
                        <td class="right" style="font-size:0.7rem;color:var(--text-2);">Drop ~${sugDrop}</td>
                    </tr>`;
                }).join('');
            }
        }

        // Update the banner to show a "Show All" button
        const btn = document.getElementById('ws10-stale-review-btn');
        if (btn) {
            btn.textContent = 'Show All';
            btn.style.background = 'var(--bg-2)';
            btn.style.color = 'var(--text-1)';
            btn.onclick = function() {
                // Reload postings page
                if (typeof loadPostingsPage === 'function') {
                    loadPostingsPage();
                } else {
                    _postingsCache = null;
                    render();
                }
            };
        }

        if (typeof showToast === 'function') {
            showToast('Showing ' + staleList.length + ' stale listing' + (staleList.length !== 1 ? 's' : ''));
        }
    }

    // ── Module Lifecycle ──

    async function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        _initialized = true;

        // Listen for data refreshes
        MK.on('data-loaded', () => {
            _inventoryCache = null;
            _postingsCache = null;
            render();
        });

        // Listen for page changes to inject banners at the right time
        document.addEventListener('mk:page-changed', (e) => {
            const page = e.detail && e.detail.page;
            if (page === 'inventory' || page === 'postings') {
                setTimeout(render, 200);
            }
        });

        // Also hook into showPage if available — re-render after page switch
        const _origShowPage = window.showPage;
        if (typeof _origShowPage === 'function') {
            window.showPage = function(name) {
                _origShowPage.apply(this, arguments);
                if (name === 'inventory' || name === 'postings') {
                    setTimeout(render, 300);
                }
            };
        }

        await render();
    }

    async function render() {
        if (!_initialized) return;

        // Auto-price banner on inventory page
        const invPage = document.getElementById('page-inventory');
        if (invPage && (invPage.classList.contains('active') || invPage.offsetParent !== null)) {
            const items = await fetchInventoryRows();
            injectAutoPriceBanner(items);
        }

        // Stale listing banner on postings page
        const postPage = document.getElementById('page-postings');
        if (postPage && (postPage.classList.contains('active') || postPage.offsetParent !== null)) {
            const postings = await fetchPostings();
            injectStaleBanner(postings);
        }
    }

    function cleanup() {
        const b1 = document.getElementById('ws10-autoprice-banner');
        if (b1) b1.remove();
        const b2 = document.getElementById('ws10-stale-banner');
        if (b2) b2.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
