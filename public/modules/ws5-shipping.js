/**
 * MK Opulence — ws5-shipping
 * Live FedEx cost estimator, label validation, batch ship selector.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws5-shipping', { init, render, cleanup })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    var MOD_ID = 'ws5-shipping';
    var fmt = window.MKModules.formatPrice;

    // ── Rate model per service ─────────────────────────────────────
    var RATES = {
        'Priority Overnight':   { base: 65.00, perLb: 8.50 },
        'Standard Overnight':   { base: 52.00, perLb: 6.50 },
        'FedEx 2Day':           { base: 32.00, perLb: 4.00 },
        'FedEx Ground':         { base: 18.00, perLb: 2.50 }
    };
    var SIGNATURE_FEE = 5.50;
    var RESIDENTIAL_FEE = 5.50;

    // ── Cost calculation ────────────────────────────────────────────
    function calcShippingCost(opts) {
        // Accept legacy single-arg call (declaredValue only)
        if (typeof opts === 'number' || typeof opts === 'string') {
            opts = { value: opts };
        }
        var val = parseFloat(opts.value) || 0;
        var weight = parseFloat(opts.weight) || 1;
        var service = opts.service || 'Priority Overnight';
        var residential = !!opts.residential;

        var rate = RATES[service] || RATES['Priority Overnight'];
        var base = rate.base + Math.max(0, weight - 1) * rate.perLb;
        var sig = SIGNATURE_FEE;
        var res = residential ? RESIDENTIAL_FEE : 0;
        var valCharge = Math.max(3, 0.015 * val);

        var total = base + sig + res + valCharge;

        return {
            base: base,
            signature: sig,
            residential: res,
            declaredValueCharge: valCharge,
            total: total,
            declaredValue: val,
            weight: weight,
            service: service,
            warnHigh: val > 50000,
            warnLow: val > 0 && val < 100
        };
    }

    // ── Live FedEx Cost Estimator ───────────────────────────────────
    var ESTIMATOR_ID = 'ws5-cost-estimator';

    function getFormValues() {
        var g = function(id) { var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; };
        return {
            value: g('ship-value'),
            weight: g('ship-weight') || '1',
            service: g('ship-service') || 'Priority Overnight',
            residential: !!(document.getElementById('ship-residential') && document.getElementById('ship-residential').checked)
        };
    }

    function renderEstimator() {
        var submitBtn = document.getElementById('ship-submit-btn');
        if (!submitBtn) return;

        var vals = getFormValues();
        var cost = calcShippingCost(vals);

        var el = document.getElementById(ESTIMATOR_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = ESTIMATOR_ID;
            // Insert above the button row (parent of submit button)
            var btnRow = submitBtn.closest('div[style*="flex"]') || submitBtn.parentElement;
            if (btnRow && btnRow.parentElement) {
                btnRow.parentElement.insertBefore(el, btnRow);
            }
        }

        if (cost.declaredValue <= 0) {
            el.style.display = 'none';
            return;
        }

        var warnings = '';
        if (cost.warnHigh) {
            warnings += '<div style="margin-top:6px;padding:6px 8px;background:rgba(255,59,48,0.12);border:1px solid var(--red);border-radius:4px;font-size:0.7rem;color:var(--red);font-family:inherit;">' +
                '!! Declared value exceeds $50,000 FedEx retail ceiling. Consider splitting shipments or using FedEx Custom Critical.</div>';
        }
        if (cost.warnLow) {
            warnings += '<div style="margin-top:6px;padding:6px 8px;background:rgba(255,171,0,0.12);border:1px solid var(--orange);border-radius:4px;font-size:0.7rem;color:var(--orange);font-family:inherit;">' +
                '? Declared value under $100 looks suspicious for a watch shipment.</div>';
        }

        el.style.cssText = 'display:block;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:10px 14px;margin-top:8px;margin-bottom:8px;';
        el.innerHTML =
            '<div style="font-size:0.65rem;color:var(--accent);text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">Estimated FedEx Cost</div>' +
            '<div style="display:grid;grid-template-columns:1fr auto;gap:2px 12px;font-size:0.76rem;">' +
                '<span style="color:var(--text-2);">' + escHtml(cost.service) + ' (base + ' + cost.weight + ' lb)</span>' +
                '<span style="text-align:right;color:var(--text-0);">$' + cost.base.toFixed(2) + '</span>' +
                '<span style="color:var(--text-2);">Signature</span>' +
                '<span style="text-align:right;color:var(--text-0);">$' + cost.signature.toFixed(2) + '</span>' +
                (cost.residential > 0 ? '<span style="color:var(--text-2);">Residential surcharge</span><span style="text-align:right;color:var(--text-0);">$' + cost.residential.toFixed(2) + '</span>' : '') +
                '<span style="color:var(--text-2);">Declared value charge (max($3, 1.5% of ' + fmt(cost.declaredValue) + '))</span>' +
                '<span style="text-align:right;color:var(--text-0);">$' + cost.declaredValueCharge.toFixed(2) + '</span>' +
                '<span style="border-top:1px solid var(--border);padding-top:4px;font-weight:700;color:var(--text-0);">Total</span>' +
                '<span style="border-top:1px solid var(--border);padding-top:4px;text-align:right;font-weight:700;color:var(--green);font-size:0.85rem;">$' + cost.total.toFixed(2) + '</span>' +
            '</div>' +
            warnings;
    }

    // ── Label Creation Reliability (validation + duplicate guard) ───
    var _lastSubmitKey = '';
    var _lastSubmitTime = 0;

    function validateShipForm() {
        var fields = {
            'ship-contact': function(v) { return v.length > 0; },
            'ship-address': function(v) { return v.length > 0; },
            'ship-city': function(v) { return v.length > 0; },
            'ship-state': function(v) { return /^[A-Za-z]{2}$/.test(v); },
            'ship-zip': function(v) { return /^\d{5}(-?\d{4})?$/.test(v); },
            'ship-value': function(v) { return parseFloat(v) > 0; },
            'ship-phone': function(v) { return v.replace(/\D/g, '').length >= 10; }
        };

        var valid = true;
        var firstInvalid = null;

        Object.keys(fields).forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            var val = (el.value || '').trim();
            var ok = fields[id](val);
            if (!ok) {
                el.style.border = '2px solid var(--red)';
                valid = false;
                if (!firstInvalid) firstInvalid = el;
            } else {
                el.style.border = '';
            }
        });

        if (!valid && firstInvalid) {
            firstInvalid.focus();
        }

        return valid;
    }

    function checkDuplicateSubmission() {
        var contact = (document.getElementById('ship-contact') || {}).value || '';
        var zip = (document.getElementById('ship-zip') || {}).value || '';
        var key = (contact + '|' + zip).toLowerCase().trim();
        var now = Date.now();

        if (key === _lastSubmitKey && (now - _lastSubmitTime) < 60000) {
            return true; // duplicate
        }
        return false;
    }

    function recordSubmission() {
        var contact = (document.getElementById('ship-contact') || {}).value || '';
        var zip = (document.getElementById('ship-zip') || {}).value || '';
        _lastSubmitKey = (contact + '|' + zip).toLowerCase().trim();
        _lastSubmitTime = Date.now();
    }

    function wrapSubmitShipLabel() {
        var origSubmit = window.submitShipLabel;
        if (!origSubmit || origSubmit._ws5Wrapped) return;

        window.submitShipLabel = async function() {
            // Validate fields
            if (!validateShipForm()) {
                if (typeof showToast === 'function') showToast('Please fix highlighted fields', 'warn');
                return;
            }

            // High value confirmation
            var val = parseFloat((document.getElementById('ship-value') || {}).value) || 0;
            if (val > 50000) {
                if (!confirm('Declared value is $' + val.toLocaleString() + ' which exceeds FedEx retail ceiling ($50,000). Proceed anyway?')) {
                    return;
                }
            }

            // Duplicate guard
            if (checkDuplicateSubmission()) {
                if (!confirm('You submitted a label to this contact+ZIP within the last 60 seconds. Create another?')) {
                    return;
                }
            }

            recordSubmission();
            return origSubmit.apply(this, arguments);
        };
        window.submitShipLabel._ws5Wrapped = true;
    }

    // ── Batch Ship Selector ─────────────────────────────────────────
    var BATCH_ID = 'ws5-batch-selector';
    var _batchWatches = [];
    var _batchSelected = new Set();

    function ageDays(dateStr) {
        if (!dateStr) return 999;
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return 999;
        return Math.floor((Date.now() - d.getTime()) / 86400000);
    }

    function ageChip(days) {
        var color, label;
        if (days <= 1) { color = 'var(--green)'; label = 'Today'; }
        else if (days <= 3) { color = 'var(--orange)'; label = days + 'd'; }
        else { color = 'var(--red)'; label = days + 'd'; }
        return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.62rem;font-weight:600;background:' + color + ';color:var(--bg-1);">' + label + '</span>';
    }

    async function loadBatchData() {
        try {
            var r = await fetch('/api/inventory/all');
            if (!r.ok) return;
            var data = await r.json();
            var watches = data.watches || data || [];
            _batchWatches = watches.filter(function(w) {
                return w.sold && !w.shipped && !w.deleted;
            });
        } catch (e) {
            console.error('[ws5] batch load error:', e);
            _batchWatches = [];
        }
    }

    function renderBatchSelector() {
        // Find the shipping-packages section or the page itself
        var page = document.getElementById('page-shipping');
        if (!page) return;

        var existing = document.getElementById(BATCH_ID);
        if (existing) existing.remove();

        if (_batchWatches.length === 0) return;

        var card = document.createElement('div');
        card.id = BATCH_ID;
        card.className = 'card';
        card.style.cssText = 'margin-top:16px;margin-bottom:16px;';

        var rows = _batchWatches.map(function(w, idx) {
            var days = ageDays(w.sale_date || w.sold_date);
            var checked = _batchSelected.has(w.id) ? ' checked' : '';
            return '<tr style="border-bottom:1px solid var(--border);">' +
                '<td style="padding:6px 8px;"><input type="checkbox" class="ws5-batch-chk" data-id="' + w.id + '"' + checked + ' style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;"></td>' +
                '<td style="padding:6px 8px;font-size:0.75rem;font-weight:600;color:var(--text-0);">' + escHtml(w.reference || w.ref || '') + '</td>' +
                '<td style="padding:6px 8px;font-size:0.72rem;color:var(--text-2);">' + escHtml(w.description || w.dial || '').substring(0, 30) + '</td>' +
                '<td style="padding:6px 8px;font-size:0.72rem;color:var(--text-1);">' + escHtml(w.sold_to || w.buyer || '') + '</td>' +
                '<td style="padding:6px 8px;font-size:0.72rem;color:var(--text-1);">' + (w.sold_price ? fmt(w.sold_price) : '--') + '</td>' +
                '<td style="padding:6px 8px;">' + ageChip(days) + '</td>' +
            '</tr>';
        }).join('');

        card.innerHTML =
            '<div class="card-head" style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span>Batch Ship -- Sold & Unshipped (' + _batchWatches.length + ')</span>' +
                '<div style="display:flex;gap:6px;">' +
                    '<button class="btn" id="ws5-batch-prefill" style="font-size:0.68rem;padding:4px 10px;background:var(--bg-2);color:var(--accent);border:1px solid var(--accent);">Prefill</button>' +
                    '<button class="btn" id="ws5-batch-create" style="font-size:0.68rem;padding:4px 10px;background:var(--green);color:var(--bg-1);font-weight:600;">Create Labels for Selected (0)</button>' +
                '</div>' +
            '</div>' +
            '<div style="overflow-x:auto;">' +
                '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;">' +
                    '<thead><tr style="border-bottom:1px solid var(--border);">' +
                        '<th style="padding:6px 8px;text-align:left;"><input type="checkbox" id="ws5-batch-all" style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;"></th>' +
                        '<th style="padding:6px 8px;text-align:left;font-size:0.65rem;color:var(--text-2);text-transform:uppercase;">Ref</th>' +
                        '<th style="padding:6px 8px;text-align:left;font-size:0.65rem;color:var(--text-2);text-transform:uppercase;">Desc</th>' +
                        '<th style="padding:6px 8px;text-align:left;font-size:0.65rem;color:var(--text-2);text-transform:uppercase;">Buyer</th>' +
                        '<th style="padding:6px 8px;text-align:left;font-size:0.65rem;color:var(--text-2);text-transform:uppercase;">Price</th>' +
                        '<th style="padding:6px 8px;text-align:left;font-size:0.65rem;color:var(--text-2);text-transform:uppercase;">Age</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table>' +
            '</div>';

        // Insert after shipping-packages section or at end of page
        var packagesSection = document.getElementById('shipping-packages');
        if (packagesSection && packagesSection.nextSibling) {
            page.insertBefore(card, packagesSection.nextSibling);
        } else if (packagesSection) {
            page.appendChild(card);
        } else {
            // Insert before the label form card
            var labelForm = document.querySelector('#page-shipping .card');
            if (labelForm) {
                page.insertBefore(card, labelForm);
            } else {
                page.appendChild(card);
            }
        }

        // Bind events
        bindBatchEvents();
    }

    function bindBatchEvents() {
        var allChk = document.getElementById('ws5-batch-all');
        if (allChk) {
            allChk.onchange = function() {
                var checked = allChk.checked;
                _batchWatches.forEach(function(w) {
                    if (checked) _batchSelected.add(w.id);
                    else _batchSelected.delete(w.id);
                });
                var chks = document.querySelectorAll('.ws5-batch-chk');
                chks.forEach(function(c) { c.checked = checked; });
                updateBatchCreateBtn();
            };
        }

        var chks = document.querySelectorAll('.ws5-batch-chk');
        chks.forEach(function(c) {
            c.onchange = function() {
                var id = parseInt(c.dataset.id);
                if (c.checked) _batchSelected.add(id);
                else _batchSelected.delete(id);
                updateBatchCreateBtn();
            };
        });

        var prefillBtn = document.getElementById('ws5-batch-prefill');
        if (prefillBtn) prefillBtn.onclick = batchPrefill;

        var createBtn = document.getElementById('ws5-batch-create');
        if (createBtn) createBtn.onclick = batchCreateLabels;
    }

    function updateBatchCreateBtn() {
        var btn = document.getElementById('ws5-batch-create');
        if (btn) {
            btn.textContent = 'Create Labels for Selected (' + _batchSelected.size + ')';
        }
    }

    async function batchPrefill() {
        if (_batchSelected.size === 0) {
            if (typeof showToast === 'function') showToast('Select watches first', 'info');
            return;
        }

        // Get first selected watch to prefill the label form
        var watchId = _batchSelected.values().next().value;
        var watch = _batchWatches.find(function(w) { return w.id === watchId; });
        if (!watch) return;

        var buyer = watch.sold_to || watch.buyer || '';

        // Try to resolve buyer against contacts
        if (buyer) {
            try {
                var r = await fetch('/api/contacts');
                if (r.ok) {
                    var contacts = await r.json();
                    var match = (contacts || []).find(function(c) {
                        return c.name && c.name.toLowerCase() === buyer.toLowerCase();
                    });
                    if (match) {
                        setField('ship-contact', match.name || buyer);
                        setField('ship-company', match.company || '');
                        setField('ship-address', match.address || '');
                        setField('ship-city', match.city || '');
                        setField('ship-state', match.state || '');
                        setField('ship-zip', match.zip || '');
                        setField('ship-phone', match.phone || '');
                        var resEl = document.getElementById('ship-residential');
                        if (resEl) resEl.checked = !!match.is_residential;
                    } else {
                        setField('ship-contact', buyer);
                    }
                }
            } catch (e) {
                setField('ship-contact', buyer);
            }
        }

        // Fill declared value from sold_price
        if (watch.sold_price) {
            setField('ship-value', String(watch.sold_price));
        }

        renderEstimator();
        if (typeof showToast === 'function') showToast('Prefilled from ' + buyer, 'ok');
    }

    async function batchCreateLabels() {
        if (_batchSelected.size === 0) {
            if (typeof showToast === 'function') showToast('No watches selected', 'info');
            return;
        }

        var count = _batchSelected.size;
        if (!confirm('Create ' + count + ' label' + (count > 1 ? 's' : '') + ' for selected watches? Each will use the current form address.')) {
            return;
        }

        var btn = document.getElementById('ws5-batch-create');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

        var succeeded = 0;
        var failed = 0;
        var errors = [];

        var selectedWatches = _batchWatches.filter(function(w) { return _batchSelected.has(w.id); });

        for (var i = 0; i < selectedWatches.length; i++) {
            var w = selectedWatches[i];
            var g = function(id) { var el = document.getElementById(id); return el ? (el.value || '').trim() : ''; };
            var data = {
                contact: g('ship-contact'),
                company: g('ship-company') || g('ship-contact'),
                address: g('ship-address'),
                apt: g('ship-apt'),
                city: g('ship-city'),
                state: g('ship-state'),
                zip: g('ship-zip'),
                phone: g('ship-phone') || '424-502-9600',
                email: g('ship-email') || 'jeffinwijaya@gmail.com',
                value: String(w.sold_price || g('ship-value')),
                weight: g('ship-weight') || '1',
                service: g('ship-service'),
                signature: g('ship-signature'),
                residential: !!(document.getElementById('ship-residential') && document.getElementById('ship-residential').checked),
                watch_id: w.id
            };

            try {
                var r = await fetch('/api/ifs/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                var d = await r.json();
                if (d.error) {
                    failed++;
                    errors.push((w.reference || w.ref || w.id) + ': ' + d.error);
                } else {
                    succeeded++;
                }
            } catch (e) {
                failed++;
                errors.push((w.reference || w.ref || w.id) + ': ' + e.message);
            }
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Create Labels for Selected (' + _batchSelected.size + ')';
        }

        if (typeof showToast === 'function') {
            if (failed === 0) {
                showToast(succeeded + ' label' + (succeeded > 1 ? 's' : '') + ' created', 'ok');
            } else {
                showToast(succeeded + ' created, ' + failed + ' failed', 'warn');
            }
        }

        if (errors.length > 0) {
            console.error('[ws5] batch label errors:', errors);
        }

        // Refresh
        _batchSelected.clear();
        await loadBatchData();
        renderBatchSelector();
        window.MKModules.emit('batch-labels-created', { succeeded: succeeded, failed: failed });
    }

    function setField(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = val;
    }

    /**
     * Minimal HTML escaping for user-facing strings.
     */
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Event handlers ──────────────────────────────────────────────
    function onEstimatorInputChange() {
        renderEstimator();
    }

    function onPageChange(e) {
        var page = e && e.detail && e.detail.page;
        if (page === 'shipping') {
            render();
        }
    }

    // ── Mobile styles ────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ws5-styles')) return;
        var style = document.createElement('style');
        style.id = 'ws5-styles';
        style.textContent = [
            '@media (max-width:768px) {',
            '    #ws5-batch-prefill, #ws5-batch-create {',
            '        min-height:44px!important;',
            '        font-size:0.75rem!important;',
            '        padding:10px 14px!important;',
            '    }',
            '    .ws5-batch-chk { width:24px!important; height:24px!important; }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ── Module lifecycle ────────────────────────────────────────────
    function init() {
        console.log('[' + MOD_ID + '] Initializing...');
        injectStyles();

        // Listen for form changes that affect cost estimator
        ['ship-value', 'ship-weight'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', onEstimatorInputChange);
                el.addEventListener('change', onEstimatorInputChange);
            }
        });
        ['ship-service'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', onEstimatorInputChange);
            }
        });
        var resEl = document.getElementById('ship-residential');
        if (resEl) {
            resEl.addEventListener('change', onEstimatorInputChange);
        }

        // Wrap submitShipLabel for validation
        wrapSubmitShipLabel();

        // Listen for page navigation
        window.MKModules.on('page-change', onPageChange);

        // Hook into loadShippingPage to trigger setup
        var origLoadShipping = window.loadShippingPage;
        if (typeof origLoadShipping === 'function' && !origLoadShipping._ws5Wrapped) {
            window.loadShippingPage = async function() {
                await origLoadShipping.apply(this, arguments);
                await setupShippingPage();
            };
            window.loadShippingPage._ws5Wrapped = true;
        }

        // If already on shipping page, run setup
        var shippingPage = document.getElementById('page-shipping');
        if (shippingPage && shippingPage.style.display !== 'none') {
            render();
        }
    }

    async function setupShippingPage() {
        // Rebind estimator inputs (in case DOM was rebuilt)
        ['ship-value', 'ship-weight'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.removeEventListener('input', onEstimatorInputChange);
                el.removeEventListener('change', onEstimatorInputChange);
                el.addEventListener('input', onEstimatorInputChange);
                el.addEventListener('change', onEstimatorInputChange);
            }
        });
        ['ship-service'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.removeEventListener('change', onEstimatorInputChange);
                el.addEventListener('change', onEstimatorInputChange);
            }
        });
        var resEl = document.getElementById('ship-residential');
        if (resEl) {
            resEl.removeEventListener('change', onEstimatorInputChange);
            resEl.addEventListener('change', onEstimatorInputChange);
        }

        // Re-wrap submit if needed
        wrapSubmitShipLabel();

        // Load batch data and render
        await loadBatchData();
        renderBatchSelector();
        renderEstimator();
    }

    function render() {
        renderEstimator();
        loadBatchData().then(function() {
            renderBatchSelector();
        });
    }

    function cleanup() {
        ['ship-value', 'ship-weight', 'ship-service'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.removeEventListener('input', onEstimatorInputChange);
                el.removeEventListener('change', onEstimatorInputChange);
            }
        });
        var resEl = document.getElementById('ship-residential');
        if (resEl) resEl.removeEventListener('change', onEstimatorInputChange);

        var estimator = document.getElementById(ESTIMATOR_ID);
        if (estimator) estimator.remove();
        var batch = document.getElementById(BATCH_ID);
        if (batch) batch.remove();
        _batchSelected.clear();
        _batchWatches = [];
    }

    // Expose cost calculator for other modules
    window._ws5CalcCost = calcShippingCost;

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
