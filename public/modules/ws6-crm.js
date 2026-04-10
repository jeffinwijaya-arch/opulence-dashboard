/**
 * MK Opulence — ws6-crm
 * Client Relationship Management: buyer history, seller reliability, recommendations.
 *
 * Available globals:
 *   window.DATA          — shared app data (refs, deals, portfolio, etc.)
 *   window.MKModules     — module system (emit, on, formatPrice, formatPct, inject, card)
 *   showToast(msg, type) — show notification
 *   showPage(name)       — navigate to page
 *
 * Rules:
 *   - Register via MKModules.register('ws6-crm', { init, render, cleanup })
 *   - Use MKModules.emit() / MKModules.on() for cross-module communication
 *   - Never use MutationObserver or setInterval for DOM updates
 *   - Use CSS variables for theming (--bg-0, --accent, --text-0, etc.)
 */

(function() {
    'use strict';

    const MOD_ID = 'ws6-crm';
    const fmt = window.MKModules.formatPrice;
    const fmtPct = window.MKModules.formatPct;

    // ── Inventory Cache ────────────────────────────────────────────
    let _inventoryCache = null;
    let _inventoryCacheTs = 0;
    const CACHE_TTL = 60000; // 1 minute

    async function getInventory() {
        const now = Date.now();
        if (_inventoryCache && (now - _inventoryCacheTs) < CACHE_TTL) {
            return _inventoryCache;
        }
        try {
            const r = await fetch('/api/inventory');
            if (!r.ok) return _inventoryCache || [];
            const data = await r.json();
            _inventoryCache = Array.isArray(data) ? data : (data.rows || data.items || []);
            _inventoryCacheTs = now;
            return _inventoryCache;
        } catch (e) {
            console.error('[ws6] Failed to fetch inventory:', e);
            return _inventoryCache || [];
        }
    }

    // ── Utility: parse price string to number ──────────────────────
    function parseNum(v) {
        if (v == null) return 0;
        var n = parseFloat(String(v).replace(/[$,]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    // ── Utility: extract brand from ref ────────────────────────────
    function extractBrand(item) {
        if (item.brand) return item.brand;
        var ref = (item.ref || '').toUpperCase();
        if (/^1[12]\d{4}/.test(ref) || /^(M1|M2|M7)/.test(ref)) return 'Rolex';
        if (/^26\d{3}/.test(ref) || /^15\d{3}/.test(ref)) return 'AP';
        if (/^5\d{3}/.test(ref) || /^(PP|PATEK)/i.test(ref)) return 'Patek';
        if (/^RM/i.test(ref)) return 'RM';
        if (/^(BB|MT|M79)/i.test(ref)) return 'Tudor';
        return item.description ? (item.description.split(' ')[0] || 'Unknown') : 'Unknown';
    }

    // ── Utility: extract ref family (first 6 chars or model group) ─
    function refFamily(ref) {
        if (!ref) return '';
        // Strip leading 'M' for Rolex model numbers
        var clean = ref.replace(/^M/i, '');
        // Take the first segment before any dash/space (e.g. 126610 from 126610LN)
        var match = clean.match(/^(\d{5,6})/);
        return match ? match[1] : ref.substring(0, 6);
    }

    // ═══════════════════════════════════════════════════════════════
    // 1. BUYER PURCHASE HISTORY
    // ═══════════════════════════════════════════════════════════════

    function getBuyerHistory(buyerName, inventory) {
        if (!buyerName || !inventory || !inventory.length) return null;
        var name = buyerName.toLowerCase().trim();
        var purchases = inventory.filter(function(w) {
            return w.sold_to && w.sold_to.toLowerCase().trim() === name;
        });
        if (!purchases.length) return null;

        var totalSpend = purchases.reduce(function(sum, w) {
            return sum + parseNum(w.sold_price || w.sale_price);
        }, 0);
        var avgPrice = purchases.length > 0 ? totalSpend / purchases.length : 0;
        var refs = purchases.map(function(w) { return w.ref; }).filter(Boolean);
        var brands = {};
        purchases.forEach(function(w) {
            var b = extractBrand(w);
            brands[b] = (brands[b] || 0) + 1;
        });

        // Sort by sale_date or buy_date descending
        purchases.sort(function(a, b) {
            return (b.sale_date || b.buy_date || '').localeCompare(a.sale_date || a.buy_date || '');
        });

        var lastPurchaseDate = purchases[0] ? (purchases[0].sale_date || purchases[0].buy_date || '') : '';

        return {
            buyerName: buyerName,
            totalWatches: purchases.length,
            totalSpend: totalSpend,
            avgPrice: avgPrice,
            refs: refs,
            brands: brands,
            lastPurchaseDate: lastPurchaseDate,
            purchases: purchases
        };
    }

    /** Aggregate all buyers and return sorted by total spend */
    function computeTopBuyers(inventory) {
        var soldItems = inventory.filter(function(w) {
            return w.sold_to && w.sold_to.trim();
        });
        var buyerMap = {};
        soldItems.forEach(function(w) {
            var key = w.sold_to.toLowerCase().trim();
            if (!buyerMap[key]) {
                buyerMap[key] = { name: w.sold_to.trim(), count: 0, totalSpend: 0, refs: [], lastDate: '' };
            }
            buyerMap[key].count += 1;
            buyerMap[key].totalSpend += parseNum(w.sold_price || w.sale_price);
            if (w.ref) buyerMap[key].refs.push(w.ref);
            var date = w.sale_date || w.buy_date || '';
            if (date > buyerMap[key].lastDate) buyerMap[key].lastDate = date;
        });

        return Object.values(buyerMap).sort(function(a, b) {
            return b.totalSpend - a.totalSpend;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. SELLER RELIABILITY SCORE (0-100)
    // ═══════════════════════════════════════════════════════════════

    function computeSellerScoresFromInventory(inventory) {
        var sellerMap = {};

        inventory.forEach(function(w) {
            var seller = w.bought_from;
            if (!seller || !seller.trim()) return;
            var key = seller.toLowerCase().trim();

            if (!sellerMap[key]) {
                sellerMap[key] = {
                    name: seller.trim(),
                    transactions: 0,
                    discounts: [],    // (market_value - cost_price) / market_value for each
                    costs: [],
                    markets: [],
                    dates: []
                };
            }
            sellerMap[key].transactions += 1;

            var cost = parseNum(w.cost_price);
            var market = parseNum(w.market_value);
            if (cost > 0) sellerMap[key].costs.push(cost);
            if (market > 0) sellerMap[key].markets.push(market);

            // Discount vs market: positive = bought below market
            if (cost > 0 && market > 0) {
                sellerMap[key].discounts.push((market - cost) / market);
            }

            var date = w.buy_date || '';
            if (date) sellerMap[key].dates.push(date);
        });

        var scores = {};

        Object.entries(sellerMap).forEach(function(entry) {
            var key = entry[0];
            var info = entry[1];

            // Transaction volume score (0-30 pts)
            // 1 tx = 5, 2 = 10, 3 = 15, 5+ = 25, 10+ = 30
            var txScore = Math.min(30, info.transactions * 5);
            if (info.transactions >= 10) txScore = 30;
            else if (info.transactions >= 5) txScore = 25;

            // Average discount score (0-40 pts)
            // If avg discount > 0 (bought below market), scale: 5% below = 20pts, 10%+ = 40pts
            var avgDiscount = 0;
            if (info.discounts.length > 0) {
                avgDiscount = info.discounts.reduce(function(s, d) { return s + d; }, 0) / info.discounts.length;
            }
            var discountScore = 0;
            if (avgDiscount > 0) {
                discountScore = Math.min(40, Math.round(avgDiscount * 400)); // 10% discount = 40pts
            } else if (avgDiscount >= -0.02) {
                discountScore = 15; // at market or tiny premium
            } else {
                discountScore = Math.max(0, 15 + Math.round(avgDiscount * 200)); // penalize premium
            }

            // Consistency score (0-30 pts)
            // Based on coefficient of variation of discount - lower is better
            var consistencyScore = 20; // default if single transaction
            if (info.discounts.length > 1) {
                var mean = info.discounts.reduce(function(s, d) { return s + d; }, 0) / info.discounts.length;
                var variance = info.discounts.reduce(function(s, d) { return s + Math.pow(d - mean, 2); }, 0) / info.discounts.length;
                var stddev = Math.sqrt(variance);
                var cv = mean !== 0 ? Math.abs(stddev / mean) : stddev;
                // Low CV = consistent: cv < 0.2 = 30pts, cv > 1.0 = 5pts
                if (cv < 0.2) consistencyScore = 30;
                else if (cv < 0.5) consistencyScore = 22;
                else if (cv < 1.0) consistencyScore = 12;
                else consistencyScore = 5;
            }

            var totalScore = Math.min(100, txScore + discountScore + consistencyScore);

            var tier, label, color;
            if (totalScore >= 75) {
                tier = 'trusted'; label = 'Trusted'; color = 'var(--green)';
            } else if (totalScore >= 45) {
                tier = 'active'; label = 'Reliable'; color = 'var(--accent)';
            } else {
                tier = 'new'; label = 'New'; color = 'var(--text-2)';
            }

            scores[key] = {
                name: info.name,
                score: totalScore,
                tier: tier,
                label: label,
                color: color,
                transactions: info.transactions,
                avgDiscount: avgDiscount,
                avgCost: info.costs.length ? info.costs.reduce(function(s, c) { return s + c; }, 0) / info.costs.length : 0,
                totalVolume: info.costs.reduce(function(s, c) { return s + c; }, 0),
                consistencyScore: consistencyScore
            };
        });

        // Also merge from window.DATA.sellers / deals (external seller data)
        var sellers = window.DATA && window.DATA.sellers;
        var deals = window.DATA && window.DATA.deals;

        if (sellers && typeof sellers === 'object') {
            Object.entries(sellers).forEach(function(entry) {
                var name = entry[0];
                var info = entry[1];
                var key = name.toLowerCase();
                if (scores[key]) return; // inventory-based score takes priority

                var listings = info.count || info.listings || info.total_listings || 0;
                var txScore = Math.min(30, listings >= 50 ? 30 : listings >= 10 ? 20 : listings * 2);
                var discountPct = info.avg_discount || info.avg_discount_vs_median || 0;
                var discountScore = Math.min(40, Math.max(0, Math.round(discountPct * 4)));
                var totalScore = Math.min(100, txScore + discountScore + 15);

                var tier, label, color;
                if (totalScore >= 75) { tier = 'trusted'; label = 'Trusted'; color = 'var(--green)'; }
                else if (totalScore >= 45) { tier = 'active'; label = 'Reliable'; color = 'var(--accent)'; }
                else { tier = 'new'; label = 'New'; color = 'var(--text-2)'; }

                scores[key] = {
                    name: name, score: totalScore, tier: tier, label: label, color: color,
                    transactions: listings, avgDiscount: discountPct / 100, avgCost: 0, totalVolume: 0,
                    consistencyScore: 15
                };
            });
        }

        if (deals && Array.isArray(deals)) {
            var dealSellerMap = {};
            deals.forEach(function(d) {
                if (!d.seller) return;
                var key = d.seller.toLowerCase();
                if (!dealSellerMap[key]) dealSellerMap[key] = { name: d.seller, listings: 0 };
                dealSellerMap[key].listings += (d.seller_listings || 1);
            });
            Object.entries(dealSellerMap).forEach(function(entry) {
                var key = entry[0];
                var info = entry[1];
                if (scores[key]) return;
                var listings = info.listings;
                var txScore = Math.min(30, listings >= 50 ? 30 : listings >= 10 ? 20 : listings * 2);
                var totalScore = Math.min(100, txScore + 15 + 15);
                var tier, label, color;
                if (totalScore >= 75) { tier = 'trusted'; label = 'Trusted'; color = 'var(--green)'; }
                else if (totalScore >= 45) { tier = 'active'; label = 'Reliable'; color = 'var(--accent)'; }
                else { tier = 'new'; label = 'New'; color = 'var(--text-2)'; }
                scores[key] = {
                    name: info.name, score: totalScore, tier: tier, label: label, color: color,
                    transactions: listings, avgDiscount: 0, avgCost: 0, totalVolume: 0, consistencyScore: 15
                };
            });
        }

        return scores;
    }

    let _sellerScores = {};

    function getSellerBadgeHTML(sellerName) {
        if (!sellerName) return '';
        var key = sellerName.toLowerCase();
        var score = _sellerScores[key];
        if (!score) return '';
        return '<span class="ws6-seller-badge" style="display:inline-block;font-size:0.58rem;font-weight:700;padding:2px 6px;border-radius:3px;border:1px solid ' + score.color + ';color:' + score.color + ';text-transform:uppercase;letter-spacing:0.3px;margin-left:4px;vertical-align:middle;line-height:1.4;min-width:48px;text-align:center;box-sizing:border-box;" title="Score: ' + score.score + '/100 | ' + score.transactions + ' transactions">' + score.label + '</span>';
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. BUYER RECOMMENDATION ENGINE
    // ═══════════════════════════════════════════════════════════════

    function getRecommendations(buyerName, inventory) {
        if (!buyerName || !inventory || !inventory.length) return [];
        var history = getBuyerHistory(buyerName, inventory);
        if (!history || history.purchases.length === 0) return [];

        // Collect brands and ref families the buyer has purchased
        var boughtBrands = {};
        var boughtFamilies = {};
        var boughtRefs = {};

        history.purchases.forEach(function(w) {
            var brand = extractBrand(w);
            boughtBrands[brand] = (boughtBrands[brand] || 0) + 1;
            var fam = refFamily(w.ref);
            if (fam) boughtFamilies[fam] = (boughtFamilies[fam] || 0) + 1;
            if (w.ref) boughtRefs[w.ref.toLowerCase()] = true;
        });

        // Average price range the buyer typically pays
        var avgPrice = history.avgPrice;
        var priceMin = avgPrice * 0.6;
        var priceMax = avgPrice * 1.5;

        // Find unsold watches that match buyer's preferences
        var candidates = inventory.filter(function(w) {
            // Must be unsold and available
            if (w.sold === 'Yes' || w.sold_to) return false;

            // Don't recommend what they already bought (same exact ref they own)
            // But do recommend same ref family (they may want another)

            var brand = extractBrand(w);
            var fam = refFamily(w.ref);
            var price = parseNum(w.sale_price || w.cost_price);

            // Score this candidate
            var matchScore = 0;

            // Brand match (strongest signal)
            if (boughtBrands[brand]) matchScore += boughtBrands[brand] * 3;

            // Ref family match (very strong signal - same model line)
            if (fam && boughtFamilies[fam]) matchScore += boughtFamilies[fam] * 5;

            // Price range match
            if (price > 0 && price >= priceMin && price <= priceMax) matchScore += 2;

            w._recScore = matchScore;
            return matchScore > 0;
        });

        // Sort by recommendation score descending
        candidates.sort(function(a, b) { return (b._recScore || 0) - (a._recScore || 0); });

        return candidates.slice(0, 5).map(function(w) {
            var price = parseNum(w.sale_price || w.cost_price);
            var brand = extractBrand(w);
            var fam = refFamily(w.ref);
            var reasons = [];
            if (fam && boughtFamilies[fam]) reasons.push('Same model line');
            else if (boughtBrands[brand]) reasons.push('Loves ' + brand);
            if (price > 0 && price >= priceMin && price <= priceMax) reasons.push('Price range fit');
            return {
                ref: w.ref,
                dial: w.dial || '',
                bracelet: w.bracelet || '',
                price: price,
                brand: brand,
                reason: reasons.join(', ') || 'Similar taste',
                row: w.row,
                _recScore: w._recScore
            };
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // REFERRAL TRACKING (localStorage-based)
    // ═══════════════════════════════════════════════════════════════

    var REFERRAL_KEY = 'mk_referrals';

    function loadReferrals() {
        try { var raw = localStorage.getItem(REFERRAL_KEY); return raw ? JSON.parse(raw) : {}; }
        catch (e) { return {}; }
    }

    function saveReferrals(map) {
        try { localStorage.setItem(REFERRAL_KEY, JSON.stringify(map)); } catch (e) {}
    }

    function setReferral(buyerName, referrerName) {
        if (!buyerName) return;
        var map = loadReferrals();
        if (referrerName && referrerName.trim()) {
            map[buyerName.toLowerCase().trim()] = referrerName.trim();
        } else {
            delete map[buyerName.toLowerCase().trim()];
        }
        saveReferrals(map);
    }

    function getReferral(buyerName) {
        if (!buyerName) return '';
        var map = loadReferrals();
        return map[buyerName.toLowerCase().trim()] || '';
    }

    function getReferralChain(buyerName) {
        var chain = [];
        var seen = {};
        var current = buyerName;
        var map = loadReferrals();
        while (current) {
            var key = current.toLowerCase().trim();
            if (seen[key]) break;
            seen[key] = true;
            var referrer = map[key];
            if (referrer) { chain.push(referrer); current = referrer; }
            else break;
        }
        return chain;
    }

    function computeTopReferrers(inventory) {
        var map = loadReferrals();
        var referrerStats = {};
        Object.entries(map).forEach(function(entry) {
            var buyerKey = entry[0];
            var referrer = entry[1];
            var refKey = referrer.toLowerCase().trim();
            if (!referrerStats[refKey]) {
                referrerStats[refKey] = { name: referrer, count: 0, totalValue: 0, buyers: [] };
            }
            referrerStats[refKey].count += 1;
            referrerStats[refKey].buyers.push(buyerKey);
            if (inventory && inventory.length) {
                inventory.forEach(function(w) {
                    if (w.sold_to && w.sold_to.toLowerCase().trim() === buyerKey) {
                        var price = parseNum(w.sold_price || w.sale_price);
                        if (price > 0) referrerStats[refKey].totalValue += price;
                    }
                });
            }
        });
        return Object.values(referrerStats).sort(function(a, b) { return b.count - a.count; });
    }

    // ═══════════════════════════════════════════════════════════════
    // DASHBOARD WIDGETS
    // ═══════════════════════════════════════════════════════════════

    /** Render "Top Buyers" card on the Dashboard page */
    function renderTopBuyersCard(inventory) {
        var old = document.getElementById('ws6-top-buyers');
        if (old) old.remove();

        var topBuyers = computeTopBuyers(inventory);
        if (!topBuyers.length) return;

        var dashPage = document.getElementById('page-dashboard');
        if (!dashPage) return;

        var rows = topBuyers.slice(0, 8).map(function(b, idx) {
            // Favorite refs: count occurrences, show top 2
            var refCounts = {};
            b.refs.forEach(function(r) { refCounts[r] = (refCounts[r] || 0) + 1; });
            var topRefs = Object.entries(refCounts)
                .sort(function(a, b) { return b[1] - a[1]; })
                .slice(0, 2)
                .map(function(e) { return e[0]; })
                .join(', ');

            var dateStr = b.lastDate ? b.lastDate.substring(0, 10) : '--';

            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;' + (idx < topBuyers.slice(0, 8).length - 1 ? 'border-bottom:1px solid var(--border);' : '') + '">'
                + '<span style="font-size:0.72rem;font-weight:700;color:var(--text-3);min-width:18px;">' + (idx + 1) + '</span>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:0.78rem;font-weight:600;color:var(--text-0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + b.name + '</div>'
                + '<div style="font-size:0.62rem;color:var(--text-2);">' + b.count + ' watch' + (b.count !== 1 ? 'es' : '')
                + (topRefs ? ' -- ' + topRefs : '') + '</div>'
                + '</div>'
                + '<div style="text-align:right;">'
                + '<div style="font-family:var(--mono);font-size:0.78rem;font-weight:700;color:var(--green);">' + fmt(b.totalSpend) + '</div>'
                + '<div style="font-size:0.58rem;color:var(--text-3);">' + dateStr + '</div>'
                + '</div>'
                + '</div>';
        }).join('');

        var totalRevenue = topBuyers.reduce(function(s, b) { return s + b.totalSpend; }, 0);
        var totalTx = topBuyers.reduce(function(s, b) { return s + b.count; }, 0);

        var card = document.createElement('div');
        card.id = 'ws6-top-buyers';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>Top Buyers</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + totalTx + ' sales -- ' + fmt(totalRevenue) + '</span></div>'
            + '<div style="padding:8px 14px;">' + rows + '</div>';

        // Insert after the Action Items / Portfolio row (grid with 2 cols)
        var activityFeed = document.getElementById('activity-feed');
        var insertTarget = activityFeed ? activityFeed.closest('.card') : null;
        if (insertTarget) {
            insertTarget.parentElement.insertBefore(card, insertTarget);
        } else {
            // Fallback: insert before Industry News
            var newsFeed = document.getElementById('news-feed');
            var newsCard = newsFeed ? newsFeed.closest('.card') : null;
            if (newsCard) {
                newsCard.parentElement.insertBefore(card, newsCard);
            }
        }
    }

    /** Render "Trusted Sellers" widget on the Dashboard page */
    function renderTrustedSellersCard(inventory) {
        var old = document.getElementById('ws6-trusted-sellers');
        if (old) old.remove();

        var scoreEntries = Object.values(_sellerScores)
            .filter(function(s) { return s.transactions > 0; })
            .sort(function(a, b) { return b.score - a.score; });

        if (!scoreEntries.length) return;

        var dashPage = document.getElementById('page-dashboard');
        if (!dashPage) return;

        var rows = scoreEntries.slice(0, 8).map(function(s, idx) {
            // Score bar
            var barColor = s.score >= 75 ? 'var(--green)' : s.score >= 45 ? 'var(--accent)' : 'var(--text-3)';
            var discountStr = s.avgDiscount > 0
                ? '<span style="color:var(--green);">-' + (s.avgDiscount * 100).toFixed(1) + '%</span>'
                : s.avgDiscount < -0.005
                    ? '<span style="color:var(--red);">+' + (Math.abs(s.avgDiscount) * 100).toFixed(1) + '%</span>'
                    : '<span style="color:var(--text-2);">at market</span>';

            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;' + (idx < scoreEntries.slice(0, 8).length - 1 ? 'border-bottom:1px solid var(--border);' : '') + '">'
                + '<div style="min-width:32px;text-align:center;">'
                + '<div style="font-family:var(--mono);font-size:0.85rem;font-weight:700;color:' + barColor + ';">' + s.score + '</div>'
                + '</div>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:0.78rem;font-weight:600;color:var(--text-0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + s.name + '</div>'
                + '<div style="font-size:0.62rem;color:var(--text-2);">' + s.transactions + ' tx' + (s.transactions !== 1 ? 's' : '') + ' -- ' + discountStr + ' vs market</div>'
                + '</div>'
                + '<div style="width:60px;">'
                + '<div style="height:4px;background:var(--bg-3);border-radius:2px;overflow:hidden;">'
                + '<div style="height:100%;width:' + s.score + '%;background:' + barColor + ';border-radius:2px;"></div>'
                + '</div>'
                + '</div>'
                + '</div>';
        }).join('');

        var card = document.createElement('div');
        card.id = 'ws6-trusted-sellers';
        card.className = 'card';
        card.style.marginTop = '8px';
        card.innerHTML = '<div class="card-head"><span>Trusted Sellers</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">Reliability 0-100</span></div>'
            + '<div style="padding:8px 14px;">' + rows + '</div>';

        // Insert right after Top Buyers card (or same location)
        var buyersCard = document.getElementById('ws6-top-buyers');
        if (buyersCard) {
            buyersCard.parentElement.insertBefore(card, buyersCard.nextSibling);
        } else {
            var activityFeed = document.getElementById('activity-feed');
            var insertTarget = activityFeed ? activityFeed.closest('.card') : null;
            if (insertTarget) {
                insertTarget.parentElement.insertBefore(card, insertTarget);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // WATCH DETAIL PANELS
    // ═══════════════════════════════════════════════════════════════

    var HISTORY_PANEL_ID = 'ws6-buyer-history';
    var RECS_PANEL_ID = 'ws6-recommendations';

    /** Render buyer history panel in watch detail overlay */
    function renderBuyerHistoryPanel(history) {
        var panel = document.getElementById(HISTORY_PANEL_ID);
        if (panel) panel.remove();

        if (!history) return;

        panel = document.createElement('div');
        panel.id = HISTORY_PANEL_ID;
        panel.style.cssText = 'margin-top:12px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);overflow:hidden;';

        var refCounts = {};
        history.refs.forEach(function(r) { refCounts[r] = (refCounts[r] || 0) + 1; });
        var topRefs = Object.entries(refCounts)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, 8)
            .map(function(e) {
                return '<span style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:0.68rem;font-family:var(--mono);color:var(--text-1);">' + e[0] + (e[1] > 1 ? ' x' + e[1] : '') + '</span>';
            })
            .join(' ');

        var purchaseRows = history.purchases.slice(0, 5).map(function(w) {
            var price = parseNum(w.sold_price || w.sale_price);
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.72rem;border-bottom:1px solid var(--border);">'
                + '<span style="color:var(--text-1);">' + (w.ref || '?') + ' <span style="color:var(--text-3);">' + (w.dial || '') + '</span></span>'
                + '<span style="font-family:var(--mono);color:var(--text-0);">' + fmt(price) + '</span>'
                + '</div>';
        }).join('');

        panel.innerHTML = '<div style="padding:10px 14px;background:var(--bg-2);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'.ws6-arrow\').textContent=this.nextElementSibling.style.display===\'none\'?\'+\':\'-\'">'
            + '<div>'
            + '<span style="font-size:0.72rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">Buyer History</span>'
            + '<span style="font-size:0.72rem;color:var(--text-2);margin-left:8px;">' + history.buyerName + ' -- ' + history.totalWatches + ' purchase' + (history.totalWatches !== 1 ? 's' : '') + '</span>'
            + '</div>'
            + '<span class="ws6-arrow" style="color:var(--text-2);font-size:1rem;font-weight:700;">+</span>'
            + '</div>'
            + '<div style="display:none;padding:12px 14px;">'
            + '<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:10px;">'
            + '<div style="background:var(--bg-3);border-radius:var(--radius);padding:8px;text-align:center;">'
            + '<div style="font-size:1.1rem;font-weight:700;color:var(--text-0);">' + history.totalWatches + '</div>'
            + '<div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;">Watches</div></div>'
            + '<div style="background:var(--bg-3);border-radius:var(--radius);padding:8px;text-align:center;">'
            + '<div style="font-size:1.1rem;font-weight:700;color:var(--green);">' + fmt(history.totalSpend) + '</div>'
            + '<div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;">Total Spend</div></div>'
            + '<div style="background:var(--bg-3);border-radius:var(--radius);padding:8px;text-align:center;">'
            + '<div style="font-size:1.1rem;font-weight:700;color:var(--accent);">' + fmt(history.avgPrice) + '</div>'
            + '<div style="font-size:0.62rem;color:var(--text-2);text-transform:uppercase;">Avg Price</div></div>'
            + '</div>'
            + '<div style="margin-bottom:8px;">'
            + '<div style="font-size:0.65rem;color:var(--text-2);text-transform:uppercase;margin-bottom:4px;">Refs Purchased</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + (topRefs || '<span style="color:var(--text-3);font-size:0.7rem;">None</span>') + '</div>'
            + '</div>'
            + '<div>'
            + '<div style="font-size:0.65rem;color:var(--text-2);text-transform:uppercase;margin-bottom:4px;">Recent Purchases</div>'
            + (purchaseRows || '<div style="color:var(--text-3);font-size:0.7rem;">No purchase data</div>')
            + (history.purchases.length > 5 ? '<div style="font-size:0.62rem;color:var(--text-3);margin-top:4px;">+ ' + (history.purchases.length - 5) + ' more</div>' : '')
            + '</div>'
            + '</div>';

        // Insert into the watch-detail-overlay
        var overlay = document.getElementById('watch-detail-overlay');
        if (overlay) {
            var invoiceSection = document.getElementById('wd-invoice-section');
            if (invoiceSection) {
                invoiceSection.parentElement.insertBefore(panel, invoiceSection.nextSibling);
            } else {
                var content = overlay.querySelector('div > div:last-child');
                if (content) content.parentElement.insertBefore(panel, content);
            }
        }
    }

    /** Render recommendation panel in watch detail overlay */
    function renderRecommendationsPanel(buyerName, inventory) {
        var old = document.getElementById(RECS_PANEL_ID);
        if (old) old.remove();

        var recs = getRecommendations(buyerName, inventory);
        if (!recs.length) return;

        var panel = document.createElement('div');
        panel.id = RECS_PANEL_ID;
        panel.style.cssText = 'margin-top:8px;border:1px solid var(--border);border-left:3px solid var(--green);border-radius:var(--radius);overflow:hidden;';

        var recRows = recs.map(function(r) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;" ' + (r.row ? 'onclick="showWatchDetail(' + r.row + ')"' : '') + '>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:0.75rem;font-weight:600;color:var(--accent);">' + r.ref + ' <span style="color:var(--text-2);font-weight:400;">' + r.dial + '</span></div>'
                + '<div style="font-size:0.6rem;color:var(--text-3);">' + r.reason + '</div>'
                + '</div>'
                + '<span style="font-family:var(--mono);font-size:0.75rem;font-weight:600;color:var(--text-0);">' + (r.price > 0 ? fmt(r.price) : '--') + '</span>'
                + '</div>';
        }).join('');

        panel.innerHTML = '<div style="padding:10px 14px;background:var(--bg-2);cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'.ws6-arrow\').textContent=this.nextElementSibling.style.display===\'none\'?\'+\':\'-\'">'
            + '<div>'
            + '<span style="font-size:0.72rem;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:0.5px;">Might Also Like</span>'
            + '<span style="font-size:0.72rem;color:var(--text-2);margin-left:8px;">' + recs.length + ' suggestion' + (recs.length !== 1 ? 's' : '') + '</span>'
            + '</div>'
            + '<span class="ws6-arrow" style="color:var(--text-2);font-size:1rem;font-weight:700;">+</span>'
            + '</div>'
            + '<div style="display:none;padding:10px 14px;">' + recRows + '</div>';

        // Insert after buyer history panel or after referral input
        var historyPanel = document.getElementById(HISTORY_PANEL_ID);
        var referralInput = document.getElementById('ws6-referral-input');
        var insertAfter = referralInput || historyPanel;
        if (insertAfter) {
            insertAfter.parentElement.insertBefore(panel, insertAfter.nextSibling);
        } else {
            var overlay = document.getElementById('watch-detail-overlay');
            if (overlay) {
                var invoiceSection = document.getElementById('wd-invoice-section');
                if (invoiceSection) invoiceSection.parentElement.insertBefore(panel, invoiceSection.nextSibling);
            }
        }
    }

    /** Render referral input on watch detail */
    function renderReferralInput(buyerName) {
        var existing = document.getElementById('ws6-referral-input');
        if (existing) existing.remove();
        if (!buyerName) return;

        var overlay = document.getElementById('watch-detail-overlay');
        if (!overlay) return;

        var currentReferrer = getReferral(buyerName);
        var chain = getReferralChain(buyerName);

        var chainHtml = '';
        if (chain.length > 0) {
            chainHtml = '<div style="margin-top:4px;font-size:0.65rem;color:var(--text-2);">'
                + 'Chain: ' + buyerName + ' <span style="color:var(--text-3);">&larr;</span> '
                + chain.map(function(r) { return '<span style="color:var(--accent);">' + r + '</span>'; }).join(' <span style="color:var(--text-3);">&larr;</span> ')
                + '</div>';
        }

        var allBuyers = [];
        if (_inventoryCache && _inventoryCache.length) {
            var seen = {};
            _inventoryCache.forEach(function(w) {
                if (w.sold_to && !seen[w.sold_to.toLowerCase()]) {
                    seen[w.sold_to.toLowerCase()] = true;
                    allBuyers.push(w.sold_to);
                }
            });
            allBuyers.sort();
        }

        var datalistOpts = allBuyers.map(function(b) {
            return '<option value="' + b.replace(/"/g, '&quot;') + '">';
        }).join('');

        var wrapper = document.createElement('div');
        wrapper.id = 'ws6-referral-input';
        wrapper.style.cssText = 'margin-top:8px;padding:8px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);';
        wrapper.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
            + '<span style="font-size:0.72rem;color:var(--text-2);white-space:nowrap;">Referred by:</span>'
            + '<input list="ws6-referrer-list" id="ws6-referrer-value" class="input" value="' + (currentReferrer || '').replace(/"/g, '&quot;') + '" placeholder="Enter referrer name..." style="flex:1;font-size:0.75rem;padding:4px 8px;height:28px;">'
            + '<datalist id="ws6-referrer-list">' + datalistOpts + '</datalist>'
            + '<button class="btn" id="ws6-save-referral" style="font-size:0.68rem;padding:4px 10px;height:28px;">Save</button>'
            + '</div>'
            + chainHtml;

        var historyPanel = document.getElementById(HISTORY_PANEL_ID);
        var invoiceSection = document.getElementById('wd-invoice-section');
        var insertTarget = historyPanel || invoiceSection;
        if (insertTarget) {
            insertTarget.parentElement.insertBefore(wrapper, insertTarget.nextSibling);
        } else {
            var content = overlay.querySelector('div > div');
            if (content) {
                var buttons = content.querySelector('div:last-child');
                if (buttons) content.insertBefore(wrapper, buttons);
            }
        }

        var saveBtn = document.getElementById('ws6-save-referral');
        var input = document.getElementById('ws6-referrer-value');
        if (saveBtn && input) {
            saveBtn.onclick = function() {
                setReferral(buyerName, input.value);
                if (typeof showToast === 'function') {
                    showToast(input.value ? 'Referral saved: ' + buyerName + ' <- ' + input.value : 'Referral cleared', 'ok');
                }
                renderReferralInput(buyerName);
            };
            input.onkeydown = function(e) { if (e.key === 'Enter') saveBtn.click(); };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // TOP REFERRERS CARD (CRM page)
    // ═══════════════════════════════════════════════════════════════

    function renderTopReferrersCard(inventory) {
        var old = document.getElementById('ws6-top-referrers');
        if (old) old.remove();

        var topReferrers = computeTopReferrers(inventory);
        if (!topReferrers.length) return;

        var crmPage = document.getElementById('page-ad-crm');
        if (!crmPage) return;

        var rows = topReferrers.slice(0, 10).map(function(r, idx) {
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">'
                + '<span style="font-size:0.72rem;font-weight:700;color:var(--text-2);min-width:20px;">' + (idx + 1) + '</span>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:0.78rem;font-weight:600;color:var(--text-0);">' + r.name + '</div>'
                + '<div style="font-size:0.65rem;color:var(--text-2);">' + r.count + ' referral' + (r.count !== 1 ? 's' : '') + ' -- ' + r.buyers.join(', ') + '</div>'
                + '</div>'
                + '<span style="font-family:var(--mono);font-size:0.78rem;font-weight:700;color:var(--green);">' + fmt(r.totalValue) + '</span>'
                + '</div>';
        }).join('');

        var totalReferred = topReferrers.reduce(function(s, r) { return s + r.count; }, 0);
        var totalValue = topReferrers.reduce(function(s, r) { return s + r.totalValue; }, 0);

        var card = document.createElement('div');
        card.id = 'ws6-top-referrers';
        card.className = 'card';
        card.style.marginTop = '12px';
        card.innerHTML = '<div class="card-head"><span>Top Referrers</span>'
            + '<span style="font-size:0.6rem;color:var(--text-2);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;">'
            + totalReferred + ' referrals -- ' + fmt(totalValue) + ' total value</span></div>'
            + '<div style="padding:8px 14px;">' + rows + '</div>';

        var pageHead = crmPage.querySelector('.page-head');
        if (pageHead) {
            pageHead.parentElement.insertBefore(card, pageHead.nextSibling);
        } else {
            crmPage.insertBefore(card, crmPage.firstChild);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SELLER BADGE INJECTION (deal cards)
    // ═══════════════════════════════════════════════════════════════

    function injectSellerBadges() {
        if (!Object.keys(_sellerScores).length) return;

        var dealCards = document.querySelectorAll('.deal-card');
        dealCards.forEach(function(card) {
            if (card.querySelector('.ws6-seller-badge')) return;
            var bottomRow = card.querySelector('div:last-child span:first-child');
            if (!bottomRow) return;
            var text = bottomRow.textContent || '';
            var match = text.match(/(?:WA\s+)?([^(|]+?)\s*\(\d+\)/);
            if (!match) return;
            var sellerName = match[1].trim();
            var badge = getSellerBadgeHTML(sellerName);
            if (!badge) return;
            var waLink = bottomRow.querySelector('a');
            if (waLink) { waLink.insertAdjacentHTML('afterend', badge); }
            else {
                var currentHTML = bottomRow.innerHTML;
                var sellerPattern = sellerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                var regex = new RegExp('(' + sellerPattern + ')');
                if (regex.test(currentHTML)) {
                    bottomRow.innerHTML = currentHTML.replace(regex, '$1' + badge);
                }
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // HOOKS INTO EXISTING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function hookWatchDetail() {
        var origShowWatchDetail = window.showWatchDetail;
        if (!origShowWatchDetail || origShowWatchDetail._ws6Hooked) return;

        window.showWatchDetail = async function(row) {
            origShowWatchDetail.call(this, row);

            await new Promise(function(resolve) { setTimeout(resolve, 50); });

            // Show skeleton placeholder while buyer history loads
            var overlay = document.getElementById('watch-detail-overlay');
            if (overlay) {
                var existingPanel = document.getElementById(HISTORY_PANEL_ID);
                if (!existingPanel) {
                    var skeleton = document.createElement('div');
                    skeleton.id = HISTORY_PANEL_ID;
                    skeleton.style.cssText = 'margin-top:12px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius);overflow:hidden;padding:14px;';
                    skeleton.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
                        + '<div style="width:100px;height:12px;background:var(--bg-3);border-radius:4px;animation:pulse 1.5s ease-in-out infinite;"></div>'
                        + '<div style="width:60px;height:12px;background:var(--bg-3);border-radius:4px;animation:pulse 1.5s ease-in-out infinite;animation-delay:0.2s;"></div>'
                        + '</div>'
                        + '<style>@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}</style>';
                    var invoiceSection = document.getElementById('wd-invoice-section');
                    if (invoiceSection) {
                        invoiceSection.parentElement.insertBefore(skeleton, invoiceSection.nextSibling);
                    }
                }
            }

            var item = null;
            if (typeof row === 'object') {
                item = row;
            } else {
                if (window.inventoryItems) item = window.inventoryItems.find(function(i) { return i.row === row || i.id === row; });
                if (!item && typeof window.invMgmtData !== 'undefined' && window.invMgmtData) {
                    item = window.invMgmtData.find(function(i) { return i.row === row || i.id === row; });
                }
            }

            if (item && item.sold_to) {
                var inventory = await getInventory();
                var history = getBuyerHistory(item.sold_to, inventory);
                if (history) renderBuyerHistoryPanel(history);
                renderReferralInput(item.sold_to);
                renderRecommendationsPanel(item.sold_to, inventory);
            }
        };
        window.showWatchDetail._ws6Hooked = true;
    }

    function hookDealRendering() {
        var origRenderDeals = window.renderDeals;
        if (!origRenderDeals || origRenderDeals._ws6Hooked) return;
        window.renderDeals = function() {
            origRenderDeals.apply(this, arguments);
            setTimeout(function() { injectSellerBadges(); }, 100);
        };
        window.renderDeals._ws6Hooked = true;
    }

    function hookDealDetail() {
        var origShowDealDetail = window.showDealDetail;
        if (!origShowDealDetail || origShowDealDetail._ws6Hooked) return;
        window.showDealDetail = function(idx) {
            origShowDealDetail.apply(this, arguments);
            setTimeout(function() {
                var panel = document.getElementById('deals-detail') || document.querySelector('#deals-detail');
                if (!panel) return;
                var sellerCells = panel.querySelectorAll('td:nth-child(2)');
                sellerCells.forEach(function(cell) {
                    if (cell.querySelector('.ws6-seller-badge')) return;
                    var name = (cell.textContent || '').trim();
                    if (!name) return;
                    var badge = getSellerBadgeHTML(name);
                    if (badge) cell.insertAdjacentHTML('beforeend', badge);
                });
            }, 100);
        };
        window.showDealDetail._ws6Hooked = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // MODULE LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    async function init() {
        console.log('[' + MOD_ID + '] Initializing...');

        // Fetch inventory for seller score computation
        var inventory = await getInventory();

        // Compute seller scores from inventory data
        _sellerScores = computeSellerScoresFromInventory(inventory);
        console.log('[' + MOD_ID + '] Computed scores for ' + Object.keys(_sellerScores).length + ' sellers');

        // Hook into watch detail overlay
        hookWatchDetail();

        // Hook into deal card rendering
        hookDealRendering();
        hookDealDetail();

        // Listen for mk:watch-sold events
        window.MKModules.on('watch-sold', async function(e) {
            console.log('[' + MOD_ID + '] Watch sold event received', e.detail);
            // Invalidate cache and re-render
            _inventoryCacheTs = 0;
            var inv = await getInventory();
            _sellerScores = computeSellerScoresFromInventory(inv);
            render();
        });

        // Initial badge injection if deals are already rendered
        setTimeout(function() { injectSellerBadges(); }, 500);
    }

    async function render() {
        // Recompute seller scores
        var inventory = await getInventory();
        _sellerScores = computeSellerScoresFromInventory(inventory);

        // Re-inject deal badges
        setTimeout(function() { injectSellerBadges(); }, 200);

        // Dashboard page: inject Top Buyers + Trusted Sellers cards
        var dashPage = document.getElementById('page-dashboard');
        if (dashPage && dashPage.classList.contains('active')) {
            renderTopBuyersCard(inventory);
            renderTrustedSellersCard(inventory);
        }

        // CRM page: render Top Referrers card
        var crmPage = document.getElementById('page-ad-crm');
        if (crmPage && crmPage.offsetParent !== null) {
            renderTopReferrersCard(inventory);
        }
    }

    function cleanup() {
        var panel = document.getElementById(HISTORY_PANEL_ID);
        if (panel) panel.remove();
        var recs = document.getElementById(RECS_PANEL_ID);
        if (recs) recs.remove();
        var buyers = document.getElementById('ws6-top-buyers');
        if (buyers) buyers.remove();
        var sellers = document.getElementById('ws6-trusted-sellers');
        if (sellers) sellers.remove();
        var referrers = document.getElementById('ws6-top-referrers');
        if (referrers) referrers.remove();
        var referralInput = document.getElementById('ws6-referral-input');
        if (referralInput) referralInput.remove();
        document.querySelectorAll('.ws6-seller-badge').forEach(function(el) { el.remove(); });
        _inventoryCache = null;
    }

    // Expose for other modules
    window._ws6GetBuyerHistory = async function(buyerName) {
        var inv = await getInventory();
        return getBuyerHistory(buyerName, inv);
    };
    window._ws6GetSellerScore = function(sellerName) {
        if (!sellerName) return null;
        return _sellerScores[sellerName.toLowerCase()] || null;
    };
    window._ws6GetRecommendations = async function(buyerName) {
        var inv = await getInventory();
        return getRecommendations(buyerName, inv);
    };

    // Register with the module system
    window.MKModules.register(MOD_ID, { init: init, render: render, cleanup: cleanup });

})();
