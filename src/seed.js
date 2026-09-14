// src/seed.js
// Run with: npm run seed
// Point DATABASE_URL (in .env) at your Postgres database first — a free
// Neon/Supabase database works for both local dev and production. Creates
// the tables if they don't exist, the ONE admin account (from .env), a demo
// business-owner account, and sample Nairobi businesses. Safe to re-run.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getOne, getAll, run, initSchema, pool } = require('./db');

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@aliko.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const name = process.env.ADMIN_NAME || 'Aliko Admin';
  const existing = await getOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    await run("UPDATE users SET role = 'admin' WHERE id = $1", [existing.id]);
    console.log(`Admin already existed (${email}) — role confirmed as admin.`);
    return existing.id;
  }
  const hash = bcrypt.hashSync(password, 10);
  const { rows } = await run('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', [name, email, hash, 'admin']);
  console.log(`Created admin account: ${email} / ${password}`);
  return rows[0].id;
}

async function ensureDemoOwner() {
  const email = 'demo.owner@aliko.local';
  const existing = await getOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) return existing.id;
  const hash = bcrypt.hashSync('DemoOwner123!', 10);
  const { rows } = await run('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', ['Demo Business Owner', email, hash, 'user']);
  console.log(`Created demo business-owner account: ${email} / DemoOwner123!`);
  return rows[0].id;
}

const STANDARD_HOURS = JSON.stringify({ mon: ['08:00', '18:00'], tue: ['08:00', '18:00'], wed: ['08:00', '18:00'], thu: ['08:00', '18:00'], fri: ['08:00', '18:00'], sat: ['09:00', '15:00'], sun: null });
const HOTEL_HOURS = JSON.stringify({ mon: ['00:00', '23:59'], tue: ['00:00', '23:59'], wed: ['00:00', '23:59'], thu: ['00:00', '23:59'], fri: ['00:00', '23:59'], sat: ['00:00', '23:59'], sun: ['00:00', '23:59'] });

async function seedBusinesses(ownerId) {
  const count = (await getOne('SELECT COUNT(*)::int AS c FROM businesses')).c;
  if (count > 0) { console.log(`Businesses table already has ${count} rows — skipping business seed.`); return; }
  const base = -1.2841, baseLng = 36.8233;
  const businesses = [
    ['Al-Huda Electronics', 'Electronics', 'Chargers, cables, adapters and accessories for all major phone and laptop brands.', '0722334455', '0722334455', 'alhuda@example.com', base + 0.0006, baseLng + 0.0004, 'Khoja Building', '3', '312', 'Tom Mboya Street entrance', 'Opposite I&M Bank', 1, STANDARD_HOURS, 'charger,cable,adapter,powerbank'],
    ['Tech Point Repairs', 'Phone Repair', 'Screen replacement, battery swaps and software repair for all phone brands.', '0733112233', '0733112233', 'techpoint@example.com', base - 0.0009, baseLng + 0.0011, 'Bruce House', '1', '14', 'Standard Street entrance', 'Next to the shoe shop', 1, STANDARD_HOURS, 'screen repair,battery,samsung,iphone'],
    ['Mobile World', 'Electronics', 'New and refurbished phones, SIM cards and mobile money services.', '0711223344', '0711223344', '', base - 0.0011, baseLng + 0.0009, 'Bruce House', '0', 'G7', 'Main entrance', 'Ground floor, near the lifts', 0, STANDARD_HOURS, 'phones,sim card,mpesa'],
    ['City Pharmacy', 'Pharmacy', 'Prescription and over-the-counter medicine, open 7 days a week.', '0700998877', '0700998877', 'citypharmacy@example.com', base + 0.0014, baseLng - 0.0007, 'Hilton Arcade', 'Ground', 'A3', 'Moi Avenue entrance', 'Beside the Hilton Hotel', 1, HOTEL_HOURS, 'medicine,prescription,painkillers'],
    ['Prestige Barbershop', 'Barber & Salon', 'Fades, shaves and grooming for men and boys. Walk-ins welcome.', '0745667788', '0745667788', '', base - 0.0004, baseLng - 0.0013, 'Rehani House', '2', '204', 'Kenyatta Avenue entrance', 'Above the corner café', 1, STANDARD_HOURS, 'haircut,fade,shave'],
    ['Laptop Doctor Kenya', 'Laptop Repair', 'Laptop screen, keyboard and motherboard repair. Free diagnosis.', '0788112200', '0788112200', 'laptopdoctor@example.com', base + 0.0021, baseLng + 0.0016, 'Reinsurance Plaza', '5', '512', 'Aga Khan Walk entrance', 'Next to the rooftop restaurant', 0, STANDARD_HOURS, 'laptop repair,motherboard,keyboard'],
    ['CBD Corner Café', 'Restaurant & Café', 'Coffee, breakfast and light lunch in a quiet corner off the main street.', '0722556677', '0722556677', '', base - 0.0016, baseLng - 0.0005, 'Uniafric House', 'Ground', 'G2', 'Koinange Street entrance', 'Opposite the Ambassadeur Hotel', 1, STANDARD_HOURS, 'coffee,breakfast,lunch'],
    ['Sunrise Guest Hotel', 'Hotel', 'Budget-friendly rooms in the city centre, secure parking available.', '0733445566', '0733445566', 'sunrise@example.com', base + 0.0009, baseLng - 0.0018, 'Sunrise House', '4', 'Reception, 4th floor', 'River Road entrance', 'Near the OTC bus stage', 1, HOTEL_HOURS, 'rooms,accommodation,parking'],
  ];
  const ids = [];
  for (const r of businesses) {
    const { rows } = await run(
      `INSERT INTO businesses (owner_id, name, category, description, phone, whatsapp, email, lat, lng, building, floor, shop, entrance, landmark, verified, successful_visits, hours_json, verification_tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [ownerId, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], Math.floor(Math.random() * 25) + 5, r[14], r[13] ? 'basic' : 'none']
    );
    const bizId = rows[0].id;
    ids.push({ id: bizId, verified: r[13] });
    for (const tag of r[15].split(',')) await run('INSERT INTO product_tags (business_id, tag) VALUES ($1, $2)', [bizId, tag.trim()]);
  }
  console.log(`Seeded ${businesses.length} sample businesses.`);

  await run("UPDATE businesses SET verification_tier = 'premium' WHERE id = $1", [ids[0].id]);
  const now = Math.floor(Date.now() / 1000);
  await run('INSERT INTO offers (business_id, title, description, discount, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    ids[0].id, 'Back-to-school charger bundle', 'Buy any fast charger and get a free cable.', '20% off', now, now + 14 * 24 * 3600,
  ]);
  console.log('Seeded 1 sample deal and 1 premium-tier business.');
}

(async () => {
  try {
    await initSchema();
    console.log('Schema ready.');
    const adminId = await ensureAdmin();
    const ownerId = await ensureDemoOwner();
    await seedBusinesses(ownerId);
    console.log('Seed complete.');
  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
