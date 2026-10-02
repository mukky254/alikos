// public/js/messages.js
renderNav('messages');
requireLogin();

const params = new URLSearchParams(window.location.search);
const threadId = params.get('thread');
let pollTimer = null;

if (threadId) showConversation(threadId); else showThreadList();

async function showThreadList() {
  document.getElementById('threadListView').classList.remove('hidden');
  document.getElementById('conversationView').classList.add('hidden');
  clearInterval(pollTimer);
  const mount = document.getElementById('threadList');
  try {
    const { threads } = await api('/messages/threads');
    if (!threads.length) { mount.innerHTML = '<div class="empty">No conversations yet. Message a business from its profile page to start one.</div>'; return; }
    mount.innerHTML = threads.map((t) => `
      <a class="row" href="messages.html?thread=${t.id}">
        <div class="row-main">
          <div class="row-name">${t.role === 'owner' ? escapeHtml(t.customer_name) : escapeHtml(t.business_name)} ${t.unread ? `<span class="badge open">${t.unread} new</span>` : ''}</div>
          <div class="row-meta">${t.role === 'owner' ? 'Customer · ' + escapeHtml(t.business_name) : 'You → ' + escapeHtml(t.business_name)}</div>
          <div class="row-loc">${escapeHtml(t.lastMessage || 'No messages yet')}</div>
        </div>
      </a>`).join('');
  } catch (e) {
    mount.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

async function showConversation(id) {
  document.getElementById('threadListView').classList.add('hidden');
  document.getElementById('conversationView').classList.remove('hidden');
  await loadMessages(id, true);
  clearInterval(pollTimer);
  // Simple polling rather than a websocket — good enough for a
  // low-frequency business-inquiry inbox, no extra infrastructure needed.
  pollTimer = setInterval(() => loadMessages(id, false), 4000);
}

let lastRenderedCount = 0;
async function loadMessages(id, isFirstLoad) {
  try {
    const { messages, role, thread } = await api('/messages/threads/' + id + '/messages');
    if (isFirstLoad) {
      document.getElementById('conversationTitle').textContent = role === 'owner' ? (thread.customer_name || 'Customer') : (thread.business_name || 'Business');
      document.getElementById('conversationSub').textContent = role === 'owner' ? 'Regarding: ' + (thread.business_name || '') : 'Conversation with this business';
    }
    if (messages.length === lastRenderedCount && !isFirstLoad) return; // nothing new, skip re-render/scroll-jump
    lastRenderedCount = messages.length;
    const bubbles = document.getElementById('messageBubbles');
    const wasNearBottom = bubbles.scrollTop + bubbles.clientHeight >= bubbles.scrollHeight - 40;
    bubbles.innerHTML = messages.map((m) => `
      <div class="bubble ${m.sender_role === role ? 'mine' : 'theirs'}">
        <div class="bubble-text">${escapeHtml(m.text)}</div>
        <div class="bubble-time">${new Date(Number(m.created_at)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
      </div>`).join('');
    if (isFirstLoad || wasNearBottom) bubbles.scrollTop = bubbles.scrollHeight;
  } catch (e) {
    if (isFirstLoad) document.getElementById('messageBubbles').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

document.getElementById('backToThreadsBtn').addEventListener('click', () => {
  window.history.pushState({}, '', 'messages.html');
  showThreadList();
});

document.getElementById('messageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !threadId) return;
  input.value = '';
  try {
    await api('/messages/threads/' + threadId + '/messages', { method: 'POST', body: { text } });
    loadMessages(threadId, false);
  } catch (e) { toast(e.message); input.value = text; }
});
