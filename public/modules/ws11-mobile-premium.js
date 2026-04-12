/**
 * MK Opulence — ws11-mobile-premium
 * Premium native-feeling mobile UX layer.
 *
 * Features:
 *  - Glassmorphic bottom tab bar with spring-scale tap feedback
 *  - iOS-style page transitions (slide + fade)
 *  - Bottom sheet component (MK.Sheet) with drag-to-dismiss
 *  - Pull-to-refresh with rubber-band + haptic feedback
 *  - Smart-hide top chrome on scroll
 *  - Haptic feedback API (MK.Haptic)
 *  - Premium toast pills (MK.Toast) — blurred, stacked, swipe-dismiss
 *  - Double-tap-to-top on Home tab
 *  - Input focus auto-scroll for keyboard
 *  - Offline indicator badge
 *  - Intersection Observer reveal animations
 *  - WCAG AA+ focus rings, reduced-motion, ARIA, focus trap
 *
 * No-op on desktop (>=900px). Safe to load everywhere.
 *
 * Available globals used:
 *   window.DATA           — shared app data
 *   window.MKModules      — module system
 *   window.showPage(name) — page navigation
 *   window.showToast(msg) — toast notifications
 *   window.refreshData()  — data refresh (if available)
 */
(function() {
    'use strict';

    const MOD_ID = 'ws11-mobile-premium';
    const MOBILE_BP = 900;

    // ── Private API references (module-scoped, not on window) ──
    let _haptic = null;
    let _toast = null;
    let _sheet = null;
    let _share = null;

    // ── Feature Detection ──
    function isMobile() {
        return window.innerWidth < MOBILE_BP;
    }
    function isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }
    function prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ── CSS Overhaul Layer ──
    function ws11GetCSS() { return `
    /* === 1. Safe Areas & Base === */
    @media(max-width:900px){
      html{font-size:15px}
      body{padding-top:env(safe-area-inset-top)}
      .main{padding-bottom:calc(76px + env(safe-area-inset-bottom))}
      *{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
      button,.btn{touch-action:manipulation}
      ::-webkit-scrollbar{width:0;height:0}
      *{scrollbar-width:none}
    }
    @media(max-width:380px){
      html{font-size:14px}
    }
    
    /* === 2. Premium Bottom Tab Bar === */
    @media(max-width:900px){
      .mobile-nav{
        background:rgba(8,8,12,0.72);backdrop-filter:blur(24px) saturate(180%);
        -webkit-backdrop-filter:blur(24px) saturate(180%);height:64px;
        padding-bottom:max(8px,env(safe-area-inset-bottom));
        border-top:0.5px solid rgba(255,255,255,0.08);
        display:flex;justify-content:space-around;align-items:center;
        overflow:visible;overflow-x:visible;white-space:normal;
      }
      html.light .mobile-nav{background:rgba(245,244,240,0.78);border-top-color:rgba(0,0,0,0.08)}
      .mobile-nav a{
        flex:1;flex-direction:column;align-items:center;justify-content:center;
        gap:3px;padding:6px 0;min-width:0;font-size:0.6rem;font-weight:500;
        color:var(--text-2);
        transition:transform 120ms cubic-bezier(0.2,0,0,1),color 150ms ease;
        -webkit-tap-highlight-color:transparent;position:relative;
      }
      .mobile-nav a.active{color:var(--accent);font-weight:700}
      .mobile-nav a.active::after{
        content:'';position:absolute;bottom:2px;left:50%;transform:translateX(-50%);
        width:4px;height:4px;border-radius:50%;background:var(--accent);
        box-shadow:0 0 8px rgba(212,175,55,0.5);
      }
      .mobile-nav a:active{transform:scale(0.88)}
      .mn-icon svg{width:22px;height:22px;stroke-width:1.8}
    }
    
    /* === 3. Touch Targets === */
    @media(max-width:900px){
      .btn,button,.tab,.more-grid-item{min-height:44px;min-width:44px}
      input,select,textarea,.input{font-size:16px !important;min-height:48px;border-radius:12px}
      .tbl .ref{padding:8px 4px}
      .card-head .link{padding:8px 12px;margin:-8px -12px}
    }
    
    /* === 4. Typography === */
    @media(max-width:900px){
      .page-head h1{font-size:1.65rem;font-weight:800;letter-spacing:-0.03em;line-height:1.15}
      .page-head p{font-size:0.85rem;line-height:1.5;color:var(--text-1)}
      .metric .val{font-size:1.5rem}
      .metric .label{font-size:0.62rem;letter-spacing:1px}
      .metric .sub{font-size:0.68rem;line-height:1.3}
      /* Card headers — bigger, cleaner */
      .card-head{
        padding:14px 16px !important;font-size:0.72rem !important;
        letter-spacing:1.2px !important;
      }
      .card-head .link{font-size:0.78rem !important;padding:8px 12px;margin:-8px -12px}
      /* Table base — larger font, more padding */
      .tbl{font-size:0.82rem !important}
      .tbl th{padding:10px 12px !important;font-size:0.65rem !important}
      .tbl td{padding:10px 12px !important;font-size:0.8rem !important}
      /* Spacing between cards */
      .card{margin-bottom:14px !important}
      /* Page head spacing */
      .page-head{margin-bottom:20px !important}
      /* Main content padding */
      .main{padding:14px 14px calc(76px + env(safe-area-inset-bottom)) !important}
    }

    /* === 5. Card & Metric Polish === */
    @media(max-width:900px){
      .card{border-radius:16px;overflow:hidden}
      .metric{border-radius:14px;padding:16px !important}
      .card[onclick]:active,.deal-card:active{transform:scale(0.985);transition:transform 100ms ease}
    }
    
    /* === 6. Page Transitions === */
    @keyframes ws11PageIn{
      from{opacity:0;transform:translate3d(16px,0,0)}
      to{opacity:1;transform:translate3d(0,0,0)}
    }
    @keyframes ws11PageFade{
      from{opacity:0}
      to{opacity:1}
    }
    @media(prefers-reduced-motion:no-preference){
      @media(max-width:900px){
        .page.active{animation:ws11PageIn 280ms cubic-bezier(0.22,1,0.36,1) both}
      }
    }
    @media(prefers-reduced-motion:reduce){
      @media(max-width:900px){
        .page.active{animation:ws11PageFade 150ms ease both}
      }
    }
    
    /* === 7. Smart-Hide Chrome === */
    @media(max-width:900px){
      .ws11-chrome-hidden .top-bar,
      .ws11-chrome-hidden .ticker-bar,
      .ws11-chrome-hidden .page-context{
        transform:translateY(-100%);
        transition:transform 280ms cubic-bezier(0.22,1,0.36,1);
      }
      .top-bar,.ticker-bar,.page-context{
        transition:transform 280ms cubic-bezier(0.22,1,0.36,1);
      }
    }
    
    /* === 8. Bottom Sheet === */
    @media(max-width:900px){
      .ws11-sheet-backdrop{
        position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.45);
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);opacity:0;transition:opacity 250ms ease;pointer-events:none;
      }
      .ws11-sheet-backdrop.ws11-visible{opacity:1;pointer-events:auto}
      .ws11-sheet{
        position:fixed;bottom:0;left:0;right:0;z-index:10001;background:var(--bg-1);
        border-radius:20px 20px 0 0;max-height:85vh;transform:translateY(100%);
        transition:transform 320ms cubic-bezier(0.22,1,0.36,1);box-shadow:0 -8px 40px rgba(0,0,0,0.4);
        overflow:hidden;padding-bottom:env(safe-area-inset-bottom);
      }
      .ws11-sheet.ws11-visible{transform:translateY(0)}
      .ws11-sheet-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.18);margin:10px auto 6px}
      html.light .ws11-sheet-handle{background:rgba(0,0,0,0.15)}
      .ws11-sheet-title{padding:8px 20px 12px;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-2);font-family:var(--mono)}
      .ws11-sheet-body{padding:0 20px 20px;overflow-y:auto;max-height:calc(85vh - 60px);-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    }
    
    /* === 9. Premium Toast === */
    @media(max-width:900px){
      .ws11-toast-container{
        position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
        z-index:20000;display:flex;flex-direction:column-reverse;gap:8px;align-items:center;
        pointer-events:none;width:90%;max-width:360px;
      }
      .ws11-toast{
        background:rgba(22,22,30,0.88);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:12px 18px;
        color:var(--text-0);font-size:0.82rem;font-weight:500;display:flex;align-items:center;
        gap:10px;pointer-events:auto;animation:ws11ToastIn 350ms cubic-bezier(0.22,1,0.36,1) both;
        box-shadow:0 8px 32px rgba(0,0,0,0.35);touch-action:pan-x;width:100%;
      }
      html.light .ws11-toast{background:rgba(255,255,255,0.92);color:var(--text-0);border-color:rgba(0,0,0,0.06)}
      .ws11-toast-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .ws11-toast-dot.ws11-success{background:var(--green);box-shadow:0 0 8px rgba(0,230,118,0.4)}
      .ws11-toast-dot.ws11-error{background:var(--red);box-shadow:0 0 8px rgba(255,23,68,0.4)}
      .ws11-toast-dot.ws11-info{background:var(--accent);box-shadow:0 0 8px rgba(212,175,55,0.4)}
      .ws11-toast-dot.ws11-warning{background:var(--orange);box-shadow:0 0 8px rgba(251,146,60,0.4)}
      .ws11-toast.ws11-dismissing{animation:ws11ToastOut 200ms ease forwards}
    }
    @keyframes ws11ToastIn{
      from{opacity:0;transform:translateY(16px) scale(0.95)}
      to{opacity:1;transform:translateY(0) scale(1)}
    }
    @keyframes ws11ToastOut{
      from{opacity:1;transform:translateY(0) scale(1)}
      to{opacity:0;transform:translateY(-8px) scale(0.95)}
    }
    
    /* === 10. Pull-to-Refresh === */
    @media(max-width:900px){
      .ws11-ptr{
        position:fixed;top:0;left:0;right:0;height:56px;display:flex;align-items:center;
        justify-content:center;z-index:90;pointer-events:none;transform:translateY(-56px);
        transition:transform 280ms cubic-bezier(0.22,1,0.36,1);
      }
      .ws11-ptr.ws11-pulling{transition:none}
      .ws11-ptr.ws11-refreshing{transform:translateY(0)}
      .ws11-ptr-spinner{width:24px;height:24px;border:2.5px solid var(--border-strong);border-top-color:var(--accent);border-radius:50%}
      .ws11-ptr.ws11-refreshing .ws11-ptr-spinner{animation:spin 0.6s linear infinite}
    }
    
    /* === 11. Focus & Accessibility === */
    @media(max-width:900px){
      *:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
      .ws11-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
    }
    
    /* === 12. Offline Badge === */
    @media(max-width:900px){
      .ws11-offline-badge{
        position:fixed;top:env(safe-area-inset-top,0);left:0;right:0;z-index:99999;
        background:rgba(30,30,36,0.92);backdrop-filter:blur(8px);color:var(--text-2);
        font-size:0.72rem;text-align:center;padding:8px 16px;
        border-bottom:1px solid var(--border);animation:ws11SlideDown 300ms ease both;
      }
    }
    @keyframes ws11SlideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}
    
    /* === 13. Reveal-on-scroll === */
    @media(prefers-reduced-motion:no-preference){
      @media(max-width:900px){
        .ws11-reveal{
          opacity:0;transform:translateY(12px);
          transition:opacity 400ms ease,transform 400ms cubic-bezier(0.22,1,0.36,1);
        }
        .ws11-reveal.ws11-revealed{opacity:1;transform:none}
      }
    }
    
    /* === 14. More Menu Sheet Override === */
    @media(max-width:900px){
      #mobile-more-menu{
        border-radius:20px 20px 0 0 !important;
        box-shadow:0 -8px 40px rgba(0,0,0,0.4) !important;
        padding:8px 16px 20px !important;
        background:var(--bg-1) !important;
      }
      #mobile-more-backdrop{
        backdrop-filter:blur(4px) !important;
        -webkit-backdrop-filter:blur(4px) !important;
      }
      .more-grid-item{border-radius:14px;min-height:64px}
    }

    /* === 15. Inline Grid Layout Fixes === */
    @media(max-width:900px){
      /* NUCLEAR: ALL inline 2-col grids → 1-col on mobile */
      div[style*="grid-template-columns:1fr 1fr"],
      div[style*="grid-template-columns: 1fr 1fr"]{
        grid-template-columns:1fr !important;
      }
      /* ALL inline 3-col grids → 1-col */
      div[style*="grid-template-columns:1fr 1fr 1fr"],
      div[style*="grid-template-columns: 1fr 1fr 1fr"]{
        grid-template-columns:1fr !important;
      }
      /* ALL flex containers: allow wrapping */
      div[style*="display:flex"][style*="gap"]{flex-wrap:wrap !important}
      /* FX calculator grid → stack */
      #fx-result div[style*="grid-template-columns"]{
        grid-template-columns:1fr !important;
      }
    }

    /* === 15b. Dashboard Tables → Mobile Card Lists === */
    @media(max-width:900px){
      /* Top Deals table → card list */
      #dash-deals thead,#dash-arb thead,#dash-inventory thead{display:none}

      #dash-deals tbody tr,#dash-arb tbody tr{
        display:flex;flex-wrap:wrap;align-items:baseline;
        padding:12px 14px;border-bottom:1px solid var(--border);gap:4px 8px;
      }
      #dash-deals tbody tr:active,#dash-arb tbody tr:active{background:var(--bg-hover)}
      #dash-deals tbody td,#dash-arb tbody td{
        padding:0;border:none;white-space:nowrap;
      }
      /* Ref column — bold accent */
      #dash-deals tbody td:first-child,#dash-arb tbody td:first-child{
        font-weight:700;font-size:0.88rem;color:var(--accent);
        flex-basis:100%;margin-bottom:2px;
      }
      /* Other columns */
      #dash-deals tbody td:not(:first-child),#dash-arb tbody td:not(:first-child){
        font-size:0.8rem;
      }
      /* Last column (price/profit) — push right */
      #dash-deals tbody td:last-child,#dash-arb tbody td:last-child{
        margin-left:auto;font-weight:700;font-size:0.9rem;
      }

      /* Inventory positions table → simplified */
      #dash-inventory tbody tr{
        display:grid;grid-template-columns:1fr auto;gap:2px 8px;
        padding:12px 14px;border-bottom:1px solid var(--border);
      }
      #dash-inventory tbody tr:active{background:var(--bg-hover)}
      #dash-inventory tbody td{padding:0;border:none;font-size:0.78rem}
      #dash-inventory tbody td:first-child{
        font-weight:700;color:var(--accent);font-size:0.85rem;
        grid-column:1/-1;margin-bottom:2px;
      }
      #dash-inventory tbody td.hide-mobile{display:none}
      #dash-inventory tbody td:last-child{text-align:right}

      /* Portfolio snapshot — bigger numbers */
      .pf-grid{
        grid-template-columns:1fr 1fr !important;gap:12px !important;
      }
      .pf-val{font-size:1.35rem !important}
      .pf-label{font-size:0.65rem !important}

      /* Increase card body padding */
      .card-body{padding:14px 16px !important}

      /* Deal discount — larger on mobile */
      .deal-discount{font-size:1.6rem !important}
    }

    /* === 16. Toast Conflict Resolution === */
    @media(max-width:900px){
      /* Hide legacy toast container on mobile — ws11 toast takes over */
      .toast-container{display:none !important}
    }

    /* === 17. Page Context Bar Polish === */
    @media(max-width:900px){
      .page-context{
        padding:10px 16px;background:rgba(8,8,12,0.85);
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        border-bottom:1px solid rgba(255,255,255,0.04);
        position:sticky;top:0;z-index:50;
      }
      html.light .page-context{
        background:rgba(245,244,240,0.85);
        border-bottom-color:rgba(0,0,0,0.04);
      }
      .page-context .pc-name{font-size:0.72rem;letter-spacing:1.2px}
    }

    /* === 18. Ticker Hide on Mobile === */
    @media(max-width:900px){
      .ticker-bar{display:none}
    }

    /* === 19. Long-press Context Menu === */
    @media(max-width:900px){
      .ws11-ctx-menu{
        position:fixed;bottom:0;left:0;right:0;z-index:10002;
        background:var(--bg-1);border-radius:20px 20px 0 0;
        padding:12px 16px 20px;padding-bottom:calc(20px + env(safe-area-inset-bottom));
        transform:translateY(100%);transition:transform 280ms cubic-bezier(0.22,1,0.36,1);
        box-shadow:0 -8px 40px rgba(0,0,0,0.5);
      }
      .ws11-ctx-menu.ws11-visible{transform:translateY(0)}
      .ws11-ctx-menu-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.18);margin:0 auto 12px}
      html.light .ws11-ctx-menu-handle{background:rgba(0,0,0,0.15)}
      .ws11-ctx-menu-title{font-size:0.85rem;font-weight:700;color:var(--accent);margin-bottom:4px;font-family:var(--mono)}
      .ws11-ctx-menu-sub{font-size:0.7rem;color:var(--text-2);margin-bottom:14px}
      .ws11-ctx-action{
        display:flex;align-items:center;gap:14px;padding:14px 12px;
        border-radius:12px;font-size:0.88rem;font-weight:500;color:var(--text-0);
        transition:background 120ms ease;cursor:pointer;border:none;
        background:none;width:100%;text-align:left;font-family:var(--font);
      }
      .ws11-ctx-action:active{background:var(--accent-dim)}
      .ws11-ctx-action-icon{width:20px;height:20px;color:var(--accent);flex-shrink:0}
      .ws11-ctx-action + .ws11-ctx-action{border-top:1px solid var(--border)}
    }

    /* === 20. Swipe Hint Indicator === */
    @media(max-width:900px){
      .ws11-swipe-indicator{
        position:fixed;bottom:calc(76px + env(safe-area-inset-bottom));
        left:50%;transform:translateX(-50%);
        font-size:0.6rem;color:var(--text-3);font-family:var(--mono);
        letter-spacing:0.5px;text-transform:uppercase;
        opacity:0;transition:opacity 400ms ease;pointer-events:none;
      }
      .ws11-swipe-indicator.ws11-visible{opacity:1}
    }

    /* === 21. Active State Feedback === */
    @media(max-width:900px){
      .btn:active,button:active{transform:scale(0.96) !important;transition:transform 80ms ease !important}
      .tag:active{transform:scale(0.94);transition:transform 80ms ease}
      .tab:active{transform:scale(0.97);transition:transform 80ms ease}
    }

    /* === 22. Shipping Tracker Table → Mobile Cards === */
    @media(max-width:900px){
      #tracker-table thead{display:none}
      #tracker-table tbody tr{
        display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;
        padding:14px 16px;border-bottom:1px solid var(--border);
        position:relative;
      }
      #tracker-table tbody tr:active{background:var(--bg-hover)}
      #tracker-table tbody td{
        padding:2px 0;border:none;white-space:normal;font-size:0.78rem;
      }
      /* Watch/Ref — spans full width, bold */
      #tracker-table tbody td:nth-child(1){
        grid-column:1/-1;font-weight:700;font-size:0.88rem;
        color:var(--accent);margin-bottom:4px;
      }
      /* Tracking # */
      #tracker-table tbody td:nth-child(2)::before{
        content:'Tracking';display:block;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-bottom:1px;
      }
      /* From */
      #tracker-table tbody td:nth-child(3)::before{
        content:'From';display:block;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-bottom:1px;
      }
      /* To */
      #tracker-table tbody td:nth-child(4)::before{
        content:'To';display:block;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-bottom:1px;
      }
      /* Ship Date */
      #tracker-table tbody td:nth-child(5)::before{
        content:'Shipped';display:block;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-bottom:1px;
      }
      /* Status — spans full width with tag styling */
      #tracker-table tbody td:nth-child(6){
        grid-column:1/-1;margin-top:6px;
      }
      #tracker-table tbody td:nth-child(6)::before{
        content:'Status';display:inline;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-right:8px;
      }
      /* ETA */
      #tracker-table tbody td:nth-child(7)::before{
        content:'ETA';display:block;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-bottom:1px;
      }
      /* Last Update */
      #tracker-table tbody td:nth-child(8)::before{
        content:'Updated';display:block;font-size:0.55rem;
        color:var(--text-2);text-transform:uppercase;letter-spacing:0.8px;
        font-weight:700;margin-bottom:1px;
      }
      /* Actions */
      #tracker-table tbody td:nth-child(9){
        grid-column:1/-1;margin-top:6px;display:flex;gap:8px;
      }
      /* Loading/empty row stays single-column */
      #tracker-table tbody tr td[colspan]{
        grid-column:1/-1;text-align:center;
      }
    }

    /* === 23. Table Scroll Indicator === */
    @media(max-width:900px){
      .tbl-wrap{
        position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch;
      }
      .tbl-wrap::after{
        content:'';position:absolute;top:0;right:0;bottom:0;width:28px;
        background:linear-gradient(to right,transparent,var(--bg-2));
        pointer-events:none;opacity:1;transition:opacity 300ms ease;
        border-radius:0 var(--radius) var(--radius) 0;
      }
      .tbl-wrap.ws11-scrolled-end::after{opacity:0}
      /* Don't show indicator on tracker table (it uses card layout) */
      #page-shipping .tbl-wrap::after{display:none}
    }

    /* === 24. Modal → Mobile Full Sheet === */
    @media(max-width:900px){
      #watch-modal > div,
      #qcmd-panel,
      #usearch-overlay .usearch-panel{
        position:fixed !important;bottom:0 !important;left:0 !important;right:0 !important;
        top:auto !important;max-width:100% !important;width:100% !important;
        border-radius:20px 20px 0 0 !important;max-height:90vh !important;
        overflow-y:auto !important;-webkit-overflow-scrolling:touch;
        transform:none !important;margin:0 !important;
        padding-bottom:calc(20px + env(safe-area-inset-bottom)) !important;
      }
      #watch-modal{align-items:flex-end !important}
      #usearch-overlay{align-items:flex-end !important}
    }

    /* === 25. Form Label Improvements === */
    @media(max-width:900px){
      #watch-modal label,
      #page-postings label{
        font-size:0.75rem !important;font-weight:600;color:var(--text-1);
        margin-bottom:4px;display:block;
      }
      /* Grid forms inside modals → stack */
      #watch-modal div[style*="grid-template-columns:1fr 1fr"]{
        grid-template-columns:1fr !important;gap:10px !important;
      }
    }

    /* === 26. Empty State Polish === */
    @media(max-width:900px){
      .empty-state,.mc-empty,.notif-empty{
        padding:40px 24px !important;text-align:center;
      }
      .empty-state svg,.mc-empty svg{
        width:48px !important;height:48px !important;opacity:0.3;margin-bottom:12px;
      }
    }

    /* === 27. Search Page Mobile === */
    @media(max-width:900px){
      #page-lookup > div:nth-child(2){
        max-width:100% !important;flex-direction:column !important;
      }
      #ref-search{
        width:100% !important;font-size:17px !important;
        padding:14px 16px !important;border-radius:14px !important;
        min-height:52px;
      }
      #ref-autocomplete{
        max-width:100% !important;width:calc(100% - 20px) !important;
        border-radius:0 0 14px 14px !important;
        max-height:50vh !important;
      }
      #compare-panel{border-radius:14px !important}
      #compare-panel > div:first-child{flex-direction:column !important}
      #compare-panel input{width:100% !important}
    }

    /* === 28. Improved Posting Cards Mobile === */
    @media(max-width:480px){
      .posting-card{
        padding:14px;border-radius:14px;
      }
      .posting-card img{
        width:72px;height:72px;border-radius:10px;
      }
      .posting-card-ref{font-size:0.92rem}
      .posting-card-desc{font-size:0.75rem;line-height:1.4}
      .posting-card-price{font-size:0.92rem}
      .posting-card-actions{margin-top:10px}
      .posting-card-actions .btn{
        min-height:40px;font-size:0.75rem;padding:8px 14px;
        border-radius:10px;flex:1;text-align:center;
      }
    }

    /* === 29. Mobile Theme Toggle === */
    @media(max-width:900px){
      .ws11-theme-fab{
        position:fixed;top:12px;right:12px;
        top:calc(12px + env(safe-area-inset-top));
        width:40px;height:40px;border-radius:50%;
        background:rgba(8,8,12,0.65);backdrop-filter:blur(16px);
        -webkit-backdrop-filter:blur(16px);
        border:1px solid rgba(255,255,255,0.08);
        display:flex;align-items:center;justify-content:center;
        z-index:150;cursor:pointer;
        transition:transform 120ms cubic-bezier(0.2,0,0,1),background 200ms ease;
        -webkit-tap-highlight-color:transparent;
        box-shadow:0 2px 12px rgba(0,0,0,0.3);
      }
      html.light .ws11-theme-fab{
        background:rgba(245,244,240,0.7);
        border-color:rgba(0,0,0,0.06);
        box-shadow:0 2px 12px rgba(0,0,0,0.08);
      }
      .ws11-theme-fab:active{transform:scale(0.88)}
      .ws11-theme-fab svg{width:18px;height:18px;stroke:var(--text-1);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    }

    /* === 30. Scrollable Tabs === */
    @media(max-width:900px){
      .tabs{
        overflow-x:auto;-webkit-overflow-scrolling:touch;
        scrollbar-width:none;flex-wrap:nowrap;gap:0;
        padding:0 4px;
      }
      .tabs::-webkit-scrollbar{display:none}
      .tab{
        white-space:nowrap;flex-shrink:0;
        padding:10px 16px;font-size:0.78rem;
        border-radius:8px 8px 0 0;min-height:44px;
      }
    }

    /* === 31. Metric Count-Up Animation === */
    @media(prefers-reduced-motion:no-preference){
      @media(max-width:900px){
        .ws11-counting .val{
          transition:none;
        }
      }
    }

    /* === 32. Deal Discount Ticker === */
    @media(prefers-reduced-motion:no-preference){
      @media(max-width:900px){
        .deal-discount{
          transition:color 200ms ease;
        }
        .deal-card.ws11-revealed .deal-discount{
          animation:ws11DiscountPop 400ms cubic-bezier(0.22,1,0.36,1) both;
        }
      }
    }
    @keyframes ws11DiscountPop{
      0%{transform:scale(0.7);opacity:0}
      60%{transform:scale(1.08)}
      100%{transform:scale(1);opacity:1}
    }

    /* === 33. Smooth Theme Transition === */
    html.ws11-transitioning *{
      transition:background-color 300ms ease,color 200ms ease,
                 border-color 300ms ease,box-shadow 300ms ease !important;
    }

    /* === 34. Image Loading Placeholder === */
    @media(max-width:900px){
      img.ws11-lazy{
        opacity:0;transition:opacity 300ms ease;
      }
      img.ws11-lazy.ws11-loaded{opacity:1}
      .ws11-img-placeholder{
        background:linear-gradient(90deg,var(--bg-3) 25%,var(--bg-4) 50%,var(--bg-3) 75%);
        background-size:200% 100%;animation:shimmer 1.5s infinite;
        display:block;border-radius:var(--radius);
      }
    }

    /* === 35. Heat Gauge Touch === */
    @media(max-width:900px){
      .heat-gauge{
        padding:10px 16px;cursor:pointer;
        -webkit-tap-highlight-color:transparent;
      }
      .heat-gauge:active{opacity:0.8;transition:opacity 80ms ease}
      .heat-bar{min-height:8px;border-radius:4px}
    }

    /* === 36. Devotion Card Mobile === */
    @media(max-width:900px){
      #devotion-card{
        border-radius:16px !important;padding:14px 16px !important;
      }
      #devotion-card #devotion-verse{
        font-size:0.95rem !important;line-height:1.65 !important;
      }
    }

    /* === 37. Notification Panel Mobile === */
    @media(max-width:900px){
      #notif-panel{
        position:fixed !important;bottom:0 !important;left:0 !important;right:0 !important;
        top:auto !important;width:100% !important;max-width:100% !important;
        border-radius:20px 20px 0 0 !important;max-height:70vh !important;
        box-shadow:0 -8px 40px rgba(0,0,0,0.5) !important;
      }
    }

    /* === 38. Footer Hide on Mobile === */
    @media(max-width:900px){
      .footer{display:none}
    }

    /* === 39. Sticky Card Headers === */
    @media(max-width:900px){
      .page.active .card-head{
        position:sticky;top:0;z-index:8;
        background:var(--bg-2);
        backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
        border-bottom:1px solid var(--border-strong);
      }
      html.light .page.active .card-head{
        background:var(--bg-2);
      }
    }

    /* === 40. Swipe Page Indicator === */
    @media(max-width:900px){
      .ws11-swipe-edge{
        position:fixed;top:50%;z-index:80;
        width:24px;height:48px;
        display:flex;align-items:center;justify-content:center;
        opacity:0;transition:opacity 200ms ease;
        pointer-events:none;
      }
      .ws11-swipe-edge-left{left:2px;transform:translateY(-50%)}
      .ws11-swipe-edge-right{right:2px;transform:translateY(-50%)}
      .ws11-swipe-edge.ws11-visible{opacity:0.4}
      .ws11-swipe-edge svg{width:16px;height:16px;stroke:var(--text-2);fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
    }

    /* === 41. Onboarding Coach Marks === */
    @media(max-width:900px){
      .ws11-coach-overlay{
        position:fixed;inset:0;z-index:30000;
        background:rgba(0,0,0,0.7);
        display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
        padding:24px 20px calc(90px + env(safe-area-inset-bottom));
        animation:ws11PageFade 300ms ease both;
      }
      .ws11-coach-card{
        background:var(--bg-1);border:1px solid var(--accent-border);
        border-radius:20px;padding:24px;max-width:320px;width:100%;
        text-align:center;box-shadow:0 16px 64px rgba(0,0,0,0.5);
        animation:ws11CoachBounce 400ms cubic-bezier(0.22,1,0.36,1) both;
      }
      .ws11-coach-title{
        font-size:1.1rem;font-weight:700;color:var(--text-0);margin-bottom:6px;
      }
      .ws11-coach-desc{
        font-size:0.82rem;color:var(--text-2);line-height:1.5;margin-bottom:18px;
      }
      .ws11-coach-dots{
        display:flex;gap:6px;justify-content:center;margin-bottom:16px;
      }
      .ws11-coach-dot{
        width:6px;height:6px;border-radius:50%;background:var(--text-3);
        transition:all 200ms ease;
      }
      .ws11-coach-dot.ws11-active{
        background:var(--accent);width:20px;border-radius:3px;
      }
      .ws11-coach-btn{
        background:var(--accent);color:#000;border:none;
        border-radius:12px;padding:14px 28px;font-size:0.88rem;
        font-weight:700;cursor:pointer;font-family:var(--font);
        min-height:48px;width:100%;
        transition:transform 100ms ease;
        -webkit-tap-highlight-color:transparent;
      }
      .ws11-coach-btn:active{transform:scale(0.97)}
      .ws11-coach-skip{
        background:none;border:none;color:var(--text-2);
        font-size:0.75rem;cursor:pointer;margin-top:10px;
        padding:8px 16px;font-family:var(--font);
      }
    }
    @keyframes ws11CoachBounce{
      0%{opacity:0;transform:translateY(30px) scale(0.95)}
      100%{opacity:1;transform:none}
    }

    /* === 42. Nav Badge Sync === */
    @media(max-width:900px){
      .ws11-nav-badge{
        position:absolute;top:4px;right:50%;transform:translateX(calc(50% + 10px));
        min-width:16px;height:16px;border-radius:8px;
        background:var(--accent);color:#000;
        font-size:0.5rem;font-weight:800;font-family:var(--mono);
        display:flex;align-items:center;justify-content:center;
        padding:0 4px;line-height:1;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
      }
      .ws11-nav-badge:empty{display:none}
    }

    /* === 43. Scroll Position Memory Indicator === */
    @media(max-width:900px){
      .ws11-scroll-progress{
        position:fixed;top:0;left:0;right:0;height:2px;z-index:200;
        background:transparent;pointer-events:none;
      }
      .ws11-scroll-progress-bar{
        height:100%;background:var(--accent);
        width:0%;transition:width 100ms ease;
        box-shadow:0 0 6px rgba(212,175,55,0.4);
      }
    }

    /* === 44. Status Bar Theme Color === */
    /* Handled via JS — meta[name="theme-color"] updated on toggle */

    /* === 45. Photos Gallery Mobile === */
    @media(max-width:900px){
      #photo-library-grid{
        grid-template-columns:repeat(auto-fill,minmax(105px,1fr)) !important;
        gap:8px !important;
      }
      #page-photos .card > div:first-child{
        flex-direction:column !important;gap:8px !important;
        align-items:flex-start !important;
      }
      #page-photos #sort-order{width:100% !important}
      /* Photo modal → full screen */
      #photo-modal > div{
        max-width:100% !important;padding:4px !important;
      }
      #editor-toolbar{
        overflow-x:auto;flex-wrap:nowrap !important;
        -webkit-overflow-scrolling:touch;gap:6px !important;
        padding:4px 0;
      }
      #editor-toolbar .btn{
        flex-shrink:0;min-height:36px;padding:6px 12px !important;
        font-size:0.72rem !important;border-radius:8px;
      }
      #photo-modal canvas{
        max-height:60vh;width:100% !important;
        object-fit:contain;border-radius:8px;
      }
    }
    @media(max-width:380px){
      #photo-library-grid{
        grid-template-columns:repeat(3,1fr) !important;gap:4px !important;
      }
    }

    /* === 46. Invoices Mobile === */
    @media(max-width:900px){
      #inv-summary{
        grid-template-columns:1fr 1fr !important;gap:6px !important;
      }
      /* Invoice modal → full sheet */
      #inv-modal > div{
        position:fixed !important;bottom:0 !important;left:0 !important;right:0 !important;
        top:auto !important;max-width:100% !important;margin:0 !important;
        border-radius:20px 20px 0 0 !important;max-height:92vh !important;
        overflow-y:auto !important;-webkit-overflow-scrolling:touch;
        padding:20px 16px calc(20px + env(safe-area-inset-bottom)) !important;
      }
      #inv-modal{align-items:flex-end !important;display:flex !important}
      /* Invoice form grids → stack */
      #inv-modal div[style*="grid-template-columns"]{
        grid-template-columns:1fr !important;
      }
      /* New Invoice button → full width */
      #page-invoices .btn[onclick*="showNewInvoice"]{
        width:100%;margin-top:4px;
      }
      /* Invoice list cards */
      #inv-list-container .tbl{font-size:0.72rem}
      #inv-list-container .tbl .hide-mobile{display:none}
    }
    @media(max-width:380px){
      #inv-summary{grid-template-columns:1fr !important}
    }

    /* === 47. Mission Control Mobile === */
    @media(max-width:900px){
      .kanban-board{
        grid-template-columns:1fr !important;gap:12px !important;
      }
      .kanban-col{padding:12px}
      .kanban-items{min-height:auto !important}
      .health-grid{
        grid-template-columns:1fr 1fr !important;gap:10px !important;
      }
      .health-value{font-size:1.4rem}
      .mc-tab-nav{
        overflow-x:auto;-webkit-overflow-scrolling:touch;
        flex-wrap:nowrap;scrollbar-width:none;
      }
      .mc-tab-nav::-webkit-scrollbar{display:none}
      .mc-tab-btn{
        flex-shrink:0;white-space:nowrap;
        padding:10px 14px;font-size:0.65rem;min-height:40px;
      }
      .schedule-card{
        flex-direction:column;align-items:flex-start;gap:10px;
      }
      .backlog-card{padding:12px}
      .backlog-title{font-size:0.82rem}
      .error-card{padding:12px}
    }
    @media(max-width:380px){
      .health-grid{grid-template-columns:1fr !important}
    }

    /* === 48. Jam/Chat Page Mobile === */
    @media(max-width:900px){
      .chat-container,
      #page-jam .card{
        border-radius:0 !important;border-left:none !important;border-right:none !important;
        margin-left:-10px !important;margin-right:-10px !important;
        width:calc(100% + 20px) !important;
      }
      .chat-messages{
        max-height:calc(100vh - 220px) !important;
        -webkit-overflow-scrolling:touch;
      }
      .chat-input-area textarea{
        font-size:16px !important;min-height:44px;border-radius:12px;
      }
      .chat-input-area button{
        min-height:44px;min-width:44px;border-radius:12px;
      }
    }

    /* === 49. CRM Page Mobile === */
    @media(max-width:900px){
      #page-ad-crm div[style*="grid-template-columns"]{
        grid-template-columns:1fr !important;
      }
      #page-ad-crm .tbl .hide-mobile{display:none}
    }

    /* === 50. Rubber-band Overscroll === */
    @media(max-width:900px){
      .main{
        overscroll-behavior-y:contain;
      }
    }

    /* === 51. Selection Highlight === */
    @media(max-width:900px){
      ::selection{background:rgba(212,175,55,0.25)}
      html.light ::selection{background:rgba(160,120,32,0.25)}
    }

    /* === 52. Print Hide Mobile Chrome === */
    @media print{
      .mobile-nav,.ws11-theme-fab,.ws11-scroll-progress,
      .ws11-swipe-edge,.footer{display:none !important}
    }
    `; }

    // ── JS Behavior Layer ──
    function ws11InitHaptic() {
      
      _haptic = {
        light()    { navigator.vibrate?.(6); },
        medium()   { navigator.vibrate?.(12); },
        heavy()    { navigator.vibrate?.(20); },
        success()  { navigator.vibrate?.([6, 30, 8]); },
        warning()  { navigator.vibrate?.([8, 50, 8]); },
        error()    { navigator.vibrate?.([15, 60, 15, 60, 15]); },
        selection(){ navigator.vibrate?.(3); }
      };
    }
    
    function dismissToast(el) {
      if (!el || !el.parentNode) return;
      clearTimeout(el._timer);
      el.classList.add('ws11-dismissing');
      setTimeout(() => el.remove(), 220);
    }
    
    function ws11InitToast() {
      
    
      const container = document.createElement('div');
      container.className = 'ws11-toast-container';
      container.id = 'ws11-toast-container';
      document.body.appendChild(container);
    
      _toast = {
        _container: container,
        _queue: [],
        show(msg, opts = {}) {
          const type = opts.type || 'info';
          const duration = opts.duration || 2500;
          const toast = document.createElement('div');
          toast.className = 'ws11-toast';
          toast.setAttribute('role', 'status');
          toast.setAttribute('aria-live', 'polite');
          toast.innerHTML = `<span class="ws11-toast-dot ws11-${type}"></span><span>${msg}</span>`;
    
          let startX = 0, currentX = 0;
          toast.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, {passive:true});
          toast.addEventListener('touchmove', e => {
            currentX = e.touches[0].clientX;
            const dx = currentX - startX;
            if (Math.abs(dx) > 10) toast.style.transform = `translateX(${dx}px)`;
          }, {passive:true});
          toast.addEventListener('touchend', () => {
            if (Math.abs(currentX - startX) > 80) { dismissToast(toast); }
            else { toast.style.transform = ''; }
          }, {passive:true});
    
          this._container.appendChild(toast);
          _haptic?.light();
    
          while (this._container.children.length > 3) {
            dismissToast(this._container.firstChild);
          }
    
          const timer = setTimeout(() => dismissToast(toast), duration);
          toast._timer = timer;
        }
      };
    
      const _origShowToast = window.showToast;
      window.showToast = function(message, type, duration) {
        if (window.innerWidth < 900 && _toast._container) {
          _toast.show(message, { type: type || 'info', duration: duration || 3000 });
        } else if (_origShowToast) {
          _origShowToast.call(window, message, type, duration);
        }
      };
    }
    
    function ws11SetupSheetDrag(sheet, onClose) {
      const handle = sheet.querySelector('.ws11-sheet-handle');
      if (!handle) return;
      let startY = 0, currentY = 0, dragging = false;
    
      handle.addEventListener('touchstart', e => {
        startY = e.touches[0].clientY;
        dragging = true;
        sheet.style.transition = 'none';
      }, {passive:true});
    
      document.addEventListener('touchmove', e => {
        if (!dragging) return;
        currentY = e.touches[0].clientY;
        const dy = Math.max(0, currentY - startY);
        sheet.style.transform = `translateY(${dy}px)`;
      }, {passive:true});
    
      document.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        sheet.style.transition = '';
        const dy = currentY - startY;
        if (dy > 100) {
          onClose();
        } else {
          sheet.style.transform = '';
        }
      }, {passive:true});
    }
    
    function ws11InitSheet() {
      
    
      let backdrop = document.querySelector('.ws11-sheet-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'ws11-sheet-backdrop';
        document.body.appendChild(backdrop);
      }
    
      let sheet = document.querySelector('.ws11-sheet');
      if (!sheet) {
        sheet = document.createElement('div');
        sheet.className = 'ws11-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-hidden', 'true');
        sheet.innerHTML =
          '<div class="ws11-sheet-handle"></div>' +
          '<div class="ws11-sheet-title"></div>' +
          '<div class="ws11-sheet-body"></div>';
        document.body.appendChild(sheet);
      }
    
      const sheetBody = sheet.querySelector('.ws11-sheet-body');
    
      _sheet = {
        _backdrop: backdrop,
        _sheet: sheet,
        _sheetBody: sheetBody,
        _focusTrap: null,
        _triggerEl: null,
        _onDismiss: null,
    
        open({ title, content, onDismiss }) {
          this._triggerEl = document.activeElement;
          this._onDismiss = onDismiss || null;
    
          const titleEl = this._sheet.querySelector('.ws11-sheet-title');
          if (titleEl) titleEl.textContent = title || '';
          if (this._sheetBody) this._sheetBody.innerHTML = typeof content === 'string' ? content : '';
    
          requestAnimationFrame(() => {
            this._backdrop.classList.add('ws11-visible');
            this._sheet.classList.add('ws11-visible');
            this._sheet.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            _haptic?.medium();
          });
    
          this._setupFocusTrap();
    
          this._escHandler = (e) => { if (e.key === 'Escape') this.close(); };
          document.addEventListener('keydown', this._escHandler);
        },
    
        close() {
          this._backdrop.classList.remove('ws11-visible');
          this._sheet.classList.remove('ws11-visible');
          this._sheet.setAttribute('aria-hidden', 'true');
          document.body.style.overflow = '';
          document.removeEventListener('keydown', this._escHandler);
          if (this._focusTrap) document.removeEventListener('keydown', this._focusTrap);
          _haptic?.light();
          if (this._onDismiss) this._onDismiss();
          if (this._triggerEl) {
            try { this._triggerEl.focus(); } catch(e) {}
          }
        },
    
        _setupFocusTrap() {
          this._focusTrap = (e) => {
            if (e.key !== 'Tab') return;
            const focusable = this._sheet.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          };
          document.addEventListener('keydown', this._focusTrap);
        }
      };
    
      backdrop.addEventListener('click', () => _sheet.close());
      ws11SetupSheetDrag(sheet, () => _sheet.close());
    }
    
    function ws11InitPageTransitions() {
      if (window.__ws11PagePatched) return;
      const _orig = window.showPage;
      if (!_orig) return;
    
      window.showPage = function(name, pushState) {
        _haptic?.selection();
        _orig.call(window, name, pushState);
      };
      window.__ws11PagePatched = true;
    }
    
    function ws11InitPullToRefresh() {
      // Skip if the app already has its own PTR (index.html #ptr-indicator)
      if (document.getElementById('ptr-indicator')) {
        console.log('[MK] ws11: Existing PTR detected, skipping ws11 PTR');
        return;
      }
      const main = document.querySelector('.main');
      if (!main) return;
    
      const ptr = document.createElement('div');
      ptr.className = 'ws11-ptr';
      ptr.id = 'ws11-ptr';
      ptr.innerHTML = '<div class="ws11-ptr-spinner"></div>';
      document.body.appendChild(ptr);
    
      let startY = 0, pulling = false, refreshing = false;
      const THRESHOLD = 80;
    
      main.addEventListener('touchstart', e => {
        if (refreshing) return;
        if (window.scrollY > 5) return;
        startY = e.touches[0].clientY;
        pulling = true;
        ptr.classList.add('ws11-pulling');
      }, {passive:true});
    
      main.addEventListener('touchmove', e => {
        if (!pulling || refreshing) return;
        const dy = Math.max(0, e.touches[0].clientY - startY);
        if (dy > 0 && window.scrollY <= 0) {
          const progress = Math.min(dy / THRESHOLD, 1.5);
          const offset = Math.min(dy * 0.4, 70);
          ptr.style.transform = `translateY(${offset - 56}px)`;
          ptr.querySelector('.ws11-ptr-spinner').style.transform = `rotate(${progress * 360}deg)`;
          if (dy >= THRESHOLD && !ptr.dataset.crossed) {
            ptr.dataset.crossed = '1';
            _haptic?.medium();
          }
        }
      }, {passive:true});
    
      main.addEventListener('touchend', () => {
        if (!pulling) return;
        pulling = false;
        ptr.classList.remove('ws11-pulling');
        delete ptr.dataset.crossed;
    
        const currentOffset = parseFloat(ptr.style.transform.replace(/[^0-9.-]/g,'')) || -56;
        if (currentOffset > 10) {
          refreshing = true;
          ptr.classList.add('ws11-refreshing');
          _haptic?.success();
    
          const done = () => {
            refreshing = false;
            ptr.classList.remove('ws11-refreshing');
            ptr.style.transform = 'translateY(-56px)';
          };
    
          if (typeof window.refreshData === 'function') {
            try { window.refreshData(); } catch(e) {}
            setTimeout(done, 1500);
          } else {
            document.dispatchEvent(new CustomEvent('mk:refresh'));
            setTimeout(done, 1500);
          }
        } else {
          ptr.style.transform = 'translateY(-56px)';
        }
      }, {passive:true});
    }
    
    function ws11InitScrollHide() {
      let lastY = 0, ticking = false;
      const DELTA = 8;
    
      window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = window.scrollY;
          if (y > 60 && y - lastY > DELTA) {
            document.body.classList.add('ws11-chrome-hidden');
          } else if (lastY - y > DELTA || y < 30) {
            document.body.classList.remove('ws11-chrome-hidden');
          }
          lastY = y;
          ticking = false;
        });
      }, {passive:true});
    }
    
    function ws11InitTabEnhancements() {
      const nav = document.getElementById('mobile-nav');
      if (!nav) return;
    
      let lastHomeTap = 0;
      const homeLink = nav.querySelector('[data-page="dashboard"]');
      if (homeLink) {
        homeLink.addEventListener('click', () => {
          const now = Date.now();
          if (now - lastHomeTap < 400 && document.querySelector('#page-dashboard.active')) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            _haptic?.medium();
          }
          lastHomeTap = now;
        });
      }
    
      nav.querySelectorAll('a').forEach(a => {
        a.addEventListener('touchstart', () => _haptic?.selection(), {passive:true});
      });
    }
    
    function ws11InitInputFocus() {
      document.addEventListener('focusin', (e) => {
        if (window.innerWidth >= 900) return;
        const el = e.target;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          setTimeout(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 350);
        }
      });
    }
    
    function ws11InitOffline() {
      let badge = null;
    
      function show() {
        if (badge) return;
        badge = document.createElement('div');
        badge.className = 'ws11-offline-badge';
        badge.setAttribute('role', 'alert');
        badge.textContent = 'You are offline \u2014 showing cached data';
        document.body.appendChild(badge);
      }
    
      function hide() {
        if (badge) { badge.remove(); badge = null; }
      }
    
      window.addEventListener('offline', show);
      window.addEventListener('online', hide);
      if (!navigator.onLine) show();
    }
    
    function ws11InitRevealOnScroll() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('ws11-revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    
      function observeElements() {
        const page = document.querySelector('.page.active');
        if (!page) return;
        page.querySelectorAll('.card, .metric, .deal-card').forEach(el => {
          if (!el.classList.contains('ws11-reveal')) {
            el.classList.add('ws11-reveal');
            observer.observe(el);
          }
        });
      }
    
      observeElements();
      document.addEventListener('mk:page-changed', observeElements);
      const _origShow = window.showPage;
      if (_origShow && !window.__ws11RevealPatched) {
        window.__ws11RevealPatched = true;
        setTimeout(observeElements, 500);
      }
    }
    
    // ── Long-press Context Menu for Deal Cards ──
    function ws11InitLongPress() {
      if (window.innerWidth >= 900) return;

      let pressTimer = null;
      let ctxMenu = null;
      let ctxBackdrop = null;

      function createCtxMenu() {
        if (ctxMenu) return;
        ctxBackdrop = document.createElement('div');
        ctxBackdrop.className = 'ws11-sheet-backdrop';
        ctxBackdrop.addEventListener('click', closeCtxMenu);
        document.body.appendChild(ctxBackdrop);

        ctxMenu = document.createElement('div');
        ctxMenu.className = 'ws11-ctx-menu';
        ctxMenu.setAttribute('role', 'menu');
        ctxMenu.setAttribute('aria-label', 'Deal actions');
        ctxMenu.innerHTML =
          '<div class="ws11-ctx-menu-handle"></div>' +
          '<div class="ws11-ctx-menu-title" id="ws11-ctx-title"></div>' +
          '<div class="ws11-ctx-menu-sub" id="ws11-ctx-sub"></div>' +
          '<div id="ws11-ctx-actions"></div>';
        document.body.appendChild(ctxMenu);
      }

      function openCtxMenu(card) {
        createCtxMenu();
        const ref = card.querySelector('.ref, [style*="color:var(--accent)"]')?.textContent || 'Item';
        const price = card.querySelector('.green, .profit-badge')?.textContent || '';
        document.getElementById('ws11-ctx-title').textContent = ref.trim();
        document.getElementById('ws11-ctx-sub').textContent = price ? `${price}` : 'Deal card';

        const actions = document.getElementById('ws11-ctx-actions');
        actions.innerHTML = [
          { label: 'Look up price', icon: 'M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z', action: () => { closeCtxMenu(); if (window.showPage) showPage('lookup'); }},
          { label: 'Copy reference', icon: 'M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z', action: () => {
            navigator.clipboard?.writeText(ref.trim());
            closeCtxMenu();
            if (_toast) _toast.show('Copied: ' + ref.trim(), { type: 'success' });
            else if (window.showToast) showToast('Copied!', 'success');
          }},
          { label: 'Save to watchlist', icon: 'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z', action: () => {
            closeCtxMenu();
            _haptic?.success();
            if (_toast) _toast.show('Saved to watchlist', { type: 'success' });
          }},
          ...(navigator.share ? [{ label: 'Share deal', icon: 'M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13', action: () => {
            closeCtxMenu();
            if (_share) _share.deal(ref.trim(), price, '');
          }}] : [])
        ].map(a =>
          `<button class="ws11-ctx-action" role="menuitem">` +
          `<svg class="ws11-ctx-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${a.icon}"/></svg>` +
          `${a.label}</button>`
        ).join('');

        // Re-bind click events
        const actionBtns = actions.querySelectorAll('.ws11-ctx-action');
        const actionData = [
          () => { closeCtxMenu(); if (window.showPage) showPage('lookup'); },
          () => {
            navigator.clipboard?.writeText(ref.trim());
            closeCtxMenu();
            if (_toast) _toast.show('Copied: ' + ref.trim(), { type: 'success' });
          },
          () => { closeCtxMenu(); _haptic?.success(); if (_toast) _toast.show('Saved to watchlist', { type: 'success' }); },
          ...(navigator.share ? [() => { closeCtxMenu(); if (_share) _share.deal(ref.trim(), price, ''); }] : [])
        ];
        actionBtns.forEach((btn, i) => btn.addEventListener('click', actionData[i]));

        requestAnimationFrame(() => {
          ctxBackdrop.classList.add('ws11-visible');
          ctxMenu.classList.add('ws11-visible');
        });
        _haptic?.heavy();
        document.body.style.overflow = 'hidden';
      }

      function closeCtxMenu() {
        if (!ctxMenu) return;
        ctxBackdrop.classList.remove('ws11-visible');
        ctxMenu.classList.remove('ws11-visible');
        document.body.style.overflow = '';
        _haptic?.light();
      }

      // Delegate long-press on deal cards
      document.addEventListener('touchstart', (e) => {
        const card = e.target.closest('.deal-card');
        if (!card) return;
        pressTimer = setTimeout(() => openCtxMenu(card), 500);
      }, { passive: true });

      document.addEventListener('touchmove', () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      }, { passive: true });

      document.addEventListener('touchend', () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      }, { passive: true });
    }

    // ── More Menu → Sheet upgrade ──
    function ws11UpgradeMoreMenu() {
      if (window.innerWidth >= 900) return;
      // Patch toggleMobileMore to add haptic feedback
      const _origToggle = window.toggleMobileMore;
      if (_origToggle && !window.__ws11MorePatched) {
        window.toggleMobileMore = function() {
          _haptic?.light();
          _origToggle.call(window);
        };
        window.__ws11MorePatched = true;
      }
      // Patch mobileNav to add haptic
      const _origMobileNav = window.mobileNav;
      if (_origMobileNav && !window.__ws11MobileNavPatched) {
        window.mobileNav = function(page) {
          _haptic?.selection();
          _origMobileNav.call(window, page);
        };
        window.__ws11MobileNavPatched = true;
      }
    }

    // ── First-visit swipe hint ──
    function ws11InitSwipeHint() {
      if (window.innerWidth >= 900) return;
      if (localStorage.getItem('ws11-hint-shown')) return;

      const hint = document.createElement('div');
      hint.className = 'ws11-swipe-indicator';
      hint.textContent = 'Swipe deal cards to save or dismiss';
      document.body.appendChild(hint);

      // Show hint when user first visits deals page
      const checkDeals = () => {
        if (document.querySelector('#page-deals.active')) {
          requestAnimationFrame(() => hint.classList.add('ws11-visible'));
          setTimeout(() => {
            hint.classList.remove('ws11-visible');
            setTimeout(() => hint.remove(), 400);
          }, 4000);
          localStorage.setItem('ws11-hint-shown', '1');
        }
      };
      document.addEventListener('mk:page-changed', checkDeals);
      setTimeout(checkDeals, 2000);
    }

    // ── Mobile Theme Toggle FAB ──
    function ws11InitThemeToggle() {
      if (window.innerWidth >= 900) return;
      if (document.getElementById('ws11-theme-fab')) return;

      const fab = document.createElement('button');
      fab.id = 'ws11-theme-fab';
      fab.className = 'ws11-theme-fab';
      fab.setAttribute('aria-label', 'Toggle dark/light mode');
      fab.setAttribute('role', 'switch');

      function updateIcon() {
        const isLight = document.documentElement.classList.contains('light');
        fab.setAttribute('aria-checked', String(isLight));
        fab.innerHTML = isLight
          ? '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
          : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
      }

      fab.addEventListener('click', () => {
        _haptic?.medium();
        // Add smooth transition class
        document.documentElement.classList.add('ws11-transitioning');
        if (typeof window.toggleTheme === 'function') {
          window.toggleTheme();
        } else {
          document.documentElement.classList.toggle('light');
          localStorage.setItem('mk-theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
        }
        updateIcon();
        setTimeout(() => document.documentElement.classList.remove('ws11-transitioning'), 350);
      });

      updateIcon();
      document.body.appendChild(fab);

      // Watch for external theme changes
      const observer = new MutationObserver(() => updateIcon());
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Lazy Load Images ──
    function ws11InitLazyImages() {
      if (window.innerWidth >= 900) return;

      // Add loading="lazy" to all images that don't have it
      document.querySelectorAll('img:not([loading])').forEach(img => {
        img.setAttribute('loading', 'lazy');
      });

      // Observe for dynamically added images
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.tagName === 'IMG' && !node.getAttribute('loading')) {
              node.setAttribute('loading', 'lazy');
            }
            if (node.querySelectorAll) {
              node.querySelectorAll('img:not([loading])').forEach(img => {
                img.setAttribute('loading', 'lazy');
              });
            }
          });
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // ── Metric Count-Up Animation ──
    function ws11InitCountUp() {
      if (window.innerWidth >= 900) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      function animateValue(el, endVal, duration) {
        const isPrice = endVal.startsWith('$') || endVal.startsWith('-$');
        const prefix = isPrice ? (endVal.startsWith('-') ? '-$' : '$') : '';
        const suffix = endVal.endsWith('%') ? '%' : '';
        const numStr = endVal.replace(/[^0-9.-]/g, '');
        const end = parseFloat(numStr);
        if (isNaN(end)) return;

        const start = 0;
        const startTime = performance.now();
        el.classList.add('ws11-counting');

        function tick(now) {
          const progress = Math.min((now - startTime) / duration, 1);
          // Ease out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = start + (end - start) * eased;

          if (Math.abs(end) >= 100) {
            el.textContent = prefix + Math.round(current).toLocaleString() + suffix;
          } else {
            el.textContent = prefix + current.toFixed(1) + suffix;
          }

          if (progress < 1) {
            requestAnimationFrame(tick);
          } else {
            el.textContent = endVal; // Ensure exact final value
            el.classList.remove('ws11-counting');
          }
        }
        requestAnimationFrame(tick);
      }

      // Observe metric values for initial appearance
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const val = entry.target;
            const text = val.textContent.trim();
            if (text && text !== '--' && !val.dataset.ws11Counted) {
              val.dataset.ws11Counted = '1';
              animateValue(val, text, 600);
            }
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });

      function observeMetrics() {
        document.querySelectorAll('.metric .val').forEach(el => {
          if (!el.dataset.ws11Counted) observer.observe(el);
        });
      }

      observeMetrics();
      // Re-observe after page changes
      document.addEventListener('mk:page-changed', () => setTimeout(observeMetrics, 300));
    }

    // ── Sparkline Touch Handler ──
    function ws11InitSparklineTouch() {
      if (window.innerWidth >= 900) return;

      document.addEventListener('touchstart', (e) => {
        const canvas = e.target.closest('.sparkline-wrap canvas');
        if (!canvas) return;

        // Show value tooltip on touch
        const rect = canvas.getBoundingClientRect();
        const x = e.touches[0].clientX - rect.left;
        const ratio = x / rect.width;

        // Trigger the existing mousemove handler if present
        const mouseEvent = new MouseEvent('mousemove', {
          clientX: e.touches[0].clientX,
          clientY: e.touches[0].clientY
        });
        canvas.dispatchEvent(mouseEvent);
        _haptic?.selection();
      }, { passive: true });

      document.addEventListener('touchend', (e) => {
        const canvas = e.target.closest('.sparkline-wrap canvas');
        if (canvas) {
          canvas.dispatchEvent(new MouseEvent('mouseleave'));
        }
      }, { passive: true });
    }

    // ── Form InputMode Fixes ──
    function ws11FixInputModes() {
      if (window.innerWidth >= 900) return;

      // Add inputmode="decimal" to all type="number" inputs (triggers numeric keyboard)
      document.querySelectorAll('input[type="number"]').forEach(input => {
        if (!input.getAttribute('inputmode')) {
          input.setAttribute('inputmode', 'decimal');
        }
      });

      // Add inputmode="search" to search inputs (adds Search key on keyboard)
      ['ref-search', 'compare-ref-a', 'compare-ref-b', 'im-search', 'usearch-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.getAttribute('inputmode')) {
          el.setAttribute('inputmode', 'search');
          el.setAttribute('enterkeyhint', 'search');
        }
      });

      // Add enterkeyhint="done" to form inputs in modals
      document.querySelectorAll('#watch-modal input, #tracker-form-modal input').forEach(input => {
        if (!input.getAttribute('enterkeyhint')) {
          input.setAttribute('enterkeyhint', 'done');
        }
      });

      // Observe for dynamically added inputs
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            const inputs = node.querySelectorAll ? node.querySelectorAll('input[type="number"]:not([inputmode])') : [];
            inputs.forEach(input => input.setAttribute('inputmode', 'decimal'));
          });
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // ── Table Scroll Indicator ──
    function ws11InitTableScroll() {
      if (window.innerWidth >= 900) return;

      document.querySelectorAll('.tbl-wrap').forEach(wrap => {
        // Skip shipping tracker (uses card layout on mobile)
        if (wrap.closest('#page-shipping')) return;

        wrap.addEventListener('scroll', () => {
          const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
          wrap.classList.toggle('ws11-scrolled-end', atEnd);
        }, { passive: true });

        // Initial check
        requestAnimationFrame(() => {
          if (wrap.scrollWidth <= wrap.clientWidth) {
            wrap.classList.add('ws11-scrolled-end');
          }
        });
      });
    }

    // ── Keyboard Dismiss on Scroll ──
    function ws11InitKeyboardDismiss() {
      if (window.innerWidth >= 900) return;

      let activeInput = null;
      document.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          activeInput = e.target;
        }
      });

      // Blur input on scroll start (dismiss keyboard like native apps)
      let scrollTimeout = null;
      window.addEventListener('scroll', () => {
        if (!activeInput) return;
        if (scrollTimeout) return; // Debounce
        scrollTimeout = setTimeout(() => {
          scrollTimeout = null;
        }, 200);
        // Only dismiss if significant scroll
        if (document.activeElement === activeInput) {
          activeInput.blur();
          activeInput = null;
        }
      }, { passive: true });
    }

    // ── Swipe Page Edge Indicators ──
    function ws11InitSwipeIndicators() {
      if (window.innerWidth >= 900) return;

      const pages = ['dashboard','inventory','jam','lookup','deals','portfolio','invoices','shipping','payments','postings','photos'];

      const leftEl = document.createElement('div');
      leftEl.className = 'ws11-swipe-edge ws11-swipe-edge-left';
      leftEl.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>';

      const rightEl = document.createElement('div');
      rightEl.className = 'ws11-swipe-edge ws11-swipe-edge-right';
      rightEl.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>';

      document.body.appendChild(leftEl);
      document.body.appendChild(rightEl);

      // Show indicators briefly on page change
      function flashIndicators() {
        const cur = document.querySelector('.page.active')?.id?.replace('page-', '');
        const allowed = window.__USER_ROLE?.allowedPages || pages;
        const idx = allowed.indexOf(cur);

        if (idx > 0) leftEl.classList.add('ws11-visible');
        if (idx < allowed.length - 1 && idx >= 0) rightEl.classList.add('ws11-visible');

        setTimeout(() => {
          leftEl.classList.remove('ws11-visible');
          rightEl.classList.remove('ws11-visible');
        }, 1200);
      }

      // Patch showPage to flash indicators
      const _orig = window.showPage;
      if (_orig && !window.__ws11SwipeIndPatched) {
        const __prevShowPage = window.showPage;
        window.showPage = function(name, ps) {
          __prevShowPage.call(window, name, ps);
          setTimeout(flashIndicators, 350);
        };
        window.__ws11SwipeIndPatched = true;
      }
    }

    // ── Onboarding Coach Marks ──
    function ws11InitOnboarding() {
      if (window.innerWidth >= 900) return;
      if (localStorage.getItem('ws11-onboarded')) return;

      const steps = [
        {
          title: 'Welcome to MK Opulence',
          desc: 'Your luxury watch market intelligence dashboard, now optimized for mobile. Let\'s show you around.'
        },
        {
          title: 'Swipe Between Pages',
          desc: 'Swipe left or right anywhere to navigate between pages. The bottom bar gives you quick access to your most-used screens.'
        },
        {
          title: 'Quick Commands',
          desc: 'Tap the Quick button in the nav bar to instantly record buys, sells, and shipments — no forms needed.'
        },
        {
          title: 'Long-press Deal Cards',
          desc: 'Press and hold any deal card for quick actions: look up prices, copy references, or save to your watchlist.'
        },
        {
          title: 'Pull to Refresh',
          desc: 'Pull down from the top to sync the latest market data. You\'re all set — happy trading!'
        }
      ];

      let currentStep = 0;
      let overlay = null;

      function show(idx) {
        if (idx >= steps.length) {
          dismiss();
          return;
        }
        currentStep = idx;
        const step = steps[idx];
        const isLast = idx === steps.length - 1;

        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'ws11-coach-overlay';
          overlay.setAttribute('role', 'dialog');
          overlay.setAttribute('aria-modal', 'true');
          overlay.setAttribute('aria-label', 'Onboarding');
          document.body.appendChild(overlay);
        }

        const dots = steps.map((_, i) =>
          `<div class="ws11-coach-dot ${i === idx ? 'ws11-active' : ''}"></div>`
        ).join('');

        overlay.innerHTML =
          `<div class="ws11-coach-card">` +
          `<div class="ws11-coach-title">${step.title}</div>` +
          `<div class="ws11-coach-desc">${step.desc}</div>` +
          `<div class="ws11-coach-dots">${dots}</div>` +
          `<button class="ws11-coach-btn" id="ws11-coach-next">${isLast ? 'Get Started' : 'Next'}</button>` +
          `<button class="ws11-coach-skip" id="ws11-coach-skip">${isLast ? '' : 'Skip tour'}</button>` +
          `</div>`;

        overlay.querySelector('#ws11-coach-next').addEventListener('click', () => {
          _haptic?.light();
          show(idx + 1);
        });
        const skipBtn = overlay.querySelector('#ws11-coach-skip');
        if (skipBtn) skipBtn.addEventListener('click', dismiss);
      }

      function dismiss() {
        if (overlay) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 200ms ease';
          setTimeout(() => { overlay?.remove(); overlay = null; }, 220);
        }
        localStorage.setItem('ws11-onboarded', '1');
        _haptic?.success();
      }

      // Start onboarding after a brief delay
      setTimeout(() => show(0), 2000);
    }

    // ── Nav Badge Sync ──
    function ws11InitNavBadges() {
      if (window.innerWidth >= 900) return;

      function syncBadges() {
        // Map desktop nav badge IDs to mobile nav data-page
        const badgeMap = {
          'deals-count': 'deals',
          'payments-count': 'payments'
        };

        for (const [badgeId, page] of Object.entries(badgeMap)) {
          const desktop = document.getElementById(badgeId);
          if (!desktop) continue;
          const count = desktop.textContent.trim();
          const mobileLink = document.querySelector(`#mobile-nav a[data-page="${page}"], .more-grid-item[onclick*="${page}"]`);
          if (!mobileLink) continue;

          // Find or create badge
          let badge = mobileLink.querySelector('.ws11-nav-badge');
          if (count && count !== '0') {
            if (!badge) {
              badge = document.createElement('span');
              badge.className = 'ws11-nav-badge';
              mobileLink.style.position = 'relative';
              mobileLink.appendChild(badge);
            }
            badge.textContent = count;
          } else if (badge) {
            badge.remove();
          }
        }
      }

      // Sync periodically (badges update on data refresh)
      syncBadges();
      setInterval(syncBadges, 5000);
      document.addEventListener('mk:data-loaded', syncBadges);
    }

    // ── Scroll Progress Bar ──
    function ws11InitScrollProgress() {
      if (window.innerWidth >= 900) return;

      const bar = document.createElement('div');
      bar.className = 'ws11-scroll-progress';
      bar.innerHTML = '<div class="ws11-scroll-progress-bar"></div>';
      document.body.appendChild(bar);
      const fill = bar.querySelector('.ws11-scroll-progress-bar');

      let ticking = false;
      window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          const progress = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
          fill.style.width = progress + '%';
          ticking = false;
        });
      }, { passive: true });
    }

    // ── Status Bar Theme Color Sync ──
    function ws11InitThemeColorSync() {
      if (window.innerWidth >= 900) return;

      function syncColor() {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        const isLight = document.documentElement.classList.contains('light');
        meta.setAttribute('content', isLight ? '#f5f4f0' : '#08080c');
      }

      syncColor();
      // Watch for class changes on html
      const obs = new MutationObserver(syncColor);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Scroll Position Memory ──
    function ws11InitScrollMemory() {
      if (window.innerWidth >= 900) return;

      const positions = {};

      // Save scroll position before page change
      const _orig = window.showPage;
      if (_orig && !window.__ws11ScrollMemPatched) {
        const __prev = window.showPage;
        window.showPage = function(name, ps) {
          // Save current page scroll
          const cur = document.querySelector('.page.active')?.id?.replace('page-', '');
          if (cur) positions[cur] = window.scrollY;
          __prev.call(window, name, ps);
          // Restore saved position (after page renders)
          requestAnimationFrame(() => {
            const saved = positions[name];
            if (saved && saved > 0) {
              window.scrollTo(0, saved);
            }
          });
        };
        window.__ws11ScrollMemPatched = true;
      }
    }

    // ── Web Share API for deals ──
    function ws11InitShare() {
      if (window.innerWidth >= 900) return;
      if (!navigator.share) return; // Not supported

      // Web Share API wrapper (module-private)
      
      _share = {
        async deal(ref, price, discount) {
          try {
            await navigator.share({
              title: `MK Opulence — ${ref}`,
              text: `${ref} at ${price} (${discount} below market)`,
              url: window.location.origin + '?p=deals'
            });
            _haptic?.success();
          } catch (e) {
            if (e.name !== 'AbortError') console.warn('[MK] Share failed:', e);
          }
        },
        async text(title, text) {
          try {
            await navigator.share({ title, text });
            _haptic?.success();
          } catch (e) {
            if (e.name !== 'AbortError') console.warn('[MK] Share failed:', e);
          }
        }
      };
    }

    // ── Orientation change handler ──
    function ws11InitOrientation() {
      if (window.innerWidth >= 900) return;

      // Re-check mobile state on orientation change
      window.addEventListener('orientationchange', () => {
        setTimeout(() => {
          // Force layout recalculation after orientation settles
          document.body.style.display = 'none';
          document.body.offsetHeight; // Force reflow
          document.body.style.display = '';
        }, 100);
      });

      // Also handle resize for fold/unfold devices
      let lastWidth = window.innerWidth;
      window.addEventListener('resize', () => {
        const newWidth = window.innerWidth;
        if (Math.abs(newWidth - lastWidth) > 100) {
          // Significant resize (fold/unfold, orientation)
          lastWidth = newWidth;
          // Re-sync any width-dependent features
          document.querySelectorAll('.tbl-wrap').forEach(wrap => {
            if (wrap.scrollWidth <= wrap.clientWidth) {
              wrap.classList.add('ws11-scrolled-end');
            } else {
              wrap.classList.remove('ws11-scrolled-end');
            }
          });
        }
      }, { passive: true });
    }



    // ══ Enhancement 1 ══
    function ws11Enh1CSS() { return `
    @media(max-width:900px){
      .ws11-photo-nav{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:10000;}
      .ws11-photo-nav button{position:absolute;top:50%;transform:translateY(-50%);
        pointer-events:auto;background:rgba(0,0,0,0.5);border:none;color:#fff;
        font-size:1.6rem;width:40px;height:64px;border-radius:6px;cursor:pointer;
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
        transition:opacity 0.2s,background 0.2s;opacity:0.7;}
      .ws11-photo-nav button:active{background:rgba(255,255,255,0.15);opacity:1;}
      .ws11-photo-nav .ws11-pn-left{left:6px;}
      .ws11-photo-nav .ws11-pn-right{right:6px;}
      #editor-canvas.ws11-zoomed{cursor:grab;touch-action:none;}
    }
    `;}
    
    function ws11Enh1Init() {
      var modal = document.getElementById('photo-modal');
      if (!modal) return;
      var canvas = document.getElementById('editor-canvas');
      if (!canvas) return;
    
      // -- Nav overlay --
      var nav = document.createElement('div');
      nav.className = 'ws11-photo-nav';
      nav.innerHTML = '<button class="ws11-pn-left" aria-label="Previous photo">\u2039</button>' +
                      '<button class="ws11-pn-right" aria-label="Next photo">\u203A</button>';
      modal.appendChild(nav);
    
      function curIndex() {
        if (!window.photoLibraryData || !window.editorWatchId) return -1;
        for (var i = 0; i < window.photoLibraryData.length; i++) {
          if (window.photoLibraryData[i].watch_id === window.editorWatchId) return i;
        }
        return -1;
      }
      function go(dir) {
        var list = window.photoLibraryData;
        if (!list || !list.length) return;
        var idx = curIndex();
        if (idx < 0) return;
        var next = idx + dir;
        if (next < 0 || next >= list.length) return;
        if (_haptic) _haptic.light();
        resetZoom();
        if (typeof window.openPhotoModal === 'function') window.openPhotoModal(list[next].watch_id);
      }
      nav.querySelector('.ws11-pn-left').addEventListener('click', function() { go(-1); });
      nav.querySelector('.ws11-pn-right').addEventListener('click', function() { go(1); });
    
      // Show/hide nav when modal toggles
      var obs = new MutationObserver(function() {
        nav.style.display = modal.style.display === 'none' ? 'none' : '';
      });
      obs.observe(modal, { attributes: true, attributeFilter: ['style'] });
      nav.style.display = 'none';
    
      // -- Swipe detection on canvas --
      var swStartX = 0, swStartY = 0, swiping = false;
      canvas.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1 || scale > 1) return;
        swStartX = e.touches[0].clientX;
        swStartY = e.touches[0].clientY;
        swiping = true;
      }, { passive: true });
      canvas.addEventListener('touchend', function(e) {
        if (!swiping) return;
        swiping = false;
        var t = e.changedTouches[0];
        var dx = t.clientX - swStartX, dy = t.clientY - swStartY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }, { passive: true });
    
      // -- Pinch-to-zoom --
      var scale = 1, baseScale = 1, startDist = 0;
      function dist(a, b) {
        var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }
      canvas.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
          swiping = false;
          startDist = dist(e.touches[0], e.touches[1]);
          baseScale = scale;
        }
      }, { passive: true });
      canvas.addEventListener('touchmove', function(e) {
        if (e.touches.length !== 2) return;
        var d = dist(e.touches[0], e.touches[1]);
        scale = Math.min(5, Math.max(1, baseScale * (d / startDist)));
        canvas.style.transform = 'scale(' + scale + ')';
        if (scale > 1) canvas.classList.add('ws11-zoomed');
      }, { passive: true });
      canvas.addEventListener('touchend', function() {
        if (scale <= 1.05) resetZoom();
      }, { passive: true });
    
      // -- Double-tap to reset zoom --
      var lastTap = 0;
      canvas.addEventListener('touchend', function(e) {
        if (e.touches.length > 0) return;
        var now = Date.now();
        if (now - lastTap < 300) {
          resetZoom();
          if (_haptic) _haptic.light();
        }
        lastTap = now;
      }, { passive: true });
    
      function resetZoom() {
        scale = 1;
        baseScale = 1;
        canvas.style.transform = 'scale(1)';
        canvas.classList.remove('ws11-zoomed');
      }
    }

    // ══ Enhancement 2 ══
    function ws11Enh2CSS() {
      return `
    @media(max-width:900px){
      .ws11-row-detail{
        background:#f8f9fa;padding:12px;border-bottom:1px solid #e0e0e0;
        font-size:.75rem;overflow:hidden;
        animation:ws11SlideDown .2s ease-out;
      }
      .ws11-row-detail-grid{
        display:grid;grid-template-columns:auto 1fr;gap:4px 12px;
      }
      .ws11-row-detail-grid span:nth-child(odd){font-weight:600;color:#555}
      .ws11-row-expanded{border-left:3px solid #4a90d9}
      @keyframes ws11SlideDown{
        from{max-height:0;opacity:0}
        to{max-height:300px;opacity:1}
      }
    }`;
    }
    
    function ws11Enh2Init() {
      document.addEventListener('click', function(e) {
        if (window.innerWidth >= 900) return;
        var row = e.target.closest('.tbl tbody tr');
        if (!row) return;
        if (e.target.closest('a,button,input,select,textarea')) return;
        var table = row.closest('.tbl');
        if (!table) return;
        var existing = row.nextElementSibling;
        if (existing && existing.classList.contains('ws11-row-detail')) {
          existing.remove();
          row.classList.remove('ws11-row-expanded');
          if (typeof _haptic === 'function') _haptic();
          return;
        }
        var headers = table.querySelectorAll('thead th.hide-mobile');
        if (!headers.length) return;
        var allTh = Array.from(table.querySelectorAll('thead th'));
        var cells = row.children;
        var pairs = [];
        headers.forEach(function(th) {
          var idx = allTh.indexOf(th);
          if (idx < 0 || idx >= cells.length) return;
          var val = cells[idx].textContent.trim();
          if (val) pairs.push({ label: th.textContent.trim(), value: val });
        });
        if (!pairs.length) return;
        var detail = document.createElement('tr');
        detail.className = 'ws11-row-detail';
        var td = document.createElement('td');
        td.colSpan = cells.length;
        var grid = document.createElement('div');
        grid.className = 'ws11-row-detail-grid';
        pairs.forEach(function(p) {
          var l = document.createElement('span');
          l.textContent = p.label;
          var v = document.createElement('span');
          v.textContent = p.value;
          grid.appendChild(l);
          grid.appendChild(v);
        });
        td.appendChild(grid);
        detail.appendChild(td);
        row.classList.add('ws11-row-expanded');
        row.parentNode.insertBefore(detail, row.nextSibling);
        if (typeof _haptic === 'function') _haptic();
      });
    }

    // ══ Enhancement 3 ══
    function ws11Enh3CSS() {
      return "";
    }
    
    function ws11Enh3Init() {
      function isMobile() {
        return window.innerWidth < 900;
      }
    
      function toRelativeTime(text) {
        var match = text.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/);
        if (!match) return null;
        var then = new Date(match[1]);
        if (isNaN(then.getTime())) return null;
        var diff = Math.floor((Date.now() - then.getTime()) / 1000);
        if (diff < 0) return null;
        if (diff < 60) return diff + "s ago";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        return Math.floor(diff / 86400) + "d ago";
      }
    
      function compactDollar(text) {
        var match = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
        if (!match) return null;
        var num = parseFloat(match[1].replace(/,/g, ""));
        if (isNaN(num) || num < 10000) return null;
        if (num >= 1e9) return "$" + (num / 1e9).toFixed(2) + "B";
        if (num >= 1e6) return "$" + (num / 1e6).toFixed(2) + "M";
        if (num >= 1e3) return "$" + (num / 1e3).toFixed(1) + "K";
        return null;
      }
    
      function run() {
        if (!isMobile()) return;
    
        var subs = document.querySelectorAll(".metric .sub");
        for (var i = 0; i < subs.length; i++) {
          var el = subs[i];
          if (el.dataset.ws11Original == null) {
            el.dataset.ws11Original = el.textContent;
          }
          var rel = toRelativeTime(el.dataset.ws11Original);
          if (rel) el.textContent = rel;
        }
    
        var metrics = document.querySelectorAll(".metric");
        for (var j = 0; j < metrics.length; j++) {
          var valEls = metrics[j].querySelectorAll(".value, .amount, .number");
          for (var k = 0; k < valEls.length; k++) {
            var ve = valEls[k];
            if (ve.dataset.ws11Full == null) {
              ve.dataset.ws11Full = ve.textContent;
            }
            var compact = compactDollar(ve.dataset.ws11Full);
            if (compact) {
              ve.setAttribute("title", ve.dataset.ws11Full.trim());
              ve.textContent = compact;
            }
          }
        }
      }
    
      run();
      document.addEventListener("mk:data-loaded", run);
      document.addEventListener("mk:page-changed", run);
    }

    // ══ Enhancement 4 ══
    function ws11Enh4CSS() {
      return `@media(max-width:900px){
    .ws11-empty-state{display:flex;flex-direction:column;align-items:center;padding:48px 24px;text-align:center}
    .ws11-empty-icon{width:64px;height:64px;opacity:0.2;margin-bottom:16px;stroke:var(--text-2)}
    .ws11-empty-title{font-size:1.1rem;font-weight:700;margin-bottom:6px}
    .ws11-empty-desc{font-size:0.82rem;color:var(--text-2);line-height:1.5;max-width:280px;margin:0 auto 18px}
    .ws11-empty-action{background:var(--accent);color:#000;padding:14px;border-radius:12px;min-height:48px;border:none;cursor:pointer;font-weight:600}
    }`;
    }
    
    function ws11Enh4Init() {
      if (window.innerWidth > 900) return;
      function makeEmpty(title, desc, actionText, actionFn) {
        var el = document.createElement('div');
        el.className = 'ws11-empty-state';
        el.innerHTML = '<svg class="ws11-empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2"/>' +
          '<path d="M22 38s3-4 10-4 10 4 10 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
          '<circle cx="24" cy="26" r="2" fill="currentColor"/><circle cx="40" cy="26" r="2" fill="currentColor"/></svg>' +
          '<div class="ws11-empty-title">' + title + '</div>' +
          '<div class="ws11-empty-desc">' + desc + '</div>' +
          (actionText ? '<button class="ws11-empty-action">' + actionText + '</button>' : '');
        if (actionText && actionFn) el.querySelector('.ws11-empty-action').addEventListener('click', actionFn);
        return el;
      }
      function replaceNode(node, emptyEl) {
        if (node.parentNode) { node.parentNode.replaceChild(emptyEl, node); }
      }
      function scan() {
        document.querySelectorAll('td, div, p, span, section').forEach(function(el) {
          if (el.querySelector('.ws11-empty-state')) return;
          var txt = el.textContent.trim();
          if (txt === 'No results' || txt === 'No watches found') {
            var replacement = makeEmpty('Nothing here yet',
              'Try adjusting your filters or add a new item to get started.',
              'Browse catalog', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
            replaceNode(el, replacement);
          }
        });
        document.querySelectorAll('tbody').forEach(function(tb) {
          if (tb.children.length === 0 && !tb.querySelector('.ws11-empty-state')) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.setAttribute('colspan', '99');
            td.appendChild(makeEmpty('No data available',
              'This table is empty. New entries will appear here automatically.', null, null));
            tr.appendChild(td);
            tb.appendChild(tr);
          }
        });
      }
      var loadingTimers = new WeakSet();
      var observer = new MutationObserver(function() {
        if (window.innerWidth > 900) return;
        document.querySelectorAll('td, div, p, span, section').forEach(function(el) {
          if (el.textContent.trim() === 'Loading...' && !loadingTimers.has(el)) {
            loadingTimers.add(el);
            setTimeout(function() {
              if (el.textContent.trim() === 'Loading...') {
                var replacement = makeEmpty('Still loading?',
                  'This is taking longer than expected. Check your connection or try refreshing.',
                  'Refresh', function() { location.reload(); });
                replaceNode(el, replacement);
              }
            }, 3000);
          }
        });
        scan();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      scan();
    }

    // ══ Enhancement 5 ══
    function ws11Enh5CSS() {
      return `@media(max-width:900px){
    .ws11-quick-bar{position:fixed;bottom:calc(72px + env(safe-area-inset-bottom));left:12px;right:12px;height:48px;border-radius:14px;background:rgba(22,22,30,0.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:space-around;z-index:190;box-shadow:0 4px 20px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);transition:transform .3s ease,opacity .3s ease}
    .light .ws11-quick-bar{background:rgba(255,255,255,0.88);box-shadow:0 4px 20px rgba(0,0,0,0.1);border-color:rgba(0,0,0,0.06)}
    .ws11-quick-bar.ws11-hidden{transform:translateY(calc(100% + 12px));opacity:0;pointer-events:none}
    .ws11-quick-bar-btn{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:0.55rem;color:var(--text-2);padding:6px 12px;border-radius:8px;border:none;background:none;font-family:var(--font);transition:transform .15s ease,background .15s ease;cursor:pointer}
    .ws11-quick-bar-btn:active{transform:scale(0.92);background:var(--accent-dim)}
    .ws11-quick-bar-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    }`;}
    
    function ws11Enh5Init() {
      if (window.innerWidth > 900) return;
      var bar = document.createElement('div');
      bar.className = 'ws11-quick-bar ws11-hidden';
      document.body.appendChild(bar);
      var pageActions = {
        dashboard: [
          { label: 'Refresh', icon: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>', fn: function() { if (typeof refreshData === 'function') refreshData(); } },
          { label: 'Search', icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', fn: function() { var lk = document.querySelector('[data-page="lookup"]'); if (lk) lk.click(); } },
          { label: 'Quick Cmd', icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', fn: function() { var e = new CustomEvent('openQuickCommand'); document.dispatchEvent(e); } }
        ],
        deals: [
          { label: 'Filter', icon: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', fn: function() { var f = document.querySelector('.deal-filters,.filter-bar'); if (f) f.scrollIntoView({ behavior: 'smooth' }); } },
          { label: 'Top', icon: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>', fn: function() { window.scrollTo({ top: 0, behavior: 'smooth' }); } }
        ],
        inventory: [
          { label: 'Search', icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', fn: function() { var s = document.getElementById('im-search'); if (s) s.focus(); } },
          { label: 'Add Watch', icon: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>', fn: function() { var e = new CustomEvent('openWatchModal'); document.dispatchEvent(e); } }
        ],
        lookup: [
          { label: 'Clear', icon: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', fn: function() { var inp = document.querySelector('.lookup-input,#lookup-search'); if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input')); } } },
          { label: 'Compare', icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>', fn: function() { var e = new CustomEvent('toggleCompare'); document.dispatchEvent(e); } }
        ]
      };
      var currentHandlers = [];
      function renderBar(pageId) {
        var actions = pageActions[pageId];
        currentHandlers = [];
        if (!actions) { bar.classList.add('ws11-hidden'); return; }
        bar.innerHTML = '';
        actions.forEach(function(a) {
          var btn = document.createElement('button');
          btn.className = 'ws11-quick-bar-btn';
          btn.innerHTML = '<svg viewBox="0 0 24 24">' + a.icon + '</svg><span>' + a.label + '</span>';
          var handler = function() { if (typeof _haptic === 'function') _haptic(); a.fn(); };
          btn.addEventListener('click', handler);
          currentHandlers.push({ el: btn, fn: handler });
          bar.appendChild(btn);
        });
        bar.classList.remove('ws11-hidden');
      }
      function getActivePage() {
        var el = document.querySelector('.page.active');
        return el ? (el.id || el.getAttribute('data-page') || '') : '';
      }
      var lastPage = '';
      function checkPage() {
        var p = getActivePage();
        if (p !== lastPage) { lastPage = p; renderBar(p); }
      }
      checkPage();
      setInterval(checkPage, 500);
      var origShowPage = window.showPage;
      if (typeof origShowPage === 'function') {
        window.showPage = function() {
          var r = origShowPage.apply(this, arguments);
          setTimeout(checkPage, 50);
          return r;
        };
      }
      window.addEventListener('resize', function() {
        var kbOpen = window.innerHeight < screen.height * 0.7;
        bar.style.display = kbOpen ? 'none' : 'flex';
      });
    }

    // ══ Enhancement 6 ══
    function ws11Enh6CSS() {
      return `
    .ws11-skip-link{position:absolute;top:-100px;left:16px;background:var(--accent);color:#000;padding:12px 20px;border-radius:8px;font-weight:700;z-index:99999;font-size:.88rem;transition:top 200ms}
    .ws11-skip-link:focus{top:calc(8px + env(safe-area-inset-top))}
    .ws11-a11y-live{position:absolute;clip:rect(0,0,0,0);width:1px;height:1px;overflow:hidden}
    `;
    }
    
    function ws11Enh6Init() {
      if (window.innerWidth > 768) return;
    
      var main = document.querySelector('.main');
      var skip = document.createElement('a');
      skip.className = 'ws11-skip-link';
      skip.href = '#main-content';
      skip.textContent = 'Skip to content';
      if (main) {
        if (!main.id) main.id = 'main-content';
        skip.href = '#' + main.id;
      }
      document.body.insertBefore(skip, document.body.firstChild);
    
      var live = document.createElement('div');
      live.className = 'ws11-a11y-live';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('role', 'status');
      document.body.appendChild(live);
    
      function announce(msg) {
        live.textContent = '';
        setTimeout(function() { live.textContent = msg; }, 100);
      }
    
      var nav = document.querySelector('.mobile-nav');
      if (nav && !nav.getAttribute('role')) nav.setAttribute('role', 'navigation');
    
      if (main && !main.getAttribute('role')) main.setAttribute('role', 'main');
    
      document.querySelectorAll('button').forEach(function(btn) {
        if (btn.getAttribute('aria-label')) return;
        var children = Array.from(btn.childNodes).filter(function(n) {
          return n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim());
        });
        var onlySvg = children.length > 0 && children.every(function(n) {
          return n.nodeType === 1 && n.tagName === 'SVG';
        });
        if (onlySvg) btn.setAttribute('aria-label', 'Action button');
      });
    
      function markCurrentPage() {
        var links = document.querySelectorAll('.mobile-nav a, .mobile-nav button');
        links.forEach(function(el) { el.removeAttribute('aria-current'); });
        var active = document.querySelector('.mobile-nav .active, .mobile-nav [data-active]');
        if (active) active.setAttribute('aria-current', 'page');
      }
      markCurrentPage();
    
      var moreToggle = document.querySelector('.more-toggle, [data-more-toggle]');
      if (moreToggle && !moreToggle.hasAttribute('aria-expanded')) {
        moreToggle.setAttribute('aria-expanded', 'false');
        moreToggle.addEventListener('click', function() {
          var exp = moreToggle.getAttribute('aria-expanded') === 'true';
          moreToggle.setAttribute('aria-expanded', String(!exp));
        });
      }
    
      var fab = document.querySelector('.fab, [data-fab]');
      if (fab && !fab.hasAttribute('aria-expanded')) {
        fab.setAttribute('aria-expanded', 'false');
        fab.addEventListener('click', function() {
          var exp = fab.getAttribute('aria-expanded') === 'true';
          fab.setAttribute('aria-expanded', String(!exp));
        });
      }
    
      document.querySelectorAll('.deal-card').forEach(function(card) {
        if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
      });
    
      var observer = new MutationObserver(function() {
        markCurrentPage();
        var active = document.querySelector('.mobile-nav .active, .mobile-nav [aria-current="page"]');
        if (active) announce('Navigated to ' + (active.textContent || 'new page').trim());
      });
      if (nav) observer.observe(nav, { attributes: true, subtree: true });
    }

    // ══ Enhancement 7 ══
    function ws11Enh7CSS() {
      return `@media(max-width:900px){
    .page:not(.active){content-visibility:hidden}
    .ws11-will-change-transform{will-change:transform}
    .ws11-gpu{transform:translateZ(0)}
    img{content-visibility:auto}
    }`;
    }
    
    function ws11Enh7Init() {
      if (window.innerWidth > 900) return;
      var isMobile = function() { return window.innerWidth <= 900; };
      var cards = document.querySelectorAll('.card');
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          e.target.style.contentVisibility = e.isIntersecting ? 'visible' : 'auto';
        });
      }, { rootMargin: '200px' });
      cards.forEach(function(card, i) {
        observer.observe(card);
        if (i > 3) {
          if ('requestIdleCallback' in window) {
            requestIdleCallback(function() { card.style.contentVisibility = 'auto'; });
          } else {
            card.style.contentVisibility = 'auto';
          }
        }
      });
      document.addEventListener('animationstart', function(e) {
        if (!isMobile()) return;
        e.target.classList.add('ws11-will-change-transform');
      }, true);
      document.addEventListener('transitionstart', function(e) {
        if (!isMobile()) return;
        e.target.classList.add('ws11-will-change-transform');
      }, true);
      var removeWillChange = function(e) {
        e.target.classList.remove('ws11-will-change-transform');
      };
      document.addEventListener('animationend', removeWillChange, true);
      document.addEventListener('transitionend', removeWillChange, true);
      var prefetched = {};
      var prefetch = function(e) {
        if (!isMobile()) return;
        var tab = e.target.closest('[data-page]');
        if (!tab) return;
        var pageId = tab.getAttribute('data-page');
        if (prefetched[pageId]) return;
        prefetched[pageId] = true;
        var page = document.querySelector('.page#' + pageId);
        if (!page || page.classList.contains('active')) return;
        page.classList.add('active');
        requestAnimationFrame(function() {
          requestAnimationFrame(function() { page.classList.remove('active'); });
        });
      };
      var nav = document.querySelector('nav, .nav, .tabs');
      if (nav) {
        nav.addEventListener('mouseenter', prefetch, true);
        nav.addEventListener('touchstart', prefetch, { capture: true, passive: true });
      }
    }

    // ══ Enhancement 8 ══
    function ws11Enh8CSS() {
      return `
    .ws11-gesture-feedback{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:30000;background:rgba(22,22,30,0.9);backdrop-filter:blur(16px);border-radius:20px;padding:20px 28px;color:var(--text-0);font-size:0.88rem;font-weight:600;pointer-events:none;opacity:0;transition:opacity 200ms;text-align:center}
    .ws11-gesture-feedback.ws11-visible{opacity:1}
    .ws11-gesture-feedback svg{width:32px;height:32px;margin-bottom:8px;stroke:var(--accent);display:block;margin:0 auto 8px}`;
    }
    
    function ws11Enh8Init() {
      var fb = document.createElement('div');
      fb.className = 'ws11-gesture-feedback';
      document.body.appendChild(fb);
      var hideTimer = null;
    
      function showFeedback(icon, label) {
        fb.innerHTML = icon + '<div>' + label + '</div>';
        fb.classList.add('ws11-visible');
        if (typeof _haptic === 'function') _haptic();
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function() { fb.classList.remove('ws11-visible'); }, 600);
      }
    
      var searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
      var refreshIcon = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
      var cmdIcon = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>';
    
      // Two-finger tap = search, three-finger tap = quick command
      var touchStart = 0;
      document.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2 || e.touches.length === 3) touchStart = Date.now();
      }, { passive: true });
    
      document.addEventListener('touchend', function(e) {
        if (Date.now() - touchStart > 400) return;
        var count = e.touches.length + e.changedTouches.length;
        if (count === 2) {
          showFeedback(searchIcon, 'Search');
          if (typeof openUnifiedSearch === 'function') openUnifiedSearch();
          else if (typeof showPage === 'function') showPage('lookup');
        } else if (count === 3) {
          showFeedback(cmdIcon, 'Quick Command');
          if (typeof openCommandPalette === 'function') openCommandPalette();
        }
      }, { passive: true });
    
      // Shake detection via devicemotion
      if ('DeviceMotionEvent' in window && 'ontouchstart' in window) {
        var shakes = [], lastShake = 0;
        window.addEventListener('devicemotion', function(e) {
          var a = e.accelerationIncludingGravity;
          if (!a) return;
          var mag = Math.max(Math.abs(a.x || 0), Math.abs(a.y || 0), Math.abs(a.z || 0));
          var now = Date.now();
          if (mag > 15 && now - lastShake > 200) {
            lastShake = now;
            shakes.push(now);
            shakes = shakes.filter(function(t) { return now - t < 1000; });
            if (shakes.length >= 3) {
              shakes = [];
              showFeedback(refreshIcon, 'Refresh');
              if (typeof refreshData === 'function') refreshData();
            }
          }
        }, { passive: true });
      }
    }

    // ══ Enhancement 9 ══
    function ws11Enh9CSS() {
      return `
    @media(max-width:900px){
      #page-dashboard .card{transition:order 300ms ease}
      .ws11-card-priority-badge{position:absolute;top:8px;right:8px;font-size:0.5rem;
        padding:2px 6px;border-radius:10px;background:var(--accent-dim);color:var(--accent);
        font-family:var(--mono);pointer-events:none;z-index:2}
    }`;
    }
    
    function ws11Enh9Init() {
      if (window.innerWidth > 900) return;
      const timeSlots = {
        morning: ['portfolio', 'deals'],
        afternoon: ['shipping', 'inventory'],
        evening: ['action-items', 'analytics']
      };
      function getSlot() {
        const h = new Date().getHours();
        if (h >= 6 && h < 12) return 'morning';
        if (h >= 12 && h < 18) return 'afternoon';
        if (h >= 18 && h < 24) return 'evening';
        return 'morning';
      }
      function getRecentPages() {
        try { return JSON.parse(localStorage.getItem('ws11-recent-pages') || '[]'); }
        catch { return []; }
      }
      function trackPage(page) {
        const recent = getRecentPages().filter(p => p !== page);
        recent.unshift(page);
        localStorage.setItem('ws11-recent-pages', JSON.stringify(recent.slice(0, 10)));
      }
      function cardMatchesKey(card, key) {
        const txt = (card.getAttribute('data-card') || card.textContent || '').toLowerCase();
        return txt.includes(key.replace('-', ' ')) || txt.includes(key);
      }
      function reorder() {
        if (window.innerWidth > 900) return;
        const dash = document.querySelector('#page-dashboard');
        if (!dash) return;
        const cards = Array.from(dash.querySelectorAll('.card'));
        if (!cards.length) return;
        const slot = getSlot();
        const priorities = [...timeSlots[slot]];
        const recent = getRecentPages();
        recent.forEach(p => { if (!priorities.includes(p)) priorities.push(p); });
        cards.forEach(c => {
          c.style.position = 'relative';
          c.style.order = '99';
          const old = c.querySelector('.ws11-card-priority-badge');
          if (old) old.remove();
        });
        let rank = 1;
        priorities.forEach(key => {
          cards.forEach(card => {
            if (cardMatchesKey(card, key) && card.style.order === '99') {
              card.style.order = String(rank);
              const badge = document.createElement('span');
              badge.className = 'ws11-card-priority-badge';
              badge.textContent = '#' + rank;
              card.appendChild(badge);
              rank++;
            }
          });
        });
      }
      reorder();
      document.addEventListener('mk:page-changed', function(e) {
        const page = (e.detail && e.detail.page) || '';
        if (page) trackPage(page);
        if (page === 'dashboard') reorder();
      });
    }

    // ══ Enhancement 10 ══
    function ws11Enh10CSS() {
      return `@media(max-width:900px){
    .ws11-connection-dot{width:8px;height:8px;position:fixed;top:calc(14px + env(safe-area-inset-top));left:12px;z-index:200;border-radius:50%;transition:background 200ms}
    .ws11-connection-dot.ws11-online{background:var(--green);box-shadow:0 0 6px rgba(0,230,118,0.4)}
    .ws11-connection-dot.ws11-slow{background:var(--orange);box-shadow:0 0 6px rgba(251,146,60,0.4)}
    .ws11-connection-dot.ws11-offline{background:var(--red);box-shadow:0 0 6px rgba(255,23,68,0.4)}
    .ws11-retry-indicator{position:fixed;bottom:calc(140px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:rgba(22,22,30,0.9);backdrop-filter:blur(12px);border-radius:12px;padding:10px 18px;font-size:0.78rem;color:var(--text-1);z-index:300;display:flex;align-items:center;gap:8px;animation:ws11SlideDown 300ms ease}
    .ws11-retry-spinner{width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.6s linear infinite}
    @keyframes ws11SlideDown{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    }`;
    }
    
    function ws11Enh10Init() {
      if (window.innerWidth > 900) return;
      var dot = document.createElement('div');
      dot.className = 'ws11-connection-dot ws11-online';
      document.body.appendChild(dot);
      var retryEl = null;
    
      function showRetry() {
        if (retryEl) return;
        retryEl = document.createElement('div');
        retryEl.className = 'ws11-retry-indicator';
        retryEl.innerHTML = '<div class="ws11-retry-spinner"></div>Retrying...';
        document.body.appendChild(retryEl);
      }
    
      function hideRetry() {
        if (retryEl) { retryEl.remove(); retryEl = null; }
      }
    
      function setQuality(cls) {
        dot.className = 'ws11-connection-dot ' + cls;
      }
    
      function checkLatency() {
        if (!navigator.onLine) { setQuality('ws11-offline'); return; }
        var start = performance.now();
        fetch(location.origin, { method: 'HEAD', cache: 'no-store' }).then(function() {
          var ms = performance.now() - start;
          if (ms < 500) setQuality('ws11-online');
          else if (ms <= 2000) setQuality('ws11-slow');
          else setQuality('ws11-slow');
        }).catch(function() {
          setQuality('ws11-offline');
        });
      }
    
      checkLatency();
      var timer = setInterval(checkLatency, 30000);
    
      window.addEventListener('online', function() {
        setQuality('ws11-online');
        if (typeof _haptic === 'function') _haptic('light');
        checkLatency();
      });
    
      window.addEventListener('offline', function() {
        setQuality('ws11-offline');
        clearInterval(timer);
        timer = setInterval(checkLatency, 30000);
      });
    
      var origFetch = window.fetch;
      window.fetch = function() {
        var args = arguments;
        return origFetch.apply(this, args).catch(function(err) {
          showRetry();
          return new Promise(function(resolve) {
            setTimeout(function() { resolve(origFetch.apply(window, args)); }, 2000);
          }).then(function(res) {
            hideRetry();
            setQuality('ws11-online');
            if (typeof _haptic === 'function') _haptic('light');
            return res;
          }).catch(function(e) {
            hideRetry();
            setQuality('ws11-offline');
            throw e;
          });
        });
      };
    }

    function ws11Cleanup() {
      ['ws11-mobile-premium-styles', 'ws11-toast-container', 'ws11-ptr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      document.querySelectorAll('.ws11-sheet-backdrop, .ws11-sheet, .ws11-offline-badge, .ws11-ctx-menu, .ws11-swipe-indicator, #ws11-theme-fab, .ws11-swipe-edge, .ws11-coach-overlay, .ws11-scroll-progress').forEach(el => el.remove());
      document.body.classList.remove('ws11-chrome-hidden');
      document.body.style.overflow = '';
    }


    // ── Module Definition ──
    const ws11 = {
        priority: 'deferred',

        init() {
            if (!isMobile() && !isTouchDevice()) {
                console.log(`[MK] ${MOD_ID}: Desktop detected — skipping mobile premium layer`);
                return;
            }

            console.log(`[MK] ${MOD_ID}: Initializing premium mobile UX...`);
            const t0 = performance.now();

            // Inject CSS
            const styleEl = document.createElement('style');
            styleEl.id = 'ws11-mobile-premium-styles';
            styleEl.textContent = ws11GetCSS();
            document.head.appendChild(styleEl);

            // Init features (order matters)
            ws11InitHaptic();
            ws11InitToast();
            ws11InitSheet();
            ws11InitPageTransitions();
            ws11InitPullToRefresh();
            ws11InitScrollHide();
            ws11InitTabEnhancements();
            ws11InitInputFocus();
            ws11InitOffline();
            ws11InitRevealOnScroll();
            ws11InitLongPress();
            ws11UpgradeMoreMenu();
            ws11InitSwipeHint();
            ws11FixInputModes();
            ws11InitTableScroll();
            ws11InitKeyboardDismiss();
            ws11InitThemeToggle();
            ws11InitLazyImages();
            ws11InitCountUp();
            ws11InitSparklineTouch();
            ws11InitSwipeIndicators();
            ws11InitOnboarding();
            ws11InitNavBadges();
            ws11InitScrollProgress();
            ws11InitThemeColorSync();
            ws11InitScrollMemory();
            ws11InitShare();
            ws11InitOrientation();

            // Phase 7: Enhancement modules (10 parallel agents)
            const enhCSS = [ws11Enh1CSS,ws11Enh2CSS,ws11Enh3CSS,ws11Enh4CSS,ws11Enh5CSS,ws11Enh6CSS,ws11Enh7CSS,ws11Enh8CSS,ws11Enh9CSS,ws11Enh10CSS]
              .map(fn => { try { return fn(); } catch(e) { return ''; } }).join('\n');
            if (enhCSS) {
              const enhStyle = document.createElement('style');
              enhStyle.id = 'ws11-enhancements-styles';
              enhStyle.textContent = enhCSS;
              document.head.appendChild(enhStyle);
            }
            [ws11Enh1Init,ws11Enh2Init,ws11Enh3Init,ws11Enh4Init,ws11Enh5Init,ws11Enh6Init,ws11Enh7Init,ws11Enh8Init,ws11Enh9Init,ws11Enh10Init]
              .forEach(fn => { try { fn(); } catch(e) { console.warn('[MK] Enhancement init failed:', e); } });

            const elapsed = (performance.now() - t0).toFixed(1);
            console.log(`[MK] ${MOD_ID}: Premium mobile layer active (${elapsed}ms) — ` +
                `haptic:${'vibrate' in navigator}, touch:${isTouchDevice()}, ` +
                `reducedMotion:${prefersReducedMotion()}`);
        },

        render() {
            if (!isMobile()) return;
            // Re-observe elements after data refresh
            ws11InitRevealOnScroll();
        },

        cleanup() {
            ws11Cleanup();
        }
    };

    // ── Register ──
    if (window.MKModules) {
        window.MKModules.register(MOD_ID, ws11);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (window.MKModules) window.MKModules.register(MOD_ID, ws11);
        });
    }
})();
