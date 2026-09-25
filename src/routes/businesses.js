// src/routes/businesses.js
const express = require('express');
const multer = require('multer');
const { getOne, getAll, run } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { notify, bumpDailyStat, isOpenNow, haversineKm, csvEscape } = require('../lib/helpers');
const { saveFile, publicUrl } = require('../lib/storage');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed.'))),
});
const uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function withComputed(biz) {
  // All 5 of these queries are independent of each other — running them
  // sequentially (the old code) meant paying full network round-trip time
  // to Postgres 5 times over, one after another. On a real network (even a
  // paid database), that round-trip time is the actual bottleneck, not
  // query speed — so this alone is the fix for "loading businesses feels
  // slow." Promise.all() fires all 5 at once instead.
  const [reviews, photos, tagRows, offers, brand] = await Promise.all([
    getAll(
      `SELECT r.id, r.rating, r.text, r.helpful_count, r.owner_reply, r.owner_reply_at, r.created_at, u.name AS user_name,
              (SELECT filename FROM review_photos WHERE review_id = r.id LIMIT 1) AS photo
       FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.business_id = $1 ORDER BY r.created_at DESC`,
      [biz.id]
    ),
    getAll('SELECT id, filename, label FROM photos WHERE business_id = $1', [biz.id]),
    getAll('SELECT tag FROM product_tags WHERE business_id = $1', [biz.id]),
    getAll('SELECT * FROM offers WHERE business_id = $1 AND ends_at >= $2 ORDER BY ends_at ASC', [biz.id, Math.floor(Date.now() / 1000)]),
    biz.brand_id ? getOne('SELECT id, name FROM brands WHERE id = $1', [biz.brand_id]) : Promise.resolve(null),
  ]);
  const otherLocations = biz.brand_id
    ? await getAll('SELECT id, name, building, floor, shop FROM businesses WHERE brand_id = $1 AND id != $2', [biz.brand_id, biz.id])
    : [];
  const avgRating = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
  const confidence = Math.max(10, Math.min(99, (biz.verified ? 78 : 48) + Math.min(biz.successful_visits, 12) - Math.min(biz.failed_visits * 3, 15)));
  return {
    ...biz,
    verified: !!biz.verified,
    reviews: reviews.map((r) => ({ ...r, photo: r.photo ? publicUrl(r.photo) : null })),
    photos: photos.map((p) => ({ ...p, filename: publicUrl(p.filename) })),
    tags: tagRows.map((r) => r.tag),
    offers,
    brand,
    otherLocations,
    avgRating,
    confidence,
    openNow: isOpenNow(biz.hours_json),
    hours: biz.hours_json ? JSON.parse(biz.hours_json) : null,
  };
}

