// src/routes/notifications.js
const express = require('express');
const { getAll, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

router.get('/', requireAuth, async (req, res) => {
  const rows = await getAll('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
  const unreadRows = await getAll('SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = 0', [req.user.id]);
  res.json({ notifications: rows, unread: unreadRows[0].c });
});

router.post('/:id/read', requireAuth, async (req, res) => {
  await run('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, async (req, res) => {
  await run('UPDATE notifications SET is_read = 1 WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
