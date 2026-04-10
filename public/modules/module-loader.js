/**
 * MK Opulence Module Loader
 * Loads all workstream modules and coordinates initialization.
 * Each module registers itself via window.MKModules.register()
 */

window.MKModules = {
    _modules: {},
    _loaded: new Set(),
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
     * @param {string} id - Module ID (e.g., 'ws1-price-intel')
     * @param {object} mod - Module object with init(), render(), cleanup() methods
     */
    register(id, mod) {
        this._modules[id] = mod;
        this._loaded.add(id);
        console.log(`[MK] Module registered: ${id}`);
    },

    /**
     * Initialize all registered modules in order.
     * Called after main app data is loaded.
     */
    async initAll() {
        console.log(`[MK] Initializing ${this._loaded.size} modules...`);
        for (const id of this._initOrder) {
            const mod = this._modules[id];
            if (mod && typeof mod.init === 'function') {
                try {
                    await mod.init();
                    console.log(`[MK] ${id} initialized`);
                } catch (e) {
                    console.error(`[MK] ${id} init failed:`, e);
                }
            }
        }
        document.dispatchEvent(new CustomEvent('mk:modules-ready'));
    },

    /**
     * Re-render all modules (called after data refresh).
     */
    renderAll() {
        for (const [id, mod] of Object.entries(this._modules)) {
            if (typeof mod.render === 'function') {
                try {
                    mod.render();
                } catch (e) {
                    console.error(`[MK] ${id} render failed:`, e);
                }
            }
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
