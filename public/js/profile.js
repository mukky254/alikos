// public/js/profile.js
renderNav('');

const params = new URLSearchParams(window.location.search);
const ownerId = params.get('id');
const mount = document.getElementById('profileMount');

async function load() {
  if (!ownerId) { mount.innerHTML = '<div class="empty">No profile specified.</div>'; return; }
  try {
    const { owner, businesses } = await api('/businesses/by-owner/' + ownerId);
    setPageMeta(`Find ${owner.name} on Aliko`, `${owner.name}'s verified businesses on Aliko — exact location and directions.`);

    if (businesses.length === 1) {
      // Feature: "fully direct" — a single-business owner's link skips
      // straight to their listing instead of an extra click through an
      // intermediary page, same as most "link in bio" tools do when
      // there's only one real destination.
      mount.innerHTML = `<div class="empty">Taking you to <strong>${escapeHtml(businesses[0].name)}</strong>…</div>`;
      setTimeout(() => { window.location.replace('business.html?id=' + businesses[0].id); }, 500);
      return;
    }

    if (!businesses.length) {
      mount.innerHTML = `<div class="empty">${escapeHtml(owner.name)} doesn't have any verified listings on Aliko yet.</div>`;
      return;
    }

    mount.innerHTML = `
      <h1 class="page-title">Find ${escapeHtml(owner.name)} on Aliko</h1>
      <p class="page-sub">${businesses.length} verified business${businesses.length > 1 ? 'es' : ''}</p>
      <div class="directory">${businesses.map((b) => `
        <a class="row" href="business.html?id=${b.id}">
          <div class="row-main">
            <div class="row-name">${escapeHtml(b.name)}</div>
            <div class="row-meta">${escapeHtml(b.category)} ${b.avgRating ? `· <span class="stars">★</span> ${b.avgRating}` : ''}</div>
            <div class="row-loc">${escapeHtml(b.building || '')}</div>
          </div>
        </a>`).join('')}</div>`;
  } catch (e) {
    mount.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}
load();
