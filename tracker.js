/**
 * NourOS Tracker v1.0
 * Behavioral Intelligence Engine for محمد نور لزيوت السيارات
 *
 * يسجّل:
 *  - Session ID + Device Info
 *  - Page Views + Scroll Depth
 *  - Product Views + Search Queries
 *  - WhatsApp Clicks (product / footer / cart)
 *  - Cart Events (add / remove / checkout intent)
 *  - Welcome Form Completion (lead capture)
 *  - Returning Visitors
 *  - Referrer Sources
 *
 * الإرسال: Cloudflare Worker → Supabase
 * التثبيت: <script src="/tracker.js" defer></script>  (آخر <body>)
 */

(function () {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────────────────────
  const CONFIG = {
    // ← غيّر ده لـ endpoint الـ Cloudflare Worker بتاعك
    endpoint: 'https://nouroil.nouroil.workers.dev/api/events',

    // ← غيّر ده لـ sessions endpoint
    sessionEndpoint: 'https://nouroil.nouroil.workers.dev/api/session',

    // ← غيّر ده لـ leads endpoint
    leadsEndpoint: 'https://nouroil.nouroil.workers.dev/api/leads',

    // كام % scroll يتسجّل
    scrollMilestones: [25, 50, 75, 90, 100],

    // وقت الـ session بالمللي ثانية (30 دقيقة)
    sessionTimeout: 30 * 60 * 1000,

    // تسجيل أحداث الـ debug في الـ console
    debug: false,
  };

  // ─── UTILITIES ─────────────────────────────────────────────────────────────

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function now() {
    return new Date().toISOString();
  }

  function log(...args) {
    if (CONFIG.debug) console.log('[NourOS Tracker]', ...args);
  }

  // قراءة وكتابة localStorage بأمان
  function store(key, val) {
    try { localStorage.setItem('_nour_' + key, JSON.stringify(val)); } catch (_) {}
  }
  function recall(key) {
    try { return JSON.parse(localStorage.getItem('_nour_' + key)); } catch (_) { return null; }
  }

  // إرسال event لـ API — fire-and-forget مع retry مرة واحدة
  function send(endpoint, payload) {
    const body = JSON.stringify(payload);
    log('send →', payload.event_type || payload.type || endpoint, payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const sent = navigator.sendBeacon(endpoint, blob);
      if (!sent) fallbackFetch(endpoint, body);
    } else {
      fallbackFetch(endpoint, body);
    }
  }

  function fallbackFetch(endpoint, body) {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  // ─── SESSION ENGINE ─────────────────────────────────────────────────────────

  const Session = (function () {
    let _id = null;
    let _isNew = false;

    function init() {
      const saved = recall('session');
      const ts = recall('session_ts');
      const expired = !ts || Date.now() - ts > CONFIG.sessionTimeout;

      if (saved && !expired) {
        _id = saved;
        _isNew = false;
      } else {
        _id = uuid();
        _isNew = true;
        store('session', _id);

        // حفظ عدد الزيارات
        const visits = (recall('visits') || 0) + 1;
        store('visits', visits);
      }

      store('session_ts', Date.now());
      return _id;
    }

    function id() { return _id; }
    function isNew() { return _isNew; }
    function visits() { return recall('visits') || 1; }

    return { init, id, isNew, visits };
  })();

  // ─── DEVICE / CONTEXT INFO ──────────────────────────────────────────────────

  function getContext() {
    return {
      url: location.href,
      path: location.pathname,
      referrer: document.referrer || null,
      utm_source: new URLSearchParams(location.search).get('utm_source'),
      utm_medium: new URLSearchParams(location.search).get('utm_medium'),
      user_agent: navigator.userAgent,
      screen: screen.width + 'x' + screen.height,
      language: navigator.language,
      is_mobile: /Mobi|Android/i.test(navigator.userAgent),
      visits: Session.visits(),
      is_returning: Session.visits() > 1,
    };
  }

  // ─── CORE EVENT SENDER ──────────────────────────────────────────────────────

  function track(event_type, metadata) {
    send(CONFIG.endpoint, {
      session_id: Session.id(),
      event_type,
      page_url: location.href,
      metadata: Object.assign({}, getContext(), metadata),
      ts: now(),
    });
  }

  // ─── SESSION REGISTRATION ───────────────────────────────────────────────────

  function registerSession() {
    if (!Session.isNew()) return;

    send(CONFIG.sessionEndpoint, {
      id: Session.id(),
      referrer: document.referrer || null,
      utm_source: new URLSearchParams(location.search).get('utm_source'),
      utm_medium: new URLSearchParams(location.search).get('utm_medium'),
      user_agent: navigator.userAgent,
      is_mobile: /Mobi|Android/i.test(navigator.userAgent),
      screen: screen.width + 'x' + screen.height,
      language: navigator.language,
      visit_number: Session.visits(),
      ts: now(),
    });

    log('New session registered:', Session.id());
  }

  // ─── PAGE VIEW ──────────────────────────────────────────────────────────────

  function trackPageView() {
    track('page_view', {
      title: document.title,
      is_returning: Session.visits() > 1,
      visit_number: Session.visits(),
    });
    log('page_view');
  }

  // ─── SCROLL DEPTH ───────────────────────────────────────────────────────────

  function trackScroll() {
    const reached = new Set();

    function onScroll() {
      const scrolled = Math.round(
        (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
      );
      CONFIG.scrollMilestones.forEach(function (m) {
        if (scrolled >= m && !reached.has(m)) {
          reached.add(m);
          track('scroll_depth', { percent: m });
          log('scroll_depth:', m + '%');
        }
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ─── PRODUCT VIEW ───────────────────────────────────────────────────────────
  // الموقع بيعرض المنتجات في كروت — نراقب لما تظهر في الـ viewport

  function trackProductViews() {
    if (!window.IntersectionObserver) return;

    const seen = new Set();

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          const productId = el.dataset.productId || el.dataset.id;
          const productName = el.dataset.productName || el.dataset.name ||
            el.querySelector('.product-name, [class*="name"], h3, h4')?.textContent?.trim();
          const productPrice = el.dataset.price ||
            el.querySelector('[class*="price"], .price')?.textContent?.trim();
          const productBrand = el.dataset.brand ||
            el.querySelector('[class*="brand"], .brand')?.textContent?.trim();

          if (!productId || seen.has(productId)) return;
          seen.add(productId);
          observer.unobserve(el);

          track('product_view', {
            product_id: productId,
            product_name: productName || null,
            product_price: productPrice || null,
            product_brand: productBrand || null,
          });
          log('product_view:', productName || productId);
        });
      },
      { threshold: 0.5, rootMargin: '0px 0px -50px 0px' }
    );

    // مراقبة الكروت الموجودة + الجديدة (تحميل المزيد)
    function observeCards() {
      document.querySelectorAll(
        '[data-product-id], [data-id], .product-card, [class*="product"]'
      ).forEach(function (el) {
        if (!el.dataset._tracked) {
          el.dataset._tracked = '1';
          observer.observe(el);
        }
      });
    }

    observeCards();

    // مراقبة إضافة منتجات جديدة عند "تحميل المزيد"
    const mo = new MutationObserver(observeCards);
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ─── SEARCH TRACKING ────────────────────────────────────────────────────────

  function trackSearch() {
    let searchTimer = null;

    function onSearchInput(e) {
      const q = e.target.value.trim();
      if (!q || q.length < 2) return;

      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        track('search', { query: q, query_length: q.length });
        log('search:', q);
      }, 600); // debounce — بعد 600ms من وقوف الكتابة
    }

    // مراقبة حقل البحث الرئيسي
    document.querySelectorAll('input[type="search"], input[type="text"][placeholder*="بحث"], input[placeholder*="search"]')
      .forEach(function (el) { el.addEventListener('input', onSearchInput); });

    // مراقبة أي input جديد يُضاف (SPA-safe)
    const mo = new MutationObserver(function () {
      document.querySelectorAll('input[type="search"]:not([data-tracked])')
        .forEach(function (el) {
          el.dataset.tracked = '1';
          el.addEventListener('input', onSearchInput);
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ─── WHATSAPP CLICK ─────────────────────────────────────────────────────────

  function trackWhatsApp() {
    document.addEventListener('click', function (e) {
      const el = e.target.closest('a[href*="wa.me"], a[href*="whatsapp"], [class*="whatsapp"], button');
      if (!el) return;

      const href = el.href || '';
      const text = el.textContent?.trim() || '';
      const isWA = href.includes('wa.me') || href.includes('whatsapp') ||
        text.includes('واتساب') || text.includes('WhatsApp') || text.includes('💬');

      if (!isWA) return;

      // تحديد السياق: من صفحة المنتج ولا الـ footer ولا السلة؟
      const isCartCheckout = !!el.closest('#cart, .cart, [class*="cart"]');
      const isProductBtn   = !!el.closest('[data-product-id], .product-card, [class*="product"]');
      const isFooter       = !!el.closest('footer, [class*="footer"]');

      const ctx = isCartCheckout ? 'cart_checkout'
        : isProductBtn ? 'product'
        : isFooter ? 'footer'
        : 'general';

      // استخراج بيانات المنتج لو موجودة
      const productEl = el.closest('[data-product-id], [data-id]');
      const productId = productEl?.dataset?.productId || productEl?.dataset?.id || null;
      const productName = productEl?.querySelector('[class*="name"], h3, h4')?.textContent?.trim() || null;

      // استخراج محتوى الـ message لو موجود في الرابط
      let waMessage = null;
      try {
        const url = new URL(href);
        waMessage = url.searchParams.get('text') || null;
      } catch (_) {}

      track('whatsapp_click', {
        context: ctx,
        product_id: productId,
        product_name: productName,
        wa_message_preview: waMessage ? waMessage.substring(0, 120) : null,
      });

      log('whatsapp_click:', ctx, productName || '');
    }, true);
  }

  // ─── CART EVENTS ────────────────────────────────────────────────────────────

  function trackCart() {
    document.addEventListener('click', function (e) {
      // Add to Cart
      const addBtn = e.target.closest('[class*="add-to-cart"], [data-action="add"], button[class*="add"]');
      if (addBtn) {
        const productEl = addBtn.closest('[data-product-id], [data-id], .product-card');
        track('cart_add', {
          product_id: productEl?.dataset?.productId || productEl?.dataset?.id || null,
          product_name: productEl?.querySelector('[class*="name"], h3')?.textContent?.trim() || null,
          product_price: productEl?.dataset?.price || null,
        });
        log('cart_add');
        return;
      }

      // Remove from Cart
      const removeBtn = e.target.closest('[class*="remove"], [data-action="remove"]');
      if (removeBtn && removeBtn.closest('#cart, [class*="cart"]')) {
        track('cart_remove', {
          product_id: removeBtn.dataset?.productId || null,
        });
        log('cart_remove');
      }
    }, true);
  }

  // ─── WELCOME FORM (LEAD CAPTURE) ────────────────────────────────────────────
  // الموقع عنده Welcome Flow بـ 4 خطوات — نراقب كل خطوة ونحفظ البيانات

  function trackWelcomeForm() {
    let formData = {};

    // مراقبة اختيار نوع النشاط (ورشة / محل / موزع / شخصي)
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[class*="business-type"], [data-type], [class*="type-btn"]');
      if (btn) {
        formData.business_type = btn.dataset?.type || btn.textContent?.trim();
        track('lead_step', { step: 'business_type', value: formData.business_type });
        log('lead_step: business_type =', formData.business_type);
      }

      // اختيار المحافظة
      const govBtn = e.target.closest('[data-gov], [class*="gov-btn"], [class*="governorate"]');
      if (govBtn) {
        formData.governorate = govBtn.dataset?.gov || govBtn.textContent?.trim();
        track('lead_step', { step: 'governorate', value: formData.governorate });
        log('lead_step: governorate =', formData.governorate);
      }

      // اختيار حجم الطلبيات
      const budgetBtn = e.target.closest('[data-budget], [class*="budget-btn"], [class*="budget"]');
      if (budgetBtn) {
        formData.budget_range = budgetBtn.dataset?.budget || budgetBtn.textContent?.trim();
        track('lead_step', { step: 'budget_range', value: formData.budget_range });
        log('lead_step: budget_range =', formData.budget_range);
      }
    }, true);

    // مراقبة إدخال الاسم
    document.addEventListener('input', function (e) {
      const el = e.target;
      if (el.matches('input[placeholder*="اسم"], input[name*="name"], input[id*="name"]')) {
        formData.name_typed = true;
      }
    }, true);

    // مراقبة إكمال الـ Form
    document.addEventListener('click', function (e) {
      const submitBtn = e.target.closest('[class*="submit"], [type="submit"], [class*="complete"]');
      if (!submitBtn) return;
      if (!submitBtn.closest('[class*="welcome"], [class*="onboard"], #welcome-modal, #onboarding')) return;

      // إرسال Lead
      const nameInput = document.querySelector('input[placeholder*="اسم"], input[name*="name"]');
      const phoneInput = document.querySelector('input[type="tel"], input[placeholder*="رقم"], input[placeholder*="phone"]');

      const lead = {
        session_id: Session.id(),
        name: nameInput?.value?.trim() || null,
        phone: phoneInput?.value?.trim() || null,
        business_type: formData.business_type || null,
        governorate: formData.governorate || null,
        budget_range: formData.budget_range || null,
        source: 'welcome_form',
        ts: now(),
      };

      send(CONFIG.leadsEndpoint, lead);
      store('lead_captured', true);
      store('lead_data', lead);

      track('lead_captured', { source: 'welcome_form', has_phone: !!lead.phone });
      log('lead_captured:', lead);
    }, true);

    // تسجيل تخطي الـ Form
    document.addEventListener('click', function (e) {
      if (e.target.closest('[class*="skip"], [class*="تخطي"]')) {
        track('lead_skipped', { step: formData.last_step || 'unknown' });
        log('lead_skipped');
      }
    }, true);
  }

  // ─── FILTER & SORT TRACKING ─────────────────────────────────────────────────

  function trackFilters() {
    // تتبع اختيار الصنف (brand filter)
    document.addEventListener('change', function (e) {
      const sel = e.target.closest('select, [class*="filter"], [class*="sort"]');
      if (!sel) return;
      track('filter_applied', {
        filter_type: sel.name || sel.id || sel.className,
        filter_value: sel.value || e.target.textContent?.trim(),
      });
      log('filter_applied:', sel.value);
    }, true);

    // تتبع الضغط على أزرار الترتيب
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[class*="sort-btn"], [data-sort], [class*="sort"]');
      if (!btn) return;
      track('sort_changed', {
        sort_value: btn.dataset?.sort || btn.textContent?.trim(),
      });
      log('sort_changed:', btn.textContent?.trim());
    }, true);
  }

  // ─── ENGAGEMENT TIME ────────────────────────────────────────────────────────

  function trackEngagement() {
    let startTime = Date.now();
    let active = true;
    let totalActive = 0;
    let lastActivity = Date.now();

    function resetIdle() {
      lastActivity = Date.now();
      active = true;
    }

    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
      window.addEventListener(ev, resetIdle, { passive: true });
    });

    // كل 10 ثواني — حساب الوقت الفعلي النشط
    setInterval(function () {
      if (Date.now() - lastActivity < 10000) {
        totalActive += 10;
      }
    }, 10000);

    // عند مغادرة الصفحة — إرسال وقت التفاعل
    window.addEventListener('beforeunload', function () {
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      track('session_end', {
        total_time_sec: totalTime,
        active_time_sec: totalActive,
        engagement_ratio: totalActive > 0 ? Math.round((totalActive / totalTime) * 100) : 0,
      });
    });

    // visibilitychange — لما يحوّل تاب
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        track('tab_hidden', { active_time_sec: totalActive });
      } else {
        lastActivity = Date.now();
        track('tab_visible', {});
      }
    });
  }

  // ─── LOAD MORE / PAGINATION ─────────────────────────────────────────────────

  function trackLoadMore() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[class*="load-more"], [class*="تحميل"], button[class*="more"]');
      if (!btn) return;
      track('load_more_clicked', {
        button_text: btn.textContent?.trim(),
      });
      log('load_more_clicked');
    }, true);
  }

  // ─── RETURNING VISITOR ──────────────────────────────────────────────────────

  function trackReturning() {
    if (Session.visits() > 1) {
      track('returning_visitor', {
        visit_number: Session.visits(),
        days_since_first: Math.round(
          (Date.now() - (recall('first_visit') || Date.now())) / 86400000
        ),
      });
      log('returning_visitor, visit #', Session.visits());
    } else {
      store('first_visit', Date.now());
    }
  }

  // ─── PWA INSTALL ────────────────────────────────────────────────────────────

  function trackPWA() {
    window.addEventListener('appinstalled', function () {
      track('pwa_installed', {});
      log('pwa_installed');
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      track('pwa_prompt_shown', {});
      e.userChoice?.then(function (r) {
        track('pwa_prompt_response', { outcome: r.outcome });
      });
    });
  }

  // ─── FACEBOOK CLICK ─────────────────────────────────────────────────────────

  function trackFacebook() {
    document.addEventListener('click', function (e) {
      const a = e.target.closest('a[href*="facebook.com"]');
      if (a) {
        track('facebook_click', { href: a.href });
        log('facebook_click');
      }
    }, true);
  }

  // ─── INIT ───────────────────────────────────────────────────────────────────

  function init() {
    Session.init();
    registerSession();
    trackPageView();
    trackReturning();
    trackScroll();
    trackProductViews();
    trackSearch();
    trackWhatsApp();
    trackCart();
    trackWelcomeForm();
    trackFilters();
    trackEngagement();
    trackLoadMore();
    trackPWA();
    trackFacebook();

    log('✅ NourOS Tracker initialized | Session:', Session.id(), '| Visit #', Session.visits());
  }

  // تشغيل بعد تحميل الـ DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── PUBLIC API (اختياري للاستخدام اليدوي) ─────────────────────────────────
  // مثال: NourTracker.track('custom_event', { key: 'value' })

  window.NourTracker = {
    track: track,
    session: Session.id,
    send: send,

    // دالة مخصوصة لتسجيل Lead بعد واتساب مباشرة
    captureLead: function (phone, extra) {
      if (!phone) return;
      const saved = recall('lead_data') || {};
      send(CONFIG.leadsEndpoint, Object.assign({
        session_id: Session.id(),
        phone: phone,
        source: 'manual',
        ts: now(),
      }, saved, extra));
      store('lead_captured', true);
      log('captureLead:', phone);
    },
  };

})();
