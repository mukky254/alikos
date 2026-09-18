// src/routes/auth.js
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getOne, run } = require('../db');
const { requireAuth, SECRET } = require('../middleware/auth');
const { sendEmail } = require('../lib/email');

const asyncRouter = require('../lib/asyncRouter');
const router = asyncRouter();

function sign(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, SECRET, { expiresIn: '7d' });
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are all required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const existing = await getOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await run(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), email.toLowerCase().trim(), hash, 'user']
    );
    const user = rows[0];
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = await getOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await getOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

router.put('/me', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  await run('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), req.user.id]);
  const user = await getOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ token: sign(user), user: publicUser(user) });
});

router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const user = await getOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  await run('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  res.json({ ok: true });
});

// Password reset — sends a real email via Resend when RESEND_API_KEY is
// configured. If it isn't, the link is logged to the server console and
// returned directly in the API response so the flow still works for local
// testing without an email account.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const user = email && (await getOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]));
  if (!user) return res.json({ ok: true, message: 'If that account exists, a reset link has been generated.' });
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await run('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [user.id, tokenHash, expiresAt]);
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const resetLink = `${appUrl}/reset-password.html?token=${token}`;

  let emailed = false;
  if (process.env.RESEND_API_KEY) {
    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset your Aliko password',
        html: `<p>Hi ${user.name},</p><p>Click the link below to reset your Aliko password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
      });
      emailed = true;
    } catch (e) {
      console.error('[password reset] email send failed:', e.message);
    }
  }
  console.log(`[password reset] link for ${user.email}: ${resetLink}`);
  res.json({
    ok: true,
    message: emailed ? 'Check your email for a reset link.' : 'Reset link generated (see server console in this demo).',
    devResetLink: emailed ? undefined : resetLink,
  });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await getOne('SELECT * FROM password_resets WHERE token_hash = $1 AND used = 0', [tokenHash]);
  if (!record || Number(record.expires_at) < Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }
  await run('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(newPassword, 10), record.user_id]);
  await run('UPDATE password_resets SET used = 1 WHERE id = $1', [record.id]);
  res.json({ ok: true });
});

module.exports = router;
