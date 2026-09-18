// src/db.js
// Real Postgres database via the `pg` driver — pure JavaScript, no native
// compiling (unlike the old SQLite version), so it works identically on
// Windows/Mac/Linux and on Vercel's serverless functions. Point DATABASE_URL
// at any Postgres instance: a free Neon/Supabase database for local dev, and
// the same (or a separate) one in your Vercel project's environment variables.

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    '\n❌ Missing DATABASE_URL.\n' +
    '   1. Copy .env.example to .env\n' +
    '   2. Get a free Postgres database at https://neon.tech (or supabase.com)\n' +
    '   3. Paste its connection string into DATABASE_URL in your .env file\n' +
    '   4. Run: npm run seed\n' +
    '   5. Run: npm start\n'
  );
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || '');
const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : false,
});

async function query(text, params = []) {
  return pool.query(text, params);
}
async function getOne(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}
async function getAll(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}
/** Runs an INSERT/UPDATE/DELETE. Pass `RETURNING id` in text if you need the new row's id. */
async function run(text, params = []) {
  const res = await pool.query(text, params);
  return { rowCount: res.rowCount, rows: res.rows };
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      building TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      shop TEXT DEFAULT '',
      entrance TEXT DEFAULT '',
      landmark TEXT DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      verification_tier TEXT NOT NULL DEFAULT 'none' CHECK(verification_tier IN ('none','basic','premium')),
      hours_json TEXT DEFAULT '',
      successful_visits INTEGER NOT NULL DEFAULT 0,
      failed_visits INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      navigations INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      whatsapp_clicks INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      label TEXT DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      text TEXT NOT NULL,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      owner_reply TEXT DEFAULT '',
      owner_reply_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS review_votes (
      review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (review_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS review_photos (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      filename TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
      PRIMARY KEY (user_id, business_id)
    );

    CREATE TABLE IF NOT EXISTS product_tags (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offers (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      discount TEXT DEFAULT '',
      starts_at BIGINT NOT NULL,
      ends_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS verification_documents (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      doc_type TEXT DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS claims (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      claimant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS qa_questions (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS qa_answers (
      id SERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES qa_questions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT NOT NULL,
      is_owner INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS stats_daily (
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      navigations INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      whatsapp_clicks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (business_id, day)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      details TEXT DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
    );

    CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category);
    CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_business ON reviews(business_id);
    CREATE INDEX IF NOT EXISTS idx_product_tags_business ON product_tags(business_id);
    CREATE INDEX IF NOT EXISTS idx_stats_daily_day ON stats_daily(day);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
  `);
}

module.exports = { pool, query, getOne, getAll, run, initSchema };
