// api/index.js
// Vercel convention: any file in /api becomes a serverless function. This one
// exports the entire Express app (see src/server.js), and vercel.json
// rewrites every /api/* request to it. The /public folder is served
// automatically by Vercel as static files — this function only ever handles
// /api/* routes in production.
module.exports = require('../src/server');
