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
- [ ] Batch ship UX polish — test the checkbox selector end-to-end, handle edge cases (no packages, all shipped)

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
- [ ] WS7: Seasonal price patterns — monthly average prices per ref to identify buy/sell windows
- [x] WS7: Currency impact dashboard — HKD/USD slider (6.50–8.50) shows per-ref arb profit & break-even FX rate, total pool delta vs baseline; added to ws7-analytics.js section 5 (2026-04-11)
- [ ] WS9: Profit by channel analysis (WhatsApp groups, Instagram, direct)
- [ ] WS10: Competition price tracking — monitor Chrono24 prices for key refs
- [ ] Multi-channel listing sync — generate Chrono24-compatible XML feed from inventory (competitive with WatchTraderHub)
- [ ] Performance badges — Fast Shipper, Top Seller badges on seller profiles (competitive with Chrono24)

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
- [x] Price analyzer: rolex_dial_options.json expanded ~98→165 refs; added 69 prev-gen refs (116xxx, 118xxx, 326xxx, 114xxx, 50xxx) covering Submariner/GMT/Day-Date/Datejust/Daytona/Milgauss/Cellini/Explorer/YM/YM-II/Sky-Dweller prev-gen (2026-04-10)

## RULES FOR AGENTS
1. Pick ONE task from the highest unchecked priority level
2. Edit only the workstream's module file (ws1-price-intel.js, ws2-inventory-pnl.js, etc.)
3. Read the relevant index.html sections to understand existing DOM structure and data flow
4. Register module via window.MKModules.register(id, {init, render, cleanup})
5. Access data through window.DATA (refs, deals, arbitrage, portfolio, etc.)
6. After completing, mark [x] with date, push both code + updated TASKQUEUE.md
7. If you discover new tasks, add them at the right priority level
8. Check git log first — don't duplicate work another session just did
