// src/routes/saved.js
const express = require('express');
const { getOne, getAll, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

router.get('/', requireAuth, async (req, res) => {
  const rows = await getAll(
    `SELECT b.* FROM saved s JOIN businesses b ON b.id = s.business_id
     WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json({ businesses: rows.map((b) => ({ ...b, verified: !!b.verified })) });
});

router.post('/:businessId', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT id FROM businesses WHERE id = $1', [req.params.businessId]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  await run('INSERT INTO saved (user_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, req.params.businessId]);
  res.status(201).json({ saved: true });
});

router.delete('/:businessId', requireAuth, async (req, res) => {
  await run('DELETE FROM saved WHERE user_id = $1 AND business_id = $2', [req.user.id, req.params.businessId]);
  res.json({ saved: false });
});

module.exports = router;
