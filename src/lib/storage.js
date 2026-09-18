const fs = require('fs');
const path = require('path');

const isVercel = process.env.VERCEL === '1';
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const docsDir = path.join(uploadsDir, 'docs');

/*
 * Vercel's filesystem is read-only.
 * Local development can use the uploads folder.
 * Vercel should use Vercel Blob for uploaded files.
 */
if (!isVercel) {
  [uploadsDir, docsDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

async function saveFile(file, { prefix = 'file', folder = '' } = {}) {
  if (!file || !file.buffer) {
    throw new Error('No file was provided.');
  }

  const ext = path.extname(file.originalname || '') || '.bin';

  const name =
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

  /*
   * Production / Vercel:
   * Use Vercel Blob.
   */
  if (useBlob) {
    const { put } = require('@vercel/blob');

    const blobPath =
      `${folder ? folder.replace(/^\/+|\/+$/g, '') + '/' : ''}${name}`;

    const blob = await put(blobPath, file.buffer, {
      access: 'public',
      contentType: file.mimetype || 'application/octet-stream',
    });

    return blob.url;
  }

  /*
   * Vercel without Blob:
   * Do not attempt to write to /var/task.
   */
  if (isVercel) {
    throw new Error(
      'File uploads are not configured for this deployment. ' +
      'Set BLOB_READ_WRITE_TOKEN in Vercel.'
    );
  }

  /*
   * Local development.
   */
  const destinationDir = folder === 'docs'
    ? docsDir
    : uploadsDir;

  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  const destination = path.join(destinationDir, name);

  fs.writeFileSync(destination, file.buffer);

  return name;
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function publicUrl(value, folder = '') {
  if (!value) return '';

  if (isUrl(value)) {
    return value;
  }

  return `/uploads/${folder ? folder + '/' : ''}${value}`;
}

async function readFileBytes(value, folder = '') {
  if (!value) {
    throw new Error('File not found.');
  }

  if (isUrl(value)) {
    const response = await fetch(value);

    if (!response.ok) {
      throw new Error('File not found.');
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /*
   * Local development only.
   */
  if (isVercel) {
    throw new Error(
      'Local file storage is unavailable on Vercel. ' +
      'Files must be stored using Vercel Blob.'
    );
  }

  const safeName = path.basename(value);

  const filePath = path.join(
    folder === 'docs' ? docsDir : uploadsDir,
    safeName
  );

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