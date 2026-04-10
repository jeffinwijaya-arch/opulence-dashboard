/**
 * MK Opulence Module Loader
 * Loads all workstream modules and coordinates initialization.
 * Each module registers itself via window.MKModules.register()
 *
 * Features:
 *   - Error boundaries: one module crash never breaks others
 *   - Auto-retry: failed modules retry once after 5s
 *   - Performance tracking: init/render times per module
 *   - Priority loading: critical modules init first, others defer 1s
 *   - Status API: MKModules.status() and MKModules.perfReport()
 */

window.MKModules = {
    _modules: {},
    _loaded: new Set(),
    _failed: new Map(),     // id -> Error
    _pending: new Set(),    // modules registered but not yet initialized
    _retried: new Set(),    // modules that already had their retry attempt
    _perf: {},              // {ws1: {init_ms: 45, render_ms: 12}, ...}

    // Priority buckets — critical modules init immediately, deferred ones wait 1s
    _critical: new Set([
        'ws1-price-intel',
        'ws3-deal-flow',
        'ws7-analytics'
    ]),

    _initOrder: [
        'ws1-price-intel',
        'ws2-inventory-pnl',
        'ws3-deal-flow',
        'ws4-posting',
        'ws5-shipping',
        'ws6-crm',
        'ws7-analytics',
        'ws8-mobile-ux',
        'ws9-reporting',
        'ws10-automation'
    ],

    /**
     * Register a module. Called by each module file.
     * Accepts optional priority field: register('ws1-price-intel', {priority: 'critical', init, render})
     * @param {string} id - Module ID (e.g., 'ws1-price-intel')
     * @param {object} mod - Module object with init(), render(), cleanup() methods
     */
    register(id, mod) {
        // Honor explicit priority override
        if (mod.priority === 'critical') {
            this._critical.add(id);
        } else if (mod.priority === 'deferred') {
            this._critical.delete(id);
        }
        this._modules[id] = mod;
        this._loaded.add(id);
        this._pending.add(id);
        console.log(`[MK] Module registered: ${id}`);
    },

    /**
     * Initialize a single module with error boundary and perf tracking.
     * @param {string} id
     * @returns {boolean} true if init succeeded
     */
    async _initOne(id) {
        const mod = this._modules[id];
        if (!mod || typeof mod.init !== 'function') return true;

        if (!this._perf[id]) this._perf[id] = {};
        const t0 = performance.now();

        try {
            await mod.init();
            const elapsed = performance.now() - t0;
            this._perf[id].init_ms = Math.round(elapsed * 100) / 100;
            this._pending.delete(id);
            this._failed.delete(id);

            if (elapsed > 500) {
                console.warn(`[MK] SLOW: ${id} init took ${elapsed.toFixed(0)}ms (>500ms threshold)`);
            }
            console.log(`[MK] ${id} initialized (${elapsed.toFixed(1)}ms)`);
            return true;
        } catch (e) {
            const elapsed = performance.now() - t0;
            this._perf[id].init_ms = Math.round(elapsed * 100) / 100;
            this._failed.set(id, e);
            this._pending.delete(id);
            console.error(`[MK] ${id} init failed (${elapsed.toFixed(1)}ms):`, e);
            console.error(e.stack || e);
            return false;
        }
    },

    /**
     * Initialize all registered modules in order.
     * Critical modules first, then deferred modules after 1s delay.
     * Failed modules retry once after 5s.
     */
    async initAll() {
        console.log(`[MK] Initializing ${this._loaded.size} modules...`);

        // Phase 1: critical modules (immediate)
        const critical = this._initOrder.filter(id => this._critical.has(id) && this._modules[id]);
        for (const id of critical) {
            await this._initOne(id);
        }

        // Phase 2: deferred modules (after 1s)
        const deferred = this._initOrder.filter(id => !this._critical.has(id) && this._modules[id]);
        if (deferred.length > 0) {
            setTimeout(async () => {
                for (const id of deferred) {
                    await this._initOne(id);
                }
                this._scheduleRetries();
                this._showFailureIndicators();
                this._injectMissionControlPerf();
                document.dispatchEvent(new CustomEvent('mk:deferred-modules-ready'));
            }, 1000);
        }

        // Schedule retries and UI updates for critical failures
        this._scheduleRetries();
        this._showFailureIndicators();

        document.dispatchEvent(new CustomEvent('mk:modules-ready'));
    },

    /**
     * Schedule retry for any failed modules (once, after 5s).
     */
    _scheduleRetries() {
        const failedIds = [...this._failed.keys()].filter(id => !this._retried.has(id));
        if (failedIds.length === 0) return;

        setTimeout(async () => {
            for (const id of failedIds) {
                this._retried.add(id);
                console.log(`[MK] Retrying ${id}...`);
                const ok = await this._initOne(id);
                if (ok) {
                    console.log(`[MK] ${id} retry succeeded`);
                } else {
                    console.error(`[MK] ${id} retry failed — module disabled`);
                }
            }
            this._showFailureIndicators();
            this._injectMissionControlPerf();
        }, 5000);
    },

    /**
     * Show subtle footer indicator for failed modules (admin/dev only).
     */
    _showFailureIndicators() {
        // Remove existing indicator
        const existing = document.getElementById('mk-module-errors');
        if (existing) existing.remove();

        if (this._failed.size === 0) return;

        // Only show if admin (pin cookie present = admin)
        if (!document.cookie.includes('pin=')) return;

        const names = [...this._failed.keys()].map(id => {
            const short = id.replace(/-.*/, '');
            return short;
        }).join(', ');

        const el = document.createElement('div');
        el.id = 'mk-module-errors';
        el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(231,76,60,0.85);' +
            'color:#fff;font-size:9px;padding:3px 8px;z-index:9999;' +
            'font-family:monospace;pointer-events:auto;cursor:pointer;border-radius:4px;' +
            'opacity:0.6;transition:opacity 0.2s;';
        el.textContent = names + ' err';
        el.title = 'Module(s) ' + names + ' failed to load. Click to dismiss.';
        el.onmouseenter = function() { el.style.opacity = '1'; };
        el.onmouseleave = function() { el.style.opacity = '0.6'; };
        el.onclick = function() { el.remove(); };
        document.body.appendChild(el);
    },

    /**
     * Re-render all modules (called after data refresh).
     * Skips modules marked as failed.
     */
    renderAll() {
        for (const id of this._initOrder) {
            const mod = this._modules[id];
            if (!mod || typeof mod.render !== 'function') continue;

            // Skip failed modules
            if (this._failed.has(id)) {
                console.warn(`[MK] Skipping render for failed module: ${id}`);
                continue;
            }

            if (!this._perf[id]) this._perf[id] = {};
            const t0 = performance.now();

            try {
                mod.render();
                const elapsed = performance.now() - t0;
                this._perf[id].render_ms = Math.round(elapsed * 100) / 100;
            } catch (e) {
                const elapsed = performance.now() - t0;
                this._perf[id].render_ms = Math.round(elapsed * 100) / 100;
                console.error(`[MK] ${id} render failed (${elapsed.toFixed(1)}ms):`, e);
                console.error(e.stack || e);
                // Mark as failed so subsequent renders skip it too
                this._failed.set(id, e);
                this._showFailureIndicators();
            }
        }
    },

    /**
     * Get module status summary.
     * @returns {{loaded: string[], failed: string[], pending: string[]}}
     */
    status() {
        const failedIds = [...this._failed.keys()];
        const pendingIds = [...this._pending];
        const loadedIds = [...this._loaded].filter(
            id => !this._failed.has(id) && !this._pending.has(id)
        );
        return {
            loaded: loadedIds,
            failed: failedIds,
            pending: pendingIds
        };
    },

    /**
     * Log a formatted performance report to the console.
     */
    perfReport() {
        const rows = this._initOrder
            .filter(id => this._perf[id])
            .map(id => ({
                Module: id,
                'Init (ms)': this._perf[id].init_ms != null ? this._perf[id].init_ms : '--',
                'Render (ms)': this._perf[id].render_ms != null ? this._perf[id].render_ms : '--',
                Priority: this._critical.has(id) ? 'critical' : 'deferred',
                Status: this._failed.has(id) ? 'FAILED' : 'ok'
            }));
        console.log('[MK] Module Performance Report');
        console.table(rows);
        return rows;
    },

    /**
     * Inject Module Performance section into Mission Control health tab.
     * Hidden by default -- only renders when the Mission Control page is active
     * and can also be triggered via console: MKModules.showPerfPanel()
     */
    showPerfPanel() {
        this._injectMissionControlPerf(true);
    },

    _injectMissionControlPerf(force) {
        // Look for Mission Control health container — try common selectors
        const tryInject = () => {
            const target = document.getElementById('mission-health') ||
                           document.getElementById('missionControlContent') ||
                           document.querySelector('[data-page="mission"] .page-content') ||
                           document.querySelector('.mission-control-health');

            if (!target) return false;

            // Only inject if Mission Control page is actually active/visible, unless forced
            if (!force && target.offsetParent === null) return false;

            // Don't inject twice
            if (document.getElementById('mk-perf-section')) return true;

            const rows = this._initOrder.map(id => {
                const p = this._perf[id] || {};
                const isFailed = this._failed.has(id);
                const isCritical = this._critical.has(id);
                const initVal = p.init_ms != null ? p.init_ms + 'ms' : '--';
                const renderVal = p.render_ms != null ? p.render_ms + 'ms' : '--';
                const initWarn = (p.init_ms || 0) > 500 ? ' style="color:#e74c3c;font-weight:bold"' : '';
                const statusColor = isFailed ? '#e74c3c' : '#2ecc71';
                const statusText = isFailed ? 'FAILED' : 'OK';
                const priorityBadge = isCritical
                    ? '<span style="color:#f39c12;font-size:10px">CRITICAL</span>'
                    : '<span style="color:#7f8c8d;font-size:10px">DEFERRED</span>';

                return `<tr>
                    <td style="padding:4px 8px;font-family:monospace;font-size:12px">${id}</td>
                    <td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:12px"${initWarn}>${initVal}</td>
                    <td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:12px">${renderVal}</td>
                    <td style="padding:4px 8px;text-align:center">${priorityBadge}</td>
                    <td style="padding:4px 8px;text-align:center;color:${statusColor};font-weight:bold;font-size:12px">${statusText}</td>
                </tr>`;
            }).join('');

            const totalInit = Object.values(this._perf).reduce((s, p) => s + (p.init_ms || 0), 0);
            const totalRender = Object.values(this._perf).reduce((s, p) => s + (p.render_ms || 0), 0);

            const section = document.createElement('div');
            section.id = 'mk-perf-section';
            section.innerHTML = `
                <div class="card" style="margin-top:16px">
                    <div class="card-head"><span>Module Performance</span></div>
                    <div style="overflow-x:auto">
                        <table style="width:100%;border-collapse:collapse;margin:8px 0">
                            <thead>
                                <tr style="border-bottom:1px solid var(--border-color, #333)">
                                    <th style="padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-2, #888)">Module</th>
                                    <th style="padding:6px 8px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-2, #888)">Init</th>
                                    <th style="padding:6px 8px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-2, #888)">Render</th>
                                    <th style="padding:6px 8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-2, #888)">Priority</th>
                                    <th style="padding:6px 8px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-2, #888)">Status</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                            <tfoot>
                                <tr style="border-top:1px solid var(--border-color, #333)">
                                    <td style="padding:6px 8px;font-weight:bold;font-size:12px">Total</td>
                                    <td style="padding:6px 8px;text-align:right;font-family:monospace;font-size:12px;font-weight:bold">${totalInit.toFixed(1)}ms</td>
                                    <td style="padding:6px 8px;text-align:right;font-family:monospace;font-size:12px;font-weight:bold">${totalRender.toFixed(1)}ms</td>
                                    <td colspan="2"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div style="padding:4px 8px 8px;font-size:11px;color:var(--text-2, #888)">
                        ${this._failed.size > 0 ? 'Failed: ' + [...this._failed.keys()].join(', ') + ' | ' : ''}
                        Loaded: ${this._loaded.size - this._failed.size}/${this._loaded.size}
                        | Run <code>MKModules.perfReport()</code> in console for details
                    </div>
                </div>
            `;
            target.appendChild(section);
            return true;
        };

        // Try now, and also listen for Mission Control tab activation
        if (!tryInject()) {
            document.addEventListener('mk:page-changed', () => tryInject());
            // Also retry on a short delay in case DOM isn't ready yet
            setTimeout(() => tryInject(), 2000);
        }
    },

    /**
     * Get a module by ID.
     */
    get(id) {
        return this._modules[id] || null;
    },

    /**
     * Emit an event that other modules can listen to.
     */
    emit(eventName, detail = {}) {
        document.dispatchEvent(new CustomEvent(`mk:${eventName}`, { detail }));
    },

    /**
     * Listen for a module event.
     */
    on(eventName, handler) {
        document.addEventListener(`mk:${eventName}`, handler);
    },

    /**
     * Shared utility: format price
     */
    formatPrice(n) {
        if (n == null || isNaN(n)) return '--';
        return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    },

    /**
     * Shared utility: format percentage
     */
    formatPct(n, decimals = 1) {
        if (n == null || isNaN(n)) return '--';
        return Number(n).toFixed(decimals) + '%';
    },

    /**
     * Shared utility: inject HTML into a container
     */
    inject(containerId, html) {
        const el = document.getElementById(containerId);
        if (el) el.innerHTML = html;
    },

    /**
     * Shared utility: create a card component
     */
    card(title, content, opts = {}) {
        const cls = opts.class || '';
        const style = opts.style || '';
        return `<div class="card ${cls}" style="${style}">
            ${title ? `<div class="card-head"><span>${title}</span></div>` : ''}
            ${content}
        </div>`;
    }
};

// Auto-load module scripts
(function() {
    const modules = [
        'ws1-price-intel',
        'ws2-inventory-pnl',
        'ws3-deal-flow',
        'ws4-posting',
        'ws5-shipping',
        'ws6-crm',
        'ws7-analytics',
        'ws8-mobile-ux',
        'ws9-reporting',
        'ws10-automation'
    ];

    const base = '/modules/';
    let loaded = 0;

    modules.forEach(m => {
        const script = document.createElement('script');
        script.src = base + m + '.js';
        script.async = true;
        script.onerror = () => {
            // Module file doesn't exist yet — that's OK
            loaded++;
            if (loaded === modules.length) onAllLoaded();
        };
        script.onload = () => {
            loaded++;
            if (loaded === modules.length) onAllLoaded();
        };
        document.head.appendChild(script);
    });

    function onAllLoaded() {
        // Wait for main app data to be ready, then init modules
        if (window.DATA && Object.keys(window.DATA).length > 0) {
            window.MKModules.initAll();
        } else {
            // Wait for data load
            document.addEventListener('mk:data-loaded', () => {
                window.MKModules.initAll();
            });
        }
    }
})();
