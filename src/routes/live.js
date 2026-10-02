// src/routes/live.js
// Temporary "share my location" links for an active trip. Deliberately
// simple and short-lived — a random token, a single current position, and
// a hard expiry (3 hours) rather than a full account-linked tracking
// system, since this is meant for "here's where I am right now", not
// long-term location history.
const crypto = require('crypto');
const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();
const { getOne, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

const SHARE_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

router.post('/', requireAuth, async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  const businessId = req.body.businessId ? Number(req.body.businessId) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'A valid current position is required.' });
  const token = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  await run(
    'INSERT INTO live_shares (token, user_id, business_id, lat, lng, updated_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [token, req.user.id, businessId, lat, lng, now, now + SHARE_DURATION_MS]
  );
  res.json({ token, expiresAt: now + SHARE_DURATION_MS });
});

// Called periodically by the sharer's own browser while navigation is
// active, to keep the shared position current.
router.put('/:token', requireAuth, async (req, res) => {
  const share = await getOne('SELECT * FROM live_shares WHERE token = $1 AND user_id = $2', [req.params.token, req.user.id]);
  if (!share) return res.status(404).json({ error: 'Share not found.' });
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'A valid position is required.' });
  await run('UPDATE live_shares SET lat = $1, lng = $2, updated_at = $3 WHERE token = $4', [lat, lng, Date.now(), req.params.token]);
  res.json({ ok: true });
});

// Public — no auth. Anyone with the link can view the live position until
// it expires. Never exposes who the user is beyond what they choose to
// share (no name/email here, just a moving dot and, if set, a destination).
router.get('/:token', async (req, res) => {
  const share = await getOne('SELECT * FROM live_shares WHERE token = $1', [req.params.token]);
  if (!share) return res.status(404).json({ error: 'This link is invalid or has expired.' });
  if (Date.now() > Number(share.expires_at)) return res.status(410).json({ error: 'This share has expired.' });
  let business = null;
  if (share.business_id) {
    const biz = await getOne('SELECT id, name, lat, lng, building FROM businesses WHERE id = $1', [share.business_id]);
    if (biz) business = biz;
  }
  res.json({ lat: share.lat, lng: share.lng, updatedAt: Number(share.updated_at), expiresAt: Number(share.expires_at), business });
});

module.exports = router;