// ---------- Search / list ----------
// This endpoint is intentionally kept to one main SQL query. The old version
// performed several database queries PER business, which made the homepage
// increasingly slow as the catalogue grew.
router.get('/', async (req, res) => {
  const { q, category, lat, lng, radius, sort, openNow } = req.query;
  const params = [];
  const where = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };

  if (category) where.push(`b.category = ${add(category)}`);

  const qText = String(q || '').trim();
  let qParam = null;
  if (qText) {
    qParam = add(`%${qText}%`);
    const qp = qParam;
    where.push(`(
      b.name ILIKE ${qp} OR
      b.category ILIKE ${qp} OR
      COALESCE(b.building,'') ILIKE ${qp} OR
      COALESCE(b.landmark,'') ILIKE ${qp} OR
      COALESCE(b.description,'') ILIKE ${qp} OR
      EXISTS (SELECT 1 FROM product_tags pt WHERE pt.business_id = b.id AND pt.tag ILIKE ${qp})
    )`);
  }

  const userLat = lat !== undefined ? Number(lat) : null;
  const userLng = lng !== undefined ? Number(lng) : null;
  const hasLoc = Number.isFinite(userLat) && Number.isFinite(userLng) && userLat >= -90 && userLat <= 90 && userLng >= -180 && userLng <= 180;

  let distanceSql = 'NULL::double precision AS "distanceKm"';
  if (hasLoc) {
    const latP = add(userLat);
    const lngP = add(userLng);
    distanceSql = `(
      6371 * acos(LEAST(1, GREATEST(-1,
        sin(radians(${latP})) * sin(radians(b.lat)) +
        cos(radians(${latP})) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(${lngP}))
      )))
    ) AS "distanceKm"`;
    if (radius !== undefined && Number.isFinite(Number(radius)) && Number(radius) >= 0) {
      const radiusP = add(Math.min(Number(radius), 1000));
      where.push(`(
        6371 * acos(LEAST(1, GREATEST(-1,
          sin(radians(${latP})) * sin(radians(b.lat)) +
          cos(radians(${latP})) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(${lngP}))
        )))
      ) <= ${radiusP}`);
    }
  }

  // openNow is deliberately applied after fetching the compact result set.
  // hours_json is stored as JSON text and cannot be cheaply indexed with the
  // current schema.
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await getAll(`
    SELECT
      b.*,
      ${distanceSql},
      COUNT(r.id)::int AS "reviewCount",
      COALESCE(AVG(r.rating), 0)::double precision AS "avgRating",
      CASE
        WHEN ${qParam ? `lower(b.name) = lower(${qParam})` : 'false'} THEN 200
        WHEN ${qParam ? `b.name ILIKE ${qParam} || '%'` : 'false'} THEN 120
        WHEN ${qParam ? `b.name ILIKE '%' || ${qParam} || '%'` : 'false'} THEN 80
        ELSE 20
      END AS "relevanceScore"
    FROM businesses b
    LEFT JOIN reviews r ON r.business_id = b.id
    ${whereSql}
    GROUP BY b.id
    ORDER BY b.verified DESC, b.created_at DESC
    LIMIT 100
  `, params);

  let result = rows.map((b) => ({
    ...b,
    verified: !!b.verified,
    openNow: isOpenNow(b.hours_json),
    avgRating: Number(b.avgRating) ? Math.round(Number(b.avgRating) * 10) / 10 : null,
    reviewCount: Number(b.reviewCount) || 0,
    distanceKm: b.distanceKm == null ? null : Number(b.distanceKm),
  }));

  if (openNow === '1') result = result.filter((b) => b.openNow !== false);

  const sortKey = sort || (hasLoc ? 'nearest' : qText ? 'relevance' : 'default');
  const sorters = {
    nearest: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    relevance: (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0) || Number(b.verified) - Number(a.verified),
    rating: (a, b) => (b.avgRating || 0) - (a.avgRating || 0) || b.reviewCount - a.reviewCount,
    reviews: (a, b) => b.reviewCount - a.reviewCount,
    newest: (a, b) => Number(b.created_at) - Number(a.created_at),
    default: (a, b) => Number(b.verified) - Number(a.verified) || a.name.localeCompare(b.name),
  };
  result.sort(sorters[sortKey] || sorters.default);

  res.json({ businesses: result.slice(0, 60), total: result.length });
});

router.get('/autocomplete', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ suggestions: [] });
  const rows = await getAll('SELECT id, name, category, building FROM businesses WHERE name ILIKE $1 ORDER BY verified DESC, name ASC LIMIT 6', [`%${q}%`]);
  res.json({ suggestions: rows });
});

router.get('/categories', async (req, res) => {
  const rows = await getAll('SELECT category, COUNT(*)::int AS count FROM businesses GROUP BY category ORDER BY count DESC');
  res.json({ categories: rows });
});

router.get('/trending', async (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = await getAll(
    `SELECT b.*, COALESCE(SUM(s.views),0)::int AS "recentViews"
     FROM businesses b LEFT JOIN stats_daily s ON s.business_id = b.id AND s.day >= $1
     GROUP BY b.id ORDER BY "recentViews" DESC, b.views DESC LIMIT 8`,
    [since]
  );
  res.json({ businesses: rows.map((b) => ({ ...b, verified: !!b.verified })) });
});

router.get('/deals', async (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const { lat, lng } = req.query;
  let rows = await getAll(
    `SELECT b.*, o.title AS offer_title, o.discount AS offer_discount, o.ends_at AS offer_ends_at
     FROM businesses b JOIN offers o ON o.business_id = b.id
     WHERE o.starts_at <= $1 AND o.ends_at >= $1 ORDER BY o.ends_at ASC`,
    [now]
  );
  const userLat = lat !== undefined ? parseFloat(lat) : null;
  const userLng = lng !== undefined ? parseFloat(lng) : null;
  if (userLat != null && userLng != null && !Number.isNaN(userLat) && !Number.isNaN(userLng)) {
    rows = rows.map((b) => ({ ...b, distanceKm: haversineKm(userLat, userLng, b.lat, b.lng) })).sort((a, b) => a.distanceKm - b.distanceKm);
  }
  res.json({ businesses: rows.map((b) => ({ ...b, verified: !!b.verified })) });
});

