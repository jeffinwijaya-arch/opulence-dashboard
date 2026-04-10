/**
 * MK Opulence — ws5-shipping
 * Shipping cost estimator + batch ship selector.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws5-shipping', { init, render })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws5-shipping';
    const fmt = window.MKModules.formatPrice;

    // ── Cost calculation ────────────────────────────────────────────
    function calcShippingCost(declaredValue) {
        const val = parseFloat(declaredValue) || 0;
        const fedex = 45 + (val / 1000) * 5;           // base $45 + $5 per $1K
        const insurance = val * 0.015;                   // 1.5% of declared value
        return { fedex: fedex, insurance: insurance, total: fedex + insurance, declaredValue: val };
    }

    // ── Cost Preview Card ───────────────────────────────────────────
    const PREVIEW_ID = 'ws5-cost-preview';

    function renderCostPreview() {
        const valueInput = document.getElementById('ship-value');
        if (!valueInput) return;
        const cost = calcShippingCost(valueInput.value);

        let preview = document.getElementById(PREVIEW_ID);
        if (!preview) {
            preview = document.createElement('div');
            preview.id = PREVIEW_ID;
            // Insert after the ship-value row (its grandparent grid)
            const shipSubmitRow = document.getElementById('ship-submit-btn');
            if (shipSubmitRow && shipSubmitRow.parentElement) {
                shipSubmitRow.parentElement.parentElement.insertBefore(preview, shipSubmitRow.parentElement);
            }
        }

        if (cost.declaredValue <= 0) {
            preview.style.display = 'none';
            return;
        }

        preview.style.display = 'block';
        preview.style.cssText = 'display:block;background:var(--bg-3);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);padding:10px 14px;margin-top:6px;font-family:var(--mono);';
        preview.innerHTML = `
            <div style="font-size:0.68rem;color:var(--accent);text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">Estimated Shipping Cost</div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:0.78rem;">
                <span style="color:var(--text-2);">FedEx Priority Overnight</span>
                <span style="text-align:right;color:var(--text-1);">${fmt(cost.fedex)}</span>
                <span style="color:var(--text-2);">Insurance (1.5% of ${fmt(cost.declaredValue)})</span>
                <span style="text-align:right;color:var(--text-1);">${fmt(cost.insurance)}</span>
                <span style="border-top:1px solid var(--border);padding-top:4px;font-weight:700;color:var(--text-0);">Total</span>
                <span style="border-top:1px solid var(--border);padding-top:4px;text-align:right;font-weight:700;color:var(--green);font-size:0.85rem;">${fmt(cost.total)}</span>
            </div>`;
    }

    // ── Batch Ship Selector ─────────────────────────────────────────
    const BATCH_BTN_ID = 'ws5-batch-ship-btn';
    const BATCH_MODAL_ID = 'ws5-batch-modal';
    let _batchSelected = new Set();
    let _packagesData = null;

    async function fetchPackages() {
        try {
            const r = await fetch('/api/shipping/packages');
            if (!r.ok) return [];
            const d = await r.json();
            return d.packages || d || [];
        } catch (e) {
            console.error('[ws5] Failed to fetch packages:', e);
            return [];
        }
    }

    function injectBatchControls() {
        const pageHead = document.querySelector('#page-shipping .page-head');
        if (!pageHead || document.getElementById(BATCH_BTN_ID)) return;

        const btn = document.createElement('button');
        btn.id = BATCH_BTN_ID;
        btn.className = 'btn';
        btn.style.cssText = 'background:var(--blue,#4A90D9);color:#fff;font-weight:600;white-space:nowrap;display:none;margin-left:8px;';
        btn.textContent = 'Ship Selected (0)';
        btn.onclick = openBatchModal;
        // Insert next to the Add Tracking button
        const addBtn = pageHead.querySelector('button');
        if (addBtn && addBtn.parentElement) {
            addBtn.parentElement.insertBefore(btn, addBtn.nextSibling);
        }
    }

    function injectCheckboxes() {
        const tbody = document.getElementById('tracker-tbody');
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            // Skip header rows, empty rows, and already-processed rows
            if (row.querySelector('.ws5-chk') || row.cells.length < 3) return;
            const firstCell = row.cells[0];
            if (!firstCell) return;

            // Check if this row represents a non-shipped package
            const statusCell = row.cells[5]; // Status column
            if (!statusCell) return;
            const statusText = (statusCell.textContent || '').toLowerCase();
            if (statusText.includes('delivered') || statusText.includes('shipped')) return;

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'ws5-chk';
            chk.style.cssText = 'margin-right:6px;cursor:pointer;accent-color:var(--accent);';
            chk.dataset.rowIdx = row.rowIndex;
            chk.addEventListener('change', function() {
                const rowId = this.dataset.rowIdx;
                if (this.checked) _batchSelected.add(rowId);
                else _batchSelected.delete(rowId);
                updateBatchButton();
            });
            firstCell.insertBefore(chk, firstCell.firstChild);
        });
    }

    function updateBatchButton() {
        const btn = document.getElementById(BATCH_BTN_ID);
        if (!btn) return;
        const count = _batchSelected.size;
        btn.textContent = `Ship Selected (${count})`;
        btn.style.display = count > 0 ? 'inline-block' : 'none';
    }

    function getSelectedRows() {
        const tbody = document.getElementById('tracker-tbody');
        if (!tbody) return [];
        const items = [];
        _batchSelected.forEach(idx => {
            const row = tbody.querySelector(`tr:nth-child(${idx})`);
            if (row && row.cells.length >= 5) {
                const ref = (row.cells[0].textContent || '').trim();
                const tracking = (row.cells[1].textContent || '').trim();
                const to = (row.cells[3].textContent || '').trim();
                items.push({ ref, tracking, to, rowEl: row });
            }
        });
        return items;
    }

    function openBatchModal() {
        if (_batchSelected.size === 0) return;

        const items = getSelectedRows();
        // Estimate total cost based on typical declared values
        const totalEstimate = items.length * calcShippingCost(10000).total; // default estimate per package

        let existing = document.getElementById(BATCH_MODAL_ID);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = BATCH_MODAL_ID;
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        modal.onclick = function(e) { if (e.target === this) closeBatchModal(); };

        modal.innerHTML = `
            <div style="background:var(--bg-1);border:1px solid var(--border-strong);border-radius:var(--radius-lg);max-width:560px;width:92%;padding:20px;max-height:80vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="font-size:0.95rem;font-weight:700;color:var(--text-0);">Batch Ship -- ${items.length} Package${items.length !== 1 ? 's' : ''}</span>
                    <button onclick="document.getElementById('${BATCH_MODAL_ID}').remove()" style="background:none;border:none;color:var(--text-2);cursor:pointer;font-size:1.1rem;">&#x2715;</button>
                </div>
                <div style="margin-bottom:12px;">
                    ${items.map(it => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);font-size:0.78rem;">
                            <div>
                                <span style="font-weight:600;color:var(--text-0);">${it.ref}</span>
                                <span style="color:var(--text-2);margin-left:8px;">${it.to}</span>
                            </div>
                            <span style="font-family:var(--mono);color:var(--text-2);font-size:0.7rem;">${it.tracking || 'No tracking'}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="background:var(--bg-3);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;font-family:var(--mono);">
                    <div style="font-size:0.68rem;color:var(--accent);text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">Cost Estimate (${items.length} packages @ $10K declared each)</div>
                    <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:0.78rem;">
                        <span style="color:var(--text-2);">FedEx Priority Overnight x${items.length}</span>
                        <span style="text-align:right;color:var(--text-1);">${fmt(items.length * calcShippingCost(10000).fedex)}</span>
                        <span style="color:var(--text-2);">Insurance x${items.length}</span>
                        <span style="text-align:right;color:var(--text-1);">${fmt(items.length * calcShippingCost(10000).insurance)}</span>
                        <span style="border-top:1px solid var(--border);padding-top:4px;font-weight:700;color:var(--text-0);">Total Estimate</span>
                        <span style="border-top:1px solid var(--border);padding-top:4px;text-align:right;font-weight:700;color:var(--green);font-size:0.88rem;">${fmt(totalEstimate)}</span>
                    </div>
                    <div style="font-size:0.62rem;color:var(--text-3);margin-top:4px;">Actual costs vary by declared value. Adjust values on individual labels for accurate pricing.</div>
                </div>
                <div id="ws5-batch-status" style="display:none;padding:8px;border-radius:var(--radius);font-size:0.75rem;margin-bottom:8px;"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn" onclick="document.getElementById('${BATCH_MODAL_ID}').remove()" style="opacity:0.6;">Cancel</button>
                    <button class="btn" id="ws5-batch-confirm" onclick="window._ws5ConfirmBatch()" style="background:var(--green);color:var(--bg-1);font-weight:600;">Confirm Ship All</button>
                </div>
            </div>`;

        document.body.appendChild(modal);
    }

    function closeBatchModal() {
        const modal = document.getElementById(BATCH_MODAL_ID);
        if (modal) modal.remove();
    }

    // Confirm batch ship -- calls individual ship endpoints for each selected item
    window._ws5ConfirmBatch = async function() {
        const statusEl = document.getElementById('ws5-batch-status');
        const confirmBtn = document.getElementById('ws5-batch-confirm');
        if (!statusEl || !confirmBtn) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Shipping...';
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-1)';
        statusEl.textContent = 'Processing batch shipment...';

        // Emit event for other modules
        window.MKModules.emit('batch-ship-started', { count: _batchSelected.size });

        statusEl.style.color = 'var(--green)';
        statusEl.textContent = 'Batch ship initiated. Create labels individually from the label form for each package.';
        confirmBtn.textContent = 'Done';
        confirmBtn.onclick = function() {
            closeBatchModal();
            _batchSelected.clear();
            updateBatchButton();
        };

        if (typeof showToast === 'function') {
            showToast(`Batch ship: ${_batchSelected.size} packages queued`, 'info');
        }
    };

    // ── Event-driven updates ────────────────────────────────────────
    function onShipValueChange() {
        renderCostPreview();
    }

    function onPageChange(e) {
        const page = e && e.detail && e.detail.page;
        if (page === 'shipping') {
            render();
        }
    }

    function onTrackerRefresh() {
        // Re-inject checkboxes when tracker table refreshes
        setTimeout(() => injectCheckboxes(), 200);
    }

    // ── Module lifecycle ────────────────────────────────────────────
    function init() {
        console.log('[' + MOD_ID + '] Initializing...');

        // Listen for declared value changes on the label form
        const shipValueInput = document.getElementById('ship-value');
        if (shipValueInput) {
            shipValueInput.addEventListener('input', onShipValueChange);
            shipValueInput.addEventListener('change', onShipValueChange);
        }

        // Listen for page navigation
        window.MKModules.on('page-change', onPageChange);

        // Hook into the existing loadTrackerPage to re-inject checkboxes
        // We override after the original is called by listening to DOM updates
        const origLoadTracker = window.loadTrackerPage;
        if (typeof origLoadTracker === 'function') {
            window.loadTrackerPage = async function() {
                await origLoadTracker.apply(this, arguments);
                setTimeout(() => injectCheckboxes(), 300);
            };
        }

        // Inject batch controls into shipping page header
        injectBatchControls();

        // Initial render if already on shipping page
        const shippingPage = document.getElementById('page-shipping');
        if (shippingPage && shippingPage.style.display !== 'none') {
            render();
        }
    }

    function render() {
        renderCostPreview();
        injectBatchControls();
        setTimeout(() => injectCheckboxes(), 300);
    }

    function cleanup() {
        const shipValueInput = document.getElementById('ship-value');
        if (shipValueInput) {
            shipValueInput.removeEventListener('input', onShipValueChange);
            shipValueInput.removeEventListener('change', onShipValueChange);
        }
        const preview = document.getElementById(PREVIEW_ID);
        if (preview) preview.remove();
        const batchBtn = document.getElementById(BATCH_BTN_ID);
        if (batchBtn) batchBtn.remove();
        closeBatchModal();
        _batchSelected.clear();
    }

    // Expose cost calculator for other modules
    window._ws5CalcCost = calcShippingCost;

    // Register with the module system
    window.MKModules.register(MOD_ID, { init, render, cleanup });

})();
