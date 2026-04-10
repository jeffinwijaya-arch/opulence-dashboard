# Opulence Dashboard Task Queue
> Any Claude session should read this file, pick the highest-priority unfinished task, do it, mark it done, and add new tasks discovered during the work.

## Priority: CRITICAL (do these first)
- [ ] WS1: Implement enhanced deal scoring in ws1-price-intel.js — factor in days-on-market, condition, seller reliability
- [ ] WS2: Add portfolio heat map to ws2-inventory-pnl.js — color-coded P&L by ref, red=losing, green=winning
- [ ] WS3: Build cross-market arbitrage calculator in ws3-deal-flow.js — HK vs US with shipping($150), insurance(1.5%), wire($40)
- [ ] WS8: Mobile-first price lookup in ws8-mobile-ux.js — large touch targets, swipe between results

## Priority: HIGH
- [ ] WS1: Add price trend arrows (up/down/flat) to lookup results based on 30-day history
- [ ] WS1: Confidence score on price estimates — how many comparables, how recent, how similar
- [ ] WS2: Days-in-inventory aging alerts — yellow >20 days, red >30 days, with suggested price drops
- [ ] WS2: Weekly/monthly P&L trend mini-charts on portfolio page
- [ ] WS3: "Snipe alert" system — watches priced 10%+ below B25 average
- [ ] WS3: Seller pattern analysis — who consistently underprices, who's reliable
- [ ] WS4: Auto-generate captions from inventory data (ref, dial, bracelet, condition, card date, price)
- [ ] WS4: Price recommendation engine — suggested sale price based on market + days held
- [ ] WS5: Batch label creation — select multiple sold watches, create labels for all
- [ ] WS5: Delivery tracking dashboard with auto-status updates
- [ ] WS7: Price history sparklines per ref on dashboard overview
- [ ] WS7: Volume heatmap — which refs are trading most this week vs last
- [ ] WS9: Monthly P&L summary report with export-to-PDF

## Priority: MEDIUM
- [ ] WS4: Repost scheduling with automatic price drops ($500 every 3 days)
- [ ] WS6: Buyer preferences tracking — "John likes Datejust 41 Blue, budget $12-15K"
- [ ] WS6: Seller reputation score — calculated from transaction history
- [ ] WS6: "This buyer bought 3 DJs — recommend the new 126334 arrival" alerts
- [ ] WS7: Seasonal pattern detection — identify best buy/sell months per ref
- [ ] WS7: Currency impact dashboard — how USD/HKD moves affect margins
- [ ] WS8: Offline price lookup cache — save last 50 lookups for subway use
- [ ] WS8: Keyboard shortcuts for power users (/ to search, n for new watch, s for sell)
- [ ] WS9: Tax lot tracking — cost basis per watch for Schedule D
- [ ] WS9: Cash flow projection — upcoming expected payments and receivables
- [ ] WS10: Auto-detect sold watches from WhatsApp messages ("sold 126334 to John 14500")
- [ ] WS10: Auto-pricing new arrivals based on market data

## Priority: LOW (nice to have)
- [ ] WS4: A/B test different caption styles — track which gets more inquiries
- [ ] WS6: Referral tracking — who referred which buyer
- [ ] WS7: Competition price tracking — scrape competitor listings
- [ ] WS8: Progressive web app with push notifications for deal alerts
- [ ] WS9: Profit by channel analysis (WhatsApp groups, Instagram, direct)
- [ ] WS10: Photo OCR for automatic serial/card date extraction from warranty card photos

## COMPLETED
<!-- Move completed tasks here with date -->

## RULES FOR AGENTS
1. Pick ONE task, do it well, mark it [x], add the date
2. If you discover new tasks during work, add them to the appropriate priority
3. Don't pick a task another session might be working on (check git log for recent commits)
4. After completing a task, push TASKQUEUE.md update along with your code changes
5. If a task is too big, break it into subtasks
