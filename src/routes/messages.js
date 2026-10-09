// src/routes/messages.js
const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();
const { getOne, getAll, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../lib/helpers');

async function threadSummary(threadId, viewerRole) {
  const last = await getOne('SELECT * FROM messages WHERE thread_id = $1 ORDER BY id DESC LIMIT 1', [threadId]);
  const unreadCol = viewerRole === 'owner' ? 'read_by_owner' : 'read_by_customer';
  const { rows } = await require('../db').pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE thread_id = $1 AND ${unreadCol} = 0 AND sender_role != $2`, [threadId, viewerRole]);
  return { lastMessage: last ? last.text : '', lastAt: last ? last.created_at : null, unread: rows[0].n };
}

// List my conversations — as a customer, every thread I started; as an
// owner, every thread across all businesses I own. One endpoint covers
// both sides since a thread only ever has one of each role.
router.get('/threads', requireAuth, async (req, res) => {
  const asCustomer = await getAll(
    `SELECT t.*, b.name AS business_name, b.id AS business_id FROM message_threads t
     JOIN businesses b ON b.id = t.business_id WHERE t.customer_id = $1 ORDER BY t.id DESC`, [req.user.id]);
  const asOwner = await getAll(
    `SELECT t.*, b.name AS business_name, u.name AS customer_name FROM message_threads t
     JOIN businesses b ON b.id = t.business_id
     JOIN users u ON u.id = t.customer_id
     WHERE b.owner_id = $1 ORDER BY t.id DESC`, [req.user.id]);

  const customerThreads = await Promise.all(asCustomer.map(async (t) => ({ ...t, role: 'customer', ...(await threadSummary(t.id, 'customer')) })));
  const ownerThreads = await Promise.all(asOwner.map(async (t) => ({ ...t, role: 'owner', ...(await threadSummary(t.id, 'owner')) })));
  res.json({ threads: [...customerThreads, ...ownerThreads].sort((a, b) => (b.lastAt || b.created_at) - (a.lastAt || a.created_at)) });
});

// Start (or resume) a conversation with a business.
router.post('/threads/business/:businessId', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.businessId]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id === req.user.id) return res.status(400).json({ error: "You can't message your own business." });
  let thread = await getOne('SELECT * FROM message_threads WHERE business_id = $1 AND customer_id = $2', [biz.id, req.user.id]);
  if (!thread) {
    const { rows } = await run(
      'INSERT INTO message_threads (business_id, customer_id, created_at) VALUES ($1, $2, $3) RETURNING *',
      [biz.id, req.user.id, Date.now()]
    );
    thread = rows[0];
  }
  res.json({ thread });
});

async function threadAccess(threadId, user) {
  // Fix: this used to select only b.owner_id, so the conversation header
  // had no business/customer name to show — it fell back to a generic
  // "Customer" with a blank "Regarding:". Joining both names in here so
  // the open conversation shows the real people, same as the chat list.
  const thread = await getOne(
    `SELECT t.*, b.owner_id, b.name AS business_name, u.name AS customer_name
     FROM message_threads t
     JOIN businesses b ON b.id = t.business_id
     JOIN users u ON u.id = t.customer_id
     WHERE t.id = $1`, [threadId]
  );
  if (!thread) return { error: 'Conversation not found.', status: 404 };
  if (thread.customer_id === user.id) return { thread, role: 'customer' };
  if (thread.owner_id === user.id) return { thread, role: 'owner' };
  return { error: "You don't have access to this conversation.", status: 403 };
}

router.get('/threads/:id/messages', requireAuth, async (req, res) => {
  const access = await threadAccess(req.params.id, req.user);
  if (access.error) return res.status(access.status).json({ error: access.error });
  const messages = await getAll('SELECT * FROM messages WHERE thread_id = $1 ORDER BY id ASC', [req.params.id]);
  const unreadCol = access.role === 'owner' ? 'read_by_owner' : 'read_by_customer';
  await run(`UPDATE messages SET ${unreadCol} = 1 WHERE thread_id = $1`, [req.params.id]);
  res.json({ messages, role: access.role, thread: access.thread });
});

router.post('/threads/:id/messages', requireAuth, async (req, res) => {
  const text = (req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
  const access = await threadAccess(req.params.id, req.user);
  if (access.error) return res.status(access.status).json({ error: access.error });

  const { rows } = await run(
    `INSERT INTO messages (thread_id, sender_id, sender_role, text, created_at, read_by_customer, read_by_owner)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, req.user.id, access.role, text, Date.now(), access.role === 'customer' ? 1 : 0, access.role === 'owner' ? 1 : 0]
  );

  const notifyUserId = access.role === 'customer' ? access.thread.owner_id : access.thread.customer_id;
  await notify(notifyUserId, 'message', `New message: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`, access.thread.business_id).catch(() => {});

  res.json({ message: rows[0] });
});

module.exports = router;
