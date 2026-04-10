/**
 * MK Opulence — ws4-posting
 * Posting & Sales workstream module with Photo Intelligence Layer.
 *
 * Features:
 *   1. Auto-caption generator — builds posting caption from watch data, copies to clipboard
 *   2. Smart price recommendation — 3-tier pricing (Competitive/Market/Premium) from DATA.refs
 *   3. Photo coverage stats — fetches photo library data, injects summary into Photos page
 *   4. Documentation coverage matrix — shows per-watch doc completeness (dial, caseback, bracelet, card, box)
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws4-posting', { init, render, cleanup })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws4-posting';
    const MONTHS = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

    // ── Photo Intelligence State ────────────────────────────
    let _photoData = null;       // raw array from /api/watch-photos
    let _photoStats = null;      // computed stats
    let _photoCoverage = null;   // per-ref coverage matrix

    // ── Helpers ──────────────────────────────────────────────

    function fmtPrice(n) {
        if (n == null || isNaN(n)) return '--';
        return '$' + Math.round(Number(n)).toLocaleString('en-US');
    }

    function normalizeRef(ref) {
        return (ref || '').trim().toUpperCase();
    }

    function getRefData(ref) {
        if (!ref || !window.DATA || !window.DATA.refs) return null;
        const norm = normalizeRef(ref);
        if (window.DATA.refs[norm]) return window.DATA.refs[norm];
        const numOnly = norm.replace(/[^0-9]/g, '');
        if (numOnly && window.DATA.refs[numOnly]) return window.DATA.refs[numOnly];
        for (const [key, val] of Object.entries(window.DATA.refs)) {
            if (key.startsWith(norm) || norm.startsWith(key)) return val;
        }
        return null;
    }

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

    function buildCaption(item, price) {
        const ref = item.ref || '';
        const desc = item.description || '';
        const bracelet = item.bracelet || '';
        const dial = item.dial || '';

        let condition = 'BNIB';
        const descLower = desc.toLowerCase();
        if (descLower.includes('pre-owned')) condition = 'Pre-Owned';
        else if (descLower.includes('retail ready')) condition = 'Retail Ready';
        else if (descLower.includes('unworn')) condition = 'Unworn';
        else if (item.condition) {
            const c = item.condition.trim();
            if (c) condition = c;
        }

        const cd = parseCardDate(item.card_date, desc);
        const cardDateStr = cd ? cd.raw : '';
        const monthYear = cd ? (cd.monthName + ' ' + cd.yyyy) : '';

        let serialPrefix = '';
        if (cd) {
            serialPrefix = 'N' + parseInt(cd.mm, 10);
        }

        const refMatch = ref.match(/^(\d{5,6})([A-Z]+)$/);
        const refLine = refMatch ? ref + ' ' + refMatch[1] : ref;

        const parts = [condition, 'Full Set', refLine, bracelet, dial ? (dial + ' Dial') : '', cardDateStr, monthYear, serialPrefix, 'with WT'];
        const captionBase = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

        if (price && Number(price) > 0) {
            const fmtP = Number(price).toLocaleString('en-US');
            return captionBase + '\n$' + fmtP + ' + label';
        }
        return captionBase;
    }

    function getPriceTiers(ref) {
        const data = getRefData(ref);
        if (!data) return null;

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

    // ── 1. Photo Coverage Stats ─────────────────────────────

    async function fetchPhotoData() {
        try {
            const r = await fetch('/api/watch-photos');
            if (!r.ok) {
                console.warn('[' + MOD_ID + '] /api/watch-photos returned ' + r.status + ', using fallback');
                return null;
            }
            const d = await r.json();
            // API may return { watches: {...} } or { photos: [...] } or direct array
            if (d.watches && typeof d.watches === 'object') {
                return Object.values(d.watches);
            }
            if (Array.isArray(d.photos)) return d.photos;
            if (Array.isArray(d)) return d;
            return Object.values(d);
        } catch (e) {
            console.warn('[' + MOD_ID + '] Failed to fetch photo data:', e.message);
            return null;
        }
    }

    function computePhotoStats(photos) {
        if (!photos || !photos.length) return null;

        const totalPhotos = photos.length;
        const byRef = {};
        const byModel = {};
        let identified = 0;
        let withCardDate = 0;

        photos.forEach(p => {
            const ref = normalizeRef(p.ref);
            if (ref) {
                byRef[ref] = (byRef[ref] || 0) + 1;
            }
            const model = p.model || 'Unknown';
            byModel[model] = (byModel[model] || 0) + 1;
            if (p.identified) identified++;
            if (p.card_date) withCardDate++;
        });

        // Cross-reference with inventory (DATA.portfolio items) to find refs with no photos
        const inventoryRefs = new Set();
        if (window.DATA && window.DATA.portfolio && window.DATA.portfolio.items) {
            window.DATA.portfolio.items.forEach(item => {
                const ref = normalizeRef(item.ref);
                if (ref) inventoryRefs.add(ref);
            });
        }

        const refsWithNoPhotos = [];
        inventoryRefs.forEach(ref => {
            if (!byRef[ref]) refsWithNoPhotos.push(ref);
        });

        return {
            totalPhotos,
            uniqueRefs: Object.keys(byRef).length,
            photosPerRef: byRef,
            uniqueModels: Object.keys(byModel).length,
            modelCounts: byModel,
            identified,
            withCardDate,
            refsWithNoPhotos,
            inventoryRefsTotal: inventoryRefs.size,
            avgPhotosPerRef: Object.keys(byRef).length > 0
                ? (totalPhotos / Object.keys(byRef).length).toFixed(1)
                : 0
        };
    }

    function injectPhotoStatsCard() {
        if (!_photoStats) return;
        const s = _photoStats;

        // Target the doc-status-bar or page-head area in Photos page
        const target = document.getElementById('doc-status-bar');
        if (!target) return;

        // Remove previous injection
        const prev = target.querySelector('.ws4-photo-intel');
        if (prev) prev.remove();

        const coverage = s.inventoryRefsTotal > 0
            ? Math.round((1 - s.refsWithNoPhotos.length / s.inventoryRefsTotal) * 100)
            : 100;
        const coverageColor = coverage >= 80 ? 'var(--green, #00e676)' : coverage >= 50 ? 'var(--yellow, #ffc107)' : 'var(--red, #ff5252)';

        const card = document.createElement('div');
        card.className = 'ws4-photo-intel card';
        card.style.cssText = 'margin-bottom:16px;padding:16px 20px;border:1px solid var(--border, #222);border-radius:12px;background:var(--bg-1, #0d0d12);';

        card.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="font-size:0.82rem;font-weight:700;color:var(--accent, #C9A84C);letter-spacing:0.5px;text-transform:uppercase;">
                    Photo Intelligence
                </div>
                <div style="font-size:0.62rem;color:var(--text-2, #888);font-style:italic;">
                    ws4-posting module
                </div>
            </div>
            <div class="ws4-stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
                <div class="ws4-stat-cell">
                    <div class="ws4-stat-val" style="font-size:1.3rem;font-weight:800;color:var(--text-0, #F2F0ED);font-family:var(--mono,monospace);">${s.totalPhotos}</div>
                    <div class="ws4-stat-label" style="font-size:0.62rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Total Photos</div>
                </div>
                <div class="ws4-stat-cell">
                    <div class="ws4-stat-val" style="font-size:1.3rem;font-weight:800;color:var(--text-0, #F2F0ED);font-family:var(--mono,monospace);">${s.uniqueRefs}</div>
                    <div class="ws4-stat-label" style="font-size:0.62rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Unique Refs</div>
                </div>
                <div class="ws4-stat-cell">
                    <div class="ws4-stat-val" style="font-size:1.3rem;font-weight:800;color:var(--text-0, #F2F0ED);font-family:var(--mono,monospace);">${s.avgPhotosPerRef}</div>
                    <div class="ws4-stat-label" style="font-size:0.62rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Avg/Ref</div>
                </div>
                <div class="ws4-stat-cell">
                    <div class="ws4-stat-val" style="font-size:1.3rem;font-weight:800;color:${coverageColor};font-family:var(--mono,monospace);">${coverage}%</div>
                    <div class="ws4-stat-label" style="font-size:0.62rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Coverage</div>
                </div>
                <div class="ws4-stat-cell">
                    <div class="ws4-stat-val" style="font-size:1.3rem;font-weight:800;color:${s.refsWithNoPhotos.length > 0 ? 'var(--red, #ff5252)' : 'var(--green, #00e676)'};font-family:var(--mono,monospace);">${s.refsWithNoPhotos.length}</div>
                    <div class="ws4-stat-label" style="font-size:0.62rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">No Photos</div>
                </div>
                <div class="ws4-stat-cell">
                    <div class="ws4-stat-val" style="font-size:1.3rem;font-weight:800;color:var(--text-0, #F2F0ED);font-family:var(--mono,monospace);">${s.uniqueModels}</div>
                    <div class="ws4-stat-label" style="font-size:0.62rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Models</div>
                </div>
            </div>
            ${s.refsWithNoPhotos.length > 0 ? `
            <div style="margin-top:12px;padding:8px 12px;border-radius:8px;background:rgba(255,82,82,0.08);border:1px solid rgba(255,82,82,0.2);">
                <div style="font-size:0.65rem;font-weight:600;color:var(--red, #ff5252);margin-bottom:4px;">Missing Photo Coverage</div>
                <div style="font-size:0.62rem;color:var(--text-1, #ccc);line-height:1.6;">${s.refsWithNoPhotos.map(r => '<span style="display:inline-block;padding:1px 6px;margin:2px;border-radius:4px;background:rgba(255,82,82,0.12);color:var(--red, #ff5252);font-family:var(--mono,monospace);font-size:0.6rem;">' + r + '</span>').join('')}</div>
            </div>` : ''}
        `;

        target.prepend(card);
    }

    // ── 4. Documentation Coverage Matrix ────────────────────

    function computeCoverageMatrix(photos) {
        if (!photos || !photos.length) return {};

        const matrix = {};

        photos.forEach(p => {
            const ref = normalizeRef(p.ref);
            if (!ref) return;

            if (!matrix[ref]) {
                matrix[ref] = {
                    ref: ref,
                    model: p.model || '',
                    brand: p.brand || '',
                    total: 0,
                    has_dial: false,
                    has_caseback: false,
                    has_bracelet: false,
                    has_card: false,
                    has_box: false,
                    photos: []
                };
            }

            const entry = matrix[ref];
            entry.total++;
            entry.photos.push(p);

            // Infer doc type from filename, description, or metadata
            const fn = (p.filename || '').toLowerCase();
            const desc = (p.description || '').toLowerCase();
            const combined = fn + ' ' + desc;

            if (combined.includes('dial') || combined.includes('front') || combined.includes('face')) {
                entry.has_dial = true;
            }
            if (combined.includes('caseback') || combined.includes('case back') || combined.includes('back')) {
                entry.has_caseback = true;
            }
            if (combined.includes('bracelet') || combined.includes('strap') || combined.includes('band')) {
                entry.has_bracelet = true;
            }
            if (combined.includes('card') || combined.includes('warranty') || combined.includes('certificate')) {
                entry.has_card = true;
            }
            if (combined.includes('box') || combined.includes('packaging') || combined.includes('set')) {
                entry.has_box = true;
            }

            // Heuristic: if a ref has 3+ photos, assume dial coverage
            // since the primary photo is almost always the dial shot
            if (entry.total >= 1) entry.has_dial = true;
            if (entry.total >= 3) entry.has_bracelet = true;
            if (entry.total >= 5) {
                entry.has_caseback = true;
                entry.has_box = true;
            }
            if (entry.total >= 7) entry.has_card = true;
        });

        return matrix;
    }

    function injectCoverageMatrix() {
        if (!_photoCoverage) return;

        const target = document.getElementById('doc-status-bar');
        if (!target) return;

        // Remove previous
        const prev = target.querySelector('.ws4-coverage-matrix');
        if (prev) prev.remove();

        const refs = Object.values(_photoCoverage)
            .sort((a, b) => b.total - a.total);

        if (!refs.length) return;

        const check = '<span style="color:var(--green, #00e676);font-weight:700;">&#10003;</span>';
        const cross = '<span style="color:var(--red, #ff5252);opacity:0.5;">&#10007;</span>';

        const rows = refs.map(r => {
            const score = [r.has_dial, r.has_caseback, r.has_bracelet, r.has_card, r.has_box].filter(Boolean).length;
            const scoreColor = score >= 4 ? 'var(--green, #00e676)' : score >= 2 ? 'var(--yellow, #ffc107)' : 'var(--red, #ff5252)';
            return `<tr style="border-bottom:1px solid var(--border, #1a1a1a);">
                <td style="padding:6px 8px;font-family:var(--mono,monospace);font-size:0.7rem;color:var(--accent, #C9A84C);font-weight:600;">${r.ref}</td>
                <td style="padding:6px 8px;font-size:0.65rem;color:var(--text-1, #ccc);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.model}</td>
                <td style="padding:6px 4px;text-align:center;font-size:0.72rem;">${r.has_dial ? check : cross}</td>
                <td style="padding:6px 4px;text-align:center;font-size:0.72rem;">${r.has_caseback ? check : cross}</td>
                <td style="padding:6px 4px;text-align:center;font-size:0.72rem;">${r.has_bracelet ? check : cross}</td>
                <td style="padding:6px 4px;text-align:center;font-size:0.72rem;">${r.has_card ? check : cross}</td>
                <td style="padding:6px 4px;text-align:center;font-size:0.72rem;">${r.has_box ? check : cross}</td>
                <td style="padding:6px 8px;text-align:center;font-family:var(--mono,monospace);font-size:0.7rem;color:${scoreColor};font-weight:700;">${score}/5</td>
                <td style="padding:6px 8px;text-align:center;font-family:var(--mono,monospace);font-size:0.68rem;color:var(--text-1, #ccc);">${r.total}</td>
            </tr>`;
        }).join('');

        const card = document.createElement('div');
        card.className = 'ws4-coverage-matrix card';
        card.style.cssText = 'margin-bottom:16px;padding:16px 20px;border:1px solid var(--border, #222);border-radius:12px;background:var(--bg-1, #0d0d12);overflow-x:auto;';

        card.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="font-size:0.82rem;font-weight:700;color:var(--accent, #C9A84C);letter-spacing:0.5px;text-transform:uppercase;">
                    Documentation Coverage Matrix
                </div>
                <div style="font-size:0.62rem;color:var(--text-2, #888);">
                    ${refs.length} refs tracked
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.7rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border, #333);">
                        <th style="padding:6px 8px;text-align:left;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Ref</th>
                        <th style="padding:6px 8px;text-align:left;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;letter-spacing:0.5px;">Model</th>
                        <th style="padding:6px 4px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Dial</th>
                        <th style="padding:6px 4px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Back</th>
                        <th style="padding:6px 4px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Bracelet</th>
                        <th style="padding:6px 4px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Card</th>
                        <th style="padding:6px 4px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Box</th>
                        <th style="padding:6px 8px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Score</th>
                        <th style="padding:6px 8px;text-align:center;font-size:0.6rem;color:var(--text-2, #888);text-transform:uppercase;">Photos</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        target.appendChild(card);
    }

    // ── 3. Smart Price Recommendation (via /api/lookup) ─────

    async function fetchMarketPrice(ref) {
        try {
            const r = await fetch('/api/lookup?q=' + encodeURIComponent(ref));
            if (!r.ok) return null;
            const d = await r.json();
            // Extract us_low from response
            if (d.us_low) return { usLow: d.us_low, b25: d.us_b25 || d.b25, count: d.count };
            if (d.low) return { usLow: d.low, b25: d.b25 || d.median, count: d.count };
            // Check if nested in results
            if (d.results && d.results.length) {
                const first = d.results[0];
                return { usLow: first.us_low || first.low, b25: first.us_b25 || first.b25, count: first.count };
            }
            return null;
        } catch (e) {
            console.warn('[' + MOD_ID + '] Market price fetch failed:', e.message);
            return null;
        }
    }

    function createRecommendedBadge(usLow, container) {
        if (!usLow || usLow <= 0) return;
        const recommended = Math.round(usLow - 100);

        const badge = document.createElement('div');
        badge.className = 'ws4-recommended-badge';
        badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 14px;margin-top:8px;border-radius:8px;border:1px solid rgba(0,230,118,0.3);background:rgba(0,230,118,0.06);cursor:pointer;transition:all 0.15s;';
        badge.innerHTML = `
            <span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--green, #00e676);font-weight:600;">Recommended</span>
            <span style="font-family:var(--mono,monospace);font-size:0.85rem;font-weight:800;color:var(--green, #00e676);">${fmtPrice(recommended)}</span>
            <span style="font-size:0.55rem;color:var(--text-2, #888);">(US low - $100)</span>
        `;
        badge.title = 'Click to apply competitive price: US low (' + fmtPrice(usLow) + ') minus $100';
        badge.onmouseenter = function() { badge.style.background = 'rgba(0,230,118,0.12)'; badge.style.borderColor = 'var(--green, #00e676)'; };
        badge.onmouseleave = function() { badge.style.background = 'rgba(0,230,118,0.06)'; badge.style.borderColor = 'rgba(0,230,118,0.3)'; };
        badge.onclick = function() {
            const priceInput = container.querySelector('input[type="number"], input[id*="price"]') ||
                               document.getElementById('pdm-price-input') ||
                               document.getElementById('epm-new-price');
            if (priceInput) {
                priceInput.value = recommended;
                priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                if (typeof showToast === 'function') showToast('Recommended price applied: ' + fmtPrice(recommended));
            }
        };

        container.appendChild(badge);
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
                gap: 5px;
                padding: 6px 14px;
                font-size: 0.72rem;
                font-weight: 700;
                border-radius: 6px;
                border: 1px solid var(--accent, #C9A84C);
                background: var(--accent, #C9A84C);
                color: var(--bg-0, #0d0d12);
                cursor: pointer;
                white-space: nowrap;
                transition: opacity 0.15s, transform 0.1s;
                letter-spacing: 0.3px;
            }
            .ws4-gen-btn:hover { opacity: 0.9; }
            .ws4-gen-btn:active { opacity: 0.7; transform: scale(0.97); }

            .ws4-caption-preview {
                margin-top: 6px;
                padding: 8px 10px;
                background: var(--bg-3, #1a1a1a);
                border: 1px solid var(--border, #333);
                border-radius: 6px;
                font-size: 0.7rem;
                font-family: var(--mono, monospace);
                color: var(--text-1, #ccc);
                white-space: pre-wrap;
                word-break: break-word;
                line-height: 1.5;
                max-height: 120px;
                overflow-y: auto;
            }

            .ws4-price-badge.ws4-badge-selected {
                outline: 2px solid var(--accent, #C9A84C);
                outline-offset: 1px;
                background: rgba(201,168,76,0.12);
            }

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
                border-color: rgba(201,168,76,0.3);
            }
            .ws4-badge-market .ws4-price-badge-label { color: var(--accent, #C9A84C); }
            .ws4-badge-market .ws4-price-badge-val { color: var(--accent, #C9A84C); }
            .ws4-badge-market:hover { background: rgba(201,168,76,0.08); border-color: var(--accent, #C9A84C); }

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

            .ws4-photo-intel .ws4-stat-cell {
                padding: 8px;
                border-radius: 8px;
                background: var(--bg-2, rgba(255,255,255,0.03));
                text-align: center;
            }

            .ws4-coverage-matrix table tr:hover {
                background: rgba(201,168,76,0.04);
            }
        `;
        document.head.appendChild(style);
    }

    // ── Caption Generator (Ready to Post + Post Direct Modal) ──

    function enhanceReadyToPostTable() {
        const tbody = document.getElementById('postings-ready-tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) return;
            const actionsCell = cells[cells.length - 1];
            if (actionsCell.querySelector('.ws4-gen-btn')) return;

            const postBtn = actionsCell.querySelector('button');
            if (!postBtn) return;

            const genBtn = document.createElement('button');
            genBtn.className = 'ws4-gen-btn';
            genBtn.textContent = 'Generate Caption';
            genBtn.style.marginLeft = '4px';
            genBtn.onclick = function(e) {
                e.stopPropagation();
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

    function generateAndCopyCaption(item, btnEl) {
        let price = item.sale_price || '';
        if (!price) {
            const tiers = getPriceTiers(item.ref);
            if (tiers) price = tiers.market;
        }

        const caption = buildCaption(item, price);

        // Show preview before copying
        var existingPreview = btnEl ? btnEl.parentElement.querySelector('.ws4-caption-preview') : null;
        if (!existingPreview && btnEl && btnEl.parentElement) {
            existingPreview = document.createElement('div');
            existingPreview.className = 'ws4-caption-preview';
            btnEl.parentElement.appendChild(existingPreview);
        }
        if (existingPreview) {
            existingPreview.textContent = caption;
        }

        navigator.clipboard.writeText(caption).then(() => {
            if (typeof showToast === 'function') showToast('Caption copied to clipboard');
            if (btnEl) {
                const origText = btnEl.textContent;
                btnEl.textContent = 'Copied!';
                btnEl.style.background = 'var(--green)';
                btnEl.style.borderColor = 'var(--green)';
                setTimeout(() => {
                    btnEl.textContent = origText;
                    btnEl.style.background = '';
                    btnEl.style.borderColor = '';
                }, 1500);
            }
        }).catch(() => {
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

    function hookPostDirectModal() {
        const origOpen = window.openPostDirectModal;
        if (!origOpen) {
            console.warn('[' + MOD_ID + '] openPostDirectModal not found, deferring hook');
            return false;
        }

        window.openPostDirectModal = function(item) {
            origOpen.call(this, item);
            injectCaptionButton(item);
            injectPriceBadges(item);
            injectSmartRecommendation(item, 'pdm-price-input');
        };
        return true;
    }

    function injectCaptionButton(item) {
        const captionTextarea = document.getElementById('pdm-caption');
        if (!captionTextarea) return;

        const parentDiv = captionTextarea.parentElement;
        if (!parentDiv) return;

        const prev = parentDiv.querySelector('.ws4-gen-btn');
        if (prev) prev.remove();
        const prevMsg = parentDiv.querySelector('.ws4-caption-copied');
        if (prevMsg) prevMsg.remove();

        const label = parentDiv.querySelector('label');
        if (!label) return;

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
            let price = document.getElementById('pdm-price-input')?.value || item.sale_price || '';
            if (!price) {
                const tiers = getPriceTiers(item.ref);
                if (tiers) price = tiers.market;
            }

            const caption = buildCaption(item, price);
            captionTextarea.value = caption;
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

    function injectPriceBadges(item) {
        const priceInput = document.getElementById('pdm-price-input');
        if (!priceInput) return;
        const parentDiv = priceInput.parentElement;
        if (!parentDiv) return;

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
                    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
                    updateCaptionPrice(t.value);
                    if (typeof showToast === 'function') showToast(t.label + ' price: ' + fmtPrice(t.value));
                    badgesDiv.querySelectorAll('.ws4-price-badge').forEach(b => b.classList.remove('ws4-badge-selected'));
                    badge.classList.add('ws4-badge-selected');
                };
                badgesDiv.appendChild(badge);
            });

            // Pre-select the tier matching current price input value
            var currentVal = parseInt(priceInput.value);
            if (currentVal > 0) {
                tierDefs.forEach(function(t) {
                    if (Math.abs(t.value - currentVal) < 50) {
                        var matchBadge = badgesDiv.querySelector('.ws4-badge-' + t.key);
                        if (matchBadge) matchBadge.classList.add('ws4-badge-selected');
                    }
                });
            }

            container.appendChild(badgesDiv);
        }

        priceInput.parentNode.insertBefore(container, priceInput);
    }

    /**
     * Fetch /api/lookup for a ref and inject a recommended price badge.
     */
    async function injectSmartRecommendation(item, priceInputId) {
        const ref = normalizeRef(item.ref);
        if (!ref) return;

        const priceInput = document.getElementById(priceInputId);
        if (!priceInput) return;
        const parentDiv = priceInput.parentElement;
        if (!parentDiv) return;

        // Remove previous recommended badge
        const prevBadge = parentDiv.querySelector('.ws4-recommended-badge');
        if (prevBadge) prevBadge.remove();

        // Try local DATA.refs first
        const localData = getRefData(ref);
        if (localData && (localData.us_low || localData.low)) {
            createRecommendedBadge(localData.us_low || localData.low, parentDiv);
            return;
        }

        // Fall back to /api/lookup
        const market = await fetchMarketPrice(ref);
        if (market && market.usLow) {
            createRecommendedBadge(market.usLow, parentDiv);
        }
    }

    function updateCaptionPrice(price) {
        const caption = document.getElementById('pdm-caption');
        if (!caption) return;
        const val = caption.value || '';
        const fmtP = Number(price).toLocaleString('en-US');
        const priceLineRegex = /\n?\$?[\d,]+\s*\+\s*label\s*$/;
        if (priceLineRegex.test(val)) {
            caption.value = val.replace(priceLineRegex, '\n$' + fmtP + ' + label');
        } else {
            caption.value = val.trim() + '\n$' + fmtP + ' + label';
        }
    }

    // ── Hook into Edit Posting Modal ────────────────────────

    function hookEditModal() {
        const origOpen = window.openPriceEditModal;
        if (!origOpen) {
            console.warn('[' + MOD_ID + '] openPriceEditModal not found, deferring hook');
            return false;
        }

        window.openPriceEditModal = function(messageId, currentPrice, caption, photo, row) {
            origOpen.call(this, messageId, currentPrice, caption, photo, row);

            const cleanCaption = (caption || '').replace(/&apos;/g, "'");
            const refM = cleanCaption.match(/\b(\d{5,6}[A-Z]{0,4})\b/);
            const ref = refM ? refM[1] : '';

            if (ref) {
                injectEditModalPriceBadges(ref);
                // Also inject smart recommendation into Edit modal
                injectEditModalRecommendation(ref);
            }

            // Auto-generate caption if textarea exists in edit modal
            autoGenerateEditCaption(cleanCaption, ref);
        };
        return true;
    }

    function injectEditModalPriceBadges(ref) {
        const priceInput = document.getElementById('epm-new-price');
        if (!priceInput) return;
        const parentDiv = priceInput.parentElement;
        if (!parentDiv) return;

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
                    badgesDiv.querySelectorAll('.ws4-price-badge').forEach(b => b.classList.remove('ws4-badge-selected'));
                    badge.classList.add('ws4-badge-selected');
                };
                badgesDiv.appendChild(badge);
            });

            container.appendChild(badgesDiv);
        }

        priceInput.parentNode.insertBefore(container, priceInput);
    }

    async function injectEditModalRecommendation(ref) {
        const priceInput = document.getElementById('epm-new-price');
        if (!priceInput) return;
        const parentDiv = priceInput.parentElement;
        if (!parentDiv) return;

        const prevBadge = parentDiv.querySelector('.ws4-recommended-badge');
        if (prevBadge) prevBadge.remove();

        const localData = getRefData(ref);
        if (localData && (localData.us_low || localData.low)) {
            createRecommendedBadge(localData.us_low || localData.low, parentDiv);
            return;
        }

        const market = await fetchMarketPrice(ref);
        if (market && market.usLow) {
            createRecommendedBadge(market.usLow, parentDiv);
        }
    }

    /**
     * Auto-generate caption from watch data when Edit Posting modal opens.
     * Builds: "BNIB Full Set {ref} {bracelet} {dial} {card_date} with WT ${price} + label"
     */
    function autoGenerateEditCaption(existingCaption, ref) {
        // Look for a caption textarea in the edit modal
        const captionEl = document.getElementById('epm-caption') || document.getElementById('epm-new-caption');
        if (!captionEl) return;

        // Try to build from photo data if available
        let photoItem = null;
        if (_photoData && ref) {
            photoItem = _photoData.find(p => normalizeRef(p.ref) === ref);
        }

        if (photoItem) {
            // Get price from the edit modal price input
            const priceInput = document.getElementById('epm-new-price');
            const price = priceInput ? priceInput.value : '';
            const caption = buildCaption(photoItem, price);
            // Only auto-fill if the caption field is empty or user hasn't customized
            if (!captionEl.value || captionEl.value === existingCaption) {
                captionEl.value = caption;
            }
        }
    }

    // ── Init & Render ───────────────────────────────────────

    let _hooksInstalled = false;

    function installHooks() {
        if (_hooksInstalled) return;
        const postOk = hookPostDirectModal();
        const editOk = hookEditModal();
        if (postOk || editOk) _hooksInstalled = true;
    }

    async function init() {
        console.log('[' + MOD_ID + '] Initializing Photo Intelligence Layer...');
        injectStyles();

        // Install modal hooks
        installHooks();
        if (!_hooksInstalled) {
            setTimeout(installHooks, 500);
        }

        // Fetch photo data for coverage stats
        _photoData = await fetchPhotoData();
        if (_photoData) {
            _photoStats = computePhotoStats(_photoData);
            _photoCoverage = computeCoverageMatrix(_photoData);
            console.log('[' + MOD_ID + '] Photo intelligence loaded: ' + _photoData.length + ' photos, ' +
                (_photoStats ? _photoStats.uniqueRefs : 0) + ' refs');
        }

        // Listen for data refresh
        window.MKModules.on('data-loaded', render);

        // Hook into postings tab switch
        const origSwitch = window.switchPostingsTab;
        if (origSwitch) {
            window.switchPostingsTab = function(tab, el) {
                origSwitch.call(this, tab, el);
                if (tab === 'ready') {
                    setTimeout(enhanceReadyToPostTable, 500);
                }
            };
        }

        // Hook loadReadyToPost
        const origLoad = window.loadReadyToPost;
        if (origLoad) {
            window.loadReadyToPost = async function() {
                await origLoad.call(this);
                setTimeout(enhanceReadyToPostTable, 100);
            };
        }

        // Hook Photos page navigation to inject stats
        const origShowPage = window.showPage;
        if (origShowPage) {
            window.showPage = function(name) {
                origShowPage.call(this, name);
                if (name === 'photos') {
                    setTimeout(renderPhotoIntelligence, 300);
                }
            };
        }
    }

    function renderPhotoIntelligence() {
        if (_photoStats) injectPhotoStatsCard();
        if (_photoCoverage) injectCoverageMatrix();
    }

    function render() {
        if (!_hooksInstalled) installHooks();

        // Re-compute stats with updated DATA (for inventory cross-ref)
        if (_photoData) {
            _photoStats = computePhotoStats(_photoData);
        }

        // If Photos page is active, refresh the cards
        const photosPage = document.getElementById('page-photos');
        if (photosPage && photosPage.classList.contains('active')) {
            renderPhotoIntelligence();
        }

        // Enhance Ready to Post table if visible
        if (document.getElementById('postings-panel-ready')?.style.display !== 'none') {
            setTimeout(enhanceReadyToPostTable, 200);
        }
    }

    function cleanup() {
        const style = document.getElementById('ws4-styles');
        if (style) style.remove();

        // Clean up injected cards
        document.querySelectorAll('.ws4-photo-intel, .ws4-coverage-matrix, .ws4-recommended-badge').forEach(el => el.remove());

        _photoData = null;
        _photoStats = null;
        _photoCoverage = null;
    }

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
