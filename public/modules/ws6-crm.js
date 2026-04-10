/**
 * MK Opulence — ws6-crm
 * Buyer purchase history + seller reliability scores.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws6-crm', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws6-crm';
    const fmt = window.MKModules.formatPrice;

    // ── Buyer Purchase History Cache ────────────────────────────────
    let _inventoryCache = null;
    let _inventoryCacheTs = 0;
    const CACHE_TTL = 60000; // 1 minute

    async function getInventory() {
        const now = Date.now();
        if (_inventoryCache && (now - _inventoryCacheTs) < CACHE_TTL) {
            return _inventoryCache;
        }
        try {
            const r = await fetch('/api/inventory');
            if (!r.ok) return _inventoryCache || [];
            const data = await r.json();
            _inventoryCache = Array.isArray(data) ? data : (data.rows || data.items || []);
            _inventoryCacheTs = now;
            return _inventoryCache;
        } catch (e) {
            console.error('[ws6] Failed to fetch inventory:', e);
            return _inventoryCache || [];
        }
    }

    function getBuyerHistory(buyerName, inventory) {
        if (!buyerName || !inventory || !inventory.length) return null;
        const name = buyerName.toLowerCase().trim();
        const purchases = inventory.filter(w =>
            w.sold_to && w.sold_to.toLowerCase().trim() === name
        );
        if (!purchases.length) return null;

        const totalSpend = purchases.reduce((sum, w) => {
            const price = parseFloat(String(w.sold_price || w.sale_price || 0).replace(/[$,]/g, ''));
            return sum + (isNaN(price) ? 0 : price);
        }, 0);
        const avgPrice = purchases.length > 0 ? totalSpend / purchases.length : 0;
        const refs = purchases.map(w => w.ref).filter(Boolean);

        // Sort by buy_date descending
        purchases.sort((a, b) => (b.buy_date || '').localeCompare(a.buy_date || ''));

        return {
            buyerName: buyerName,
            totalWatches: purchases.length,
            totalSpend: totalSpend,
            avgPrice: avgPrice,
            refs: refs,
            purchases: purchases
        };
    }

    // ── Referral Tracking (localStorage-based) ───────────────────────
    const REFERRAL_KEY = 'mk_referrals';

    function loadReferrals() {
        try {
            var raw = localStorage.getItem(REFERRAL_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function saveReferrals(map) {
        try { localStorage.setItem(REFERRAL_KEY, JSON.stringify(map)); } catch (e) {}
    }

    function setReferral(buyerName, referrerName) {
        if (!buyerName) return;
        var map = loadReferrals();
        if (referrerName && referrerName.trim()) {
            map[buyerName.toLowerCase().trim()] = referrerName.trim();
        } else {
            delete map[buyerName.toLowerCase().trim()];
        }
        saveReferrals(map);
    }

    function getReferral(buyerName) {
        if (!buyerName) return '';
        var map = loadReferrals();
        return map[buyerName.toLowerCase().trim()] || '';
    }

    function getReferralChain(buyerName) {
        var chain = [];
        var seen = {};
        var current = buyerName;
        var map = loadReferrals();
        while (current) {
            var key = current.toLowerCase().trim();
            if (seen[key]) break; // avoid cycles
            seen[key] = true;
            var referrer = map[key];
            if (referrer) {
                chain.push(referrer);
                current = referrer;
            } else {
                break;
            }
        }
        return chain;
    }

    /** Build "Top Referrers" data from referral map + inventory */
    function computeTopReferrers(inventory) {
        var map = loadReferrals();
        var referrerStats = {}; // referrer_name -> { count, totalValue, buyers[] }

        Object.entries(map).forEach(function(entry) {
            var buyerKey = entry[0];
            var referrer = entry[1];
            var refKey = referrer.toLowerCase().trim();

            if (!referrerStats[refKey]) {
                referrerStats[refKey] = { name: referrer, count: 0, totalValue: 0, buyers: [] };
            }
            referrerStats[refKey].count += 1;
            referrerStats[refKey].buyers.push(buyerKey);

            // Sum the referred buyer's purchases
            if (inventory && inventory.length) {
                inventory.forEach(function(w) {
                    if (w.sold_to && w.sold_to.toLowerCase().trim() === buyerKey) {
                        var price = parseFloat(String(w.sold_price || w.sale_price || 0).replace(/[$,]/g, ''));
                        if (!isNaN(price)) referrerStats[refKey].totalValue += price;
                    }
                });
            }
        });

        return Object.values(referrerStats).sort(function(a, b) { return b.count - a.count; });
    }

    // ── Render referral input on watch detail ──────────────────────
    function renderReferralInput(buyerName) {
        var existing = document.getElementById('ws6-referral-input');
        if (existing) existing.remove();
        if (!buyerName) return;

        var overlay = document.getElementById('watch-detail-overlay');
        if (!overlay) return;

        var currentReferrer = getReferral(buyerName);
        var chain = getReferralChain(buyerName);

        var chainHtml = '';
        if (chain.length > 0) {
            chainHtml = '<div style="margin-top:4px;font-size:0.65rem;color:var(--text-2);">'
                + 'Chain: ' + buyerName + ' <span style="color:var(--text-3);">&larr;</span> '
                + chain.map(function(r) { return '<span style="color:var(--accent);">' + r + '</span>'; }).join(' <span style="color:var(--text-3);">&larr;</span> ')
                + '</div>';
        }

        // Get all known buyers for the datalist
        var allBuyers = [];
        if (_inventoryCache && _inventoryCache.length) {
            var seen = {};
            _inventoryCache.forEach(function(w) {
                if (w.sold_to && !seen[w.sold_to.toLowerCase()]) {
                    seen[w.sold_to.toLowerCase()] = true;
                    allBuyers.push(w.sold_to);
                }
            });
            allBuyers.sort();
        }

        var datalistOpts = allBuyers.map(function(b) {
            return '<option value="' + b.replace(/"/g, '&quot;') + '">';
        }).join('');

        var wrapper = document.createElement('div');
        wrapper.id = 'ws6-referral-input';
        wrapper.style.cssText = 'margin-top:8px;padding:8px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);';
        wrapper.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
            + '<span style="font-size:0.72rem;color:var(--text-2);white-space:nowrap;">Referred by:</span>'
            + '<input list="ws6-referrer-list" id="ws6-referrer-value" class="input" value="' + (currentReferrer || '').replace(/"/g, '&quot;') + '" placeholder="Enter referrer name..." style="flex:1;font-size:0.75rem;padding:4px 8px;height:28px;">'
            + '<datalist id="ws6-referrer-list">' + datalistOpts + '</datalist>'
            + '<button class="btn" id="ws6-save-referral" style="font-size:0.68rem;padding:4px 10px;height:28px;">Save</button>'
            + '</div>'
            + chainHtml;

        // Insert after the buyer history panel or after the invoice section
        var historyPanel = document.getElementById(HISTORY_PANEL_ID);
        var invoiceSection = document.getElementById('wd-invoice-section');
        var insertTarget = historyPanel || invoiceSection;
        if (insertTarget) {
            insertTarget.parentElement.insertBefore(wrapper, insertTarget.nextSibling);
        } else {
            // Fallback: insert before buttons
            var content = overlay.querySelector('div > div');
            if (content) {
                var buttons = content.querySelector('div:last-child');
                if (buttons) content.insertBefore(wrapper, buttons);
            }
        }

        // Attach save handler
        var saveBtn = document.getElementById('ws6-save-referral');
        var input = document.getElementById('ws6-referrer-value');
        if (saveBtn && input) {
            saveBtn.onclick = function() {
                setReferral(buyerName, input.value);
                if (typeof showToast === 'function') {
                    showToast(input.value ? 'Referral saved: ' + buyerName + ' <- ' + input.value : 'Referral cleared', 'ok');
                }
                // Re-render to update chain
                renderReferralInput(buyerName);
            };
            input.onkeydown = function(e) {
                if (e.key === 'Enter') saveBtn.click();
            };
        }
    }

    // ── Top Referrers Card (injected on CRM page) ──────────────────
    function renderTopReferrersCard(inventory) {
        var old = document.getElementById('ws6-top-referrers');
        if (old) old.remove();

        var topReferrers = computeTopReferrers(inventory);
        if (!topReferrers.length) return;

        var crmPage = document.getElementById('page-ad-crm');
        if (!crmPage) return;

        var rows = topReferrers.slice(0, 10).map(function(r, idx) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">'
                + '<span style="font-size:0.72rem;font-weight:700;color:var(--text-2);min-width:20px;">' + (idx + 1) + '</span>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:0.78rem;font-weight:600;color:var(--text-0);">' + r.name + '</div>'
                + '<div style="font-size:0.65rem;color:var(--text-2);">' + r.count + ' referral' + (r.count !== 1 ? 's' : '') + ' -- ' + r.buyers.map(function(b) { return b; }).join(', ') + '</div>'
                + '</div>'
                + '<span style="font-family:var(--mono);font-size:0.78rem;font-weight:700;color:var(--green);">' + fmt(r.totalValue) + '</span>'
                + '</div>';
        }).join('');

        var totalReferred = topReferrers.reduce(function(s, r) { return s + r.count; }, 0);
        var totalValue = topReferrers.reduce(function(s, r) { return s + r.totalValue; }, 0);

        var card = document.createElement('div');
        card.id = 'ws6-top-referrers';
        card.className = 'card';
        card.style.marginTop = '12px';
        card.innerHTML = '<div class="card-head"><span>Top Referrers</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + totalReferred + ' referrals -- ' + fmt(totalValue) + ' total value</span></div>'
            + '<div style="padding:8px 14px;">' + rows + '</div>';

        // Insert at the top of the CRM page content area (after page header)
        var pageHead = crmPage.querySelector('.page-head');
        if (pageHead) {
            pageHead.parentElement.insertBefore(card, pageHead.nextSibling);
        } else {
            crmPage.insertBefore(card, crmPage.firstChild);
        }
    }

    // ── Render buyer history panel ──────────────────────────────────
    const HISTORY_PANEL_ID = 'ws6-buyer-history';

    function renderBuyerHistoryPanel(history) {
        let panel = document.getElementById(HISTORY_PANEL_ID);
        if (panel) panel.remove();

        if (!history) return;

        panel = document.createElement('div');
        panel.id = HISTORY_PANEL_ID;
        panel.style.cssText = 'margin-top:12px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);overflow:hidden;';

        const refCounts = {};
        history.refs.forEach(r => { refCounts[r] = (refCounts[r] || 0) + 1; });
        const topRefs = Object.entries(refCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([ref, count]) => `<span style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:0.68rem;font-family:var(--mono);color:var(--text-1);">${ref}${count > 1 ? ' x' + count : ''}</span>`)
            .join(' ');

        const purchaseRows = history.purchases.slice(0, 5).map(w => {
            const price = parseFloat(String(w.sold_price || w.sale_price || 0).replace(/[$,]/g, ''));
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.72rem;border-bottom:1px solid var(--border);">
                <span style="color:var(--text-1);">${w.ref || '?'} <span style="color:var(--text-3);">${w.dial || ''}</span></span>
                <span style="font-family:var(--mono);color:var(--text-0);">${fmt(price)}</span>
            </div>`;
        }).join('');

        panel.innerHTML = `
            <div style="padding:10px 14px;background:var(--bg-2);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.ws6-arrow').textContent=this.nextElementSibling.style.display==='none'?'+':'-'">
                <div>
                    <span style="font-size:0.72rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">Buyer History</span>
                    <span style="font-size:0.72rem;color:var(--text-2);margin-left:8px;">${history.buyerName} -- ${history.totalWatches} purchase${history.totalWatches !== 1 ? 's' : ''}</span>
                </div>
                <span class="ws6-arrow" style="color:var(--text-2);font-size:1rem;font-weight:700;">+</span>
            </div>
            <div style="display:none;padding:12px 14px;">
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:10px;">
                    <div style="background:var(--bg-3);border-radius:var(--radius);padding:8px;text-align:center;">
                        <div style="font-size:1.1rem;font-weight:700;color:var(--text-0);">${history.totalWatches}</div>
                        <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;">Watches</div>
                    </div>
                    <div style="background:var(--bg-3);border-radius:var(--radius);padding:8px;text-align:center;">
                        <div style="font-size:1.1rem;font-weight:700;color:var(--green);">${fmt(history.totalSpend)}</div>
                        <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;">Total Spend</div>
                    </div>
                    <div style="background:var(--bg-3);border-radius:var(--radius);padding:8px;text-align:center;">
                        <div style="font-size:1.1rem;font-weight:700;color:var(--accent);">${fmt(history.avgPrice)}</div>
                        <div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;">Avg Price</div>
                    </div>
                </div>
                <div style="margin-bottom:8px;">
                    <div style="font-size:0.65rem;color:var(--text-2);text-transform:uppercase;margin-bottom:4px;">Refs Purchased</div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px;">${topRefs || '<span style="color:var(--text-3);font-size:0.7rem;">None</span>'}</div>
                </div>
                <div>
                    <div style="font-size:0.65rem;color:var(--text-2);text-transform:uppercase;margin-bottom:4px;">Recent Purchases</div>
                    ${purchaseRows || '<div style="color:var(--text-3);font-size:0.7rem;">No purchase data</div>'}
                    ${history.purchases.length > 5 ? `<div style="font-size:0.62rem;color:var(--text-3);margin-top:4px;">+ ${history.purchases.length - 5} more</div>` : ''}
                </div>
            </div>`;

        // Insert into the watch-detail-overlay if it exists
        const overlay = document.getElementById('watch-detail-overlay');
        if (overlay) {
            const content = overlay.querySelector('div > div:last-child'); // button row
            const invoiceSection = document.getElementById('wd-invoice-section');
            if (invoiceSection) {
                invoiceSection.parentElement.insertBefore(panel, invoiceSection.nextSibling);
            } else if (content) {
                content.parentElement.insertBefore(panel, content);
            }
        }
    }

    // ── Hook into showWatchDetail ───────────────────────────────────
    function hookWatchDetail() {
        const origShowWatchDetail = window.showWatchDetail;
        if (!origShowWatchDetail || origShowWatchDetail._ws6Hooked) return;

        window.showWatchDetail = async function(row) {
            origShowWatchDetail.call(this, row);

            // Wait for overlay to render
            await new Promise(resolve => setTimeout(resolve, 50));

            // Find the watch item to get sold_to
            let item = null;
            if (typeof row === 'object') {
                item = row;
            } else {
                if (window.inventoryItems) item = window.inventoryItems.find(i => i.row === row || i.id === row);
                if (!item && typeof window.invMgmtData !== 'undefined' && window.invMgmtData) {
                    item = window.invMgmtData.find(i => i.row === row || i.id === row);
                }
            }

            if (item && item.sold_to) {
                const inventory = await getInventory();
                const history = getBuyerHistory(item.sold_to, inventory);
                if (history) {
                    renderBuyerHistoryPanel(history);
                }
                // Render referral input below buyer history
                renderReferralInput(item.sold_to);
            }
        };
        window.showWatchDetail._ws6Hooked = true;
    }

    // ── Seller Reliability Score ────────────────────────────────────
    function computeSellerScores() {
        const sellers = window.DATA && window.DATA.sellers;
        const deals = window.DATA && window.DATA.deals;
        if (!sellers && !deals) return {};

        const scores = {};

        // Build from sellers data (from bundle.json)
        if (sellers && typeof sellers === 'object') {
            Object.entries(sellers).forEach(([name, info]) => {
                const listings = info.count || info.listings || info.total_listings || 0;
                const prices = info.prices || [];
                const avgDiscount = info.avg_discount || info.avg_discount_vs_median || 0;

                // Compute price consistency (stddev)
                let stddev = 0;
                if (prices.length > 1) {
                    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
                    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
                    stddev = Math.sqrt(variance);
                }

                let tier, label, color;
                if (listings > 50) {
                    tier = 'trusted';
                    label = 'Trusted';
                    color = 'var(--green)';
                } else if (listings >= 10) {
                    tier = 'active';
                    label = 'Active';
                    color = 'var(--accent)';
                } else {
                    tier = 'new';
                    label = 'New';
                    color = 'var(--text-2)';
                }

                // Downgrade if high variance relative to price
                if (tier === 'trusted' && stddev > 0 && prices.length > 0) {
                    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
                    const cv = stddev / mean; // coefficient of variation
                    if (cv > 0.15) {
                        tier = 'active';
                        label = 'Active';
                        color = 'var(--accent)';
                    }
                }

                scores[name.toLowerCase()] = { tier, label, color, listings, avgDiscount, stddev };
            });
        }

        // Also build from deals data if available
        if (deals && Array.isArray(deals)) {
            const sellerMap = {};
            deals.forEach(d => {
                if (!d.seller) return;
                const key = d.seller.toLowerCase();
                if (!sellerMap[key]) sellerMap[key] = { name: d.seller, listings: 0, prices: [] };
                sellerMap[key].listings += (d.seller_listings || 1);
                if (d.price_usd || d.price) sellerMap[key].prices.push(d.price_usd || d.price);
            });

            Object.entries(sellerMap).forEach(([key, info]) => {
                if (scores[key]) return; // already have from sellers data

                const listings = info.listings;
                let tier, label, color;
                if (listings > 50) {
                    tier = 'trusted'; label = 'Trusted'; color = 'var(--green)';
                } else if (listings >= 10) {
                    tier = 'active'; label = 'Active'; color = 'var(--accent)';
                } else {
                    tier = 'new'; label = 'New'; color = 'var(--text-2)';
                }

                let stddev = 0;
                if (info.prices.length > 1) {
                    const mean = info.prices.reduce((a, b) => a + b, 0) / info.prices.length;
                    const variance = info.prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / info.prices.length;
                    stddev = Math.sqrt(variance);
                }

                scores[key] = { tier, label, color, listings, avgDiscount: 0, stddev };
            });
        }

        return scores;
    }

    let _sellerScores = {};

    function getSellerBadgeHTML(sellerName) {
        if (!sellerName) return '';
        const key = sellerName.toLowerCase();
        const score = _sellerScores[key];
        if (!score) return '';

        return `<span class="ws6-seller-badge" style="display:inline-block;font-size:0.58rem;font-weight:700;padding:1px 5px;border-radius:3px;border:1px solid ${score.color};color:${score.color};text-transform:uppercase;letter-spacing:0.3px;margin-left:4px;vertical-align:middle;line-height:1.4;" title="${score.listings} listings">${score.label}</span>`;
    }

    // ── Inject seller badges into deal cards ────────────────────────
    function injectSellerBadges() {
        if (!Object.keys(_sellerScores).length) return;

        const dealCards = document.querySelectorAll('.deal-card');
        dealCards.forEach(card => {
            if (card.querySelector('.ws6-seller-badge')) return; // already injected

            // Find the seller name in the bottom row of the deal card
            const bottomRow = card.querySelector('div:last-child span:first-child');
            if (!bottomRow) return;

            const text = bottomRow.textContent || '';
            // Pattern: "WA SellerName (123) | GroupName" or "SellerName (123) | GroupName"
            const match = text.match(/(?:WA\s+)?([^(|]+?)\s*\(\d+\)/);
            if (!match) return;

            const sellerName = match[1].trim();
            const badge = getSellerBadgeHTML(sellerName);
            if (!badge) return;

            // Find the WA link or seller text and append badge
            const waLink = bottomRow.querySelector('a');
            if (waLink) {
                waLink.insertAdjacentHTML('afterend', badge);
            } else {
                // Insert badge after seller name
                const currentHTML = bottomRow.innerHTML;
                const sellerPattern = sellerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${sellerPattern})`);
                if (regex.test(currentHTML)) {
                    bottomRow.innerHTML = currentHTML.replace(regex, '$1' + badge);
                }
            }
        });
    }

    // ── Hook into deal rendering ────────────────────────────────────
    function hookDealRendering() {
        const origRenderDeals = window.renderDeals;
        if (!origRenderDeals || origRenderDeals._ws6Hooked) return;

        window.renderDeals = function() {
            origRenderDeals.apply(this, arguments);
            setTimeout(() => injectSellerBadges(), 100);
        };
        window.renderDeals._ws6Hooked = true;
    }

    // Also hook into deal detail view
    function hookDealDetail() {
        const origShowDealDetail = window.showDealDetail;
        if (!origShowDealDetail || origShowDealDetail._ws6Hooked) return;

        window.showDealDetail = function(idx) {
            origShowDealDetail.apply(this, arguments);
            setTimeout(() => {
                // Inject badges into comparable listings table
                const panel = document.getElementById('deals-detail') || document.querySelector('#deals-detail');
                if (!panel) return;
                const sellerCells = panel.querySelectorAll('td:nth-child(2)');
                sellerCells.forEach(cell => {
                    if (cell.querySelector('.ws6-seller-badge')) return;
                    const name = (cell.textContent || '').trim();
                    if (!name) return;
                    const badge = getSellerBadgeHTML(name);
                    if (badge) cell.insertAdjacentHTML('beforeend', badge);
                });
            }, 100);
        };
        window.showDealDetail._ws6Hooked = true;
    }

    // ── Module lifecycle ────────────────────────────────────────────
    function init() {
        console.log('[' + MOD_ID + '] Initializing...');

        // Compute seller scores
        _sellerScores = computeSellerScores();
        console.log(`[${MOD_ID}] Computed scores for ${Object.keys(_sellerScores).length} sellers`);

        // Hook into watch detail overlay
        hookWatchDetail();

        // Hook into deal card rendering
        hookDealRendering();
        hookDealDetail();

        // Initial badge injection if deals are already rendered
        setTimeout(() => injectSellerBadges(), 500);
    }

    async function render() {
        // Recompute seller scores (data may have changed)
        _sellerScores = computeSellerScores();

        // Re-inject badges
        setTimeout(() => injectSellerBadges(), 200);

        // Render Top Referrers card on CRM page
        var crmPage = document.getElementById('page-ad-crm');
        if (crmPage && crmPage.offsetParent !== null) {
            var inv = await getInventory();
            renderTopReferrersCard(inv);
        }
    }

    function cleanup() {
        const panel = document.getElementById(HISTORY_PANEL_ID);
        if (panel) panel.remove();
        // Remove all seller badges
        document.querySelectorAll('.ws6-seller-badge').forEach(el => el.remove());
        _inventoryCache = null;
    }

    // Expose for other modules
    window._ws6GetBuyerHistory = async function(buyerName) {
        const inv = await getInventory();
        return getBuyerHistory(buyerName, inv);
    };
    window._ws6GetSellerScore = function(sellerName) {
        if (!sellerName) return null;
        return _sellerScores[sellerName.toLowerCase()] || null;
    };

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