router.get('/check-duplicate', async (req, res) => {
  const { name, building } = req.query;
  if (!name) return res.json({ matches: [] });
  const rows = await getAll(
    "SELECT id, name, building, floor, shop FROM businesses WHERE name ILIKE $1 OR (building ILIKE $2 AND building != '')",
    [`%${name}%`, `%${building || '__none__'}%`]
  );
  res.json({ matches: rows });
});

router.get('/mine', requireAuth, async (req, res) => {
  const rows = await getAll('SELECT * FROM businesses WHERE owner_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ businesses: await Promise.all(rows.map(withComputed)) });
});

// Feature: personal share link ("Find me on Aliko"). Public, no auth —
// this is what a shared social-media link resolves against. Only exposes
// the owner's display name and their *verified* listings (never
// unverified/pending ones, and never email or other account details).
router.get('/by-owner/:userId', async (req, res) => {
  const owner = await getOne('SELECT id, name FROM users WHERE id = $1', [req.params.userId]);
  if (!owner) return res.status(404).json({ error: 'This link is no longer valid.' });
  const rows = await getAll('SELECT * FROM businesses WHERE owner_id = $1 AND verified = 1 ORDER BY created_at DESC', [req.params.userId]);
  res.json({ owner: { id: owner.id, name: owner.name }, businesses: await Promise.all(rows.map(withComputed)) });
});

router.get('/:id', async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  res.json({ business: await withComputed(biz) });
});

router.get('/:id/stats-daily', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your business.' });
  const rows = await getAll(
    "SELECT day, views, navigations, calls, whatsapp_clicks FROM stats_daily WHERE business_id = $1 AND day >= to_char(now() - interval '13 days', 'YYYY-MM-DD') ORDER BY day ASC",
    [req.params.id]
  );
  res.json({ days: rows });
});

