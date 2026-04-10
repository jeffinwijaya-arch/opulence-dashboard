/**
 * MK Opulence — ws4-posting
 * Posting & Sales workstream module — Photo Intelligence layer.
 *
 * Features (Photo & Documentation Pipeline):
 *   1. Filename-based photo classification (dial, caseback, movement,
 *      bracelet, papers, card, box, serial, wrist, ...).
 *   2. Auto-match photo-library watches to live inventory SKUs via
 *      ref + bracelet + dial + card_date scoring.
 *   3. Serial-number extraction/validation helpers (Rolex/AP/Patek
 *      formats) usable as a seed for future browser-side OCR.
 *   4. Documentation coverage matrix — what % of watches have the
 *      full required doc set, surfaced as a card on the Photos page.
 *
 * Integration strategy: the Photos page HTML is owned by index.html
 * and cannot be edited here, so this module wraps the globals
 * loadPhotoLibrary / filterPhotoLibrary / renderPhotoLibrary to
 * post-process data and inject cards after each render.
 *
 * Public API (for other modules / console debugging):
 *   window.MKPhoto.classifyFilename(name)    → category key
 *   window.MKPhoto.classifyPhotos(photos)    → { dial: [...], ... }
 *   window.MKPhoto.extractSerial(text, brand)→ serial string | null
 *   window.MKPhoto.validateSerial(brand, s)  → boolean
 *   window.MKPhoto.matchWatchToInventory(w)  → { item, score, conf }
 *   window.MKPhoto.docCoverage(watch)        → { present, missing, pct }
 */

