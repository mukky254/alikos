// src/server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  next();
});
app.use(express.json());

// Defense in depth: even with every route wrapped by asyncRouter, this
// ensures a truly unexpected error (e.g. in third-party middleware) logs
// instead of silently crashing the process.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server kept running):', reason);
});

// Initialize the database once and make every API request wait for it.
// The previous version started listening immediately, which created a race:
// the browser could request /api/businesses before CREATE TABLE finished.
const schemaReady = db.initSchema().catch((e) => {
  console.error('Schema init failed:', e.message);
  throw e;
});

// Local-disk uploads only matter when NOT using Vercel Blob (BLOB_READ_WRITE_TOKEN
// unset) — e.g. plain `npm start` on your own machine. On Vercel this folder is
// read-only/ephemeral, so uploads there go through src/lib/storage.js to Blob
// storage instead, and this line simply has nothing to serve.
app.disable('x-powered-by');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d', etag: true }));

// Never let an API request race the database schema initialization.
app.use('/api', async (req, res, next) => {
  try { await schemaReady; next(); }
  catch (err) { next(err); }
});

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/businesses', require('./routes/businesses').router);
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/offers', require('./routes/offers'));
app.use('/api/qa', require('./routes/qa'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/saved', require('./routes/saved'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/directions', require('./routes/directions'));

// Frontend (multi-page static site). On Vercel this is redundant — Vercel
// serves /public automatically — but it's what makes `npm start` work as a
// normal local dev server too.
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, etag: true }));

// Fallback error handler (e.g. multer file-type rejection, unhandled async errors)
app.use((err, req, res, next) => {
  console.error(`[Aliko ${req.method} ${req.originalUrl}]`, err);
  if (res.headersSent) return next(err);
  const status = Number(err.statusCode || err.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500 ? 'Aliko server error. Check the terminal for details.' : (err.message || 'Something went wrong.')
  });
});

// Only start a real listening server when run directly. Wait for the database
// before accepting browser traffic so the first page load cannot fail randomly.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  schemaReady
    .then(() => app.listen(PORT, () => console.log(`Aliko server running at http://localhost:${PORT}`)))
    .catch(() => {
      console.error('Aliko could not start because the database is unavailable. Check DATABASE_URL in .env.');
      process.exitCode = 1;
    });
}

module.exports = app;
