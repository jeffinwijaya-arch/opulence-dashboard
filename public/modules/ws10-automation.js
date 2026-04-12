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
            <button id="ws10-autoprice-dismiss" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:1rem;padding:4px 8px;line-height:1;" title="Dismiss">&#x2715;</button>
        `;

        // Insert at top of inventory page, after page-head
        const pageHead = invPage.querySelector('.page-head');
        if (pageHead && pageHead.nextSibling) {
            invPage.insertBefore(banner, pageHead.nextSibling);
        } else {
            invPage.prepend(banner);
        }

        // Attach click handlers
        document.getElementById('ws10-autoprice-btn').onclick = async function() {
            await applyAutoPrice(unpriced);
        };
        document.getElementById('ws10-autoprice-dismiss').onclick = function() {
            banner.remove();
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

        // Find stale postings and classify urgency
        const stale = postings.filter(p => {
            const posted = p.posted_at || p.posted_date || '';
            if (!posted) return false;
            return daysSince(posted.slice(0, 10)) > STALE_DAYS;
        });

        if (stale.length === 0) return;

        // Classify urgency levels
        let urgencyCritical = 0; // >21 days
        let urgencyHigh = 0;     // >14 days
        let urgencyMedium = 0;   // >7 days
        let totalDrop = 0;
        let dropCount = 0;
        stale.forEach(p => {
            const posted = p.posted_at || p.posted_date || '';
            const age = daysSince(posted.slice(0, 10));
            if (age > 21) urgencyCritical++;
            else if (age > 14) urgencyHigh++;
            else urgencyMedium++;
            const price = parseNum(p.price);
            if (price > 0) {
                const dropPct = STALE_DROP_MIN + Math.random() * (STALE_DROP_MAX - STALE_DROP_MIN);
                totalDrop += price * dropPct;
                dropCount++;
            }
        });
        const avgDrop = dropCount > 0 ? Math.round(totalDrop / dropCount) : 0;

        const urgencyBadges = [
            urgencyCritical > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:0.62rem;font-weight:700;font-family:var(--mono);background:rgba(255,59,48,0.15);color:var(--red);border:1px solid rgba(255,59,48,0.3);">' + urgencyCritical + ' CRITICAL (&gt;21d)</span>' : '',
            urgencyHigh > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:0.62rem;font-weight:700;font-family:var(--mono);background:rgba(255,149,0,0.12);color:rgb(255,149,0);border:1px solid rgba(255,149,0,0.25);">' + urgencyHigh + ' HIGH (&gt;14d)</span>' : '',
            urgencyMedium > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:0.62rem;font-weight:700;font-family:var(--mono);background:rgba(255,202,40,0.12);color:#ffca28;border:1px solid rgba(255,202,40,0.25);">' + urgencyMedium + ' MEDIUM (&gt;7d)</span>' : ''
        ].filter(Boolean).join(' ');

        const banner = document.createElement('div');
        banner.id = 'ws10-stale-banner';
        banner.style.cssText = 'background:rgba(255,59,48,0.06);border:1px solid rgba(255,59,48,0.18);border-radius:8px;padding:10px 14px;margin-bottom:10px;';
        banner.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <span style="font-size:0.78rem;color:var(--red);font-weight:600;">${stale.length} listing${stale.length !== 1 ? 's' : ''} stale >${STALE_DAYS} days</span>
                    ${avgDrop > 0 ? `<span style="font-size:0.65rem;color:var(--text-2);margin-left:8px;">Avg suggested drop: ${fmt(avgDrop)}</span>` : ''}
                </div>
                <button id="ws10-stale-review-btn" style="background:var(--red);color:white;border:none;border-radius:6px;padding:6px 14px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:var(--mono);">Review Stale</button>
            </div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">${urgencyBadges}</div>
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

    // ── Feature 3: Auto-Detect Sold Watches in Postings ──

    let _soldMatchCache = null;

    async function findSoldPostingMatches() {
        if (_soldMatchCache) return _soldMatchCache;
        try {
            const [postings, inventory] = await Promise.all([fetchPostings(), fetchInventoryRows()]);

            // Build set of sold watch refs (and their row IDs for context)
            var soldByRef = {};
            inventory.forEach(function(w) {
                if (w.sold !== 'Yes' && w.sold !== 1 && w.sold !== true) return;
                var ref = extractRef(w.description) || w.ref;
                if (!ref) return;
                if (!soldByRef[ref]) soldByRef[ref] = [];
                soldByRef[ref].push({
                    row: w.row || w.id,
                    description: w.description || '',
                    soldPrice: parseNum(w.sold_price),
                    soldTo: w.sold_to || ''
                });
            });

            // Match active postings against sold inventory
            var matches = [];
            postings.forEach(function(p) {
                if (p.status !== 'active' && p.status !== 'draft') return;
                var postRef = extractRef(p.description) || p.ref;
                if (!postRef) return;
                if (soldByRef[postRef]) {
                    matches.push({
                        posting: p,
                        postingId: p.id,
                        messageId: p.message_id || '',
                        ref: postRef,
                        description: p.description || '',
                        price: p.price || '',
                        soldWatch: soldByRef[postRef][0]
                    });
                }
            });

            _soldMatchCache = matches;
        } catch (e) {
            console.error('[' + MOD_ID + '] sold match error:', e);
            _soldMatchCache = [];
        }
        return _soldMatchCache;
    }

    function injectSoldDetectBanner(matches) {
        var postingsPage = document.getElementById('page-postings');
        if (!postingsPage) return;

        // Remove old banner
        var old = document.getElementById('ws10-sold-detect-banner');
        if (old) old.remove();

        if (!matches || matches.length === 0) return;

        var banner = document.createElement('div');
        banner.id = 'ws10-sold-detect-banner';
        banner.style.cssText = 'background:rgba(255,149,0,0.08);border:1px solid rgba(255,149,0,0.25);border-radius:8px;padding:10px 14px;margin-bottom:10px;';

        var listHtml = matches.slice(0, 5).map(function(m) {
            var soldInfo = m.soldWatch.soldTo ? ' to ' + m.soldWatch.soldTo : '';
            var priceInfo = m.soldWatch.soldPrice > 0 ? ' for ' + fmt(m.soldWatch.soldPrice) : '';
            return '<div style="font-size:0.68rem;color:var(--text-1);padding:3px 0;border-bottom:1px solid rgba(255,149,0,0.1);">'
                + '<span style="font-weight:600;font-family:var(--mono);">' + m.ref + '</span>'
                + ' -- posting still active, watch sold' + soldInfo + priceInfo
                + '</div>';
        }).join('');
        var moreText = matches.length > 5
            ? '<div style="font-size:0.62rem;color:var(--text-2);padding-top:4px;">+ ' + (matches.length - 5) + ' more</div>'
            : '';

        banner.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;">'
            + '<div style="flex:1;min-width:0;">'
            + '<span style="font-size:0.78rem;color:rgb(255,149,0);font-weight:600;">' + matches.length + ' posting' + (matches.length !== 1 ? 's' : '') + ' may be sold</span>'
            + '<span style="font-size:0.65rem;color:var(--text-2);margin-left:8px;">Matching sold inventory items</span>'
            + '</div>'
            + '<button id="ws10-clean-sold-btn" style="background:rgb(255,149,0);color:var(--bg-1);border:none;border-radius:6px;padding:6px 14px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:var(--mono);">Clean Up Sold</button>'
            + '</div>'
            + listHtml + moreText;

        // Insert after stale banner or after page-head
        var staleBanner = document.getElementById('ws10-stale-banner');
        if (staleBanner && staleBanner.nextSibling) {
            postingsPage.insertBefore(banner, staleBanner.nextSibling);
        } else {
            var pageHead = postingsPage.querySelector('.page-head');
            if (pageHead && pageHead.nextSibling) {
                postingsPage.insertBefore(banner, pageHead.nextSibling);
            } else {
                postingsPage.prepend(banner);
            }
        }

        document.getElementById('ws10-clean-sold-btn').onclick = async function() {
            await cleanUpSoldPostings(matches);
        };
    }

    async function cleanUpSoldPostings(matches) {
        var btn = document.getElementById('ws10-clean-sold-btn');
        if (!btn) return;
        btn.disabled = true;
        btn.textContent = 'Cleaning...';

        // Use the sync endpoint which marks sold watches' postings as sold
        var success = 0;
        var failed = 0;

        try {
            var r = await fetch('/api/my-postings/sync', { method: 'POST' });
            var d = await r.json();
            if (d.ok) {
                success = matches.length;
            } else {
                // Fallback: delete each posting individually
                for (var i = 0; i < matches.length; i++) {
                    var m = matches[i];
                    try {
                        var dr = await fetch('/api/my-postings/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                message_id: m.messageId,
                                posting_id: m.postingId
                            })
                        });
                        var dd = await dr.json();
                        if (dd.ok) success++;
                        else failed++;
                    } catch (e2) {
                        failed++;
                    }
                }
            }
        } catch (e) {
            console.error('[' + MOD_ID + '] clean sold error:', e);
            failed = matches.length;
        }

        if (typeof showToast === 'function') {
            if (failed === 0) {
                showToast('Cleaned up ' + success + ' sold posting' + (success !== 1 ? 's' : ''));
            } else {
                showToast('Cleaned ' + success + ', failed ' + failed, 'error');
            }
        }

        // Reset caches and refresh
        _postingsCache = null;
        _soldMatchCache = null;
        btn.textContent = 'Done (' + success + '/' + matches.length + ')';
        btn.style.opacity = '0.6';

        if (typeof loadPostingsPage === 'function') {
            setTimeout(loadPostingsPage, 500);
        }
    }

    // ── Feature 4: Smart Photo Tagging ──

    let _photoTagCache = null;

    // Known Rolex model name -> ref mappings for filename matching
    var MODEL_NAME_MAP = {
        'daytona': ['116500', '126500', '116509', '126509', '116515', '126515'],
        'submariner': ['124060', '126610', '116610', '114060'],
        'gmt': ['126710', '126720', '116710'],
        'datejust': ['126300', '126334', '126331', '126234', '126233', '126200'],
        'daydate': ['228238', '228235', '228206'],
        'day-date': ['228238', '228235', '228206'],
        'explorer': ['224270', '226570'],
        'skydweller': ['336934', '336935', '326934'],
        'sky-dweller': ['336934', '336935', '326934'],
        'yachtmaster': ['226659', '126621', '126622'],
        'yacht-master': ['226659', '126621', '126622'],
        'seadweller': ['126600', '126603'],
        'sea-dweller': ['126600', '126603'],
        'airking': ['126900'],
        'air-king': ['126900'],
        'milgauss': ['116400'],
        'oyster': ['124300', '126000', '277200']
    };

    function extractRefFromFilename(filename) {
        if (!filename) return null;
        var fn = filename.replace(/\.[^.]+$/, ''); // strip extension

        // Pattern 1: Direct ref number in filename (5-6 digit Rolex ref, optionally with suffix)
        var refMatch = fn.match(/\b(1[12]\d{4}[A-Z]{0,4})\b/i);
        if (refMatch) return refMatch[1].toUpperCase();

        // Pattern 2: IMG_REFNUM or similar underscore-separated
        var underscoreMatch = fn.match(/(?:IMG|DSC|PHOTO|PXL|P|WP)[_-]?(1[12]\d{4}[A-Z]{0,4})/i);
        if (underscoreMatch) return underscoreMatch[1].toUpperCase();

        // Pattern 3: Model name in filename (e.g. 'Rolex_Daytona', 'GMT-Master')
        var fnLower = fn.toLowerCase().replace(/[_\- ]+/g, '');
        var keys = Object.keys(MODEL_NAME_MAP);
        for (var i = 0; i < keys.length; i++) {
            var modelName = keys[i].replace(/[_\- ]+/g, '');
            if (fnLower.indexOf(modelName) !== -1) {
                // Return first ref as suggestion (most common variant)
                return MODEL_NAME_MAP[keys[i]][0];
            }
        }

        return null;
    }

    async function findUntaggedPhotos() {
        if (_photoTagCache) return _photoTagCache;
        try {
            var r = await fetch('/api/watch-photos');
            var d = await r.json();
            var watches = d.watches || [];

            var suggestions = [];
            watches.forEach(function(w) {
                // Skip if already has a proper model/ref
                if (w.model && w.model.match(/^1[12]\d{4}/)) return;
                // Skip if no photos
                if (!w.photo_count || w.photo_count === 0) return;

                // The watch_id from the photo library is the index key
                // Try to extract ref from the watch description or model name
                var watchId = w.watch_id;
                var currentModel = w.model || '';
                var currentDial = w.dial || '';

                // For library photos (lib_*), the filename is in the photo_index
                // For DB photos, we check the model field
                // We'll check if the model is a known name rather than a ref number
                var suggestedRef = null;

                // If model is a name like "GMT-Master II", map to ref
                if (currentModel && !currentModel.match(/^\d{5,6}/)) {
                    var modelLower = currentModel.toLowerCase().replace(/[_\- ]+/g, '');
                    var keys = Object.keys(MODEL_NAME_MAP);
                    for (var k = 0; k < keys.length; k++) {
                        var mName = keys[k].replace(/[_\- ]+/g, '');
                        if (modelLower.indexOf(mName) !== -1) {
                            suggestedRef = MODEL_NAME_MAP[keys[k]][0];
                            break;
                        }
                    }
                }

                if (suggestedRef) {
                    suggestions.push({
                        watchId: watchId,
                        currentModel: currentModel,
                        currentDial: currentDial,
                        suggestedRef: suggestedRef,
                        source: 'model name'
                    });
                }
            });

            _photoTagCache = suggestions;
        } catch (e) {
            console.error('[' + MOD_ID + '] photo tag scan error:', e);
            _photoTagCache = [];
        }
        return _photoTagCache;
    }

    function injectPhotoTagBanner(suggestions) {
        var photosPage = document.getElementById('page-photos');
        if (!photosPage) return;

        var old = document.getElementById('ws10-phototag-banner');
        if (old) old.remove();

        if (!suggestions || suggestions.length === 0) return;

        var banner = document.createElement('div');
        banner.id = 'ws10-phototag-banner';
        banner.style.cssText = 'background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.25);border-radius:8px;padding:10px 14px;margin-bottom:10px;';

        var listHtml = suggestions.slice(0, 6).map(function(s) {
            return '<div style="font-size:0.68rem;color:var(--text-1);padding:3px 0;border-bottom:1px solid rgba(88,166,255,0.1);">'
                + '<span style="color:var(--text-2);">' + (s.currentModel || 'Untagged') + '</span>'
                + ' -- Tag as <span style="font-weight:600;font-family:var(--mono);color:var(--accent);">' + s.suggestedRef + '</span>?'
                + ' <span style="font-size:0.6rem;color:var(--text-2);">(from ' + s.source + ')</span>'
                + '</div>';
        }).join('');
        var moreText = suggestions.length > 6
            ? '<div style="font-size:0.62rem;color:var(--text-2);padding-top:4px;">+ ' + (suggestions.length - 6) + ' more</div>'
            : '';

        banner.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;">'
            + '<div style="flex:1;min-width:0;">'
            + '<span style="font-size:0.78rem;color:rgb(88,166,255);font-weight:600;">' + suggestions.length + ' photo' + (suggestions.length !== 1 ? 's' : '') + ' can be auto-tagged</span>'
            + '<span style="font-size:0.65rem;color:var(--text-2);margin-left:8px;">Ref suggestions from filenames and model names</span>'
            + '</div>'
            + '<button id="ws10-autotag-btn" style="background:rgb(88,166,255);color:var(--bg-1);border:none;border-radius:6px;padding:6px 14px;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:var(--mono);">Auto-Tag</button>'
            + '</div>'
            + listHtml + moreText;

        // Insert after page-head
        var pageHead = photosPage.querySelector('.page-head');
        if (pageHead && pageHead.nextSibling) {
            photosPage.insertBefore(banner, pageHead.nextSibling);
        } else {
            photosPage.prepend(banner);
        }

        document.getElementById('ws10-autotag-btn').onclick = async function() {
            await applyAutoTags(suggestions);
        };
    }

    async function applyAutoTags(suggestions) {
        var btn = document.getElementById('ws10-autotag-btn');
        if (!btn) return;
        btn.disabled = true;
        btn.textContent = 'Tagging...';

        var success = 0;
        var failed = 0;

        for (var i = 0; i < suggestions.length; i++) {
            var s = suggestions[i];
            try {
                var r = await fetch('/api/watch-photos/' + s.watchId + '/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: s.suggestedRef })
                });
                var d = await r.json();
                if (d.ok || d.changes !== undefined) success++;
                else failed++;
            } catch (e) {
                failed++;
            }
        }

        if (typeof showToast === 'function') {
            if (failed === 0) {
                showToast('Tagged ' + success + ' photo' + (success !== 1 ? 's' : '') + ' with ref numbers');
            } else {
                showToast('Tagged ' + success + ', failed ' + failed, 'error');
            }
        }

        _photoTagCache = null;
        btn.textContent = 'Done (' + success + '/' + suggestions.length + ')';
        btn.style.opacity = '0.6';

        if (typeof loadPhotoLibrary === 'function') {
            setTimeout(loadPhotoLibrary, 500);
        }
    }

    // ── Mobile UX Styles ──

    function injectMobileStyles() {
        if (document.getElementById('ws10-mobile-styles')) return;
        var s = document.createElement('style');
        s.id = 'ws10-mobile-styles';
        s.textContent = [
            '@media(max-width:768px) {',
            '    /* Autoprice banner: vertical stack so button gets full width */',
            '    #ws10-autoprice-banner { flex-direction:column!important; align-items:stretch!important; }',
            '    #ws10-autoprice-btn { width:100%!important; min-height:44px!important;',
            '        font-size:0.82rem!important; padding:10px 14px!important; white-space:normal!important; }',
            '    #ws10-autoprice-dismiss { align-self:flex-end!important; }',
            '    /* Stale / sold-detect / phototag banner action buttons: 44px touch targets */',
            '    #ws10-stale-review-btn, #ws10-clean-sold-btn, #ws10-autotag-btn {',
            '        min-height:44px!important; width:100%!important; margin-top:8px!important;',
            '        font-size:0.82rem!important; padding:10px 14px!important; white-space:normal!important; }',
            '    /* Chrono24 export card buttons: full-width on mobile */',
            '    #ws10-c24-download, #ws10-c24-preview {',
            '        width:100%!important; min-height:44px!important; justify-content:center!important;',
            '        font-size:0.82rem!important; padding:10px 14px!important; }',
            '}'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ── Module Lifecycle ──

    async function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        _initialized = true;
        injectMobileStyles();

        // Listen for data refreshes
        MK.on('data-loaded', () => {
            _inventoryCache = null;
            _postingsCache = null;
            _soldMatchCache = null;
            _photoTagCache = null;
            render();
        });

        // Listen for page changes to inject banners at the right time
        document.addEventListener('mk:page-changed', (e) => {
            const page = e.detail && e.detail.page;
            if (page === 'inventory' || page === 'postings' || page === 'photos') {
                setTimeout(render, 200);
            }
        });

        // Also hook into showPage if available — re-render after page switch
        const _origShowPage = window.showPage;
        if (typeof _origShowPage === 'function') {
            window.showPage = function(name) {
                _origShowPage.apply(this, arguments);
                if (name === 'inventory' || name === 'postings' || name === 'photos') {
                    setTimeout(render, 300);
                }
            };
        }

        await render();
    }

    async function render() {
        if (!_initialized) return;

        // Auto-price banner + Chrono24 export on inventory page
        const invPage = document.getElementById('page-inventory');
        if (invPage && (invPage.classList.contains('active') || invPage.offsetParent !== null)) {
            const items = await fetchInventoryRows();
            injectAutoPriceBanner(items);
            injectChrono24ExportCard(items);
        }

        // Stale listing banner + sold detection on postings page
        const postPage = document.getElementById('page-postings');
        if (postPage && (postPage.classList.contains('active') || postPage.offsetParent !== null)) {
            const postings = await fetchPostings();
            injectStaleBanner(postings);

            var soldMatches = await findSoldPostingMatches();
            injectSoldDetectBanner(soldMatches);
        }

        // Smart photo tagging on photos page
        const photosPage = document.getElementById('page-photos');
        if (photosPage && (photosPage.classList.contains('active') || photosPage.offsetParent !== null)) {
            var photoSuggestions = await findUntaggedPhotos();
            injectPhotoTagBanner(photoSuggestions);
        }
    }


    // ═══════════════════════════════════════════════════
    // CHRONO24 XML FEED EXPORT
    // Competitive with WatchTraderHub's paid Chrono24 integration.
    // Generates Chrono24-compatible XML from live inventory.
    // ═══════════════════════════════════════════════════

    function _escXml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function _c24CondCode(condStr) {
        var c = (condStr || '').toLowerCase();
        if (/brand\s*new|new\s*unworn|unpolished\s*new/.test(c)) return 2;
        if (/like\s*new|lnib|mint|unworn/.test(c)) return 3;
        if (/very\s*good|vg|excellent|great/.test(c)) return 4;
        if (/good|light\s*wear/.test(c)) return 4;
        if (/fair|used|worn|marks/.test(c)) return 5;
        return 4; // default: good
    }

    function _generateChrono24XML(items) {
        var forSale = items.filter(function(r) {
            if (r.sold === 'Yes' || r.sold === 1 || r.sold === true) return false;
            var price = parseNum(r.selling_price || r.asking_price || r.list_price || '0');
            return price > 0;
        });

        var xmlItems = forSale.map(function(r) {
            var ref   = extractRef(r.description || '') || r.ref || '';
            var price = parseNum(r.selling_price || r.asking_price || r.list_price || '0');
            var cond  = _c24CondCode(r.condition || r.cond || '');
            // Detect brand from ref prefix if not set
            var brand = r.brand || '';
            if (!brand && ref) {
                var n = parseInt(ref, 10);
                if (n >= 100000 && n <= 340000) brand = 'Rolex';
                else if (/^1520|^1521|^1522|^2651|^2636|^2660|^263/.test(ref)) brand = 'Audemars Piguet';
                else if (/^57|^58|^59|^49|^53|^56|^240|^241/.test(ref)) brand = 'Patek Philippe';
                else if (/^827|^5231|^87|^M/.test(ref)) brand = 'Tudor';
            }
            var model = r.model || '';
            var year  = r.year || r.production_year || '';
            var cDesc = (r.condition || r.cond || '').toLowerCase();
            var hasBox    = /box/i.test(cDesc) || /box/i.test(r.description || '') ? 1 : 0;
            var hasPapers = /paper|card|warrant/i.test(cDesc) || /paper/i.test(r.description || '') ? 1 : 0;
            // Build clean description (max 500 chars)
            var rawDesc = [r.description || '', r.notes || ''].join(' ').trim();
            var desc = _escXml(rawDesc.substring(0, 500));

            var lines = [
                '  <item>',
                ref    ? ('    <reference>' + _escXml(ref) + '</reference>') : '',
                brand  ? ('    <manufacturer>' + _escXml(brand) + '</manufacturer>') : '',
                model  ? ('    <model>' + _escXml(model) + '</model>') : '',
                '    <condition>' + cond + '</condition>',
                '    <price>' + Math.round(price) + '</price>',
                '    <currency>USD</currency>',
                year   ? ('    <year>' + _escXml(String(year)) + '</year>') : '',
                '    <box>' + hasBox + '</box>',
                '    <papers>' + hasPapers + '</papers>',
                '    <location>Hong Kong, China</location>',
                desc   ? ('    <description>' + desc + '</description>') : '',
                '  </item>'
            ].filter(Boolean).join('\n');
            return lines;
        }).join('\n');

        return '<?xml version="1.0" encoding="UTF-8"?>\n<items>\n' + xmlItems + '\n</items>';
    }

    function injectChrono24ExportCard(items) {
        var page = document.getElementById('page-inventory');
        if (!page) return;

        var old = document.getElementById('ws10-c24-card');
        if (old) old.remove();

        var forSale = items.filter(function(r) {
            return r.sold !== 'Yes' && r.sold !== 1 && r.sold !== true;
        });
        var priced = forSale.filter(function(r) {
            return parseNum(r.selling_price || r.asking_price || r.list_price || '0') > 0;
        });
        var missingRef = priced.filter(function(r) {
            return !extractRef(r.description || '') && !r.ref;
        });
        var missingPrice = forSale.length - priced.length;

        // Warning HTML
        var warnHtml = '';
        if (missingRef.length > 0) {
            warnHtml += '<div style="background:rgba(255,171,0,0.1);border:1px solid rgba(255,171,0,0.25);'
                + 'border-radius:5px;padding:6px 10px;margin-bottom:8px;font-size:0.7rem;color:var(--orange,#ffa500);">'
                + '\u26A0 ' + missingRef.length + ' item' + (missingRef.length > 1 ? 's' : '') 
                + ' have no reference number — will export without <reference> field.'
                + '</div>';
        }
        if (missingPrice > 0) {
            warnHtml += '<div style="background:rgba(255,23,68,0.08);border:1px solid rgba(255,23,68,0.2);'
                + 'border-radius:5px;padding:6px 10px;margin-bottom:8px;font-size:0.7rem;color:var(--red);">'
                + '\u2716 ' + missingPrice + ' unsold item' + (missingPrice > 1 ? 's' : '')
                + ' have no price set — excluded from feed.'
                + '</div>';
        }

        var card = document.createElement('div');
        card.id = 'ws10-c24-card';
        card.className = 'card';
        card.style.cssText = 'margin:12px 0;';
        card.innerHTML = '<div class="card-head">'
            + '<span>Chrono24 XML Feed</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;'
            + 'letter-spacing:0;margin-left:8px;">multi-channel listing sync</span>'
            + '</div>'
            + '<div style="padding:12px 16px;">'
            + warnHtml
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">'
            + '<div style="background:var(--bg-3);border-radius:6px;padding:10px;text-align:center;">'
            +   '<div style="font-size:0.58rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;">Feed Items</div>'
            +   '<div style="font-size:1.2rem;font-weight:800;font-family:var(--mono);color:var(--accent);margin-top:3px;">' + priced.length + '</div>'
            + '</div>'
            + '<div style="background:var(--bg-3);border-radius:6px;padding:10px;text-align:center;">'
            +   '<div style="font-size:0.58rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;">Total Inventory</div>'
            +   '<div style="font-size:1.2rem;font-weight:800;font-family:var(--mono);color:var(--text-0);margin-top:3px;">' + forSale.length + '</div>'
            + '</div>'
            + '<div style="background:var(--bg-3);border-radius:6px;padding:10px;text-align:center;">'
            +   '<div style="font-size:0.58rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;">No Price</div>'
            +   '<div style="font-size:1.2rem;font-weight:800;font-family:var(--mono);color:' + (missingPrice > 0 ? 'var(--red)' : 'var(--green)') + ';margin-top:3px;">' + missingPrice + '</div>'
            + '</div>'
            + '</div>'
            + '<div style="font-size:0.7rem;color:var(--text-2);line-height:1.5;margin-bottom:12px;">'
            + 'Download the XML feed and upload it to your Chrono24 Marketplace Manager under '
            + '<em>Stock &rarr; Import &rarr; XML feed</em>. Alternatively, host this file at a stable URL '
            + 'and provide it to Chrono24 for automated 12-24 hour sync.'
            + '</div>'
            + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
            + '<button id="ws10-c24-download" style="background:var(--accent);color:var(--bg-0);border:none;'
            + 'border-radius:6px;padding:9px 18px;font-size:0.78rem;font-weight:700;cursor:pointer;'
            + 'display:flex;align-items:center;gap:6px;">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"'
            + ' stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>'
            + '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            + 'Download XML (' + priced.length + ' items)'
            + '</button>'
            + '<button id="ws10-c24-preview" style="background:var(--bg-3);color:var(--text-1);border:1px solid var(--border);'
            + 'border-radius:6px;padding:9px 14px;font-size:0.78rem;cursor:pointer;">Preview XML</button>'
            + '</div>'
            + '<pre id="ws10-c24-preview-box" style="display:none;margin-top:12px;background:var(--bg-0);'
            + 'border:1px solid var(--border);border-radius:6px;padding:10px;font-size:0.62rem;'
            + 'font-family:var(--mono);color:var(--text-1);overflow-x:auto;max-height:220px;'
            + 'overflow-y:auto;white-space:pre;"></pre>'
            + '</div>';

        // Wire buttons
        card.querySelector('#ws10-c24-download').addEventListener('click', function() {
            if (priced.length === 0) {
                if (typeof showToast === 'function') showToast('No priced inventory to export', 'warn');
                return;
            }
            var xml = _generateChrono24XML(items);
            var blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            var dateStr = new Date().toISOString().slice(0, 10);
            a.download = 'mk_opulence_chrono24_' + dateStr + '.xml';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast('Downloaded Chrono24 XML feed — ' + priced.length + ' items', 'ok');
        });

        var previewShown = false;
        card.querySelector('#ws10-c24-preview').addEventListener('click', function() {
            var box = card.querySelector('#ws10-c24-preview-box');
            if (!box) return;
            if (previewShown) {
                box.style.display = 'none';
                previewShown = false;
                this.textContent = 'Preview XML';
            } else {
                var xml = _generateChrono24XML(items);
                // Show first ~2000 chars
                box.textContent = xml.length > 2000 ? xml.slice(0, 2000) + '\n... (' + (xml.length - 2000) + ' more chars)' : xml;
                box.style.display = 'block';
                previewShown = true;
                this.textContent = 'Hide Preview';
            }
        });

        // Prepend to page
        var firstCard = page.querySelector('.card');
        if (firstCard) page.insertBefore(card, firstCard);
        else page.appendChild(card);
    }

    function cleanup() {
        const b0 = document.getElementById('ws10-c24-card');
        if (b0) b0.remove();
        const b1 = document.getElementById('ws10-autoprice-banner');
        if (b1) b1.remove();
        const b2 = document.getElementById('ws10-stale-banner');
        if (b2) b2.remove();
        const b3 = document.getElementById('ws10-sold-detect-banner');
        if (b3) b3.remove();
        const b4 = document.getElementById('ws10-phototag-banner');
        if (b4) b4.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
