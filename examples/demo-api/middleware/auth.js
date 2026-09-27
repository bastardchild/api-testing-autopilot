// examples/demo-api/middleware/auth.js
// Bearer-token auth middleware.

module.exports = function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
