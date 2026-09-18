// src/lib/asyncRouter.js
// A plain Express Router does NOT catch rejected promises thrown inside
// `async (req, res) => {...}` handlers — an unhandled rejection like that
// crashes the entire Node process, taking down every other request with it.
// This wraps every route handler so a thrown/rejected error is forwarded to
// Express's error-handling middleware (which replies with a JSON error)
// instead of killing the server. Use this in place of `express.Router()` in
// every route file.
const express = require('express');

function asyncRouter() {
  const router = express.Router();
  ['get', 'post', 'put', 'delete', 'patch'].forEach((method) => {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => {
      const wrapped = handlers.map((h) => {
        if (typeof h !== 'function') return h;
        return (req, res, next) => {
          try {
            const result = h(req, res, next);
            if (result && typeof result.catch === 'function') result.catch(next);
          } catch (err) {
            next(err);
          }
        };
      });
      return original(path, ...wrapped);
    };
  });
  return router;
}

module.exports = asyncRouter;
