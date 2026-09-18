// src/routes/offers.js
const express = require('express');
const { getOne, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

router.post('/business/:businessId', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.businessId]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the business owner can post offers.' });
  const { title, description, discount, startsAt, endsAt } = req.body || {};
  if (!title || !endsAt) return res.status(400).json({ error: 'Title and an end date are required.' });
  const starts = startsAt ? Math.floor(new Date(startsAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const ends = Math.floor(new Date(endsAt).getTime() / 1000);
  if (Number.isNaN(starts) || Number.isNaN(ends) || ends <= starts) return res.status(400).json({ error: 'Invalid date range.' });
  const { rows } = await run(
    'INSERT INTO offers (business_id, title, description, discount, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.params.businessId, title.trim(), description || '', discount || '', starts, ends]
  );
  res.status(201).json({ offer: rows[0] });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const offer = await getOne('SELECT * FROM offers WHERE id = $1', [req.params.id]);
  if (!offer) return res.status(404).json({ error: 'Offer not found.' });
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [offer.business_id]);
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your offer.' });
  await run('DELETE FROM offers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
