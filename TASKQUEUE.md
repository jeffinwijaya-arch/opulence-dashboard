# Opulence Dashboard Task Queue
> Any Claude session reads this, picks highest-priority unchecked task, does it, marks done, adds new tasks.

## Current State
- **17,868 lines** in index.html — full SPA with 15 pages
- **27K listings** across 564 refs, 8 brands, 1555 sellers, 74 WhatsApp groups
- **55 inventory items** with full P&L tracking
- **Data**: bundle.json (deals, arbitrage, refs, sellers), Flask API (inventory, portfolio, shipping, postings)
- **Pages**: Overview, Prices/Lookup, Portfolio, Deals & Arbitrage, Inventory, Postings, Shipping, Invoices, Payments, Photos, Aging, AD CRM, Mission Control, Operations (Jam)
- **Module system**: 10 independent JS files in public/modules/ for parallel development

## Priority: CRITICAL

All critical tasks completed 2026-04-10.

## Priority: HIGH

All high tasks completed 2026-04-10.

## Priority: MEDIUM

### WS5: Shipping (ws5-shipping.js)
- [x] Batch ship UX polish — fixed tab detection bug (CSS var inspection → _currentTab state), off-by-one on cells check, Select All now uses DOM checkboxes directly, toasts for empty/all-delivered/wrong-tab edge cases (2026-04-11)

### WS6: CRM (ws6-crm.js)
- [x] Referral tracking — "referred by" field on buyer records, track referral chains (2026-04-10)

### WS8: Mobile UX (ws8-mobile-ux.js)
- [x] Offline mode — localStorage-based cache for /api/smart_search + /api/deals; offline banner shown with timestamp (2026-04-10)
- [x] Keyboard shortcuts for desktop power users: `/` focus search, `d` deals, `p` lookup, `i` inventory, `n` add watch, `Esc` close modal, `?` cheat sheet (2026-04-10)

### WS9: Financial Reporting (ws9-reporting.js)
- [x] Tax export — CSV with cost basis + sale price + holding period per sold watch, year selector, preview summary (2026-04-10)
- [x] Monthly P&L summary — last 12 months table + bar chart on Portfolio page (2026-04-10)

### General
- [ ] Test all 10 modules on mobile Safari — fix any layout/interaction bugs
- [ ] Performance audit — measure module load time, optimize if >500ms
- [x] Add module error boundary — error boundaries already in module-loader.js: try/catch in _initOne() + renderAll(), failed-module Map, auto-retry after 5s, admin footer indicator (2026-04-11)

## Priority: LOW
- [ ] WS4: A/B caption testing — track view counts per caption style
- [x] WS7: Seasonal price patterns — 12-month calendar with buy/sell scores (0-100) for HK market, current-month strategy badge, live deal count + avg discount overlay; added to ws7-analytics.js section 6 (2026-04-11)
- [x] WS7: Price Seasonality (Real Data) — Section 7 in ws7-analytics.js: fetches /data/monthly_medians.json, shows actual % price deviations by calendar month per ref, ref/dial selector, canvas bar chart, buy month (cheapest) + sell month (most expensive) badges derived from real WhatsApp listing data (2026-04-11)
- [x] WS7: Currency impact dashboard — HKD/USD slider (6.50–8.50) shows per-ref arb profit & break-even FX rate, total pool delta vs baseline; added to ws7-analytics.js section 5 (2026-04-11)
- [x] WS9: Profit by channel analysis — Portfolio "By Channel" tab: groups sold watches by source (WhatsApp, Chrono24, eBay, Instagram, direct), canvas bar chart + table with profit, margin, revenue per channel (2026-04-11)
- [x] Multi-channel listing sync — Chrono24 XML feed generator in ws10-automation.js: fetches inventory, generates Chrono24-compatible XML (reference, brand, model, condition code, price, year, box/papers, location, description), downloadable .xml file + preview panel, missing-price/ref warnings (2026-04-11)
- [ ] WS10: Competition price tracking — monitor Chrono24 prices for key refs
- [x] Performance badges — ★ Top Supplier (5+ deals), ↓ Value Dealer (7%+ below market), ◈ Premium ($25k+ avg deal), ✓ Consistent, ⚡ Active (50+ WA listings); shown on Trusted Sellers card and inline on deal cards; competitive with Chrono24 dealer badge system (2026-04-11)