router.get('/:id/export.csv', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your business.' });
  const reviews = await getAll('SELECT rating, text, created_at FROM reviews WHERE business_id = $1', [biz.id]);
  let csv = 'field,value\n';
  ['name', 'category', 'phone', 'whatsapp', 'email', 'building', 'floor', 'shop', 'entrance', 'landmark', 'lat', 'lng', 'verified', 'views', 'navigations', 'calls', 'whatsapp_clicks', 'shares'].forEach((f) => {
    csv += `${f},${csvEscape(biz[f])}\n`;
  });
  csv += '\nreview_rating,review_text,review_date\n';
  reviews.forEach((r) => { csv += `${r.rating},${csvEscape(r.text)},${new Date(r.created_at * 1000).toISOString()}\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${biz.name.replace(/[^a-z0-9]/gi, '_')}.csv"`);
  res.send(csv);
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const required = ['name', 'category', 'phone', 'lat', 'lng', 'building'];
    for (const field of required) {
      if (b[field] === undefined || b[field] === null || b[field] === '') return res.status(400).json({ error: `Missing required field: ${field}` });
    }
    const lat = parseFloat(b.lat), lng = parseFloat(b.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: 'GPS coordinates must be valid numbers.' });
    const { rows } = await run(
      `INSERT INTO businesses (owner_id, name, category, description, phone, whatsapp, email, website, lat, lng, building, floor, shop, entrance, landmark, verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0) RETURNING *`,
      [req.user.id, b.name.trim(), b.category, b.description || '', b.phone, b.whatsapp || '', b.email || '', b.website || '', lat, lng, b.building, b.floor || '', b.shop || '', b.entrance || '', b.landmark || '']
    );
    const biz = rows[0];
    if (b.tags) {
      const tags = String(b.tags).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 15);
      for (const tag of tags) await run('INSERT INTO product_tags (business_id, tag) VALUES ($1, $2)', [biz.id, tag]);
    }
    res.status(201).json({ business: await withComputed(biz) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the business owner or an admin can edit this listing.' });
    const editable = ['name', 'category', 'description', 'phone', 'whatsapp', 'email', 'website', 'building', 'floor', 'shop', 'entrance', 'landmark', 'lat', 'lng'];
    const sets = []; const params = [];
    editable.forEach((f) => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f} = $${params.length}`); } });
    if (req.body.hours) { params.push(JSON.stringify(req.body.hours)); sets.push(`hours_json = $${params.length}`); }
    if (!sets.length && req.body.tags === undefined) return res.status(400).json({ error: 'No editable fields supplied.' });
    if (sets.length) {
      params.push(req.params.id);
      await run(`UPDATE businesses SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    if (req.body.tags !== undefined) {
      await run('DELETE FROM product_tags WHERE business_id = $1', [req.params.id]);
      const tags = String(req.body.tags).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 15);
      for (const tag of tags) await run('INSERT INTO product_tags (business_id, tag) VALUES ($1, $2)', [req.params.id, tag]);
    }
    const updated = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    res.json({ business: await withComputed(updated) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the business owner or an admin can delete this listing.' });
    // Safety check: the caller must echo the exact business name back, so
    // this can't be triggered by a stray click — same pattern GitHub/Vercel
    // use for destructive actions ("type the repo name to delete it").
    if ((req.body.confirmName || '').trim().toLowerCase() !== biz.name.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Confirmation name did not match — nothing was deleted.' });
    }
    // Every table with a business_id column is declared with
    // ON DELETE CASCADE (see src/db.js), so this one delete cleans up
    // photos, reviews, offers, Q&A, claims, saved entries, daily stats,
    // etc. automatically at the database level.
    await run('DELETE FROM businesses WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/photos', requireAuth, uploadPhoto.single('photo'), async (req, res) => {
  try {
    const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the business owner can add photos.' });
    if (!req.file) return res.status(400).json({ error: 'No image file received.' });
    const stored = await saveFile(req.file, { prefix: `biz${req.params.id}` });
    await run('INSERT INTO photos (business_id, filename, label) VALUES ($1, $2, $3)', [req.params.id, stored, (req.body.label || 'Photo').slice(0, 60)]);
    const updated = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    res.status(201).json({ business: await withComputed(updated) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/documents', requireAuth, uploadDoc.single('document'), async (req, res) => {
  try {
    const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (!biz) return res.status(404).json({ error: 'Business not found.' });
    if (biz.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the business owner can upload documents.' });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const stored = await saveFile(req.file, { prefix: `doc_biz${req.params.id}`, folder: 'docs' });
    await run('INSERT INTO verification_documents (business_id, filename, doc_type) VALUES ($1, $2, $3)', [req.params.id, stored, req.body.docType || 'other']);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/track', async (req, res) => {
  const { type } = req.body || {};
  const columns = { view: 'views', navigation: 'navigations', call: 'calls', whatsapp: 'whatsapp_clicks', share: 'shares' };
  const col = columns[type];
  if (!col) return res.status(400).json({ error: 'Unknown tracking type.' });
  const { rowCount } = await run(`UPDATE businesses SET ${col} = ${col} + 1 WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Business not found.' });
  if (['view', 'navigation', 'call', 'whatsapp'].includes(type)) await bumpDailyStat(req.params.id, col);
  res.json({ ok: true });
});

router.post('/:id/arrival', async (req, res) => {
  const { found } = req.body || {};
  const col = found ? 'successful_visits' : 'failed_visits';
  const { rowCount } = await run(`UPDATE businesses SET ${col} = ${col} + 1 WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Business not found.' });
  const updated = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  res.json({ business: await withComputed(updated) });
});

router.post('/:id/report', optionalAuth, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Please describe the issue.' });
  const biz = await getOne('SELECT id FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  await run('INSERT INTO reports (business_id, reporter_id, reason) VALUES ($1, $2, $3)', [req.params.id, req.user ? req.user.id : null, reason.trim()]);
  res.status(201).json({ ok: true });
});

router.post('/:id/claim', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id === req.user.id) return res.status(400).json({ error: 'You already own this listing.' });
  await run('INSERT INTO claims (business_id, claimant_id, message) VALUES ($1, $2, $3)', [req.params.id, req.user.id, (req.body && req.body.message) || '']);
  res.status(201).json({ ok: true, message: 'Claim submitted for admin review.' });
});

router.post('/brands', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Brand name is required.' });
  const { rows } = await run('INSERT INTO brands (owner_id, name) VALUES ($1, $2) RETURNING *', [req.user.id, name.trim()]);
  res.status(201).json({ brand: rows[0] });
});
router.get('/brands/mine', requireAuth, async (req, res) => {
  const rows = await getAll('SELECT * FROM brands WHERE owner_id = $1', [req.user.id]);
  res.json({ brands: rows });
});
router.put('/:id/brand', requireAuth, async (req, res) => {
  const biz = await getOne('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can group this listing under a brand.' });
  const brandId = req.body.brandId || null;
  if (brandId) {
    const brand = await getOne('SELECT * FROM brands WHERE id = $1 AND owner_id = $2', [brandId, req.user.id]);
    if (!brand) return res.status(400).json({ error: 'Invalid brand.' });
  }
  await run('UPDATE businesses SET brand_id = $1 WHERE id = $2', [brandId, req.params.id]);
  res.json({ ok: true });
});

module.exports = { router, withComputed };
