// src/lib/storage.js

const fs = require('fs');
const path = require('path');

/*
 * Aliko file storage
 *
 * LOCAL DEVELOPMENT
 * -----------------
 * Files are stored inside:
 *   /uploads
 *   /uploads/docs
 *
 * VERCEL
 * ------
 * Vercel's deployment filesystem is not persistent/writable.
 * Therefore, Vercel must use Vercel Blob when BLOB_READ_WRITE_TOKEN
 * is available.
 *
 * IMPORTANT:
 * If the app is running on Vercel without Blob configured, we do NOT
 * attempt to create /uploads. This prevents the application from
 * crashing during startup.
 */

const isVercel = process.env.VERCEL === '1';

const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/*
 * Local upload directories.
 *
 * These are only created when we are NOT running on Vercel.
 */
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsDir, 'docs');

if (!isVercel) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(docsDir, { recursive: true });
  } catch (error) {
    console.error('Aliko storage directory error:', error);
    throw error;
  }
}

/**
 * Generate a safe unique filename.
 */
function createFilename(file, prefix = 'file') {
  const originalName = file?.originalname || '';
  const ext = path.extname(originalName) || '.bin';

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}${ext}`;
}

/**
 * Saves a multer memory-storage file buffer.
 *
 * Returns:
 *   - Vercel Blob URL when Blob is enabled
 *   - local filename during local development
 */
async function saveFile(file, { prefix = 'file', folder = '' } = {}) {
  if (!file || !file.buffer) {
    throw new Error('No file buffer was provided.');
  }

  const name = createFilename(file, prefix);

  /*
   * VERCEL BLOB
   */
  if (useBlob) {
    const { put } = require('@vercel/blob');

    const blobPath = folder
      ? `${folder}/${name}`
      : name;

    const blob = await put(blobPath, file.buffer, {
      access: 'public',
      contentType: file.mimetype || 'application/octet-stream',
    });

    return blob.url;
  }

  /*
   * VERCEL WITHOUT BLOB
   *
   * Do not attempt to write to /var/task.
   * Give a useful error instead of crashing the entire server.
   */
  if (isVercel) {
    throw new Error(
      'File uploads require Vercel Blob. Please configure BLOB_READ_WRITE_TOKEN.'
    );
  }

  /*
   * LOCAL DISK
   */
  const destinationDir =
    folder === 'docs'
      ? docsDir
      : uploadsDir;

  /*
   * Make sure the local directory exists.
   */
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  const destination = path.join(destinationDir, name);

  fs.writeFileSync(destination, file.buffer);

  return name;
}

/**
 * Returns true when the stored value is a full HTTP/HTTPS URL.
 */
function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

/**
 * Converts a stored filename into a browser-accessible URL.
 *
 * Blob URLs are returned unchanged.
 *
 * Local development files become:
 *   /uploads/file.jpg
 *   /uploads/docs/file.pdf
 */
function publicUrl(value, folder = '') {
  if (!value) {
    return '';
  }

  if (isUrl(value)) {
    return value;
  }

  return `/uploads/${folder ? `${folder}/` : ''}${encodeURIComponent(
    path.basename(value)
  )}`;
}

/**
 * Reads a stored file into a Buffer.
 *
 * For Blob:
 *   Downloads the file from its URL.
 *
 * For local development:
 *   Reads it from /uploads.
 */
async function readFileBytes(value, folder = '') {
  if (!value) {
    throw new Error('File not found.');
  }

  /*
   * Vercel Blob / remote URL
   */
  if (isUrl(value)) {
    const response = await fetch(value);

    if (!response.ok) {
      throw new Error('File not found.');
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /*
   * Local development
   */
  if (isVercel) {
    throw new Error(
      'Local file storage is not available on Vercel. This file must be stored in Vercel Blob.'
    );
  }

  const baseDir =
    folder === 'docs'
      ? docsDir
      : uploadsDir;

  const safeFilename = path.basename(value);
  const filePath = path.join(baseDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    throw new Error('File not found.');
  }

  return fs.readFileSync(filePath);
}

module.exports = {
  saveFile,
  isUrl,
  publicUrl,
  readFileBytes,
  useBlob,
  uploadsDir,
  docsDir,
};
