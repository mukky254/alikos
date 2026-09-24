// public/js/nav.js
//
// Redesigned as a slim top bar (brand + hamburger + notifications) with a
// slide-out side drawer holding every nav link, plus a persistent
// Uber-style bottom tab bar on phones for the most-used destinations —
// instead of a full row of text links across the top eating vertical
// space on every page.
const NAV_TABS = [
  { href: 'index.html', label: 'Discover', key: 'home', icon: '🔎' },
  { href: 'saved.html', label: 'Saved', key: 'saved', authOnly: true, icon: '★' },
  { href: 'deals.html', label: 'Deals', key: 'deals', icon: '🏷' },
  { href: 'register.html', label: 'List a business', key: 'register', authOnly: true, icon: '➕' },
  { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard', authOnly: true, icon: '📊' },
  { href: 'account.html', label: 'Account', key: 'account', authOnly: true, icon: '👤' },
  { href: 'admin.html', label: 'Admin', key: 'admin', adminOnly: true, icon: '🛡' },
];
// The 4 destinations that live in the bottom tab bar on phones (mirrors
// Uber/most consumer apps: 3-4 primary tabs + a "More" for everything else).
const BOTTOM_TAB_KEYS = ['home', 'saved', 'deals'];

function renderNav(activePage) {
  const user = getUser();
  const visibleTabs = NAV_TABS.filter((t) => (!t.authOnly || user) && (!t.adminOnly || (user && user.role === 'admin')));

  const drawerLinks = visibleTabs.map((t) => `<a href="${t.href}" class="drawer-link ${activePage === t.key ? 'active' : ''}"><span class="drawer-icon">${t.icon}</span>${t.label}</a>`).join('');
  const drawerAuth = user
    ? `<div class="drawer-user"><strong>${escapeHtml(user.name)}</strong>${user.role === 'admin' ? ' <span class="badge premium">ADMIN</span>' : ''}</div><button class="btn ghost block" onclick="logout()">Log out</button>`
    : `<a class="btn ghost block" href="login.html">Log in</a><a class="btn primary block" href="signup.html" style="margin-top:8px;">Sign up</a>`;

  const bellHtml = user
    ? `<div class="notif-wrap"><button class="notif-bell" id="notifBell">🔔<span id="notifDot" class="notif-dot hidden"></span></button><div id="notifPanel" class="notif-panel hidden"></div></div>`
    : '';

  document.getElementById('site-header').innerHTML = `
    <header class="site">
      <div class="site-inner">
        <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu">☰</button>
        <a href="index.html" class="brand">Alik<em>o</em></a>
        <div class="auth-box">${bellHtml}${!user ? `<a href="login.html" class="top-login-link">Log in</a>` : ''}</div>
      </div>
    </header>
    <div class="drawer-backdrop hidden" id="drawerBackdrop"></div>
    <nav class="side-drawer" id="sideDrawer" aria-label="Main menu">
      <div class="drawer-top">
        <a href="index.html" class="brand">Alik<em>o</em></a>
        <button class="drawer-close" id="drawerCloseBtn" aria-label="Close menu">✕</button>
      </div>
      <div class="drawer-links">${drawerLinks}</div>
      <div class="drawer-bottom">${drawerAuth}</div>
    </nav>
    ${renderBottomTabs(activePage, visibleTabs)}
  `;

  const drawer = document.getElementById('sideDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const openDrawer = () => { drawer.classList.add('open'); backdrop.classList.remove('hidden'); document.body.classList.add('drawer-open'); };
  const closeDrawer = () => { drawer.classList.remove('open'); backdrop.classList.add('hidden'); document.body.classList.remove('drawer-open'); };
  document.getElementById('hamburgerBtn').addEventListener('click', openDrawer);
  document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  const moreBtn = document.getElementById('bottomTabMore');
  if (moreBtn) moreBtn.addEventListener('click', openDrawer);

  if (user) wireNotifications();
}

// Uber-style persistent bottom tab bar (phones only, via CSS media query —
// it's rendered always, hidden above the breakpoint) for the handful of
// destinations someone jumps to constantly, so they don't need to open
// the drawer for the common case.
function renderBottomTabs(activePage, visibleTabs) {
  const tabs = visibleTabs.filter((t) => BOTTOM_TAB_KEYS.includes(t.key));
  const items = tabs.map((t) => `<a href="${t.href}" class="bottom-tab ${activePage === t.key ? 'active' : ''}"><span>${t.icon}</span>${t.label}</a>`).join('');
  return `<nav class="bottom-tabs" aria-label="Quick navigation">${items}<button class="bottom-tab" id="bottomTabMore"><span>☰</span>More</button></nav>`;
}

async function wireNotifications() {
  const bell = document.getElementById('notifBell');
  const panel = document.getElementById('notifPanel');
  if (!bell) return;
  try {
    const { notifications, unread } = await api('/notifications');
    document.getElementById('notifDot').classList.toggle('hidden', unread === 0);
    panel.innerHTML = notifications.length
      ? notifications.map((n) => `<div class="notif-item ${n.is_read ? 'read' : ''}">
          ${n.business_id ? `<a href="business.html?id=${n.business_id}">${escapeHtml(n.message)}</a>` : escapeHtml(n.message)}
          <time>${new Date(n.created_at * 1000).toLocaleString()}</time>
        </div>`).join('')
      : '<div class="notif-item muted">No notifications yet.</div>';
  } catch (e) {}

  bell.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', isOpen);
    if (!isOpen) {
      try { await api('/notifications/read-all', { method: 'POST' }); document.getElementById('notifDot').classList.add('hidden'); } catch (err) {}
    }
  });
  document.addEventListener('click', () => panel.classList.add('hidden'));
}

function requireLogin() {
  const user = getUser();
  if (!user) {
    window.location.href = 'login.html?next=' + encodeURIComponent(window.location.pathname.split('/').pop());
    return null;
  }
  return user;
}

function requireAdminUI() {
  const user = getUser();
  if (!user || user.role !== 'admin') {
    document.getElementById('app').innerHTML = `
      <div id="site-header"></div>
      <main class="shell narrow"><div class="empty"><h2>Admin access only</h2><p>You need to be signed in with the admin account to view this page.</p><a class="btn primary" href="index.html">Back to Discover</a></div></main>`;
    renderNav('admin');
    return null;
  }
  return user;
}
