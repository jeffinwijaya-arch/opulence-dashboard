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

    var MOD_ID = 'ws5-shipping';
    var fmt = window.MKModules.formatPrice;

    // ── Cost calculation ────────────────────────────────────────────
    function calcShippingCost(declaredValue) {
        var val = parseFloat(declaredValue) || 0;
        var fedex = 45 + (val / 1000) * 5;           // base $45 + $5 per $1K
        var insurance = val * 0.015;                   // 1.5% of declared value
        return { fedex: fedex, insurance: insurance, total: fedex + insurance, declaredValue: val };
    }

    // ── Cost Preview Card ───────────────────────────────────────────
    var PREVIEW_ID = 'ws5-cost-preview';

    function renderCostPreview() {
        var valueInput = document.getElementById('ship-value');
        if (!valueInput) return;
        var cost = calcShippingCost(valueInput.value);

        var preview = document.getElementById(PREVIEW_ID);
        if (!preview) {
            preview = document.createElement('div');
            preview.id = PREVIEW_ID;
            // Insert ABOVE the shipping form (before the form grid)
            var shipForm = valueInput.closest('form') || valueInput.closest('.card-body') || valueInput.closest('.card');
            if (shipForm) {
                shipForm.parentElement.insertBefore(preview, shipForm);
            } else {
                var shipSubmitRow = document.getElementById('ship-submit-btn');
                if (shipSubmitRow && shipSubmitRow.parentElement) {
                    var formContainer = shipSubmitRow.parentElement.parentElement;
                    formContainer.parentElement.insertBefore(preview, formContainer);
                }
            }
        }

        if (cost.declaredValue <= 0) {
            preview.style.display = 'none';
            return;
        }

        preview.style.display = 'block';
        preview.style.cssText = 'display:block;background:var(--bg-3);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);padding:10px 14px;margin-top:6px;font-family:var(--mono);';
        preview.innerHTML =
            '<div style="font-size:0.68rem;color:var(--accent);text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">Estimated Shipping Cost</div>' +
            '<div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:0.78rem;">' +
                '<span style="color:var(--text-2);">FedEx Priority Overnight</span>' +
                '<span style="text-align:right;color:var(--text-1);">' + fmt(cost.fedex) + '</span>' +
                '<span style="color:var(--text-2);">Insurance (1.5% of ' + fmt(cost.declaredValue) + ')</span>' +
                '<span style="text-align:right;color:var(--text-1);">' + fmt(cost.insurance) + '</span>' +
                '<span style="border-top:1px solid var(--border);padding-top:4px;font-weight:700;color:var(--text-0);">Total</span>' +
                '<span style="border-top:1px solid var(--border);padding-top:4px;text-align:right;font-weight:700;color:var(--green);font-size:0.85rem;">' + fmt(cost.total) + '</span>' +
            '</div>';
    }

    // ── Batch Ship Selector ─────────────────────────────────────────
    var BATCH_BTN_ID = 'ws5-batch-ship-btn';
    var BATCH_MODAL_ID = 'ws5-batch-modal';
    var _batchSelected = new Set();

    /**
     * Get the current tracker data from the global _allTrackings.
     * The tracker table in index.html stores tracking objects with
     * { id, tracking_number, direction, status, watch_ref, from, to, ... }
     */
    function getTrackings() {
        // _allTrackings is defined in index.html's IIFE scope but renderTrackerTable
        // writes data-id attributes on rows. We read from the DOM + re-fetch if needed.
        // We access it through the tracker tbody rows.
        return [];
    }

    /**
     * Return outbound tracker rows that are NOT delivered (i.e. eligible for batch action).
     */
    function getUnshippedOutboundRows() {
        var tbody = document.getElementById('tracker-tbody');
        if (!tbody) return [];
        var rows = [];
        var trs = tbody.querySelectorAll('tr');
        for (var i = 0; i < trs.length; i++) {
            var tr = trs[i];
            // Skip placeholder / empty-state rows
            if (tr.cells.length < 5) continue;
            // Status is column 5 (0-indexed)
            var statusCell = tr.cells[5];
            if (!statusCell) continue;
            var statusText = (statusCell.textContent || '').toLowerCase().trim();
            // Skip delivered packages
            if (statusText === 'delivered') continue;
            rows.push(tr);
        }
        return rows;
    }

    function injectBatchControls() {
        var pageHead = document.querySelector('#page-shipping .page-head');
        if (!pageHead || document.getElementById(BATCH_BTN_ID)) return;

        // Select All toggle button
        var selAllBtn = document.createElement('button');
        selAllBtn.id = 'ws5-select-all-btn';
        selAllBtn.className = 'btn';
        selAllBtn.style.cssText = 'background:var(--bg-3);color:var(--text-1);font-weight:500;white-space:nowrap;margin-left:8px;font-size:0.72rem;';
        selAllBtn.textContent = 'Select All';
        selAllBtn.onclick = function() {
            var rows = getUnshippedOutboundRows();
            if (rows.length === 0) {
                if (typeof showToast === 'function') showToast('No unshipped packages to select', 'info');
                return;
            }
            var allSelected = rows.length > 0 && _batchSelected.size >= rows.length;
            if (allSelected) {
                _batchSelected.clear();
                selAllBtn.textContent = 'Select All';
            } else {
                rows.forEach(function(tr) {
                    var trackingCell = tr.cells[1];
                    var trackingLink = trackingCell ? trackingCell.querySelector('a') : null;
                    var trackingNum = trackingLink ? trackingLink.textContent.trim() : '';
                    if (!trackingNum && trackingCell) trackingNum = trackingCell.textContent.trim();
                    var rowKey = trackingNum || ('row-' + Array.prototype.indexOf.call(tr.parentElement.children, tr));
                    _batchSelected.add(rowKey);
                });
                selAllBtn.textContent = 'Deselect All';
            }
            injectCheckboxes();
            updateBatchButton();
        };

        var btn = document.createElement('button');
        btn.id = BATCH_BTN_ID;
        btn.className = 'btn';
        btn.style.cssText = 'background:var(--blue,#4A90D9);color:#fff;font-weight:600;white-space:nowrap;display:none;margin-left:8px;';
        btn.textContent = 'Ship Selected (0)';
        btn.onclick = openBatchModal;
        // Insert next to the Add Tracking button
        var addBtn = pageHead.querySelector('button');
        if (addBtn && addBtn.parentElement) {
            addBtn.parentElement.insertBefore(selAllBtn, addBtn.nextSibling);
            addBtn.parentElement.insertBefore(btn, selAllBtn.nextSibling);
        }
    }

    function injectCheckboxes() {
        var tbody = document.getElementById('tracker-tbody');
        if (!tbody) return;

        // Read what tab is active (only add checkboxes on outbound)
        var outboundTab = document.getElementById('tab-outbound');
        var isOutbound = outboundTab && outboundTab.style.borderBottomColor &&
            outboundTab.style.borderBottomColor !== 'transparent' &&
            outboundTab.style.color !== 'var(--text-2)';

        // Also check the accent-styled tab
        if (!isOutbound) {
            var inboundTab = document.getElementById('tab-inbound');
            // If inbound is active, outbound is not
            if (inboundTab && inboundTab.style.color === 'var(--accent)') {
                isOutbound = false;
            } else if (outboundTab && outboundTab.style.color === 'var(--accent)') {
                isOutbound = true;
            }
        }

        // Clear old selections when changing tabs (checkboxes get re-rendered)
        var trs = tbody.querySelectorAll('tr');
        var anyCheckboxExists = false;

        for (var i = 0; i < trs.length; i++) {
            var tr = trs[i];
            // Skip placeholder / empty-state rows
            if (tr.cells.length < 5) continue;

            var firstCell = tr.cells[0];
            if (!firstCell) continue;

            // Remove any old checkboxes first
            var oldChk = firstCell.querySelector('.ws5-chk');
            if (oldChk) {
                oldChk.remove();
            }

            // Only inject on outbound tab, for non-delivered rows
            if (!isOutbound) continue;

            var statusCell = tr.cells[5];
            if (!statusCell) continue;
            var statusText = (statusCell.textContent || '').toLowerCase().trim();
            if (statusText === 'delivered') continue;

            // Extract a stable identifier: the tracking number from column 1
            var trackingCell = tr.cells[1];
            var trackingLink = trackingCell ? trackingCell.querySelector('a') : null;
            var trackingNum = trackingLink ? trackingLink.textContent.trim() : '';
            if (!trackingNum && trackingCell) trackingNum = trackingCell.textContent.trim();
            // Fall back to row index if no tracking number
            var rowKey = trackingNum || ('row-' + i);

            var chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'ws5-chk';
            chk.style.cssText = 'margin-right:6px;cursor:pointer;accent-color:var(--accent);vertical-align:middle;width:20px;height:20px;min-width:20px;';
            chk.dataset.key = rowKey;
            chk.checked = _batchSelected.has(rowKey);
            chk.addEventListener('change', (function(key) {
                return function() {
                    if (this.checked) {
                        _batchSelected.add(key);
                    } else {
                        _batchSelected.delete(key);
                    }
                    updateBatchButton();
                };
            })(rowKey));
            firstCell.insertBefore(chk, firstCell.firstChild);
            anyCheckboxExists = true;
        }

        // If we're not on outbound or no eligible rows, clear selection
        if (!isOutbound || !anyCheckboxExists) {
            _batchSelected.clear();
        }

        updateBatchButton();
    }

    function updateBatchButton() {
        var btn = document.getElementById(BATCH_BTN_ID);
        if (!btn) return;
        var count = _batchSelected.size;
        btn.textContent = 'Ship Selected (' + count + ')';
        btn.style.display = count > 0 ? 'inline-block' : 'none';
    }

    /**
     * Build a structured list of selected rows with their display data.
     */
    function getSelectedItems() {
        var tbody = document.getElementById('tracker-tbody');
        if (!tbody) return [];
        var items = [];
        var trs = tbody.querySelectorAll('tr');

        for (var i = 0; i < trs.length; i++) {
            var tr = trs[i];
            if (tr.cells.length < 5) continue;

            var trackingCell = tr.cells[1];
            var trackingLink = trackingCell ? trackingCell.querySelector('a') : null;
            var trackingNum = trackingLink ? trackingLink.textContent.trim() : '';
            if (!trackingNum && trackingCell) trackingNum = trackingCell.textContent.trim();
            var rowKey = trackingNum || ('row-' + i);

            if (!_batchSelected.has(rowKey)) continue;

            var watchRef = (tr.cells[0].textContent || '').replace(/^\s+/, '').trim();
            // Remove checkbox text artifact if present
            var fromVal = (tr.cells[2].textContent || '').trim();
            var toVal = (tr.cells[3].textContent || '').trim();
            var statusText = (tr.cells[5].textContent || '').trim();

            // Try to extract tracking id from row buttons (deleteTracking('id') pattern)
            var actionCell = tr.cells[8];
            var trackingId = '';
            if (actionCell) {
                var deleteBtn = actionCell.querySelector('button[onclick*="deleteTracking"]');
                if (deleteBtn) {
                    var onclick = deleteBtn.getAttribute('onclick') || '';
                    var match = onclick.match(/deleteTracking\(['"]([^'"]+)['"]\)/);
                    if (match) trackingId = match[1];
                }
            }

            items.push({
                key: rowKey,
                watchRef: watchRef,
                trackingNum: trackingNum,
                from: fromVal,
                to: toVal,
                status: statusText,
                trackingId: trackingId
            });
        }
        return items;
    }

    function openBatchModal() {
        if (_batchSelected.size === 0) {
            if (typeof showToast === 'function') showToast('No packages selected -- use checkboxes to select', 'info');
            return;
        }

        var items = getSelectedItems();
        if (items.length === 0) {
            if (typeof showToast === 'function') {
                showToast('Selected packages no longer available (already shipped?)', 'warn');
            }
            _batchSelected.clear();
            updateBatchButton();
            return;
        }

        // Cost estimate: typical watch is ~$10K declared
        var perPkgCost = calcShippingCost(10000);
        var totalEstimate = items.length * perPkgCost.total;

        var existing = document.getElementById(BATCH_MODAL_ID);
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = BATCH_MODAL_ID;
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        modal.onclick = function(e) { if (e.target === modal) closeBatchModal(); };

        var itemsHtml = items.map(function(it, idx) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;' +
                (idx < items.length - 1 ? 'border-bottom:1px solid var(--border);' : '') +
                'font-size:0.78rem;">' +
                '<div style="min-width:0;flex:1;">' +
                    '<span style="font-weight:600;color:var(--text-0);">' + escHtml(it.watchRef) + '</span>' +
                    '<span style="color:var(--text-2);margin-left:8px;font-size:0.72rem;">' + escHtml(it.to || it.from || '') + '</span>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0;margin-left:8px;">' +
                    '<span style="font-family:var(--mono);color:var(--text-2);font-size:0.68rem;">' + escHtml(it.trackingNum || 'No tracking') + '</span>' +
                    '<br><span style="font-size:0.65rem;color:var(--text-3);">' + escHtml(it.status) + '</span>' +
                '</div>' +
            '</div>';
        }).join('');

        var inner = document.createElement('div');
        inner.style.cssText = 'background:var(--bg-1);border:1px solid var(--border-strong);border-radius:var(--radius-lg);max-width:560px;width:92%;padding:20px;max-height:80vh;overflow-y:auto;';

        inner.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                '<span style="font-size:0.95rem;font-weight:700;color:var(--text-0);">Batch Ship -- ' + items.length + ' Package' + (items.length !== 1 ? 's' : '') + '</span>' +
                '<button id="ws5-batch-close" style="background:none;border:none;color:var(--text-2);cursor:pointer;font-size:1.1rem;">&#x2715;</button>' +
            '</div>' +
            '<div style="margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">' +
                itemsHtml +
            '</div>' +
            '<div style="background:var(--bg-3);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;font-family:var(--mono);">' +
                '<div style="font-size:0.68rem;color:var(--accent);text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">Cost Estimate (' + items.length + ' package' + (items.length !== 1 ? 's' : '') + ' @ $10K declared each)</div>' +
                '<div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:0.78rem;">' +
                    '<span style="color:var(--text-2);">FedEx Priority Overnight x' + items.length + '</span>' +
                    '<span style="text-align:right;color:var(--text-1);">' + fmt(items.length * perPkgCost.fedex) + '</span>' +
                    '<span style="color:var(--text-2);">Insurance x' + items.length + '</span>' +
                    '<span style="text-align:right;color:var(--text-1);">' + fmt(items.length * perPkgCost.insurance) + '</span>' +
                    '<span style="border-top:1px solid var(--border);padding-top:4px;font-weight:700;color:var(--text-0);">Total Estimate</span>' +
                    '<span style="border-top:1px solid var(--border);padding-top:4px;text-align:right;font-weight:700;color:var(--green);font-size:0.88rem;">' + fmt(totalEstimate) + '</span>' +
                '</div>' +
                '<div style="font-size:0.62rem;color:var(--text-3);margin-top:4px;">Actual costs vary by declared value.</div>' +
            '</div>' +
            '<div id="ws5-batch-status" style="display:none;padding:8px;border-radius:var(--radius);font-size:0.75rem;margin-bottom:8px;"></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
                '<button class="btn" id="ws5-batch-cancel" style="opacity:0.6;">Cancel</button>' +
                '<button class="btn" id="ws5-batch-confirm" style="background:var(--green);color:var(--bg-1);font-weight:600;">Confirm Ship All</button>' +
            '</div>';

        modal.appendChild(inner);
        document.body.appendChild(modal);

        // Bind button events (avoids inline onclick with global functions)
        document.getElementById('ws5-batch-close').onclick = closeBatchModal;
        document.getElementById('ws5-batch-cancel').onclick = closeBatchModal;
        document.getElementById('ws5-batch-confirm').onclick = function() {
            confirmBatchShip(items);
        };
    }

    function closeBatchModal() {
        var modal = document.getElementById(BATCH_MODAL_ID);
        if (modal) modal.remove();
    }

    /**
     * Confirm batch ship: calls the ship API for each selected package,
     * then refreshes the tracker page and shows a toast.
     */
    async function confirmBatchShip(items) {
        var statusEl = document.getElementById('ws5-batch-status');
        var confirmBtn = document.getElementById('ws5-batch-confirm');
        var cancelBtn = document.getElementById('ws5-batch-cancel');
        if (!confirmBtn) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Shipping...';
        if (cancelBtn) cancelBtn.disabled = true;

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.cssText = 'display:block;background:var(--bg-3);color:var(--text-1);padding:8px;border-radius:var(--radius);font-size:0.75rem;margin-bottom:8px;';
            statusEl.textContent = 'Processing 0 / ' + items.length + '...';
        }

        var succeeded = 0;
        var failed = 0;
        var errors = [];

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (statusEl) {
                statusEl.textContent = 'Processing ' + (i + 1) + ' / ' + items.length + ' -- ' + (item.watchRef || item.trackingNum) + '...';
            }

            try {
                // Call the ship API endpoint with tracking number
                // The API expects: { row (watch row/id), tracking, type }
                // We extract watch_id from the trackingId if available
                var payload = {
                    tracking: item.trackingNum,
                    type: 'foreign'
                };

                // If we have a tracking ID, try to get associated watch info
                if (item.trackingId) {
                    payload.tracking_id = item.trackingId;
                }

                var r = await fetch('/api/inventory/ship', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var d = await r.json();

                if (d.ok) {
                    succeeded++;
                } else {
                    failed++;
                    errors.push((item.watchRef || item.trackingNum) + ': ' + (d.error || 'Unknown error'));
                }
            } catch (e) {
                failed++;
                errors.push((item.watchRef || item.trackingNum) + ': ' + e.message);
            }
        }

        // Show result
        if (statusEl) {
            if (failed === 0) {
                statusEl.style.cssText = 'display:block;background:rgba(0,200,83,0.1);color:var(--green);padding:8px;border-radius:var(--radius);font-size:0.75rem;margin-bottom:8px;';
                statusEl.textContent = 'All ' + succeeded + ' package' + (succeeded !== 1 ? 's' : '') + ' shipped successfully.';
            } else if (succeeded === 0) {
                statusEl.style.cssText = 'display:block;background:rgba(255,23,68,0.1);color:var(--red);padding:8px;border-radius:var(--radius);font-size:0.75rem;margin-bottom:8px;';
                statusEl.innerHTML = 'All shipments failed.<br>' + errors.map(escHtml).join('<br>');
            } else {
                statusEl.style.cssText = 'display:block;background:rgba(255,171,0,0.1);color:var(--gold);padding:8px;border-radius:var(--radius);font-size:0.75rem;margin-bottom:8px;';
                statusEl.innerHTML = succeeded + ' shipped, ' + failed + ' failed.<br>' + errors.map(escHtml).join('<br>');
            }
        }

        // Update button to "Done"
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Done';
        confirmBtn.onclick = function() {
            closeBatchModal();
            _batchSelected.clear();
            updateBatchButton();
            // Refresh the tracker page
            if (typeof window.loadTrackerPage === 'function') {
                window.loadTrackerPage();
            }
        };
        if (cancelBtn) {
            cancelBtn.disabled = false;
        }

        // Emit event for other modules
        window.MKModules.emit('batch-ship-completed', { succeeded: succeeded, failed: failed });

        if (typeof showToast === 'function') {
            if (failed === 0) {
                showToast(succeeded + ' package' + (succeeded !== 1 ? 's' : '') + ' shipped successfully', 'ok');
            } else {
                showToast(succeeded + ' shipped, ' + failed + ' failed', 'warn');
            }
        }
    }

    /**
     * Minimal HTML escaping for user-facing strings.
     */
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Event-driven updates ────────────────────────────────────────
    function onShipValueChange() {
        renderCostPreview();
    }

    function onPageChange(e) {
        var page = e && e.detail && e.detail.page;
        if (page === 'shipping') {
            render();
        }
    }

    // ── Module lifecycle ────────────────────────────────────────────
    function init() {
        console.log('[' + MOD_ID + '] Initializing...');

        // Listen for declared value changes on the label form
        var shipValueInput = document.getElementById('ship-value');
        if (shipValueInput) {
            shipValueInput.addEventListener('input', onShipValueChange);
            shipValueInput.addEventListener('change', onShipValueChange);
        }

        // Listen for page navigation
        window.MKModules.on('page-change', onPageChange);

        // Hook into the existing loadTrackerPage to re-inject checkboxes
        var origLoadTracker = window.loadTrackerPage;
        if (typeof origLoadTracker === 'function') {
            window.loadTrackerPage = async function() {
                await origLoadTracker.apply(this, arguments);
                // Re-inject checkboxes after tracker data renders
                // Clear stale selections since rows are fully re-rendered
                _batchSelected.clear();
                setTimeout(function() { injectCheckboxes(); }, 150);
            };
        }

        // Also hook into switchTrackerTab to re-inject checkboxes on tab switch
        var origSwitchTab = window.switchTrackerTab;
        if (typeof origSwitchTab === 'function') {
            window.switchTrackerTab = function(tab) {
                origSwitchTab.apply(this, arguments);
                // Clear selections when switching tabs
                _batchSelected.clear();
                setTimeout(function() { injectCheckboxes(); }, 100);
            };
        }

        // Inject batch controls into shipping page header
        injectBatchControls();

        // Initial render if already on shipping page
        var shippingPage = document.getElementById('page-shipping');
        if (shippingPage && shippingPage.style.display !== 'none') {
            render();
        }
    }

    function render() {
        renderCostPreview();
        injectBatchControls();
        setTimeout(function() { injectCheckboxes(); }, 200);
    }

    function cleanup() {
        var shipValueInput = document.getElementById('ship-value');
        if (shipValueInput) {
            shipValueInput.removeEventListener('input', onShipValueChange);
            shipValueInput.removeEventListener('change', onShipValueChange);
        }
        var preview = document.getElementById(PREVIEW_ID);
        if (preview) preview.remove();
        var batchBtn = document.getElementById(BATCH_BTN_ID);
        if (batchBtn) batchBtn.remove();
        closeBatchModal();
        _batchSelected.clear();
    }

    // Expose cost calculator for other modules
    window._ws5CalcCost = calcShippingCost;

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
