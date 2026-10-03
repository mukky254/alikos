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

// Fix: the poll timer (every 4s) and a manual reload right after sending
// a message could both be in flight at once, and — since each is an
// independent async call — a slower-but-earlier-started request could
// resolve AFTER a faster-but-later-started one and overwrite the screen
// with stale/differently-ordered data. This was very likely the actual
// cause of "messages are out of order": not a sort bug, but an older
// response landing after a newer one and clobbering it. A simple
// increasing request-sequence number fixes it — any response that isn't
// from the latest request in flight is just discarded.
let requestSeq = 0;
let lastRenderedLastId = null;

async function loadMessages(id, isFirstLoad) {
  const mySeq = ++requestSeq;
  try {
    const { messages, role, thread } = await api('/messages/threads/' + id + '/messages');
    if (mySeq !== requestSeq) return; // a newer request already started/finished — this response is stale, ignore it

    if (isFirstLoad) {
      document.getElementById('conversationTitle').textContent = role === 'owner' ? (thread.customer_name || 'Customer') : (thread.business_name || 'Business');
      document.getElementById('conversationSub').textContent = role === 'owner' ? 'Regarding: ' + (thread.business_name || '') : 'Conversation with this business';
    }
    const newLastId = messages.length ? messages[messages.length - 1].id : null;
    if (newLastId === lastRenderedLastId && !isFirstLoad) return; // nothing new
    lastRenderedLastId = newLastId;

    const bubbles = document.getElementById('messageBubbles');
    const wasNearBottom = bubbles.scrollTop + bubbles.clientHeight >= bubbles.scrollHeight - 40;
    bubbles.innerHTML = renderBubbleHtml(messages, role);
    if (isFirstLoad || wasNearBottom) bubbles.scrollTop = bubbles.scrollHeight;
  } catch (e) {
    if (isFirstLoad) document.getElementById('messageBubbles').innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

// WhatsApp-style rendering: a date divider whenever the day changes, and
// consecutive bubbles from the same sender grouped tighter with only the
// last one in a run showing a timestamp — instead of every single bubble
// repeating the full date/time regardless of who sent it or when.
function renderBubbleHtml(messages, role) {
  // messages arrives pre-sorted chronologically by the server (ORDER BY id
  // ASC, the primary key — always insertion order); render in that exact
  // order rather than re-sorting here, so this stays a single source of
  // truth for "what order are these in".
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
    await loadMessages(threadId, false);
  } catch (e) { toast(e.message); input.value = text; }
});
