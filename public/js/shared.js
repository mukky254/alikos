/* =====================================================================
   ALIKO SHARED — site-wide utilities included on every page.
   Each function here is a small, real, independently working feature —
   not a mockup. See SITE-FEATURES-NOTES.md for the full numbered list.
   ===================================================================== */

/* 1. Toast / snackbar notifications — replaces plain alert() popups */
function toast(message, type) {
  let host = document.getElementById('aliko-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'aliko-toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'aliko-toast' + (type ? ' ' + type : '');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

/* 2. Copy-to-clipboard with toast feedback, used for phone/address/link */
async function copyToClipboard(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast((label || 'Copied') + ' copied to clipboard ✓');
    return true;
  } catch (e) {
    // 3. Fallback for browsers without Clipboard API permission
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast((label || 'Copied') + ' copied ✓'); } catch (e2) { toast('Could not copy — long-press to copy manually', 'error'); }
    ta.remove();
    return true;
  }
}

/* 4. Native share sheet, falling back to copy-to-clipboard */
async function shareOrCopy(data) {
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyToClipboard(data.url || data.text || '', 'Link');
}

/* 5. Debounce helper — used to throttle search-as-you-type, resize, etc. */
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* 6. Scroll-to-top floating button, appears after scrolling down */
function initScrollTop() {
  const btn = document.createElement('button');
  btn.id = 'aliko-scrolltop'; btn.className = 'aliko-scrolltop hidden'; btn.title = 'Back to top'; btn.textContent = '↑';
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  document.body.appendChild(btn);
  window.addEventListener('scroll', debounce(() => btn.classList.toggle('hidden', window.scrollY < 400), 100));
}

/* 7. Online/offline network status banner */
function initNetworkBanner() {
  const banner = document.createElement('div');
  banner.id = 'aliko-net-banner'; banner.className = 'aliko-net-banner hidden';
  banner.textContent = "You're offline — some features won't work until you're back online.";
  document.body.appendChild(banner);
  const update = () => banner.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', () => { update(); toast('Back online ✓'); });
  window.addEventListener('offline', update);
  update();
}

/* 8. prefers-reduced-motion respect — disables non-essential animation */
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function applyReducedMotionClass() {
  if (prefersReducedMotion()) document.documentElement.classList.add('aliko-reduced-motion');
}

/* 9. Keyboard shortcuts: "/" focuses the nearest search box, Esc blurs it */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      const box = document.getElementById('searchInput') || document.querySelector('input[type="search"], input[type="text"]');
      if (box) { e.preventDefault(); box.focus(); }
    } else if (e.key === 'Escape' && document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  });
}

/* 10. Lazy-loading images via IntersectionObserver, for any <img data-src> */
function lazyLoadImages(root) {
  const imgs = (root || document).querySelectorAll('img[data-src]');
  if (!imgs.length) return;
  if (!('IntersectionObserver' in window)) { imgs.forEach((img) => { img.src = img.dataset.src; }); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.src = entry.target.dataset.src; io.unobserve(entry.target); }
    });
  }, { rootMargin: '200px' });
  imgs.forEach((img) => io.observe(img));
}

