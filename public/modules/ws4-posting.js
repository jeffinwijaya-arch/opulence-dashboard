/**
 * MK Opulence — ws4-posting
 * Posting & Sales workstream module.
 *
 * Features:
 *   1. Auto-caption generator — builds posting caption from watch data, copies to clipboard
 *   2. Smart price recommendation — 3-tier pricing (Competitive/Market/Premium) from DATA.refs
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws4-posting', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws4-posting';
    const MONTHS = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

    // ── Helpers ──────────────────────────────────────────────

    function fmtPrice(n) {
        if (n == null || isNaN(n)) return '--';
        return '$' + Math.round(Number(n)).toLocaleString('en-US');
    }

    /**
     * Extract ref number from a ref string. Handles "126710BLNR" etc.
     * Returns the raw ref for DATA.refs lookup.
     */
    function normalizeRef(ref) {
        return (ref || '').trim().toUpperCase();
    }

    /**
     * Look up market data for a reference in DATA.refs.
     * Returns { low, b25, us_low, us_b25, count, ... } or null.
     */
    function getRefData(ref) {
        if (!ref || !window.DATA || !window.DATA.refs) return null;
        const norm = normalizeRef(ref);
        // Try exact match first
        if (window.DATA.refs[norm]) return window.DATA.refs[norm];
        // Try numeric-only prefix (e.g., "126710" from "126710BLNR")
        const numOnly = norm.replace(/[^0-9]/g, '');
        if (numOnly && window.DATA.refs[numOnly]) return window.DATA.refs[numOnly];
        // Search for partial matches
        for (const [key, val] of Object.entries(window.DATA.refs)) {
            if (key.startsWith(norm) || norm.startsWith(key)) return val;
        }
        return null;
    }

    /**
     * Parse card_date (MM/YYYY or other formats) into { mm, yyyy, monthName }.
     */
    function parseCardDate(cardDate, description) {
        let raw = cardDate || '';
        if (!raw && description) {
            const m = description.match(/(\d{2})\/(\d{4})/);
            if (m) raw = m[0];
        }
        if (!raw) return null;
        const parts = raw.match(/(\d{1,2})\/(\d{4})/);
        if (!parts) return null;
        const mm = parseInt(parts[1], 10);
        const yyyy = parts[2];
        return {
            mm: String(mm).padStart(2, '0'),
            yyyy: yyyy,
            monthName: MONTHS[mm] || '',
            raw: parts[1].padStart(2, '0') + '/' + yyyy
        };
    }

    /**
     * Build a posting caption from watch item data.
     * Format: {Condition} Full Set {ref} {bracelet} {dial} Dial {MM/YYYY} {Month Year} {serial_prefix} with WT
     * $price + label
     */
    function buildCaption(item, price) {
        const ref = item.ref || '';
        const desc = item.description || '';
        const bracelet = item.bracelet || '';
        const dial = item.dial || '';

        // Condition
        let condition = 'BNIB';
        const descLower = desc.toLowerCase();
        if (descLower.includes('pre-owned')) condition = 'Pre-Owned';
        else if (descLower.includes('retail ready')) condition = 'Retail Ready';
        else if (descLower.includes('unworn')) condition = 'Unworn';
        else if (item.condition) {
            const c = item.condition.trim();
            if (c) condition = c;
        }

        // Card date
        const cd = parseCardDate(item.card_date, desc);
        const cardDateStr = cd ? cd.raw : '';
        const monthYear = cd ? (cd.monthName + ' ' + cd.yyyy) : '';

        // Serial prefix (N + month number from card date)
        let serialPrefix = '';
        if (cd) {
            serialPrefix = 'N' + parseInt(cd.mm, 10);
        }

        // Ref line — if ref has letters at end, also show numeric portion
        const refMatch = ref.match(/^(\d{5,6})([A-Z]+)$/);
        const refLine = refMatch ? ref + ' ' + refMatch[1] : ref;

        // Build base caption
        const parts = [condition, 'Full Set', refLine, bracelet, dial ? (dial + ' Dial') : '', cardDateStr, monthYear, serialPrefix, 'with WT'];
        const captionBase = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

        // Price line
        if (price && Number(price) > 0) {
            const fmtP = Number(price).toLocaleString('en-US');
            return captionBase + '\n$' + fmtP + ' + label';
        }
        return captionBase;
    }

    /**
     * Get the 3 price tiers for a given ref.
     * Returns { competitive, market, premium } or null if no data.
     */
    function getPriceTiers(ref) {
        const data = getRefData(ref);
        if (!data) return null;

        // Use us_low if available, otherwise fall back to low, then b25
        const usLow = data.us_low || data.low || 0;
        const b25 = data.us_b25 || data.b25 || data.median || 0;
        const baseLow = usLow || b25;

        if (!baseLow || baseLow <= 0) return null;

        return {
            competitive: Math.round(baseLow - 100),
            market: Math.round(b25 || baseLow),
            premium: Math.round(baseLow + 300),
            count: data.count || 0,
            usLow: usLow,
            b25: b25
        };
    }

    // ── CSS injection ───────────────────────────────────────

    function injectStyles() {
        if (document.getElementById('ws4-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws4-styles';
        style.textContent = `
            .ws4-gen-btn {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                font-size: 0.65rem;
                font-weight: 600;
                border-radius: 6px;
                border: 1px solid var(--accent-border, rgba(0,180,255,0.3));
                background: var(--accent-dim, rgba(0,180,255,0.1));
                color: var(--accent, #00b4ff);
                cursor: pointer;
                white-space: nowrap;
                transition: opacity 0.15s;
            }
            .ws4-gen-btn:active { opacity: 0.7; }

            .ws4-price-badges {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 6px;
            }
            .ws4-price-badge {
                display: inline-flex;
                flex-direction: column;
                align-items: center;
                padding: 6px 12px;
                border-radius: 8px;
                border: 1px solid var(--border, #333);
                background: var(--bg-2, #1a1a1a);
                cursor: pointer;
                transition: border-color 0.15s, background 0.15s;
                min-width: 80px;
                text-align: center;
            }
            .ws4-price-badge:active {
                opacity: 0.7;
            }
            .ws4-price-badge-label {
                font-size: 0.58rem;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                font-weight: 600;
                margin-bottom: 2px;
            }
            .ws4-price-badge-val {
                font-family: var(--mono, monospace);
                font-size: 0.78rem;
                font-weight: 700;
            }
            .ws4-badge-competitive {
                border-color: rgba(0,230,118,0.3);
            }
            .ws4-badge-competitive .ws4-price-badge-label { color: var(--green, #00e676); }
            .ws4-badge-competitive .ws4-price-badge-val { color: var(--green, #00e676); }
            .ws4-badge-competitive:hover { background: rgba(0,230,118,0.08); border-color: var(--green, #00e676); }

            .ws4-badge-market {
                border-color: rgba(0,180,255,0.3);
            }
            .ws4-badge-market .ws4-price-badge-label { color: var(--accent, #00b4ff); }
            .ws4-badge-market .ws4-price-badge-val { color: var(--accent, #00b4ff); }
            .ws4-badge-market:hover { background: rgba(0,180,255,0.08); border-color: var(--accent, #00b4ff); }

            .ws4-badge-premium {
                border-color: rgba(255,193,7,0.3);
            }
            .ws4-badge-premium .ws4-price-badge-label { color: var(--yellow, #ffc107); }
            .ws4-badge-premium .ws4-price-badge-val { color: var(--yellow, #ffc107); }
            .ws4-badge-premium:hover { background: rgba(255,193,7,0.08); border-color: var(--yellow, #ffc107); }

            .ws4-no-data {
                font-size: 0.68rem;
                color: var(--text-2, #888);
                padding: 6px 0;
                font-style: italic;
            }

            .ws4-caption-copied {
                font-size: 0.62rem;
                color: var(--green, #00e676);
                font-weight: 600;
                margin-left: 6px;
                opacity: 0;
                transition: opacity 0.3s;
            }
            .ws4-caption-copied.show { opacity: 1; }
        `;
        document.head.appendChild(style);
    }

    // ── Caption Generator (Ready to Post + Post Direct Modal) ──

    /**
     * Inject "Generate Caption" button into the Ready to Post table rows.
     * We hook into the existing renderReadyToPost flow via event.
     */
    function enhanceReadyToPostTable() {
        const tbody = document.getElementById('postings-ready-tbody');
        if (!tbody) return;

        // Add Generate Caption button to each row's actions cell (last td)
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) return; // header or empty row
            const actionsCell = cells[cells.length - 1];
            // Skip if already enhanced
            if (actionsCell.querySelector('.ws4-gen-btn')) return;

            // Find the Post button to extract the item data
            const postBtn = actionsCell.querySelector('button');
            if (!postBtn) return;

            const genBtn = document.createElement('button');
            genBtn.className = 'ws4-gen-btn';
            genBtn.textContent = 'Generate Caption';
            genBtn.style.marginLeft = '4px';
            genBtn.onclick = function(e) {
                e.stopPropagation();
                // Extract item from the Post button's onclick
                const onclickStr = postBtn.getAttribute('onclick') || '';
                const match = onclickStr.match(/openPostDirectModal\((\{.*\})\)/s);
                if (!match) {
                    if (typeof showToast === 'function') showToast('Could not extract watch data', 'error');
                    return;
                }
                try {
                    const item = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
                    generateAndCopyCaption(item, genBtn);
                } catch (err) {
                    if (typeof showToast === 'function') showToast('Parse error: ' + err.message, 'error');
                }
            };
            actionsCell.insertBefore(genBtn, postBtn.nextSibling);
        });
    }

    /**
     * Generate caption for a watch item and copy to clipboard.
     */
    function generateAndCopyCaption(item, btnEl) {
        // Determine best price
        let price = item.sale_price || '';
        if (!price) {
            const tiers = getPriceTiers(item.ref);
            if (tiers) price = tiers.market;
        }

        const caption = buildCaption(item, price);
        navigator.clipboard.writeText(caption).then(() => {
            if (typeof showToast === 'function') showToast('Caption copied to clipboard');
            // Flash the button
            if (btnEl) {
                const origText = btnEl.textContent;
                btnEl.textContent = 'Copied!';
                btnEl.style.borderColor = 'var(--green)';
                btnEl.style.color = 'var(--green)';
                setTimeout(() => {
                    btnEl.textContent = origText;
                    btnEl.style.borderColor = '';
                    btnEl.style.color = '';
                }, 1500);
            }
        }).catch(() => {
            // Fallback: select text in a temp textarea
            const ta = document.createElement('textarea');
            ta.value = caption;
            ta.style.cssText = 'position:fixed;left:-999px;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (typeof showToast === 'function') showToast('Caption copied');
        });
    }

    // ── Smart Price Recommendation (Post Direct Modal) ──────

    /**
     * Inject price tier badges into the Post Direct modal when it opens.
     * We override openPostDirectModal to add our enhancement after it runs.
     */
    function hookPostDirectModal() {
        const origOpen = window.openPostDirectModal;
        if (!origOpen) {
            console.warn('[' + MOD_ID + '] openPostDirectModal not found, deferring hook');
            return false;
        }

        window.openPostDirectModal = function(item) {
            // Call original
            origOpen.call(this, item);

            // Inject caption generator button near caption textarea
            injectCaptionButton(item);

            // Inject price recommendation badges
            injectPriceBadges(item);
        };
        return true;
    }

    /**
     * Add "Generate Caption" button next to the caption label in Post Direct modal.
     */
    function injectCaptionButton(item) {
        const captionTextarea = document.getElementById('pdm-caption');
        if (!captionTextarea) return;

        const parentDiv = captionTextarea.parentElement;
        if (!parentDiv) return;

        // Remove previous injection
        const prev = parentDiv.querySelector('.ws4-gen-btn');
        if (prev) prev.remove();
        const prevMsg = parentDiv.querySelector('.ws4-caption-copied');
        if (prevMsg) prevMsg.remove();

        const label = parentDiv.querySelector('label');
        if (!label) return;

        // Wrap label row for flex
        let labelRow = parentDiv.querySelector('.ws4-label-row');
        if (!labelRow) {
            labelRow = document.createElement('div');
            labelRow.className = 'ws4-label-row';
            labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
            label.parentNode.insertBefore(labelRow, label);
            labelRow.appendChild(label);
        }

        const genBtn = document.createElement('button');
        genBtn.className = 'ws4-gen-btn';
        genBtn.innerHTML = 'Generate Caption';
        genBtn.onclick = function(e) {
            e.preventDefault();
            // Determine best price: use current value in price field, or sale_price, or market
            let price = document.getElementById('pdm-price-input')?.value || item.sale_price || '';
            if (!price) {
                const tiers = getPriceTiers(item.ref);
                if (tiers) price = tiers.market;
            }

            const caption = buildCaption(item, price);
            captionTextarea.value = caption;

            // Also copy to clipboard
            navigator.clipboard.writeText(caption).catch(() => {});
            if (typeof showToast === 'function') showToast('Caption generated and copied');

            genBtn.textContent = 'Generated!';
            genBtn.style.borderColor = 'var(--green)';
            genBtn.style.color = 'var(--green)';
            setTimeout(() => {
                genBtn.textContent = 'Generate Caption';
                genBtn.style.borderColor = '';
                genBtn.style.color = '';
            }, 1500);
        };

        labelRow.appendChild(genBtn);
    }

    /**
     * Inject 3-tier price badges above the price input in Post Direct modal.
     */
    function injectPriceBadges(item) {
        const priceInput = document.getElementById('pdm-price-input');
        if (!priceInput) return;
        const parentDiv = priceInput.parentElement;
        if (!parentDiv) return;

        // Remove previous badges
        const prev = parentDiv.querySelector('.ws4-price-rec');
        if (prev) prev.remove();

        const ref = normalizeRef(item.ref);
        const tiers = getPriceTiers(ref);

        const container = document.createElement('div');
        container.className = 'ws4-price-rec';
        container.style.marginTop = '6px';

        if (!tiers) {
            container.innerHTML = '<div class="ws4-no-data">No market data for ' + (ref || 'this ref') + '</div>';
        } else {
            const header = document.createElement('div');
            header.style.cssText = 'font-size:0.62rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;';
            header.textContent = 'Smart Price (' + tiers.count + ' listings)';
            container.appendChild(header);

            const badgesDiv = document.createElement('div');
            badgesDiv.className = 'ws4-price-badges';

            const tierDefs = [
                { key: 'competitive', label: 'Competitive', value: tiers.competitive, desc: 'US low - $100' },
                { key: 'market', label: 'Market', value: tiers.market, desc: 'B25 avg' },
                { key: 'premium', label: 'Premium', value: tiers.premium, desc: 'US low + $300' }
            ];

            tierDefs.forEach(t => {
                const badge = document.createElement('div');
                badge.className = 'ws4-price-badge ws4-badge-' + t.key;
                badge.title = t.desc;
                badge.innerHTML = '<span class="ws4-price-badge-label">' + t.label + '</span>' +
                    '<span class="ws4-price-badge-val">' + fmtPrice(t.value) + '</span>';
                badge.onclick = function() {
                    priceInput.value = t.value;
                    // Trigger input event so caption updates via the existing oninput handler
                    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                    // Also update caption price line
                    updateCaptionPrice(t.value);
                    if (typeof showToast === 'function') showToast(t.label + ' price: ' + fmtPrice(t.value));
                    // Highlight selected badge
                    badgesDiv.querySelectorAll('.ws4-price-badge').forEach(b => b.style.outline = 'none');
                    badge.style.outline = '2px solid ' + getComputedStyle(badge.querySelector('.ws4-price-badge-val')).color;
                    badge.style.outlineOffset = '1px';
                };
                badgesDiv.appendChild(badge);
            });

            container.appendChild(badgesDiv);
        }

        // Insert after the label, before the input
        priceInput.parentNode.insertBefore(container, priceInput);
    }

    /**
     * Update the caption price line when a badge is clicked.
     */
    function updateCaptionPrice(price) {
        const caption = document.getElementById('pdm-caption');
        if (!caption) return;
        const val = caption.value || '';
        const fmtP = Number(price).toLocaleString('en-US');
        // Replace existing price line or append
        const priceLineRegex = /\n?\$?[\d,]+\s*\+\s*label\s*$/;
        if (priceLineRegex.test(val)) {
            caption.value = val.replace(priceLineRegex, '\n$' + fmtP + ' + label');
        } else {
            caption.value = val.trim() + '\n$' + fmtP + ' + label';
        }
    }

    // ── Hook into Edit Posting Modal ────────────────────────

    /**
     * Enhance the Edit Posting modal (epm) with price badges too.
     */
    function hookEditModal() {
        const origOpen = window.openPriceEditModal;
        if (!origOpen) {
            console.warn('[' + MOD_ID + '] openPriceEditModal not found, deferring hook');
            return false;
        }

        window.openPriceEditModal = function(messageId, currentPrice, caption, photo, row) {
            origOpen.call(this, messageId, currentPrice, caption, photo, row);

            // Extract ref from caption
            const cleanCaption = (caption || '').replace(/&apos;/g, "'");
            const refM = cleanCaption.match(/\b(\d{5,6}[A-Z]{0,4})\b/);
            const ref = refM ? refM[1] : '';

            if (ref) {
                injectEditModalPriceBadges(ref);
            }
        };
        return true;
    }

    /**
     * Inject price badges into the Edit Posting modal.
     */
    function injectEditModalPriceBadges(ref) {
        const priceInput = document.getElementById('epm-new-price');
        if (!priceInput) return;
        const parentDiv = priceInput.parentElement;
        if (!parentDiv) return;

        // Remove previous
        const prev = parentDiv.querySelector('.ws4-price-rec');
        if (prev) prev.remove();

        const tiers = getPriceTiers(ref);

        const container = document.createElement('div');
        container.className = 'ws4-price-rec';
        container.style.marginTop = '6px';

        if (!tiers) {
            container.innerHTML = '<div class="ws4-no-data">No market data for ' + ref + '</div>';
        } else {
            const header = document.createElement('div');
            header.style.cssText = 'font-size:0.62rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;';
            header.textContent = 'Smart Price (' + tiers.count + ' listings)';
            container.appendChild(header);

            const badgesDiv = document.createElement('div');
            badgesDiv.className = 'ws4-price-badges';

            const tierDefs = [
                { key: 'competitive', label: 'Competitive', value: tiers.competitive, desc: 'US low - $100' },
                { key: 'market', label: 'Market', value: tiers.market, desc: 'B25 avg' },
                { key: 'premium', label: 'Premium', value: tiers.premium, desc: 'US low + $300' }
            ];

            tierDefs.forEach(t => {
                const badge = document.createElement('div');
                badge.className = 'ws4-price-badge ws4-badge-' + t.key;
                badge.title = t.desc;
                badge.innerHTML = '<span class="ws4-price-badge-label">' + t.label + '</span>' +
                    '<span class="ws4-price-badge-val">' + fmtPrice(t.value) + '</span>';
                badge.onclick = function() {
                    priceInput.value = t.value;
                    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                    if (typeof showToast === 'function') showToast(t.label + ' price: ' + fmtPrice(t.value));
                    badgesDiv.querySelectorAll('.ws4-price-badge').forEach(b => b.style.outline = 'none');
                    badge.style.outline = '2px solid ' + getComputedStyle(badge.querySelector('.ws4-price-badge-val')).color;
                    badge.style.outlineOffset = '1px';
                };
                badgesDiv.appendChild(badge);
            });

            container.appendChild(badgesDiv);
        }

        priceInput.parentNode.insertBefore(container, priceInput);
    }

    // ── Init & Render ───────────────────────────────────────

    let _hooksInstalled = false;

    function installHooks() {
        if (_hooksInstalled) return;
        const postOk = hookPostDirectModal();
        const editOk = hookEditModal();
        if (postOk || editOk) _hooksInstalled = true;
    }

    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();

        // Try to install hooks immediately
        installHooks();

        // Also try after a short delay in case functions aren't defined yet
        if (!_hooksInstalled) {
            setTimeout(installHooks, 500);
        }

        // Listen for data refresh to re-enhance the Ready to Post table
        window.MKModules.on('data-loaded', render);

        // Listen for postings tab switches to enhance Ready to Post rows
        // We hook into the existing switchPostingsTab
        const origSwitch = window.switchPostingsTab;
        if (origSwitch) {
            window.switchPostingsTab = function(tab, el) {
                origSwitch.call(this, tab, el);
                if (tab === 'ready') {
                    // Wait for DOM to update after loadReadyToPost
                    setTimeout(enhanceReadyToPostTable, 500);
                }
            };
        }

        // Also hook loadReadyToPost to enhance after it populates
        const origLoad = window.loadReadyToPost;
        if (origLoad) {
            window.loadReadyToPost = async function() {
                await origLoad.call(this);
                setTimeout(enhanceReadyToPostTable, 100);
            };
        }
    }

    function render() {
        // Re-install hooks if they failed during init (globals may not have existed)
        if (!_hooksInstalled) installHooks();

        // Enhance Ready to Post table if currently visible
        if (document.getElementById('postings-panel-ready')?.style.display !== 'none') {
            setTimeout(enhanceReadyToPostTable, 200);
        }
    }

    function cleanup() {
        // Remove injected styles
        const style = document.getElementById('ws4-styles');
        if (style) style.remove();
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