## COMPLETED (2026-04-14)
- [x] Mission Control > Claude Code: fix active sessions not showing — service worker at public/sw.js was serving `/api/*` via stale-while-revalidate, handing out 2-day-old cached session lists before the network response landed; frontend painted stale data. Excluded `/api/*` from SW caching entirely (Strategy 0 early-return), bumped CACHE_NAME to mk-shell-v7 so activate purges poisoned entries. Also sort active sessions first + by last_activity DESC in loadClaudeSessions() so recent turns surface at the top. (2026-04-14)
- [x] Mission Control > Claude Code: image attachments, voice input, voice output — added paperclip button (file picker, client-side downscale to 1600px / JPEG 0.85, base64 data URLs in `images` array on /send payload), mic button (Web Speech API dictation with pulsing red state), 🔊 header toggle (SpeechSynthesis TTS of assistant replies, persisted in localStorage, code-fence/URL stripping). Feature-detected so unsupported browsers hide the controls. Backend-side wiring lives in scripts/backend-ref/claude_code_send_images.py as a drop-in reference for whichever Flask app serves /api/mission-control/* (covers both Anthropic-SDK and Claude-CLI subprocess transports). (2026-04-14)

## COMPLETED (2026-04-11)
- [x] Performance badges — Top Seller/Power Dealer/Best Value/VIP Supplier in ws6-crm.js; computePerformanceBadges() from DATA.sellers; inline on deal cards (2026-04-11)
- [x] Price analyzer: rolex_dial_options.json expanded 268→404 refs (+136 new refs): Sub NoDate (124060/114060/14060M), Lady-DJ31 178xxx series (12 refs), DJ36 Oyster Rolesor (126201/203/204 + G/RBR), DJ41 126304 + G-suffix Oyster + Jubilee RBR, pre-2010 sports (16610/16613/16618/16710/16713/16718/16600 series), Sky-Dweller missing Rolesor (326930/932/933, 336930/932), GMT Sprite Rolesor (126718GRNR), DJ31/LDJ28 G-suffix sets, vintage DD36 18xxx, Rainbow Daytona (116595RBOW/126595RBOW) (2026-04-11)
- [x] WS5: Batch ship tab detection bug fixed (2026-04-11)
- [x] WS7: Seasonal Market Intelligence — section 6 (2026-04-11)
- [x] WS7: Price Seasonality (Real Data) — section 7 (2026-04-11)
- [x] WS9: Profit by Channel (2026-04-11)
- [x] Multi-channel: Chrono24 XML feed export (2026-04-11)
- [x] Price analyzer: rolex_dial_options.json expanded 184→268 refs — added 18 Lady-Datejust 26 (179xxx) base refs (entirely new segment), 9 Lady-DJ 26 G-suffix, 7 Lady-DJ 26 RBR, 5 Pearlmaster 29 (80xxx), 4 Pearlmaster 34 addl, Daytona Everose/WG prev-gen (116505/116515LN/116518/116528), Yacht-Master 37 (268621/268622/268648), Day-Date 36/40 G-suffix variants, Datejust 41 RBR current gen, Deepsea (116660/126660/126660JN), DJ36/40 Platinum refs (2026-04-11)
- [x] Performance badges on seller profiles — computePerformanceBadges() + renderBadgeChips() in ws6-crm.js (2026-04-11)

## COMPLETED (2026-04-10)
- [x] WS1: Deal scoring algorithm (0-100 composite score) — ws1-price-intel.js
- [x] WS1: Price confidence indicator (HIGH/MEDIUM/LOW) — ws1-price-intel.js
- [x] WS1: Price trend arrows (up/down/flat) — ws1-price-intel.js
- [x] WS2: Portfolio heat map (green/yellow/red squares) — ws2-inventory-pnl.js
- [x] WS2: Days-in-inventory aging bars — ws2-inventory-pnl.js
- [x] WS2: Unrealized P&L trend sparkline — ws2-inventory-pnl.js
- [x] WS3: Enhanced arbitrage calculator (real costs: $150+1.5%+$40+$35) — ws3-deal-flow.js
- [x] WS3: Snipe alert badges (>10% below b25, pulsing gold) — ws3-deal-flow.js
- [x] WS4: Auto-caption generator — ws4-posting.js
- [x] WS4: Smart price recommendation (competitive/market/premium) — ws4-posting.js
- [x] WS5: Shipping cost estimator — ws5-shipping.js
- [x] WS6: Buyer purchase history panel — ws6-crm.js
- [x] WS6: Seller reliability score — ws6-crm.js
- [x] WS6: Referral tracking — "referred by" input on watch detail, referral chain display, top-referrers card on CRM page (2026-04-10)
- [x] WS7: Brand market share donut chart — ws7-analytics.js
- [x] WS7: Top movers widget — ws7-analytics.js
- [x] WS7: HK vs US price gap chart — ws7-analytics.js
- [x] WS8: Quick-action floating button (FAB) — ws8-mobile-ux.js
- [x] WS8: Swipe-to-action on deal cards — ws8-mobile-ux.js
- [x] WS8: Offline cache — localStorage wraps /api/smart_search + /api/deals with timestamp banner (2026-04-10)
- [x] WS8: Desktop keyboard shortcuts — /, Cmd+K, d, p, i, n, Esc, ? with cheat sheet overlay (2026-04-10)
- [x] WS9: Weekly P&L summary card — ws9-reporting.js
- [x] WS9: Profit by ref analysis — ws9-reporting.js
- [x] WS9: Tax export CSV — year selector, cost basis + proceeds + holding period, TOTALS row (2026-04-10)
- [x] WS9: Monthly P&L — last 12 months table + canvas bar chart (2026-04-10)
- [x] WS10: Auto-price new watches — ws10-automation.js
- [x] WS10: Stale listing detector — ws10-automation.js
- [x] Price analyzer: Rolex dial options expanded 74→271 refs
- [x] Price analyzer: AP 18→56 refs, Patek 15→80 refs, RM 0→59 refs with dials
- [x] Price analyzer: FIXED_DIAL expanded 71→126 entries
- [x] Price analyzer: 13 new dealer shorthand patterns in extract_dial()
- [x] Price analyzer: Phone number extraction improved (33 seller mappings)
- [x] Price analyzer: Dial synonyms expanded to 30 entries
- [x] Price analyzer: rolex_dial_options.json expanded ~98→165 refs (2026-04-10)

## RULES FOR AGENTS
1. Pick ONE task from the highest unchecked priority level
2. Edit only the workstream's module file (ws1-price-intel.js, ws2-inventory-pnl.js, etc.)
3. Read the relevant index.html sections to understand existing DOM structure and data flow
4. Register module via window.MKModules.register(id, {init, render, cleanup})
5. Access data through window.DATA (refs, deals, arbitrage, portfolio, etc.)
6. After completing, mark [x] with date, push both code + updated TASKQUEUE.md
7. If you discover new tasks, add them at the right priority level
8. Check git log first — don't duplicate work another session just did
