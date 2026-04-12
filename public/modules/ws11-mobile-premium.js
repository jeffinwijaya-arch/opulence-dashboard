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
      .page-head p{font-size:0.82rem;line-height:1.4}
      .metric .val{font-size:1.4rem}
      .metric .label{font-size:0.6rem;letter-spacing:1px}
    }
    
    /* === 5. Card & Metric Polish === */
    @media(max-width:900px){
      .card{border-radius:16px;overflow:hidden}
      .metric{border-radius:14px}
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
      /* Dashboard 2-col grids → stack on mobile */
      #page-dashboard div[style*="grid-template-columns:1fr 1fr"],
      #page-dashboard div[style*="grid-template-columns: 1fr 1fr"]{
        display:block !important;
      }
      #page-dashboard div[style*="grid-template-columns:1fr 1fr"] > .card,
      #page-dashboard div[style*="grid-template-columns: 1fr 1fr"] > .card{
        margin-bottom:10px;
      }
      /* Shipping 3-col form → 1-col */
      #page-shipping div[style*="grid-template-columns:1fr 1fr 1fr"],
      #page-shipping div[style*="grid-template-columns: 1fr 1fr 1fr"]{
        grid-template-columns:1fr !important;
      }
      /* Shipping 2-col form → 1-col */
      #page-shipping div[style*="grid-template-columns:1fr 1fr"],
      #page-shipping div[style*="grid-template-columns: 1fr 1fr"]{
        grid-template-columns:1fr !important;
      }
      /* All flex containers: allow wrapping */
      div[style*="display:flex"][style*="gap"]{flex-wrap:wrap !important}
      /* FX calculator grid → stack on small screens */
      #fx-result div[style*="grid-template-columns:1fr 1fr"]{
        grid-template-columns:1fr !important;
      }
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