/* 11. QR code image URL for any piece of text/link (free API, no key) */
function qrCodeUrl(data, size) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size || 220}x${size || 220}&data=${encodeURIComponent(data)}`;
}

/* 12. Downloadable .ics calendar file for a deal/event */
function downloadICS({ title, description, start, end, location }) {
  const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aliko//EN', 'BEGIN:VEVENT',
    'UID:' + Date.now() + '@aliko', 'DTSTAMP:' + fmt(Date.now()),
    'DTSTART:' + fmt(start), 'DTEND:' + fmt(end || start),
    'SUMMARY:' + (title || 'Aliko event'), 'DESCRIPTION:' + (description || '').replace(/\n/g, '\\n'),
    location ? 'LOCATION:' + location : '', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = (title || 'event').replace(/[^a-z0-9]/gi, '-') + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
  toast('Calendar file downloaded ✓');
}

/* 13. JSON-LD structured data injection, for richer search-engine previews */
function injectJSONLD(obj) {
  const existing = document.getElementById('aliko-jsonld');
  if (existing) existing.remove();
  const script = document.createElement('script');
  script.id = 'aliko-jsonld'; script.type = 'application/ld+json';
  script.textContent = JSON.stringify(obj);
  document.head.appendChild(script);
}

/* 14. Dynamic <title> + meta description updater (for shareable links) */
function setPageMeta(title, description) {
  if (title) document.title = title;
  if (description) {
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = description;
  }
}

/* 15. Show/hide toggle on every password field on the page */
function initPasswordToggles(root) {
  (root || document).querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.toggled) return;
    input.dataset.toggled = '1';
    const wrap = document.createElement('span');
    wrap.className = 'aliko-pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'aliko-pw-toggle'; btn.textContent = '👁'; btn.title = 'Show/hide password';
    btn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
    wrap.appendChild(btn);
    // 16. Live password-strength meter (only on fields that look like "new password")
    if (/new|signup|register/i.test(input.id) || input.hasAttribute('minlength')) {
      const meter = document.createElement('div');
      meter.className = 'aliko-pw-meter'; meter.innerHTML = '<span></span>';
      wrap.parentNode.insertBefore(meter, wrap.nextSibling);
      input.addEventListener('input', () => {
        const s = passwordStrength(input.value);
        const bar = meter.querySelector('span');
        bar.style.width = s.pct + '%'; bar.style.background = s.color; meter.title = s.label;
      });
    }
  });
}
function passwordStrength(v) {
  let score = 0;
  if (v.length >= 6) score++;
  if (v.length >= 10) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/[0-9]/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  const levels = [
    { pct: 10, color: '#FF5C5C', label: 'Very weak' },
    { pct: 30, color: '#FF5C5C', label: 'Weak' },
    { pct: 55, color: '#F5B942', label: 'Okay' },
    { pct: 80, color: '#33D17A', label: 'Good' },
    { pct: 100, color: '#33D17A', label: 'Strong' },
  ];
  return levels[Math.min(score, levels.length - 1)];
}

/* 17. Breadcrumb trail builder */
function renderBreadcrumb(mount, items) {
  if (!mount) return;
  mount.innerHTML = items.map((it, i) => i === items.length - 1
    ? `<span aria-current="page">${it.label}</span>`
    : `<a href="${it.href}">${it.label}</a><span class="crumb-sep">›</span>`).join('');
}

/* 18. Skeleton-loader card generator, for use while data is fetching */
function skeletonCards(n) {
  return Array.from({ length: n || 4 }).map(() => '<div class="skeleton-card"><div class="sk-line w60"></div><div class="sk-line w40"></div><div class="sk-line w80"></div></div>').join('');
}

/* 19. PWA install prompt capture + button.
   Fix: on iOS Safari, `beforeinstallprompt` never fires — there is no such
   API there — so the button below would just silently never appear,
   looking like "the install option disappeared" when really it never had
   a way to show up on that browser. iOS gets its own instructional banner
   instead, since manual "Add to Home Screen" via the Share sheet is the
   only install path Apple exposes to web pages. */
let deferredInstallPrompt = null;
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function initPwaInstall() {
  if (isStandalone()) return; // already installed/running as an app — nothing to offer

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('aliko-install-btn');
    if (btn) btn.classList.remove('hidden');
  });
  const btn = document.createElement('button');
  btn.id = 'aliko-install-btn'; btn.className = 'aliko-install-btn hidden'; btn.textContent = '⬇ Install Aliko';
  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    btn.classList.add('hidden');
  });
  document.body.appendChild(btn);
  window.addEventListener('appinstalled', () => toast('Aliko installed ✓'));

  // iOS gets a dismissible instructional banner instead of a button that
  // would never do anything, since the browser gives no install event to
  // hook into there at all.
  if (isIos() && !localStorage.getItem('aliko_ios_install_dismissed')) {
    const banner = document.createElement('div');
    banner.className = 'aliko-ios-install-banner';
    banner.innerHTML = `<span>Install Aliko: tap <strong>Share</strong> ⬆️ then <strong>"Add to Home Screen"</strong></span><button aria-label="Dismiss">✕</button>`;
    banner.querySelector('button').addEventListener('click', () => {
      banner.remove();
      localStorage.setItem('aliko_ios_install_dismissed', '1');
    });
    document.body.appendChild(banner);
  }
}

/* 20. Service worker registration — offline app-shell caching */
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

/* 21. Print helper — opens the browser print dialog (paired with print CSS) */
function printPage() { window.print(); }

/* 22. Embed-code generator (an iframe snippet business owners can paste
   on their own site, linking back to their Aliko listing) */
function embedCodeFor(businessId, name) {
  const url = window.location.origin + '/business.html?id=' + businessId;
  return `<a href="${url}" style="display:inline-block;padding:10px 16px;background:#FF5A1F;color:#fff;border-radius:8px;font-family:sans-serif;text-decoration:none;font-weight:700;">📍 Find ${(name || 'us').replace(/"/g, '')} on Aliko</a>`;
}

/* 23. Session-based "continue where you left off" resume banner, or a
   horizontal recently-viewed strip (Uber-style "past trips" row) when
   there's more than one recent business — home page only. */
function initResumeBanner() {
  const mount = document.getElementById('resumeBannerMount');
  if (!mount) return;
  try {
    const recent = JSON.parse(localStorage.getItem('aliko_recent') || '[]');
    if (!recent.length) return;
    if (recent.length === 1) {
      const last = recent[0];
      mount.innerHTML = `<div class="resume-banner">Continue where you left off — <a href="business.html?id=${last.id}">${escapeHtml(last.name)}</a><button class="resume-dismiss" aria-label="Dismiss">✕</button></div>`;
      mount.querySelector('.resume-dismiss').addEventListener('click', () => { mount.innerHTML = ''; });
      return;
    }
    mount.innerHTML = `<div class="recent-strip-wrap"><h3 class="recent-strip-title">Recently viewed</h3>
      <div class="recent-strip">${recent.slice(0, 8).map((b) => `<a class="recent-card" href="business.html?id=${b.id}"><strong>${escapeHtml(b.name)}</strong><span>${escapeHtml(b.category || '')}</span></a>`).join('')}</div></div>`;
  } catch (e) {}
}

/* 24. Persistent "Add business" floating action button on the Discover page */
function initAddBusinessFab() {
  if (!document.getElementById('resultsMap') && !document.getElementById('searchInput')) return; // Discover page only
  const user = typeof getUser === 'function' ? getUser() : null;
  const fab = document.createElement('a');
  fab.className = 'aliko-fab'; fab.title = 'List a business'; fab.textContent = '+';
  fab.href = user ? 'register.html' : 'login.html?next=register.html';
  document.body.appendChild(fab);
}

/* 25. Phone/WhatsApp country-code handling.
   Fix: tel:/wa.me links were built directly from whatever text a business
   owner typed (often a local format like "0712345678"), which wa.me
   silently rejects or misroutes — it requires a full international
   number with country code and no leading zero. This provides a proper
   country-code selector for forms, and a normalizer used everywhere a
   phone number is turned into a tel:/wa.me link, so both new entries and
   existing legacy numbers resolve correctly. */
const ALIKO_COUNTRY_CODES = [
  { cc: '254', label: '🇰🇪 Kenya +254' },
  { cc: '234', label: '🇳🇬 Nigeria +234' },
  { cc: '255', label: '🇹🇿 Tanzania +255' },
  { cc: '256', label: '🇺🇬 Uganda +256' },
  { cc: '233', label: '🇬🇭 Ghana +233' },
  { cc: '27', label: '🇿🇦 South Africa +27' },
  { cc: '251', label: '🇪🇹 Ethiopia +251' },
  { cc: '250', label: '🇷🇼 Rwanda +250' },
  { cc: '20', label: '🇪🇬 Egypt +20' },
  { cc: '1', label: '🇺🇸/🇨🇦 US/Canada +1' },
  { cc: '44', label: '🇬🇧 UK +44' },
  { cc: '91', label: '🇮🇳 India +91' },
  { cc: 'other', label: 'Other (type full number with +)' },
];

function countryPhoneFieldHTML(idPrefix, labelText, existingValue) {
  const { cc, local } = splitE164(existingValue);
  const options = ALIKO_COUNTRY_CODES.map((c) => `<option value="${c.cc}" ${cc === c.cc ? 'selected' : ''}>${c.label}</option>`).join('');
  return `<div class="field"><label>${labelText}</label><div class="phone-field-row">
    <select id="${idPrefix}-cc" class="phone-cc-select">${options}</select>
    <input id="${idPrefix}-local" placeholder="7XX XXX XXX" value="${escapeHtml(local)}">
  </div></div>`;
}
// Best-effort split of a possibly-already-combined legacy number, so
// editing an existing business pre-fills the country selector sensibly
// instead of showing the whole jumbled string in the local-number box.
function splitE164(value) {
  const v = (value || '').trim();
  if (v.startsWith('+')) {
    const match = ALIKO_COUNTRY_CODES.find((c) => c.cc !== 'other' && v.startsWith('+' + c.cc));
    if (match) return { cc: match.cc, local: v.slice(match.cc.length + 1) };
    return { cc: 'other', local: v };
  }
  return { cc: '254', local: v };
}
function readCountryPhoneField(idPrefix) {
  const ccEl = document.getElementById(idPrefix + '-cc');
  const localEl = document.getElementById(idPrefix + '-local');
  if (!ccEl || !localEl) return '';
  return combinePhoneE164(ccEl.value, localEl.value);
}
function combinePhoneE164(countryCode, local) {
  local = (local || '').trim();
  if (!local) return '';
  if (countryCode === 'other' || local.startsWith('+')) return '+' + local.replace(/[^\d]/g, '');
  const digits = local.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  return '+' + countryCode + digits;
}
// Normalizes a possibly-legacy (no country code, leading-zero) number for
// building tel:/wa.me links. defaultCC is a last-resort guess for old
// data saved before this fix existed — never applied to numbers that
// already look international.
function normalizePhoneForLink(value, defaultCC) {
  const v = (value || '').trim();
  if (!v) return '';
  if (v.startsWith('+')) return v.replace(/[^\d+]/g, '');
  const digits = v.replace(/\D/g, '');
  if (digits.length > 10) return '+' + digits; // already looks like it has a country code
  return '+' + (defaultCC || '254') + digits.replace(/^0+/, '');
}

document.addEventListener('DOMContentLoaded', () => {
  applyReducedMotionClass();
  initScrollTop();
  initNetworkBanner();
  initKeyboardShortcuts();
  initPwaInstall();
  initServiceWorker();
  initPasswordToggles();
  initResumeBanner();
  initAddBusinessFab();
});
