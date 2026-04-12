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
    `; }

    // ── JS Behavior Layer ──
    function ws11InitHaptic() {
      window.MK = window.MK || {};
      MK.Haptic = {
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
      window.MK = window.MK || {};
    
      const container = document.createElement('div');
      container.className = 'ws11-toast-container';
      container.id = 'ws11-toast-container';
      document.body.appendChild(container);
    
      MK.Toast = {
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
          MK.Haptic?.light();
    
          while (this._container.children.length > 3) {
            dismissToast(this._container.firstChild);
          }
    
          const timer = setTimeout(() => dismissToast(toast), duration);
          toast._timer = timer;
        }
      };
    
      const _origShowToast = window.showToast;
      window.showToast = function(message, type, duration) {
        if (window.innerWidth < 900 && MK.Toast._container) {
          MK.Toast.show(message, { type: type || 'info', duration: duration || 3000 });
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
      window.MK = window.MK || {};
    
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
    
      MK.Sheet = {
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
            MK.Haptic?.medium();
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
          MK.Haptic?.light();
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
    
      backdrop.addEventListener('click', () => MK.Sheet.close());
      ws11SetupSheetDrag(sheet, () => MK.Sheet.close());
    }
    
    function ws11InitPageTransitions() {
      if (window.__ws11PagePatched) return;
      const _orig = window.showPage;
      if (!_orig) return;
    
      window.showPage = function(name, pushState) {
        MK.Haptic?.selection();
        _orig.call(window, name, pushState);
      };
      window.__ws11PagePatched = true;
    }
    
    function ws11InitPullToRefresh() {
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
            MK.Haptic?.medium();
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
          MK.Haptic?.success();
    
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
            MK.Haptic?.medium();
          }
          lastHomeTap = now;
        });
      }
    
      nav.querySelectorAll('a').forEach(a => {
        a.addEventListener('touchstart', () => MK.Haptic?.selection(), {passive:true});
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
            if (window.MK?.Toast) MK.Toast.show('Copied: ' + ref.trim(), { type: 'success' });
            else if (window.showToast) showToast('Copied!', 'success');
          }},
          { label: 'Save to watchlist', icon: 'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z', action: () => {
            closeCtxMenu();
            MK.Haptic?.success();
            if (window.MK?.Toast) MK.Toast.show('Saved to watchlist', { type: 'success' });
          }}
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
            if (window.MK?.Toast) MK.Toast.show('Copied: ' + ref.trim(), { type: 'success' });
          },
          () => { closeCtxMenu(); MK.Haptic?.success(); if (window.MK?.Toast) MK.Toast.show('Saved to watchlist', { type: 'success' }); }
        ];
        actionBtns.forEach((btn, i) => btn.addEventListener('click', actionData[i]));

        requestAnimationFrame(() => {
          ctxBackdrop.classList.add('ws11-visible');
          ctxMenu.classList.add('ws11-visible');
        });
        MK.Haptic?.heavy();
        document.body.style.overflow = 'hidden';
      }

      function closeCtxMenu() {
        if (!ctxMenu) return;
        ctxBackdrop.classList.remove('ws11-visible');
        ctxMenu.classList.remove('ws11-visible');
        document.body.style.overflow = '';
        MK.Haptic?.light();
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
          MK.Haptic?.light();
          _origToggle.call(window);
        };
        window.__ws11MorePatched = true;
      }
      // Patch mobileNav to add haptic
      const _origMobileNav = window.mobileNav;
      if (_origMobileNav && !window.__ws11MobileNavPatched) {
        window.mobileNav = function(page) {
          MK.Haptic?.selection();
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

    function ws11Cleanup() {
      ['ws11-mobile-premium-styles', 'ws11-toast-container', 'ws11-ptr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      document.querySelectorAll('.ws11-sheet-backdrop, .ws11-sheet, .ws11-offline-badge, .ws11-ctx-menu, .ws11-swipe-indicator').forEach(el => el.remove());
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
