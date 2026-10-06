// public/js/messages.js — two-pane layout: a persistent chat list on the
// left, the active conversation on the right (matching a real chat app,
// not two separate full-page views). Clicking a chat updates the right
// pane in place, no page reload — the sidebar never disappears on desktop.
renderNav('messages');
requireLogin();

let allThreads = [];
let activeThreadId = new URLSearchParams(window.location.search).get('thread') || null;
let pollTimer = null;
let requestSeq = 0;
let lastRenderedLastId = null;

function avatarInitial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 48%, 42%)`;
}
function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const daysAgo = Math.floor((now - d) / 86400000);
  if (daysAgo < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function threadDisplayName(t) { return t.role === 'owner' ? (t.customer_name || 'Customer') : (t.business_name || 'Business'); }

async function loadThreadList() {
  const mount = document.getElementById('threadList');
  try {
    const { threads } = await api('/messages/threads');
    allThreads = threads;
    renderThreadList();
    if (activeThreadId) openConversation(Number(activeThreadId), false);
  } catch (e) {
    mount.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

function renderThreadList(filterText) {
  const mount = document.getElementById('threadList');
  const q = (filterText || '').toLowerCase().trim();
  const list = q ? allThreads.filter((t) => threadDisplayName(t).toLowerCase().includes(q)) : allThreads;
  if (!list.length) { mount.innerHTML = `<div class="empty">${q ? 'No chats match that search.' : "No conversations yet. Message a business from its profile page to start one."}</div>`; return; }
  mount.innerHTML = list.map((t) => {
    const name = threadDisplayName(t);
    const sub = t.role === 'owner' ? escapeHtml(t.business_name || '') : null;
    return `
    <a class="chat-row ${Number(activeThreadId) === t.id ? 'active' : ''}" href="messages.html?thread=${t.id}" data-id="${t.id}">
      <div class="chat-avatar" style="background:${avatarColor(name)}">${escapeHtml(avatarInitial(name))}</div>
      <div class="chat-row-main">
        <div class="chat-row-top">
          <span class="chat-row-name">${escapeHtml(name)}</span>
          <span class="chat-row-time">${formatChatTime(t.lastAt || t.created_at)}</span>
        </div>
        <div class="chat-row-bottom">
          <span class="chat-row-preview">${sub ? `<span class="chat-row-sub">${sub}: </span>` : ''}${escapeHtml(t.lastMessage || 'No messages yet')}</span>
          ${t.unread ? `<span class="chat-unread-badge">${t.unread}</span>` : ''}
        </div>
      </div>
    </a>`;
  }).join('');

  mount.querySelectorAll('.chat-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      e.preventDefault();
      openConversation(Number(row.dataset.id), true);
    });
  });
}

document.getElementById('chatSearchInput').addEventListener('input', (e) => renderThreadList(e.target.value));

function openConversation(id, updateUrl) {
  activeThreadId = id;
  if (updateUrl) history.pushState({}, '', 'messages.html?thread=' + id);
  document.getElementById('chatEmptyState').classList.add('hidden');
  document.getElementById('chatActiveView').classList.remove('hidden');
  document.getElementById('chatShell').classList.add('mobile-show-chat'); // mobile: swap to the conversation pane
  renderThreadList(document.getElementById('chatSearchInput').value); // refresh active-row highlight
  lastRenderedLastId = null;
  loadMessages(id, true);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadMessages(id, false), 4000);
}

document.getElementById('chatBackBtn').addEventListener('click', () => {
  document.getElementById('chatShell').classList.remove('mobile-show-chat'); // mobile: back to the list pane
});

async function loadMessages(id, isFirstLoad) {
  const mySeq = ++requestSeq;
  try {
    const { messages, role, thread } = await api('/messages/threads/' + id + '/messages');
    if (mySeq !== requestSeq) return; // a newer request already started — this response is stale

    if (isFirstLoad) {
      const name = role === 'owner' ? (thread.customer_name || 'Customer') : (thread.business_name || 'Business');
      document.getElementById('conversationTitle').textContent = name;
      document.getElementById('conversationSub').textContent = role === 'owner' ? 'Regarding: ' + (thread.business_name || '') : 'Conversation with this business';
      const avatarEl = document.getElementById('conversationAvatar');
      avatarEl.textContent = avatarInitial(name);
      avatarEl.style.background = avatarColor(name);
    }
    const newLastId = messages.length ? messages[messages.length - 1].id : null;
    if (newLastId === lastRenderedLastId && !isFirstLoad) return;
    lastRenderedLastId = newLastId;

    const bubbles = document.getElementById('messageBubbles');
    const wasNearBottom = bubbles.scrollTop + bubbles.clientHeight >= bubbles.scrollHeight - 40;
    bubbles.innerHTML = renderBubbleHtml(messages, role);
    if (isFirstLoad || wasNearBottom) bubbles.scrollTop = bubbles.scrollHeight;
    loadThreadListQuiet(); // refresh previews/unread counts in the sidebar without disrupting the open chat
  } catch (e) {
    if (isFirstLoad) document.getElementById('messageBubbles').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

async function loadThreadListQuiet() {
  try { const { threads } = await api('/messages/threads'); allThreads = threads; renderThreadList(document.getElementById('chatSearchInput').value); } catch (e) {}
}

function renderBubbleHtml(messages, role) {
  let html = '';
  let lastDay = null;
  messages.forEach((m, i) => {
    const d = new Date(Number(m.created_at));
    const dayKey = d.toDateString();
    if (dayKey !== lastDay) {
      html += `<div class="date-divider">${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>`;
      lastDay = dayKey;
    }
    const next = messages[i + 1];
    const isLastInGroup = !next || next.sender_role !== m.sender_role || new Date(Number(next.created_at)).toDateString() !== dayKey;
    html += `<div class="bubble ${m.sender_role === role ? 'mine' : 'theirs'} ${isLastInGroup ? 'last-in-group' : ''}">
      <div class="bubble-text">${escapeHtml(m.text)}</div>
      ${isLastInGroup ? `<div class="bubble-time">${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>` : ''}
    </div>`;
  });
  return html;
}

document.getElementById('messageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !activeThreadId) return;
  input.value = '';
  try {
    await api('/messages/threads/' + activeThreadId + '/messages', { method: 'POST', body: { text } });
    await loadMessages(activeThreadId, false);
  } catch (e) { toast(e.message); input.value = text; }
});

loadThreadList();
