// src/middleware/auth.js
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

/** Requires a valid Bearer token. Attaches decoded {id, name, email, role} to req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'You must be logged in to do that.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

/** Attaches req.user if a valid token is present, but never blocks the request. */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
    } catch (e) {
      /* ignore invalid token for optional routes */
    }
  }
  next();
}

/**
 * Server-side admin gate. This is the ONLY thing that actually protects the
 * admin panel — it rejects every non-admin request with 403, regardless of
 * what the frontend shows or hides. Must run after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin, SECRET };
