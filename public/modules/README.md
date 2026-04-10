# Opulence Dashboard Modules

Each workstream owns its own JS file. Multiple agents can work on different files simultaneously without merge conflicts.

## Architecture

```
index.html          - Core HTML structure, CSS, base app shell (DO NOT EDIT for workstreams)
modules/
  ws1-price-intel.js    - Price Intelligence Engine (lookups, comparables, deal scoring)
  ws2-inventory-pnl.js  - Inventory P&L Dashboard (portfolio, heat maps, aging)
  ws3-deal-flow.js      - Deal Flow & Arbitrage (cross-market, snipe alerts)
  ws4-posting.js        - Posting & Sales Workflow (captions, photos, batch post)
  ws5-shipping.js       - Shipping & Logistics (labels, tracking, HAL)
  ws6-crm.js            - Client Relationship Management (buyers, sellers, history)
  ws7-analytics.js      - Market Data & Analytics (trends, volume, seasonal)
  ws8-mobile-ux.js      - Mobile & UX Optimization (touch, offline, performance)
  ws9-reporting.js      - Financial Reporting (P&L reports, tax, cash flow)
  ws10-automation.js    - Automation & Integrations (WhatsApp, auto-pricing, OCR)
  module-loader.js      - Loads and initializes all modules
```

## Rules for Module Authors

1. Each module exports an `init()` function and optionally `render()`, `cleanup()`
2. Modules register themselves via `window.MKModules.register('ws1', { init, render })`
3. Modules can read from `window.DATA` (shared app data) but should not mutate it
4. Modules inject UI via designated container divs: `<div id="ws1-container"></div>`
5. Modules communicate via custom events: `document.dispatchEvent(new CustomEvent('mk:price-update', {detail: {...}}))`
6. Never use MutationObserver or setInterval for DOM updates
7. Keep the dark theme: use CSS variables (--bg-0, --accent, --text-0, etc.)
