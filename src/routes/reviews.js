// src/routes/reviews.js
const express = require('express');
const multer = require('multer');
const { getOne, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../lib/helpers');
const { saveFile } = require('../lib/storage');
const { withComputed } = require('./businesses');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/business/:businessId', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { rating, text } = req.body || {};
    const r = parseInt(rating, 10);
    if (!r || r < 1 || r > 5 || !text || !text.trim()) return res.status(400).json({ error: 'A rating (1-5) and review text are required.' });
    const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.businessId]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    const { rows } = await run('INSERT INTO reviews (business_id, user_id, rating, text) VALUES ($1,$2,$3,$4) RETURNING id', [req.params.businessId, req.user.id, r, text.trim()]);
    if (req.file) {
      const stored = await saveFile(req.file, { prefix: 'review' });
      await run('INSERT INTO review_photos (review_id, filename) VALUES ($1, $2)', [rows[0].id, stored]);
    }
    if (biz.owner_id !== req.user.id) await notify(biz.owner_id, 'review', `${req.user.name} left a ${r}-star review on ${biz.name}.`, biz.id);
    const updated = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.businessId]);
    res.status(201).json({ business: await withComputed(updated) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/helpful', requireAuth, async (req, res) => {
  const review = await getOne('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  const existing = await getOne('SELECT 1 FROM review_votes WHERE review_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (existing) {
    await run('DELETE FROM review_votes WHERE review_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    await run('UPDATE reviews SET helpful_count = GREATEST(0, helpful_count - 1) WHERE id = $1', [req.params.id]);
  } else {
    await run('INSERT INTO review_votes (review_id, user_id) VALUES ($1, $2)', [req.params.id, req.user.id]);
    await run('UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = $1', [req.params.id]);
  }
  const updated = await getOne('SELECT * FROM businesses WHERE id = $1', [review.business_id]);
  res.json({ business: await withComputed(updated) });
});

router.put('/:id/reply', requireAuth, async (req, res) => {
  const review = await getOne('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [review.business_id]);
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the business owner can reply to reviews.' });
  const { reply } = req.body || {};
  if (!reply || !reply.trim()) return res.status(400).json({ error: 'Reply text is required.' });
  await run("UPDATE reviews SET owner_reply = $1, owner_reply_at = extract(epoch from now())::bigint WHERE id = $2", [reply.trim(), req.params.id]);
  await notify(review.user_id, 'reply', `${biz.name} replied to your review.`, biz.id);
  const updated = await getOne('SELECT * FROM businesses WHERE id = $1', [review.business_id]);
  res.json({ business: await withComputed(updated) });
});

module.exports = router;
