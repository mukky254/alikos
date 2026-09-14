// src/lib/helpers.js
const { run } = require('../db');

async function notify(userId, type, message, businessId = null) {
  await run('INSERT INTO notifications (user_id, type, message, business_id) VALUES ($1, $2, $3, $4)', [userId, type, message, businessId]);
}

async function logAudit(adminId, action, targetType, targetId, details = '') {
  await run('INSERT INTO audit_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)', [adminId, action, targetType, targetId, details]);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function bumpDailyStat(businessId, column) {
  const day = todayStr();
  await run(
    `INSERT INTO stats_daily (business_id, day, ${column}) VALUES ($1, $2, 1)
     ON CONFLICT (business_id, day) DO UPDATE SET ${column} = stats_daily.${column} + 1`,
    [businessId, day]
  );
}

/** Real haversine distance in km — computed in JS so it works on any Postgres host without custom functions. */
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parses hours_json (e.g. {"mon":["09:00","18:00"], ...}) and tells if open right now. */
function isOpenNow(hoursJson) {
  if (!hoursJson) return null;
  let hours;
  try { hours = JSON.parse(hoursJson); } catch (e) { return null; }
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const now = new Date();
  const today = days[now.getDay()];
  const range = hours[today];
  if (!range || range.length !== 2) return false;
  const [openStr, closeStr] = range;
  const [oh, om] = openStr.split(':').map(Number);
  const [ch, cm] = closeStr.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= oh * 60 + om && nowMinutes <= ch * 60 + cm;
}

/** Very small, dependency-free CSV line parser (handles quoted fields with commas). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvEscape(val) {
  const s = String(val == null ? '' : val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = { notify, logAudit, todayStr, bumpDailyStat, haversineKm, isOpenNow, parseCsv, csvEscape };
