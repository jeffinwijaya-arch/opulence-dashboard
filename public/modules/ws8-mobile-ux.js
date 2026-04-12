/**
 * MK Opulence — ws8-mobile-ux
 * Mobile UX enhancements: FAB button + swipe-to-action on deal cards.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws8-mobile-ux', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws8-mobile-ux';
    const MOBILE_BP = 768;
    const SWIPE_THRESHOLD = 100;
    const FAB_ID = 'mk-fab';
    const WATCHLIST_KEY = 'mk-deal-watchlist';

    let _mql = null;
    let _fabEl = null;
    let _styleEl = null;
    let _swipeState = null;
    let _keyboardOpen = false;
    let _boundHandlers = {};
    let _kbShortcutsActive = false;
    let _kbCheatEl = null;
    let _offlineBannerEl = null;
    let _originalFetch = null;

    // ── Offline Cache Constants ──

    const OFFLINE_LOOKUP_KEY = 'mk_offline_lookups';
    const OFFLINE_DEALS_KEY = 'mk_offline_deals';
    const OFFLINE_MAX_LOOKUPS = 50;

    // ── Helpers ──

    function isMobile() {
        return window.innerWidth < MOBILE_BP || (_mql && _mql.matches);
    }

    function getActivePage() {
        const el = document.querySelector('.page.active');
        return el ? el.id.replace('page-', '') : '';
    }

    function getWatchlist() {
        try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); }
        catch(e) { return []; }
    }

    function saveToWatchlist(deal) {
        const list = getWatchlist();
        // Dedupe by ref + seller + price
        const key = `${deal.ref}|${deal.seller}|${deal.price_usd || deal.price}`;
        if (list.some(d => `${d.ref}|${d.seller}|${d.price_usd || d.price}` === key)) return false;
        list.unshift({
            ref: deal.ref,
            model: deal.model || '',
            seller: deal.seller || '',
            price_usd: deal.price_usd || deal.price || 0,
            discount_pct: deal.discount_pct || deal.gap_pct || 0,
            condition: deal.condition || deal.condition_bucket || '',
            saved_at: Date.now()
        });
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list.slice(0, 100)));
        return true;
    }

    // ── Styles ──

    function injectStyles() {
        if (_styleEl) return;
        _styleEl = document.createElement('style');
        _styleEl.id = 'ws8-mobile-ux-styles';
        _styleEl.textContent = `
            /* FAB — only visible on mobile */
            #${FAB_ID} {
                display: none;
                position: fixed;
                bottom: calc(90px + env(safe-area-inset-bottom, 0px));
                right: 16px;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: #C9A84C;
                color: #fff;
                border: none;
                box-shadow: 0 4px 14px rgba(0,0,0,0.35);
                z-index: 9990;
                cursor: pointer;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                line-height: 1;
                transition: transform 0.2s ease, opacity 0.2s ease;
                -webkit-tap-highlight-color: transparent;
            }
            #${FAB_ID}:active {
                transform: scale(0.92);
            }
            #${FAB_ID}.mk-fab-hidden {
                opacity: 0;
                pointer-events: none;
                transform: scale(0.6);
            }
            @media (max-width: ${MOBILE_BP}px) {
                #${FAB_ID} {
                    display: flex;
                }
                #${FAB_ID}.mk-fab-hidden {
                    display: flex;
                }
            }

            /* Swipe hint overlays */
            .mk-swipe-hint {
                position: absolute;
                top: 0;
                bottom: 0;
                width: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.75rem;
                font-weight: 700;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s ease;
                z-index: 1;
                border-radius: 8px;
            }
            .mk-swipe-hint-save {
                left: 0;
                background: rgba(34,197,94,0.18);
                color: var(--green, #22c55e);
            }
            .mk-swipe-hint-dismiss {
                right: 0;
                background: rgba(239,68,68,0.18);
                color: var(--red, #ef4444);
            }

            /* Swipe flash feedback */
            @keyframes mkSwipeFlashGreen {
                0% { background: rgba(34,197,94,0.35); }
                100% { background: transparent; }
            }
            @keyframes mkSwipeFlashRed {
                0% { background: rgba(239,68,68,0.35); }
                100% { background: transparent; }
            }
            @keyframes mkSlideOutRight {
                to { transform: translateX(110%); opacity: 0; }
            }
            @keyframes mkSlideOutLeft {
                to { transform: translateX(-110%); opacity: 0; }
            }
            .mk-flash-green {
                animation: mkSwipeFlashGreen 0.5s ease forwards;
            }
            .mk-flash-red {
                animation: mkSwipeFlashRed 0.5s ease forwards;
            }
            .mk-slide-out-left {
                animation: mkSlideOutLeft 0.3s ease forwards;
            }
            .mk-slide-out-right {
                animation: mkSlideOutRight 0.3s ease forwards;
            }

            /* Offline banner */
            #mk-offline-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 99999;
                background: rgba(30,30,30,0.92);
                color: var(--text-2, #aaa);
                font-size: 0.72rem;
                text-align: center;
                padding: max(6px, env(safe-area-inset-top, 6px)) 16px 6px;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border-bottom: 1px solid var(--border, #333);
                animation: mkBannerSlideIn 0.3s ease;
            }
            @keyframes mkBannerSlideIn {
                from { transform: translateY(-100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            /* Keyboard shortcuts help icon */
            #mk-kb-help {
                display: none;
                position: fixed;
                bottom: 16px;
                left: 16px;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: var(--bg-2, #222);
                color: var(--text-3, #666);
                border: 1px solid var(--border, #333);
                font-size: 0.75rem;
                font-weight: 700;
                cursor: pointer;
                z-index: 9990;
                align-items: center;
                justify-content: center;
                transition: color 0.15s, border-color 0.15s;
            }
            #mk-kb-help:hover {
                color: var(--accent, #C9A84C);
                border-color: var(--accent, #C9A84C);
            }
            @media (min-width: 769px) {
                #mk-kb-help {
                    display: flex;
                }
            }

            /* Keyboard cheat sheet */
            #mk-kb-cheatsheet {
                position: fixed;
                bottom: 52px;
                left: 16px;
                background: var(--bg-1, #1a1a1a);
                border: 1px solid var(--border, #333);
                border-radius: 10px;
                padding: 12px 16px;
                z-index: 99999;
                font-size: 0.72rem;
                color: var(--text-1, #ccc);
                box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                min-width: 200px;
                animation: mkCheatIn 0.15s ease;
            }
            @keyframes mkCheatIn {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .mk-kb-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 3px 0;
                gap: 12px;
            }
            .mk-kb-row kbd {
                background: var(--bg-3, #2a2a2a);
                border: 1px solid var(--border, #444);
                border-radius: 4px;
                padding: 1px 6px;
                font-family: var(--mono, monospace);
                font-size: 0.68rem;
                color: var(--text-0, #eee);
                white-space: nowrap;
            }
            .mk-kb-row span {
                color: var(--text-2, #999);
                font-size: 0.68rem;
            }

            /* Deal card swipe wrapper */
            .mk-swipe-wrap {
                position: relative;
                overflow: hidden;
                border-radius: 8px;
            }
            .mk-swipe-wrap .deal-card {
                transition: none;
                position: relative;
                z-index: 2;
            }
            .mk-swipe-wrap.mk-swiping .deal-card {
                transition: none !important;
            }
        `;
        document.head.appendChild(_styleEl);
    }

    // ── FAB (Floating Action Button) ──

    function createFAB() {
        if (_fabEl) return;
        _fabEl = document.createElement('button');
        _fabEl.id = FAB_ID;
        _fabEl.setAttribute('aria-label', 'Quick action');
        _fabEl.classList.add('mk-fab-hidden');
        document.body.appendChild(_fabEl);
        _fabEl.addEventListener('click', onFABClick);
        updateFAB();
    }

    function updateFAB() {
        if (!_fabEl) return;
        if (!isMobile() || _keyboardOpen) {
            _fabEl.classList.add('mk-fab-hidden');
            return;
        }
        _fabEl.classList.remove('mk-fab-hidden');

        const page = getActivePage();
        let icon = '+';
        let label = 'Action';

        switch (page) {
            case 'inventory':
                icon = '+';
                label = 'Add Watch';
                break;
            case 'lookup':
                // magnifying glass unicode
                icon = '\u2315';
                label = 'Search';
                break;
            case 'deals':
                // refresh arrow
                icon = '\u21BB';
                label = 'Refresh Deals';
                break;
            case 'portfolio':
                icon = '\u21BB';
                label = 'Refresh Portfolio';
                break;
            case 'postings':
                icon = '+';
                label = 'New Posting';
                break;
            default:
                _fabEl.classList.add('mk-fab-hidden');
                return;
        }

        _fabEl.textContent = icon;
        _fabEl.setAttribute('aria-label', label);
        _fabEl.title = label;
    }

    function onFABClick() {
        const page = getActivePage();
        switch (page) {
            case 'inventory':
                if (typeof showAddWatchModal === 'function') showAddWatchModal();
                break;
            case 'lookup': {
                const si = document.getElementById('ref-search');
                if (si) { si.focus(); si.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                break;
            }
            case 'deals':
                if (typeof loadData === 'function') {
                    loadData();
                    if (typeof showToast === 'function') showToast('Refreshing deals...', 'info');
                }
                break;
            case 'portfolio':
                if (typeof loadPortfolio === 'function') {
                    loadPortfolio();
                    if (typeof showToast === 'function') showToast('Refreshing portfolio...', 'info');
                }
                break;
            case 'postings':
                if (typeof loadPostingsPage === 'function') {
                    // Switch to "Ready to Post" tab where user picks a watch to post
                    const readyTab = document.getElementById('postings-tab-ready');
                    if (readyTab && typeof switchPostingsTab === 'function') {
                        switchPostingsTab('ready', readyTab);
                    }
                    if (typeof showToast === 'function') showToast('Showing watches ready to post', 'info');
                }
                break;
        }
    }

    // ── Keyboard detection via visualViewport ──

    function setupKeyboardDetection() {
        if (!window.visualViewport) return;
        const initialHeight = window.visualViewport.height;
        _boundHandlers.viewportResize = function() {
            // If viewport shrinks by >150px, keyboard is probably open
            const diff = initialHeight - window.visualViewport.height;
            const wasOpen = _keyboardOpen;
            _keyboardOpen = diff > 150;
            if (wasOpen !== _keyboardOpen) updateFAB();
        };
        window.visualViewport.addEventListener('resize', _boundHandlers.viewportResize);
    }

    // ── Page change listener ──

    function setupPageChangeListener() {
        // Listen for popstate / hashchange and also hook into showPage calls
        // We use a custom event emitted by module system, plus a fallback
        _boundHandlers.pageChange = function() {
            updateFAB();
            // Re-bind swipe handlers when navigating to deals
            if (getActivePage() === 'deals') {
                requestAnimationFrame(() => setupSwipeHandlers());
            }
        };

        // The showPage function dispatches click on nav items which change .page.active
        // Listen for the page transition via the click on mobile-nav links and sidebar links
        document.addEventListener('click', function(e) {
            const link = e.target.closest('[data-page], [onclick*="showPage"]');
            if (link) {
                // Defer to next frame so the page class has been updated
                requestAnimationFrame(() => {
                    updateFAB();
                    if (getActivePage() === 'deals') {
                        // Small delay for deals cards to render
                        setTimeout(() => setupSwipeHandlers(), 300);
                    }
                });
            }
        });

        // Also listen for mk:modules-ready and data refresh
        window.MKModules.on('data-loaded', _boundHandlers.pageChange);
        document.addEventListener('mk:modules-ready', _boundHandlers.pageChange);

        // popstate for browser back/forward
        window.addEventListener('popstate', function() {
            setTimeout(() => { updateFAB(); }, 100);
        });
    }

    // ── Swipe-to-action on deal cards ──

    function setupSwipeHandlers() {
        if (!isMobile()) return;
        const container = document.getElementById('deals-cards');
        if (!container) return;

        const cards = container.querySelectorAll('.deal-card');
        cards.forEach(function(card, idx) {
            // Skip if already wrapped
            if (card.parentElement && card.parentElement.classList.contains('mk-swipe-wrap')) return;

            // Wrap card for swipe
            const wrapper = document.createElement('div');
            wrapper.className = 'mk-swipe-wrap';
            wrapper.dataset.dealIdx = idx;

            // Create hint overlays
            const hintSave = document.createElement('div');
            hintSave.className = 'mk-swipe-hint mk-swipe-hint-save';
            hintSave.textContent = '\u2713 Save';

            const hintDismiss = document.createElement('div');
            hintDismiss.className = 'mk-swipe-hint mk-swipe-hint-dismiss';
            hintDismiss.textContent = '\u2717 Dismiss';

            card.parentNode.insertBefore(wrapper, card);
            wrapper.appendChild(hintSave);
            wrapper.appendChild(hintDismiss);
            wrapper.appendChild(card);

            // Touch handlers
            wrapper.addEventListener('touchstart', onSwipeTouchStart, { passive: true });
            wrapper.addEventListener('touchmove', onSwipeTouchMove, { passive: false });
            wrapper.addEventListener('touchend', onSwipeTouchEnd, { passive: true });
        });
    }

    function onSwipeTouchStart(e) {
        const touch = e.touches[0];
        _swipeState = {
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: 0,
            locked: false, // locked to horizontal once determined
            cancelled: false,
            wrapper: this
        };
    }

    function onSwipeTouchMove(e) {
        if (!_swipeState || _swipeState.cancelled) return;
        const touch = e.touches[0];
        const dx = touch.clientX - _swipeState.startX;
        const dy = touch.clientY - _swipeState.startY;

        // Determine direction lock
        if (!_swipeState.locked) {
            if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
                // Vertical scroll — cancel swipe
                _swipeState.cancelled = true;
                return;
            }
            if (Math.abs(dx) > 10) {
                _swipeState.locked = true;
                _swipeState.wrapper.classList.add('mk-swiping');
            } else {
                return;
            }
        }

        e.preventDefault(); // prevent scrolling during horizontal swipe

        _swipeState.currentX = dx;
        const card = _swipeState.wrapper.querySelector('.deal-card');
        if (card) {
            card.style.transform = 'translateX(' + dx + 'px)';
        }

        // Show hint overlays based on direction and threshold
        const hintSave = _swipeState.wrapper.querySelector('.mk-swipe-hint-save');
        const hintDismiss = _swipeState.wrapper.querySelector('.mk-swipe-hint-dismiss');

        if (dx > 20 && hintSave) {
            hintSave.style.opacity = Math.min(dx / SWIPE_THRESHOLD, 1);
        } else if (hintSave) {
            hintSave.style.opacity = '0';
        }

        if (dx < -20 && hintDismiss) {
            hintDismiss.style.opacity = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
        } else if (hintDismiss) {
            hintDismiss.style.opacity = '0';
        }
    }

    function onSwipeTouchEnd() {
        if (!_swipeState || _swipeState.cancelled) {
            _swipeState = null;
            return;
        }

        const wrapper = _swipeState.wrapper;
        const card = wrapper.querySelector('.deal-card');
        const dx = _swipeState.currentX;
        const idx = parseInt(wrapper.dataset.dealIdx, 10);

        // Hide hints
        const hintSave = wrapper.querySelector('.mk-swipe-hint-save');
        const hintDismiss = wrapper.querySelector('.mk-swipe-hint-dismiss');
        if (hintSave) hintSave.style.opacity = '0';
        if (hintDismiss) hintDismiss.style.opacity = '0';

        wrapper.classList.remove('mk-swiping');

        if (dx > SWIPE_THRESHOLD) {
            // Swipe right — save to watchlist
            handleSwipeSave(wrapper, card, idx);
        } else if (dx < -SWIPE_THRESHOLD) {
            // Swipe left — dismiss
            handleSwipeDismiss(wrapper, card, idx);
        } else {
            // Snap back
            if (card) {
                card.style.transition = 'transform 0.2s ease';
                card.style.transform = 'translateX(0)';
                setTimeout(function() { card.style.transition = ''; }, 200);
            }
        }

        _swipeState = null;
    }

    function handleSwipeSave(wrapper, card, idx) {
        // Get deal data
        var deal = null;
        if (window._dealsFiltered && window._dealsFiltered[idx]) {
            deal = window._dealsFiltered[idx];
        }

        // Animate snap back with green flash
        if (card) {
            card.style.transition = 'transform 0.2s ease';
            card.style.transform = 'translateX(0)';
            setTimeout(function() { card.style.transition = ''; }, 200);
        }
        wrapper.classList.add('mk-flash-green');
        setTimeout(function() { wrapper.classList.remove('mk-flash-green'); }, 500);

        if (deal) {
            var added = saveToWatchlist(deal);
            if (typeof showToast === 'function') {
                showToast(added ? deal.ref + ' saved to watchlist' : deal.ref + ' already in watchlist', added ? 'success' : 'info');
            }
        }
    }

    function handleSwipeDismiss(wrapper, card, idx) {
        // Slide out left
        if (card) {
            card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            card.style.transform = 'translateX(-110%)';
            card.style.opacity = '0';
        }

        setTimeout(function() {
            wrapper.style.overflow = 'hidden';
            wrapper.style.maxHeight = wrapper.offsetHeight + 'px';
            wrapper.style.transition = 'max-height 0.25s ease, margin 0.25s ease, padding 0.25s ease';
            requestAnimationFrame(function() {
                wrapper.style.maxHeight = '0';
                wrapper.style.marginTop = '0';
                wrapper.style.marginBottom = '0';
                wrapper.style.paddingTop = '0';
                wrapper.style.paddingBottom = '0';
            });
            setTimeout(function() { wrapper.remove(); }, 300);
        }, 250);

        // Store dismissed deal index in session
        var dismissed = [];
        try { dismissed = JSON.parse(sessionStorage.getItem('mk-dismissed-deals') || '[]'); } catch(e) {}
        if (window._dealsFiltered && window._dealsFiltered[idx]) {
            var d = window._dealsFiltered[idx];
            dismissed.push(d.ref + '|' + (d.seller || '') + '|' + (d.price_usd || d.price || 0));
            sessionStorage.setItem('mk-dismissed-deals', JSON.stringify(dismissed));
        }

        if (typeof showToast === 'function') {
            showToast('Deal dismissed', 'info');
        }
    }

    // ── Offline Cache ──

    function getOfflineLookups() {
        try { return JSON.parse(localStorage.getItem(OFFLINE_LOOKUP_KEY) || '[]'); }
        catch(e) { return []; }
    }

    function saveOfflineLookup(ref, data) {
        var lookups = getOfflineLookups();
        // Remove existing entry for same ref
        lookups = lookups.filter(function(l) { return l.ref !== ref; });
        lookups.unshift({ ref: ref, data: data, timestamp: Date.now() });
        // Cap at max
        if (lookups.length > OFFLINE_MAX_LOOKUPS) {
            lookups = lookups.slice(0, OFFLINE_MAX_LOOKUPS);
        }
        try { localStorage.setItem(OFFLINE_LOOKUP_KEY, JSON.stringify(lookups)); }
        catch(e) { /* storage full — evict half */
            lookups = lookups.slice(0, Math.floor(OFFLINE_MAX_LOOKUPS / 2));
            try { localStorage.setItem(OFFLINE_LOOKUP_KEY, JSON.stringify(lookups)); } catch(e2) {}
        }
    }

    function findOfflineLookup(ref) {
        var lookups = getOfflineLookups();
        return lookups.find(function(l) { return l.ref === ref; }) || null;
    }

    function getOfflineDeals() {
        try { return JSON.parse(localStorage.getItem(OFFLINE_DEALS_KEY) || 'null'); }
        catch(e) { return null; }
    }

    function saveOfflineDeals(data) {
        try {
            localStorage.setItem(OFFLINE_DEALS_KEY, JSON.stringify({
                deals: data,
                timestamp: Date.now()
            }));
        } catch(e) { /* storage full */ }
    }

    function formatTimeAgo(ts) {
        var diff = Date.now() - ts;
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        return Math.floor(hrs / 24) + 'd ago';
    }

    function showOfflineBanner(timestamp) {
        removeOfflineBanner();
        _offlineBannerEl = document.createElement('div');
        _offlineBannerEl.id = 'mk-offline-banner';
        _offlineBannerEl.textContent = 'Offline -- using cached data from ' + formatTimeAgo(timestamp);
        document.body.appendChild(_offlineBannerEl);
        // Auto-dismiss after 8 seconds
        setTimeout(function() { removeOfflineBanner(); }, 8000);
    }

    function removeOfflineBanner() {
        if (_offlineBannerEl && _offlineBannerEl.parentNode) {
            _offlineBannerEl.parentNode.removeChild(_offlineBannerEl);
        }
        _offlineBannerEl = null;
    }

    function setupOfflineCache() {
        if (_originalFetch) return; // already wrapped
        _originalFetch = window.fetch;

        window.fetch = function(url, opts) {
            var urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));

            // Intercept /api/smart_search calls (lookup)
            if (urlStr.indexOf('/api/smart_search') !== -1) {
                var qMatch = urlStr.match(/[?&]q=([^&]+)/);
                var queryRef = qMatch ? decodeURIComponent(qMatch[1]).trim().toLowerCase() : '';

                return _originalFetch.call(window, url, opts).then(function(response) {
                    // Clone response so we can read it and still return it
                    var cloned = response.clone();
                    if (response.ok && queryRef) {
                        cloned.json().then(function(data) {
                            saveOfflineLookup(queryRef, data);
                        }).catch(function() {});
                    }
                    removeOfflineBanner();
                    return response;
                }).catch(function(err) {
                    // Network failed — try cache
                    if (queryRef) {
                        var cached = findOfflineLookup(queryRef);
                        if (cached) {
                            showOfflineBanner(cached.timestamp);
                            return new Response(JSON.stringify(cached.data), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                    }
                    throw err;
                });
            }

            // Intercept /api/deals calls
            if (urlStr.indexOf('/api/deals') !== -1 && urlStr.indexOf('/api/deals/') === -1) {
                return _originalFetch.call(window, url, opts).then(function(response) {
                    var cloned = response.clone();
                    if (response.ok) {
                        cloned.json().then(function(data) {
                            saveOfflineDeals(data);
                        }).catch(function() {});
                    }
                    removeOfflineBanner();
                    return response;
                }).catch(function(err) {
                    var cached = getOfflineDeals();
                    if (cached) {
                        showOfflineBanner(cached.timestamp);
                        return new Response(JSON.stringify(cached.deals), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    throw err;
                });
            }

            // All other requests pass through
            return _originalFetch.call(window, url, opts);
        };
    }

    // ── Keyboard Shortcuts (desktop only) ──

    function isDesktop() {
        return window.innerWidth > MOBILE_BP;
    }

    function isTyping() {
        var el = document.activeElement;
        if (!el) return false;
        var tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function findSearchInput() {
        var page = getActivePage();
        var map = {
            'lookup': 'ref-search',
            'deals': 'deals-search',
            'inventory': 'im-search',
            'browse': 'browse-search',
            'postings': 'postings-search',
            'invoices': 'inv-search',
            'shipping': 'ship-contact-search',
            'photos': 'library-search'
        };
        var id = map[page];
        if (id) {
            var el = document.getElementById(id);
            if (el) return el;
        }
        // Fallback: find first visible input on the active page
        var pageEl = document.querySelector('.page.active');
        if (pageEl) {
            var inputs = pageEl.querySelectorAll('input[type="text"], input:not([type])');
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i].offsetParent !== null) return inputs[i];
            }
        }
        return null;
    }

    function onKeyboardShortcut(e) {
        if (!isDesktop()) return;
        if (isTyping()) {
            // Only handle Escape when typing
            if (e.key === 'Escape') {
                document.activeElement.blur();
            }
            return;
        }

        // Cmd+K / Ctrl+K — focus search
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            var si = findSearchInput();
            if (si) { si.focus(); si.select(); }
            return;
        }

        // Don't handle shortcuts with modifier keys (except Cmd+K above)
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        switch (e.key) {
            case '/':
                e.preventDefault();
                var si2 = findSearchInput();
                if (si2) { si2.focus(); si2.select(); }
                break;
            case 'n':
                if (getActivePage() === 'inventory' && typeof showAddWatchModal === 'function') {
                    e.preventDefault();
                    showAddWatchModal();
                }
                break;
            case 'd':
                e.preventDefault();
                if (typeof showPage === 'function') showPage('deals');
                break;
            case 'p':
                e.preventDefault();
                if (typeof showPage === 'function') showPage('lookup');
                break;
            case 'i':
                e.preventDefault();
                if (typeof showPage === 'function') showPage('inventory');
                break;
            case 'Escape':
                // Close any open modal
                closeAnyModal();
                break;
            case '?':
                toggleCheatSheet();
                break;
        }
    }

    function closeAnyModal() {
        // Close modals by looking for common patterns
        var modals = document.querySelectorAll('.modal-overlay, .modal-backdrop, [id$="-modal"]');
        modals.forEach(function(m) {
            if (m.style.display !== 'none' && m.offsetParent !== null) {
                // Try clicking close button first
                var closeBtn = m.querySelector('.modal-close, [onclick*="close"], .btn-close');
                if (closeBtn) {
                    closeBtn.click();
                } else {
                    m.style.display = 'none';
                }
            }
        });
        // Also try known close functions
        if (typeof closeWatchDetail === 'function') {
            try { closeWatchDetail(); } catch(e) {}
        }
        if (typeof closeUnifiedSearch === 'function') {
            try { closeUnifiedSearch(); } catch(e) {}
        }
    }

    function createCheatSheetIcon() {
        if (!isDesktop()) return;
        if (document.getElementById('mk-kb-help')) return;

        var btn = document.createElement('button');
        btn.id = 'mk-kb-help';
        btn.textContent = '?';
        btn.setAttribute('aria-label', 'Keyboard shortcuts');
        btn.addEventListener('mouseenter', function() { showCheatSheet(); });
        btn.addEventListener('mouseleave', function() { hideCheatSheet(); });
        btn.addEventListener('click', function() { toggleCheatSheet(); });
        document.body.appendChild(btn);
    }

    function removeCheatSheetIcon() {
        var btn = document.getElementById('mk-kb-help');
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    }

    function showCheatSheet() {
        if (_kbCheatEl) return;
        _kbCheatEl = document.createElement('div');
        _kbCheatEl.id = 'mk-kb-cheatsheet';
        _kbCheatEl.innerHTML = [
            '<div style="font-weight:700;margin-bottom:8px;color:var(--accent,#C9A84C);font-size:0.8rem;">Keyboard Shortcuts</div>',
            '<div class="mk-kb-row"><kbd>/</kbd> or <kbd>Cmd+K</kbd><span>Focus search</span></div>',
            '<div class="mk-kb-row"><kbd>d</kbd><span>Deals</span></div>',
            '<div class="mk-kb-row"><kbd>p</kbd><span>Prices / Lookup</span></div>',
            '<div class="mk-kb-row"><kbd>i</kbd><span>Inventory</span></div>',
            '<div class="mk-kb-row"><kbd>n</kbd><span>Add watch (on Inventory)</span></div>',
            '<div class="mk-kb-row"><kbd>Esc</kbd><span>Close modal</span></div>',
            '<div class="mk-kb-row"><kbd>?</kbd><span>Toggle this sheet</span></div>'
        ].join('');
        document.body.appendChild(_kbCheatEl);
    }

    function hideCheatSheet() {
        if (_kbCheatEl && _kbCheatEl.parentNode) {
            _kbCheatEl.parentNode.removeChild(_kbCheatEl);
        }
        _kbCheatEl = null;
    }

    function toggleCheatSheet() {
        if (_kbCheatEl) { hideCheatSheet(); }
        else { showCheatSheet(); }
    }

    function setupKeyboardShortcuts() {
        if (_kbShortcutsActive) return;
        if (!isDesktop()) return;

        _boundHandlers.keyboardShortcut = onKeyboardShortcut;
        document.addEventListener('keydown', _boundHandlers.keyboardShortcut);
        _kbShortcutsActive = true;
        createCheatSheetIcon();
    }

    function teardownKeyboardShortcuts() {
        if (_boundHandlers.keyboardShortcut) {
            document.removeEventListener('keydown', _boundHandlers.keyboardShortcut);
        }
        _kbShortcutsActive = false;
        hideCheatSheet();
        removeCheatSheetIcon();
    }

    // ── Init / Render / Cleanup ──

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        _mql = window.matchMedia('(max-width: ' + MOBILE_BP + 'px)');

        injectStyles();
        createFAB();
        setupKeyboardDetection();
        setupPageChangeListener();
        setupOfflineCache();

        // Desktop keyboard shortcuts
        if (isDesktop()) {
            setupKeyboardShortcuts();
        }
        // Re-evaluate on resize
        _boundHandlers.resizeKb = function() {
            if (isDesktop() && !_kbShortcutsActive) {
                setupKeyboardShortcuts();
            } else if (!isDesktop() && _kbShortcutsActive) {
                teardownKeyboardShortcuts();
            }
        };
        window.addEventListener('resize', _boundHandlers.resizeKb);

        // Initial FAB state
        updateFAB();

        // If already on deals page, set up swipe
        if (getActivePage() === 'deals') {
            setTimeout(function() { setupSwipeHandlers(); }, 500);
        }
    }

    function render() {
        updateFAB();
        // Re-setup swipe handlers if on deals page (cards may have re-rendered)
        if (isMobile() && getActivePage() === 'deals') {
            requestAnimationFrame(function() { setupSwipeHandlers(); });
        }
    }

    function cleanup() {
        if (_fabEl && _fabEl.parentNode) {
            _fabEl.removeEventListener('click', onFABClick);
            _fabEl.parentNode.removeChild(_fabEl);
            _fabEl = null;
        }
        if (_styleEl && _styleEl.parentNode) {
            _styleEl.parentNode.removeChild(_styleEl);
            _styleEl = null;
        }
        if (window.visualViewport && _boundHandlers.viewportResize) {
            window.visualViewport.removeEventListener('resize', _boundHandlers.viewportResize);
        }
        if (_boundHandlers.resizeKb) {
            window.removeEventListener('resize', _boundHandlers.resizeKb);
        }
        teardownKeyboardShortcuts();
        removeOfflineBanner();
        // Restore original fetch
        if (_originalFetch) {
            window.fetch = _originalFetch;
            _originalFetch = null;
        }
        _boundHandlers = {};
        _swipeState = null;
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
