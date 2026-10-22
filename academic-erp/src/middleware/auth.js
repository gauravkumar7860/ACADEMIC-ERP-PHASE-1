const db = require('../config/db');
const { verifySession } = require('../utils/auth');

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  const payload = token && verifySession(token);
  if (!payload) return res.status(401).json({ error: 'Please log in to continue.' });

  const user = await db.one(
    `SELECT u.id, u.username, u.email, u.is_active, u.must_change_password, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [payload.sub]
  );
  if (!user || !user.is_active) return res.status(401).json({ error: 'This account is no longer active.' });

  // Until a forced password change is done, only the change-password endpoint works.
  const isChangePassword = req.originalUrl.split('?')[0] === '/api/auth/change-password';
  if (user.must_change_password && !isChangePassword) {
    return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED', message: 'You must set a new password before continuing.' });
  }
  req.user = user;
  next();
}

const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user || !allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  next();
};

module.exports = { requireAuth, requireRole };
