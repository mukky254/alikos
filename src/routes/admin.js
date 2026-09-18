// src/routes/admin.js
// Every route here is gated by requireAuth + requireAdmin — enforced on the
// server, not just hidden in the UI.
const express = require('express');
const multer = require('multer');
const { getOne, getAll, run } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notify, logAudit, parseCsv } = require('../lib/helpers');
const { readFileBytes } = require('../lib/storage');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();
router.use(requireAuth, requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.get('/stats', async (req, res) => {
  const total = (await getOne('SELECT COUNT(*)::int AS c FROM businesses')).c;
  const verified = (await getOne('SELECT COUNT(*)::int AS c FROM businesses WHERE verified = 1')).c;
  const pending = total - verified;
  const totalViews = (await getOne('SELECT COALESCE(SUM(views),0)::int AS c FROM businesses')).c;
  const totalUsers = (await getOne('SELECT COUNT(*)::int AS c FROM users')).c;
  const totalReviews = (await getOne('SELECT COUNT(*)::int AS c FROM reviews')).c;
  const openReports = (await getOne("SELECT COUNT(*)::int AS c FROM reports WHERE status = 'open'")).c;
  const pendingClaims = (await getOne("SELECT COUNT(*)::int AS c FROM claims WHERE status = 'pending'")).c;
  const pendingDocs = (await getOne("SELECT COUNT(*)::int AS c FROM verification_documents WHERE status = 'pending'")).c;
  res.json({ total, verified, pending, totalViews, totalUsers, totalReviews, openReports, pendingClaims, pendingDocs });
});

router.get('/analytics', async (req, res) => {
  const byCategory = await getAll('SELECT category, COUNT(*)::int AS count FROM businesses GROUP BY category ORDER BY count DESC');
  const growth = await getAll(
    `SELECT to_char(to_timestamp(created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
     FROM businesses WHERE created_at >= extract(epoch from now() - interval '13 days')::bigint GROUP BY day ORDER BY day ASC`
  );
  const viewsTrend = await getAll(
    "SELECT day, SUM(views)::int AS views FROM stats_daily WHERE day >= to_char(now() - interval '13 days', 'YYYY-MM-DD') GROUP BY day ORDER BY day ASC"
  );
  res.json({ byCategory, growth, viewsTrend });
});

router.get('/businesses', async (req, res) => {
  const { status } = req.query;
  let rows;
  if (status === 'pending') rows = await getAll('SELECT * FROM businesses WHERE verified = 0 ORDER BY created_at DESC');
  else if (status === 'verified') rows = await getAll('SELECT * FROM businesses WHERE verified = 1 ORDER BY created_at DESC');
  else rows = await getAll('SELECT * FROM businesses ORDER BY created_at DESC');
  res.json({ businesses: rows.map((b) => ({ ...b, verified: !!b.verified })) });
});

router.put('/businesses/:id', async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  const editable = ['name', 'category', 'description', 'phone', 'whatsapp', 'email', 'building', 'floor', 'shop', 'entrance', 'landmark', 'lat', 'lng'];
  const sets = []; const params = [];
  editable.forEach((f) => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f} = $${params.length}`); } });
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied.' });
  params.push(req.params.id);
  await run(`UPDATE businesses SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  await logAudit(req.user.id, 'edit', 'business', req.params.id, JSON.stringify(req.body));
  res.json({ ok: true });
});

router.post('/businesses/:id/verify', async (req, res) => {
  const { rowCount } = await run('UPDATE businesses SET verified = 1 WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Business not found.' });
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  await notify(biz.owner_id, 'verified', `${biz.name} has been verified!`, biz.id);
  await logAudit(req.user.id, 'verify', 'business', req.params.id);
  res.json({ ok: true });
});

router.post('/businesses/:id/unverify', async (req, res) => {
  const { rowCount } = await run('UPDATE businesses SET verified = 0 WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Business not found.' });
  await logAudit(req.user.id, 'unverify', 'business', req.params.id);
  res.json({ ok: true });
});

