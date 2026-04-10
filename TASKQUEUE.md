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

### WS1: Price Intelligence (ws1-price-intel.js)
- [x] Add deal scoring algorithm — combine: discount_pct (weight 40%), days_on_market (20%), seller_reliability (20%), condition_premium (20%) → single 0-100 score (2026-04-10)
- [x] Price confidence indicator on lookups — "HIGH" (>20 comparables), "MEDIUM" (5-20), "LOW" (<5) with color coding (2026-04-10)
- [x] Price trend arrows on lookup results — localStorage-based 30-day b25 tracking, ▲/▼ arrow on repeat lookups (2026-04-10)

### WS3: Deal Flow & Arbitrage (ws3-deal-flow.js)
- [x] Enhanced arbitrage calculator — add real costs: shipping $150, insurance 1.5% of value, wire fee $40, FedEx label $35 → show true net margin (2026-04-10)
- [x] Snipe alert badge on deals page — flag any listing priced >10% below b25 with pulsing gold border (2026-04-10)

## Priority: HIGH

### WS2: Inventory P&L (ws2-inventory-pnl.js)
- [x] Portfolio heat map — inject colored squares into portfolio page: green (>5% profit), yellow (0-5%), red (loss), size = capital deployed (2026-04-10)
- [ ] Days-in-inventory aging bar — show color-coded bar on each inventory row: green <14d, yellow 14-30d, red >30d
- [ ] Unrealized P&L trend — weekly sparkline showing portfolio value over time (store snapshots in localStorage)

### WS4: Posting & Sales (ws4-posting.js)
- [ ] Auto-caption generator — from inventory data build: "BNIB Full Set {ref} {bracelet} {dial} {card_month}/{card_year} {condition} with WT ${price} + label"
- [ ] Smart price recommendation — suggested sale price = US low from refs data - $100, with "competitive" / "aggressive" / "premium" tiers

### WS7: Market Analytics (ws7-analytics.js)
- [ ] Brand market share donut chart on overview page — Rolex 68%, AP 6%, Patek 10%, RM 9%, etc from summary.brands
- [ ] Top movers widget — show refs with biggest price changes from movers data in bundle.json
- [ ] HK vs US price gap chart — for top 20 refs, show side-by-side bars of HK b25 vs US b25

## Priority: MEDIUM

### WS5: Shipping (ws5-shipping.js)
- [ ] Shipping cost estimator — based on declared value, calculate FedEx Priority cost + insurance premium before creating label
- [ ] Batch ship selector — checkbox column on sold/unshipped watches, "Create Labels for Selected" button

### WS6: CRM (ws6-crm.js)
- [ ] Buyer purchase history panel — when viewing a sold watch, show "John also bought: [list]" from inventory data
- [ ] Seller reliability score — count of transactions, average discount vs market, response pattern

### WS8: Mobile UX (ws8-mobile-ux.js)
- [ ] Quick-action floating buttons — context-aware: on inventory page show "Add Watch", on lookup show "Search", on portfolio show "Refresh"
- [ ] Swipe-to-action on deal cards — swipe right = save to watchlist, swipe left = dismiss

### WS9: Financial Reporting (ws9-reporting.js)
- [ ] Weekly P&L summary card on overview — total realized P&L this week, unrealized change, capital deployed vs available
- [ ] Profit by ref analysis — which ref models are most profitable? Average margin per ref from sold watches

### WS10: Automation (ws10-automation.js)
- [ ] Auto-price new watches — when a watch is added without sale_price, auto-fill from refs data: US low or b25 - $100
- [ ] Stale listing detector — watches posted >7 days with no activity → suggest price drop amount

## Priority: LOW
- [ ] WS4: A/B caption testing — track view counts per caption style
- [ ] WS6: Referral tracking — "referred by" field on buyer records
- [ ] WS7: Seasonal price patterns — monthly average prices per ref to identify buy/sell windows
- [ ] WS8: Offline mode — cache last lookup results in service worker for subway use
- [ ] WS9: Tax export — generate CSV of all sold watches with cost basis + proceeds for accountant
- [ ] WS10: Smart photo tagging — match uploaded photos to refs based on filename/EXIF

## COMPLETED
- **2026-04-10** WS1 Price Intelligence (ws1-price-intel.js): deal scoring (0-100, 4 components), price confidence indicator (HIGH/MEDIUM/LOW), price trend arrows (localStorage 30-day b25 tracking)
- **2026-04-10** WS3 Deal Flow (ws3-deal-flow.js): enhanced arbitrage calculator (true net = sell − buy − shipping $150 − insurance 1.5% − wire $40 − label $35, injected "True Net" column + cost banner), snipe alert badge (pulsing gold border + ★ SNIPE tag for deals >10% below B25)
- **2026-04-10** WS2 Inventory P&L (ws2-inventory-pnl.js): portfolio heat map (colored tiles on Summary tab, green >5%, yellow 0-5%, red <0%, size proportional to capital deployed)

## RULES FOR AGENTS
1. Pick ONE task from the highest unchecked priority level
2. Edit only the workstream's module file (ws1-price-intel.js, ws2-inventory-pnl.js, etc.)
3. Read the relevant index.html sections to understand existing DOM structure and data flow
4. Register module via window.MKModules.register(id, {init, render, cleanup})
5. Access data through window.DATA (refs, deals, arbitrage, portfolio, etc.)
6. After completing, mark [x] with date, push both code + updated TASKQUEUE.md
7. If you discover new tasks, add them at the right priority level
8. Check git log first — don't duplicate work another session just did