(function () {
    'use strict';

    const MOD_ID = 'ws4-posting';

    // =========================================================
    // CONSTANTS
    // =========================================================

    // Filename category keyword sets — ordered, first match wins.
    // Matching is token-based: the filename stem is split on any
    // non-alphanumeric separator ([_\-.\s]+) and each lowercase token
    // is compared against these sets. This sidesteps the `\b` word
    // boundary trap where "_dial" doesn't start on a word boundary
    // because underscore counts as a word character.
    const CATEGORY_KEYWORDS = [
        { key: 'serial',   any: ['serial', 'sn'] },
        { key: 'card',     any: ['card', 'warranty', 'warrant', 'guarantee', 'papers', 'paper', 'cert'] },
        { key: 'box',      any: ['box', 'packaging', 'outer'] },
        { key: 'caseback', any: ['caseback', 'back', 'rear', 'engraving', 'engraved', 'engrav'] },
        { key: 'movement', any: ['movement', 'caliber', 'mvt', 'cal'] },
        { key: 'bracelet', any: ['bracelet', 'clasp', 'band', 'strap', 'buckle'] },
        { key: 'crown',    any: ['crown', 'winding', 'pusher'] },
        { key: 'lugs',     any: ['lug', 'lugs', 'horn'] },
        { key: 'wrist',    any: ['wrist', 'onwrist', 'onhand', 'worn'] },
        // `dial` must win over `macro` — a DIAL macro shot is primarily
        // a dial photo; "macro" is just the photography style.
        { key: 'dial',     any: ['dial', 'face', 'front', 'index'] },
        { key: 'macro',    any: ['macro', 'zoom', 'detail'] },
        { key: 'overall',  any: ['full', 'overall', 'hero', 'main', 'cover'] }
    ];

    // What does a "fully documented" watch look like? These are the
    // categories a buyer typically wants before committing to a deal.
    const REQUIRED_DOCS = ['dial', 'caseback', 'bracelet', 'card', 'box'];

    // Brand-specific serial number formats.
    const SERIAL_FORMATS = {
        rolex: /\b[A-HJ-NPR-Z0-9]{8}\b/,   // Random 8-char (post-2010)
        ap:    /\b[A-Z]?\d{5,6}\b/,         // e.g. "G12345" / "123456"
        patek: /\b\d{7}\b/,                 // 7-digit
        rm:    /\b[A-Z]{2}\d{2,3}[A-Z]?\d{2,4}\b/
    };

    // Brand lookup for serial validation — maps ref prefix → brand key.
    function inferBrandFromRef(ref) {
        if (!ref) return null;
        const r = String(ref).toUpperCase();
        // Rolex refs are 5-6 digit numeric prefixes (+optional letters)
        if (/^\d{5,6}[A-Z]*$/.test(r)) return 'rolex';
        if (r.startsWith('RM') || r.startsWith('RM-')) return 'rm';
        if (/^\d{4,5}[A-Z]{0,3}\/\d/.test(r)) return 'patek';
        // AP Royal Oak refs look like 15500ST.OO.1220ST.03
        if (/[A-Z]{2}\.[A-Z0-9]{2}\./.test(r)) return 'ap';
        return null;
    }

    // =========================================================
    // STYLES
    // =========================================================

    function injectStyles() {
        if (document.getElementById('ws4-photo-styles')) return;
        const style = document.createElement('style');
        style.id = 'ws4-photo-styles';
        style.textContent = `
            .ws4-cover-card { margin-bottom: 16px; }
            .ws4-cover-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                gap: 8px;
                margin-top: 10px;
            }
            .ws4-cover-cat {
                background: var(--bg-2);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                padding: 8px 10px;
                font-size: 0.68rem;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .ws4-cover-cat .cat-name {
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--text-2);
                font-size: 0.6rem;
            }
            .ws4-cover-cat .cat-val {
                font-size: 1.05rem;
                font-weight: 700;
                color: var(--text-0);
            }
            .ws4-cover-cat .cat-bar {
                height: 3px;
                border-radius: 2px;
                background: var(--bg-1);
                overflow: hidden;
                margin-top: 4px;
            }
            .ws4-cover-cat .cat-bar > i {
                display: block;
                height: 100%;
                background: var(--green);
                border-radius: 2px;
            }
            .ws4-cover-summary {
                display: flex;
                gap: 16px;
                flex-wrap: wrap;
                font-size: 0.72rem;
                color: var(--text-2);
                align-items: baseline;
            }
            .ws4-cover-summary b {
                color: var(--text-0);
                font-size: 1.1rem;
                font-weight: 700;
                margin-right: 3px;
            }
            .ws4-match-badge {
                position: absolute;
                top: 4px;
                left: 4px;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.58rem;
                font-weight: 700;
                letter-spacing: 0.3px;
                z-index: 2;
                pointer-events: none;
            }
            .ws4-match-badge.match-high {
                background: rgba(0, 200, 83, 0.85);
                color: #041d0c;
            }
            .ws4-match-badge.match-med {
                background: rgba(212, 175, 55, 0.85);
                color: #1a1403;
            }
            .ws4-match-badge.match-none {
                background: rgba(255, 255, 255, 0.1);
                color: var(--text-2);
                border: 1px dashed var(--border);
            }
            .ws4-docs-chip {
                display: inline-block;
                padding: 1px 5px;
                border-radius: 2px;
                font-size: 0.55rem;
                font-weight: 600;
                margin: 1px 2px 0 0;
                background: var(--bg-1);
                color: var(--text-2);
                text-transform: uppercase;
                letter-spacing: 0.3px;
            }
            .ws4-docs-chip.have { background: rgba(0,200,83,0.18); color: var(--green); }
            .ws4-docs-chip.miss { background: rgba(255,23,68,0.15); color: var(--red); }
        `;
        document.head.appendChild(style);
    }

    // =========================================================
    // PHOTO CLASSIFICATION
    // =========================================================

    /**
     * Classify a single filename/path into one of the known categories.
     * Returns 'overall' as a fallback rather than null so that every
     * photo has a bucket in the coverage calculation.
     */
    function classifyFilename(name) {
        if (!name) return 'overall';
        const base = String(name).split(/[\\/]/).pop();
        // Strip the extension, then split on any non-alphanumeric run.
        const stem = base.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
        const tokens = stem.split(/[^a-z0-9]+/).filter(Boolean);
        if (!tokens.length) return 'overall';
        for (const cat of CATEGORY_KEYWORDS) {
            for (const tok of tokens) {
                if (cat.any.indexOf(tok) !== -1) return cat.key;
            }
        }
        return 'overall';
    }

    /**
     * Bucket an array of photo descriptors (strings or objects with a
     * `filename`/`name`/`url` field) by category.
     */
    function classifyPhotos(photos) {
        const buckets = {};
        if (!Array.isArray(photos)) return buckets;
        for (const p of photos) {
            const name = typeof p === 'string'
                ? p
                : (p.filename || p.name || p.url || '');
            const key = classifyFilename(name);
            (buckets[key] = buckets[key] || []).push(p);
        }
        return buckets;
    }

    // =========================================================
    // SERIAL NUMBER EXTRACTION
    // =========================================================

    /**
     * Extract a plausible serial number from arbitrary text (filename,
     * caption, description). Brand narrows the regex; unknown brand
     * falls back to the Rolex-modern format which is the most common.
     */
    function extractSerial(text, brand) {
        if (!text) return null;
        const rx = SERIAL_FORMATS[brand] || SERIAL_FORMATS.rolex;
        const m = String(text).match(rx);
        return m ? m[0] : null;
    }

    function validateSerial(brand, serial) {
        if (!brand || !serial) return false;
        const rx = SERIAL_FORMATS[brand];
        if (!rx) return false;
        // Anchor the regex for strict validation
        const strict = new RegExp('^' + rx.source.replace(/\\b/g, '') + '$');
        return strict.test(String(serial).trim().toUpperCase());
    }

    // =========================================================
    // SKU AUTO-MATCHING
    // =========================================================

    // Cached inventory (loaded on demand; invalidated on data refresh).
    let _invCache = null;
    let _invPromise = null;

    function getInventory() {
        // Prefer the in-memory inventory the inventory page populates.
        if (Array.isArray(window.inventoryItems) && window.inventoryItems.length) {
            return Promise.resolve(window.inventoryItems);
        }
        if (_invCache) return Promise.resolve(_invCache);
        if (_invPromise) return _invPromise;
        _invPromise = fetch('/api/inventory')
            .then(r => r.ok ? r.json() : [])
            .then(items => { _invCache = Array.isArray(items) ? items : []; return _invCache; })
            .catch(() => { _invCache = []; return _invCache; });
        return _invPromise;
    }

    function norm(s) {
        return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Score how well an inventory item matches a photo-library watch.
     * Score components (max 100):
     *   ref exact         → 40
     *   bracelet match    → 20
     *   dial match        → 20
     *   card_date match   → 15
     *   condition match   →  5
     */
    function scoreMatch(photoWatch, invItem) {
        if (!photoWatch || !invItem) return 0;
        let score = 0;
        const pRef = norm(photoWatch.model || photoWatch.ref);
        const iRef = norm(invItem.ref);
        if (pRef && iRef && pRef === iRef) score += 40;
        else if (pRef && iRef && (pRef.includes(iRef) || iRef.includes(pRef))) score += 25;
        else return 0; // no ref overlap → definitely not the same watch

        if (photoWatch.bracelet && invItem.bracelet &&
            norm(photoWatch.bracelet) === norm(invItem.bracelet)) score += 20;
        if (photoWatch.dial && invItem.dial &&
            norm(photoWatch.dial) === norm(invItem.dial)) score += 20;
        if (photoWatch.card_date && invItem.card_date &&
            norm(photoWatch.card_date) === norm(invItem.card_date)) score += 15;
        if (photoWatch.condition && invItem.condition &&
            norm(photoWatch.condition) === norm(invItem.condition)) score += 5;
        return score;
    }

    /**
     * Find the best inventory match for a given photo-library watch.
     * Returns { item, score, conf } or null if nothing scores above 40.
     */
    function matchWatchToInventory(photoWatch, inventory) {
        if (!photoWatch || !Array.isArray(inventory) || !inventory.length) return null;
        let best = null;
        for (const it of inventory) {
            const s = scoreMatch(photoWatch, it);
            if (!best || s > best.score) best = { item: it, score: s };
        }
        if (!best || best.score < 40) return null;
        best.conf = best.score >= 75 ? 'high' : best.score >= 55 ? 'med' : 'low';
        return best;
    }

    // =========================================================
    // DOCUMENTATION COVERAGE
    // =========================================================

    /**
     * For one watch object (from photoLibraryData), compute which of
     * the required doc categories are present in its photos array.
     * Works with either pre-loaded photo arrays or just filenames.
     */
    function docCoverage(watch) {
        const photos = (watch && (watch.photos || watch.files)) || [];
        const buckets = classifyPhotos(photos);
        const present = REQUIRED_DOCS.filter(k => (buckets[k] || []).length > 0);
        const missing = REQUIRED_DOCS.filter(k => !(buckets[k] || []).length);
        return {
            present,
            missing,
            pct: Math.round((present.length / REQUIRED_DOCS.length) * 100),
            buckets
        };
    }

    /**
     * Aggregate coverage across the entire photo library.
     */
    function aggregateCoverage(watches) {
        const catCounts = Object.fromEntries(REQUIRED_DOCS.map(k => [k, 0]));
        let fullyDocumented = 0;
        let partiallyDocumented = 0;
        let undocumented = 0;

        const totalWatches = (watches || []).filter(w => (w.photo_count || 0) > 0).length;
        if (!totalWatches) {
            return { totalWatches: 0, catCounts, fullyDocumented: 0, partiallyDocumented: 0, undocumented: 0 };
        }

        for (const w of watches) {
            if (!w || !(w.photo_count > 0)) continue;
            const cov = docCoverage(w);
            cov.present.forEach(k => { catCounts[k]++; });
            if (cov.pct === 100) fullyDocumented++;
            else if (cov.pct > 0) partiallyDocumented++;
            else undocumented++;
        }
        return { totalWatches, catCounts, fullyDocumented, partiallyDocumented, undocumented };
    }

    // =========================================================
    // UI INJECTION
    // =========================================================

    function buildCoverageCard(watches) {
        const agg = aggregateCoverage(watches);
        if (!agg.totalWatches) return '';

        const cats = REQUIRED_DOCS.map(k => {
            const have = agg.catCounts[k] || 0;
            const pct = Math.round((have / agg.totalWatches) * 100);
            return `<div class="ws4-cover-cat">
                <span class="cat-name">${k}</span>
                <span class="cat-val">${have}<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;"> / ${agg.totalWatches}</span></span>
                <div class="cat-bar"><i style="width:${pct}%;"></i></div>
            </div>`;
        }).join('');

        const fullPct = Math.round((agg.fullyDocumented / agg.totalWatches) * 100);

        return `<div class="card ws4-cover-card">
            <div class="card-head">
                <span>Documentation Coverage</span>
                <span style="font-size:0.63rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;">
                    which watches have dial + caseback + bracelet + card + box
                </span>
            </div>
            <div style="padding:12px 14px;">
                <div class="ws4-cover-summary">
                    <span><b>${fullPct}%</b> fully documented (${agg.fullyDocumented}/${agg.totalWatches})</span>
                    <span style="color:var(--accent);">${agg.partiallyDocumented} partial</span>
                    <span style="color:var(--red);">${agg.undocumented} missing all required</span>
                </div>
                <div class="ws4-cover-grid">${cats}</div>
            </div>
        </div>`;
    }

    /**
     * Inject the coverage card at the top of the Photos page, above
     * the doc-status-bar / photos-panel-library. Idempotent.
     */
    function injectCoverageCard(watches) {
        const host = document.getElementById('photos-panel-library');
        if (!host) return;
        let card = document.getElementById('ws4-cover-wrap');
        const html = buildCoverageCard(watches);
        if (!html) {
            if (card) card.remove();
            return;
        }
        if (!card) {
            card = document.createElement('div');
            card.id = 'ws4-cover-wrap';
            host.insertBefore(card, host.firstChild);
        }
        card.innerHTML = html;
    }

    /**
     * After the photo library grid renders, walk each card and add a
     * match badge + a chip row showing which required docs are on
     * hand. We target the grid children that have the watch model
     * text so we don't clobber the native markup.
     */
    function decorateLibraryGrid(watches, inventory) {
        const grid = document.getElementById('photo-library-grid');
        if (!grid) return;
        const children = Array.from(grid.children);
        if (!children.length) return;

        // Each card the native renderer emits has
        //   onclick="openPhotoModal('<watch_id>')"
        // so the watch_id is parseable straight off the element.
        const byId = {};
        for (const w of (watches || [])) {
            if (w && w.watch_id) byId[w.watch_id] = w;
        }
        const WATCH_ID_RX = /openPhotoModal\(\s*['"]([^'"]+)['"]/;

        children.forEach(el => {
            if (el.dataset.ws4Decorated === '1') return;
            const onclick = el.getAttribute('onclick') || '';
            const m = onclick.match(WATCH_ID_RX);
            const matchedWatch = m ? byId[m[1]] : null;
            if (!matchedWatch) return;

            // --- match badge ---
            const inv = matchWatchToInventory(matchedWatch, inventory);
            const badge = document.createElement('div');
            if (inv) {
                const cls = inv.conf === 'high' ? 'match-high'
                           : inv.conf === 'med'  ? 'match-high'
                           : 'match-med';
                badge.className = 'ws4-match-badge ' + cls;
                badge.textContent = 'SKU ' + (inv.item.row || inv.item.id || '');
                badge.title = 'Matched inventory item '
                    + inv.item.ref + ' (score ' + inv.score + ')';
            } else {
                badge.className = 'ws4-match-badge match-none';
                badge.textContent = 'UNMATCHED';
                badge.title = 'No inventory SKU matches this photo set';
            }
            if (getComputedStyle(el).position === 'static') {
                el.style.position = 'relative';
            }
            el.appendChild(badge);

            // --- doc chips ---
            const cov = docCoverage(matchedWatch);
            const chips = REQUIRED_DOCS.map(k =>
                `<span class="ws4-docs-chip ${cov.present.includes(k) ? 'have' : 'miss'}">${k}</span>`
            ).join('');
            const chipRow = document.createElement('div');
            chipRow.style.cssText = 'padding:4px 6px 6px;';
            chipRow.innerHTML = chips;
            el.appendChild(chipRow);

            el.dataset.ws4Decorated = '1';
        });
    }

    // =========================================================
    // GLOBAL WRAPPERS
    // =========================================================

    /**
     * Scan watch metadata for a serial number when the `serial` field
     * is empty. We only rewrite the field when the extracted value
     * actually passes the brand-specific format check so we never
     * introduce false positives into the documentation record.
     */
    function autoFillSerials(watches) {
        let filled = 0;
        for (const w of (watches || [])) {
            if (!w || w.serial) continue;
            const brand = inferBrandFromRef(w.model || w.ref);
            if (!brand) continue;
            // Search the watch blob + any filename strings on its photos.
            const candidates = [
                w.notes, w.description, w.caption, w.card_date, w.engraving
            ];
            if (Array.isArray(w.photos)) {
                for (const p of w.photos) {
                    candidates.push(typeof p === 'string' ? p : (p && (p.filename || p.name || p.url)));
                }
            }
            for (const text of candidates) {
                const s = extractSerial(text, brand);
                if (s && validateSerial(brand, s)) {
                    w.serial = s;
                    w._ws4_serial_auto = true;
                    filled++;
                    break;
                }
            }
        }
        if (filled) console.log('[' + MOD_ID + '] auto-filled ' + filled + ' serial numbers');
        return filled;
    }

    function installHooks() {
        // Wrap loadPhotoLibrary to inject coverage card after data lands.
        if (typeof window.loadPhotoLibrary === 'function' && !window.loadPhotoLibrary.__ws4wrap) {
            const _origLoad = window.loadPhotoLibrary;
            window.loadPhotoLibrary = async function () {
                await _origLoad.apply(this, arguments);
                try {
                    const watches = window.photoLibraryData || [];
                    autoFillSerials(watches);
                    injectCoverageCard(watches);
                    const inv = await getInventory();
                    decorateLibraryGrid(watches, inv);
                } catch (e) {
                    console.warn('[' + MOD_ID + '] loadPhotoLibrary hook:', e);
                }
            };
            window.loadPhotoLibrary.__ws4wrap = true;
        }

        // Wrap renderPhotoLibrary to re-decorate after every filter pass.
        if (typeof window.renderPhotoLibrary === 'function' && !window.renderPhotoLibrary.__ws4wrap) {
            const _origRender = window.renderPhotoLibrary;
            window.renderPhotoLibrary = function (filtered) {
                _origRender.apply(this, arguments);
                requestAnimationFrame(() => {
                    try {
                        getInventory().then(inv => decorateLibraryGrid(filtered, inv));
                    } catch (e) { /* silent */ }
                });
            };
            window.renderPhotoLibrary.__ws4wrap = true;
        }

        // Wrap showPhotoStats to enrich the alert text with coverage.
        if (typeof window.showPhotoStats === 'function' && !window.showPhotoStats.__ws4wrap) {
            const _origStats = window.showPhotoStats;
            window.showPhotoStats = function () {
                const watches = window.photoLibraryData || [];
                const agg = aggregateCoverage(watches);
                if (agg.totalWatches) {
                    const pct = Math.round((agg.fullyDocumented / agg.totalWatches) * 100);
                    const lines = [
                        'Photo Library Stats',
                        '',
                        'Watches with photos : ' + agg.totalWatches,
                        'Fully documented    : ' + agg.fullyDocumented + '  (' + pct + '%)',
                        'Partial coverage    : ' + agg.partiallyDocumented,
                        'Missing all required: ' + agg.undocumented,
                        '',
                        'By category (have / total):',
                        ...REQUIRED_DOCS.map(k =>
                            '  ' + k.padEnd(9) + ': ' + agg.catCounts[k] + ' / ' + agg.totalWatches)
                    ];
                    alert(lines.join('\n'));
                    return;
                }
                _origStats.apply(this, arguments);
            };
            window.showPhotoStats.__ws4wrap = true;
        }
    }

    // =========================================================
    // PUBLIC API
    // =========================================================

    window.MKPhoto = {
        classifyFilename,
        classifyPhotos,
        extractSerial,
        validateSerial,
        inferBrandFromRef,
        matchWatchToInventory,
        scoreMatch,
        docCoverage,
        aggregateCoverage,
        autoFillSerials,
        REQUIRED_DOCS
    };

    // =========================================================
    // MODULE LIFECYCLE
    // =========================================================

    function init() {
        console.log('[' + MOD_ID + '] init (photo intelligence)');
        injectStyles();
        installHooks();

        // If the photos page is already loaded when we init, run a pass
        // immediately so the coverage card shows up without needing the
        // user to navigate away and back.
        if (Array.isArray(window.photoLibraryData) && window.photoLibraryData.length) {
            try {
                injectCoverageCard(window.photoLibraryData);
                getInventory().then(inv => decorateLibraryGrid(window.photoLibraryData, inv));
            } catch (e) { /* silent */ }
        }
    }

    function render() {
        // Called on data refresh — refresh coverage card if visible.
        if (Array.isArray(window.photoLibraryData) && window.photoLibraryData.length) {
            try { injectCoverageCard(window.photoLibraryData); } catch (e) {}
        }
    }

    function cleanup() {
        const el = document.getElementById('ws4-cover-wrap');
        if (el) el.remove();
        const styles = document.getElementById('ws4-photo-styles');
        if (styles) styles.remove();
    }

    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