router.put('/businesses/:id/tier', async (req, res) => {
  const { tier } = req.body || {};
  if (!['none', 'basic', 'premium'].includes(tier)) return res.status(400).json({ error: 'Invalid tier.' });
  const { rowCount } = await run('UPDATE businesses SET verification_tier = $1 WHERE id = $2', [tier, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Business not found.' });
  await logAudit(req.user.id, 'set_tier', 'business', req.params.id, tier);
  res.json({ ok: true });
});

router.delete('/businesses/:id', async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  await run('DELETE FROM businesses WHERE id = $1', [req.params.id]);
  await logAudit(req.user.id, 'reject', 'business', req.params.id, biz.name);
  res.json({ ok: true });
});

router.get('/users', async (req, res) => {
  const rows = await getAll('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
  res.json({ users: rows });
});

router.delete('/reviews/:id', async (req, res) => {
  const { rowCount } = await run('DELETE FROM reviews WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Review not found.' });
  await logAudit(req.user.id, 'delete_review', 'review', req.params.id);
  res.json({ ok: true });
});

router.get('/reports', async (req, res) => {
  const rows = await getAll(
    `SELECT r.*, b.name AS business_name FROM reports r JOIN businesses b ON b.id = r.business_id
     WHERE r.status = 'open' ORDER BY r.created_at DESC`
  );
  res.json({ reports: rows });
});
router.post('/reports/:id/resolve', async (req, res) => {
  await run("UPDATE reports SET status = 'resolved' WHERE id = $1", [req.params.id]);
  await logAudit(req.user.id, 'resolve_report', 'report', req.params.id);
  res.json({ ok: true });
});
router.post('/reports/:id/dismiss', async (req, res) => {
  await run("UPDATE reports SET status = 'dismissed' WHERE id = $1", [req.params.id]);
  await logAudit(req.user.id, 'dismiss_report', 'report', req.params.id);
  res.json({ ok: true });
});

router.get('/claims', async (req, res) => {
  const rows = await getAll(
    `SELECT c.*, b.name AS business_name, u.name AS claimant_name, u.email AS claimant_email
     FROM claims c JOIN businesses b ON b.id = c.business_id JOIN users u ON u.id = c.claimant_id
     WHERE c.status = 'pending' ORDER BY c.created_at DESC`
  );
  res.json({ claims: rows });
});
router.post('/claims/:id/approve', async (req, res) => {
  const claim = await getOne('SELECT * FROM claims WHERE id = $1', [req.params.id]);
  if (!claim) return res.status(404).json({ error: 'Claim not found.' });
  await run('UPDATE businesses SET owner_id = $1 WHERE id = $2', [claim.claimant_id, claim.business_id]);
  await run("UPDATE claims SET status = 'approved' WHERE id = $1", [req.params.id]);
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [claim.business_id]);
  await notify(claim.claimant_id, 'claim_approved', `Your ownership claim for ${biz.name} was approved.`, biz.id);
  await logAudit(req.user.id, 'approve_claim', 'claim', req.params.id);
  res.json({ ok: true });
});
router.post('/claims/:id/reject', async (req, res) => {
  const claim = await getOne('SELECT * FROM claims WHERE id = $1', [req.params.id]);
  if (!claim) return res.status(404).json({ error: 'Claim not found.' });
  await run("UPDATE claims SET status = 'rejected' WHERE id = $1", [req.params.id]);
  await notify(claim.claimant_id, 'claim_rejected', 'Your ownership claim was rejected.', claim.business_id);
  await logAudit(req.user.id, 'reject_claim', 'claim', req.params.id);
  res.json({ ok: true });
});

router.get('/documents', async (req, res) => {
  const rows = await getAll(
    `SELECT d.*, b.name AS business_name FROM verification_documents d JOIN businesses b ON b.id = d.business_id
     WHERE d.status = 'pending' ORDER BY d.created_at DESC`
  );
  res.json({ documents: rows });
});
// Streams the file server-side (from Blob or local disk) so access control stays behind requireAdmin.
router.get('/documents/:filename', async (req, res) => {
  try {
    const doc = await getOne('SELECT * FROM verification_documents WHERE filename = $1', [req.params.filename]);
    const value = doc ? doc.filename : req.params.filename;
    const bytes = await readFileBytes(value, 'docs');
    res.send(bytes);
  } catch (e) {
    res.status(404).json({ error: 'File not found.' });
  }
});
router.post('/documents/:id/approve', async (req, res) => {
  await run("UPDATE verification_documents SET status = 'approved' WHERE id = $1", [req.params.id]);
  await logAudit(req.user.id, 'approve_document', 'document', req.params.id);
  res.json({ ok: true });
});
router.post('/documents/:id/reject', async (req, res) => {
  await run("UPDATE verification_documents SET status = 'rejected' WHERE id = $1", [req.params.id]);
  await logAudit(req.user.id, 'reject_document', 'document', req.params.id);
  res.json({ ok: true });
});

router.get('/audit-log', async (req, res) => {
  const rows = await getAll('SELECT a.*, u.name AS admin_name FROM audit_log a JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT 100');
  res.json({ log: rows });
});

// Expected header row: name,category,phone,lat,lng,building,floor,shop,entrance,landmark
router.post('/businesses/bulk-import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file received.' });
  const text = req.file.buffer.toString('utf8');
  const rows = parseCsv(text);
  if (!rows.length) return res.status(400).json({ error: 'CSV is empty.' });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const required = ['name', 'category', 'phone', 'lat', 'lng', 'building'];
  for (const col of required) {
    if (!header.includes(col)) return res.status(400).json({ error: `CSV is missing required column: ${col}` });
  }
  let created = 0;
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || r.every((c) => c === '')) continue;
    const rec = {};
    header.forEach((col, idx) => { rec[col] = (r[idx] || '').trim(); });
    const lat = parseFloat(rec.lat), lng = parseFloat(rec.lng);
    if (!rec.name || !rec.category || Number.isNaN(lat) || Number.isNaN(lng)) { errors.push(`Row ${i + 1}: missing/invalid required field.`); continue; }
    await run(
      `INSERT INTO businesses (owner_id, name, category, phone, whatsapp, email, lat, lng, building, floor, shop, entrance, landmark, verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)`,
      [req.user.id, rec.name, rec.category, rec.phone || '', rec.whatsapp || '', rec.email || '', lat, lng, rec.building || '', rec.floor || '', rec.shop || '', rec.entrance || '', rec.landmark || '']
    );
    created++;
  }
  await logAudit(req.user.id, 'bulk_import', 'business', null, `${created} businesses imported`);
  res.json({ created, errors });
});

module.exports = router;
