// public/js/nav.js
function renderNav(activePage) {
  const user = getUser();
  const tabs = [
    { href: 'index.html', label: 'Discover', key: 'home' },
    { href: 'saved.html', label: 'Saved', key: 'saved', authOnly: true },
    { href: 'deals.html', label: 'Deals', key: 'deals' },
    { href: 'register.html', label: 'List a business', key: 'register', authOnly: true },
    { href: 'dashboard.html', label: 'Dashboard', key: 'dashboard', authOnly: true },
    { href: 'account.html', label: 'Account', key: 'account', authOnly: true },
    { href: 'admin.html', label: 'Admin', key: 'admin', adminOnly: true },
  ];

  const tabsHtml = tabs
    .filter((t) => (!t.authOnly || user) && (!t.adminOnly || (user && user.role === 'admin')))
    .map((t) => `<a href="${t.href}" class="${activePage === t.key ? 'active' : ''}">${t.label}</a>`)
    .join('');

  const bellHtml = user
    ? `<div class="notif-wrap">
        <button class="notif-bell" id="notifBell">🔔<span id="notifDot" class="notif-dot hidden"></span></button>
        <div id="notifPanel" class="notif-panel hidden"></div>
      </div>`
    : '';

  const authHtml = user
    ? `${bellHtml}<span>${escapeHtml(user.name)}${user.role === 'admin' ? ' <span class="badge premium">ADMIN</span>' : ''}</span><button onclick="logout()">Log out</button>`
    : `<a href="login.html">Log in</a><a href="signup.html" class="btn primary small">Sign up</a>`;

  document.getElementById('site-header').innerHTML = `
    <header class="site">
      <div class="site-inner">
        <a href="index.html" class="brand">Alik<em>o</em></a>
        <nav class="tabs">${tabsHtml}</nav>
        <div class="auth-box">${authHtml}</div>
      </div>
    </header>
  `;

  if (user) wireNotifications();
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
