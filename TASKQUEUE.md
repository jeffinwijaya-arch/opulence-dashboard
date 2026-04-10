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
- [ ] Referral tracking — "referred by" field on buyer records, track referral chains

### WS8: Mobile UX (ws8-mobile-ux.js)
- [ ] Offline mode — cache last lookup results + deals in service worker for subway use
- [ ] Keyboard shortcuts for desktop power users (/ to search, n for new watch, s for sell)

### WS9: Financial Reporting (ws9-reporting.js)
- [ ] Tax export — generate CSV of all sold watches with cost basis + proceeds for accountant
- [ ] Monthly P&L PDF export with charts

### WS10: Automation (ws10-automation.js)
- [ ] Smart photo tagging — match uploaded photos to refs based on filename/EXIF
- [ ] Auto-detect sold watches from WhatsApp messages ("sold 126334 to John 14500")

### General
- [ ] Test all 10 modules on mobile Safari — fix any layout/interaction bugs
- [ ] Performance audit — measure module load time, optimize if >500ms
- [ ] Add module error boundary — if one module crashes, others keep working

## Priority: LOW
- [ ] WS4: A/B caption testing — track view counts per caption style
- [ ] WS7: Seasonal price patterns — monthly average prices per ref to identify buy/sell windows
- [ ] WS7: Currency impact dashboard — how USD/HKD moves affect margins
- [ ] WS9: Profit by channel analysis (WhatsApp groups, Instagram, direct)
- [ ] WS10: Competition price tracking — monitor Chrono24 prices for key refs

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
- [x] WS7: Brand market share donut chart — ws7-analytics.js
- [x] WS7: Top movers widget — ws7-analytics.js
- [x] WS7: HK vs US price gap chart — ws7-analytics.js
- [x] WS8: Quick-action floating button (FAB) — ws8-mobile-ux.js
- [x] WS8: Swipe-to-action on deal cards — ws8-mobile-ux.js
- [x] WS9: Weekly P&L summary card — ws9-reporting.js
- [x] WS9: Profit by ref analysis — ws9-reporting.js
- [x] WS10: Auto-price new watches — ws10-automation.js
- [x] WS10: Stale listing detector — ws10-automation.js
- [x] Price analyzer: Rolex dial options expanded 74→271 refs
- [x] Price analyzer: AP 18→56 refs, Patek 15→80 refs, RM 0→59 refs with dials
- [x] Price analyzer: FIXED_DIAL expanded 71→126 entries
- [x] Price analyzer: 13 new dealer shorthand patterns in extract_dial()
- [x] Price analyzer: Phone number extraction improved (33 seller mappings)
- [x] Price analyzer: Dial synonyms expanded to 30 entries

## RULES FOR AGENTS
1. Pick ONE task from the highest unchecked priority level
2. Edit only the workstream's module file (ws1-price-intel.js, ws2-inventory-pnl.js, etc.)
3. Read the relevant index.html sections to understand existing DOM structure and data flow
4. Register module via window.MKModules.register(id, {init, render, cleanup})
5. Access data through window.DATA (refs, deals, arbitrage, portfolio, etc.)
6. After completing, mark [x] with date, push both code + updated TASKQUEUE.md
7. If you discover new tasks, add them at the right priority level
8. Check git log first — don't duplicate work another session just did
