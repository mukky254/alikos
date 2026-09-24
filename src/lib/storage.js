// src/lib/storage.js
// On Vercel, the filesystem is read-only (except /tmp, which is wiped
// between invocations), so uploaded photos/documents can't live on local
// disk in production. This module uploads to Vercel Blob when
// BLOB_READ_WRITE_TOKEN is set (i.e. when deployed on Vercel with Blob
// enabled, or running locally with that token exported), and falls back to
// writing into /uploads on local disk otherwise — so `npm start` still works
// with zero extra setup on your own machine.

const fs = require('fs');
const path = require('path');

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsDir, 'docs');
if (!useBlob) {
  // Fix: this used to call mkdirSync unguarded. On Vercel, the deployed
  // code lives at /var/task, which is read-only — so without
  // BLOB_READ_WRITE_TOKEN set, this line crashed at module load time,
  // which took down every single request to the app (not just uploads),
  // including plain page loads and favicon.ico. Wrapped in try/catch so a
  // read-only filesystem degrades (uploads won't work) instead of taking
  // the whole site down. The real fix is still to set
  // BLOB_READ_WRITE_TOKEN in your Vercel project so uploads work in
  // production — see the note in saveFile() below.
  try {
    [uploadsDir, docsDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  } catch (e) {
    console.error('[storage] Could not create local uploads directory (expected on a read-only filesystem like Vercel without BLOB_READ_WRITE_TOKEN set):', e.message);
  }
}

/**
 * Saves a multer memory-storage file buffer. Returns the value to store in
 * the database: a full https URL (Blob) or a bare filename (local disk).
 */
async function saveFile(file, { prefix = 'file', folder = '' } = {}) {
  const ext = path.extname(file.originalname) || '.bin';
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  if (useBlob) {
    const { put } = require('@vercel/blob');
    const blob = await put((folder ? folder + '/' : '') + name, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
    });
    return blob.url; // full https URL, stored directly in the DB
  }
  const dest = folder === 'docs' ? docsDir : uploadsDir;
  try {
    fs.writeFileSync(path.join(dest, name), file.buffer);
  } catch (e) {
    // Same read-only-filesystem issue as above, but at actual upload time
    // rather than at startup — surface a clear, actionable error instead
    // of a raw ENOENT crash.
    throw new Error('File storage isn\'t configured for this deployment. Set BLOB_READ_WRITE_TOKEN in your Vercel project to enable uploads.');
  }
  return name;
}

/** True if the stored value is already a full URL (Blob) rather than a bare local filename. */
function isUrl(value) {
  return /^https?:\/\//i.test(value || '');
}

/** Resolves a stored filename/URL to something a browser can load directly. */
function publicUrl(value, folder = '') {
  if (isUrl(value)) return value;
  return `/uploads/${folder ? folder + '/' : ''}${value}`;
}

/** For admin-only files: fetches the bytes server-side so access stays gated behind requireAdmin. */
async function readFileBytes(value, folder = '') {
  if (isUrl(value)) {
    const res = await fetch(value);
    if (!res.ok) throw new Error('File not found.');
    return Buffer.from(await res.arrayBuffer());
  }
  const filePath = path.join(folder === 'docs' ? docsDir : uploadsDir, path.basename(value));
  if (!fs.existsSync(filePath)) throw new Error('File not found.');
  return fs.readFileSync(filePath);
}

module.exports = { saveFile, isUrl, publicUrl, readFileBytes, useBlob, uploadsDir, docsDir };
