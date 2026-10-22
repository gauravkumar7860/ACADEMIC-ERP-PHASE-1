const express = require('express');
const db = require('../config/db');
const { signSession, checkPassword, hashPassword, generateRawToken, hashToken } = require('../utils/auth');
const { requireAuth } = require('../middleware/auth');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;

const findByUsername = (username) =>
  db.one('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = $1', [username]);

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const user = await findByUsername(String(username).trim().toLowerCase());
  const genericError = { error: 'Incorrect username or password.' };
  if (!user) return res.status(401).json(genericError);
  if (!user.is_active) return res.status(401).json({ error: 'This account has been deactivated. Contact your administrator.' });
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({ error: 'Too many failed attempts. Please try again in a few minutes.' });
  }

  if (!checkPassword(password, user.password_hash)) {
    const attempts = user.failed_login_attempts + 1;
    const lockUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
    await db.query('UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockUntil, user.id]);
    return res.status(401).json(genericError);
  }

  await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1', [user.id]);
  res.cookie('session', signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: Number(process.env.SESSION_HOURS || 8) * 3600 * 1000,
  });
  res.json({ user: { id: user.id, username: user.username, role: user.role }, mustChangePassword: !!user.must_change_password });
});

router.post('/logout', (req, res) => { res.clearCookie('session'); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const row = await db.one('SELECT password_hash, must_change_password FROM users WHERE id = $1', [req.user.id]);
  if (!currentPassword || !checkPassword(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  await db.tx(async (t) => {
    await t.query('UPDATE users SET password_hash = $1, must_change_password = 0, updated_at = NOW() WHERE id = $2', [hashPassword(newPassword), req.user.id]);
    await recordAudit({ req, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: req.user.id,
      reason: row.must_change_password ? 'first_login_forced_change' : 'user_initiated' }, t);
  });
  res.json({ ok: true });
});

// In production, send the token by email/SMS instead of returning it (see README).
router.post('/forgot-password', async (req, res) => {
  const generic = { ok: true, message: 'If that account exists, a reset link has been generated.' };
  const { username } = req.body || {};
  if (!username) return res.json(generic);
  const user = await findByUsername(String(username).trim().toLowerCase());
  if (!user || !user.is_active) return res.json(generic);

  const raw = generateRawToken();
  await db.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [user.id, hashToken(raw), new Date(Date.now() + RESET_TOKEN_MINUTES * 60000)]);
  if (process.env.NODE_ENV !== 'production') { generic.devResetToken = raw; generic.devNote = 'Shown only because NODE_ENV != production.'; }
  res.json(generic);
});

router.post('/reset-password', async (req, res) => {
  const { username, token, newPassword } = req.body || {};
  if (!username || !token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Username, token and a new password (min 8 chars) are required.' });
  }
  const bad = { error: 'Invalid or expired reset link.' };
  const user = await findByUsername(String(username).trim().toLowerCase());
  if (!user) return res.status(400).json(bad);

  const row = await db.one(
    'SELECT * FROM password_reset_tokens WHERE user_id = $1 AND token_hash = $2 AND used = 0 ORDER BY id DESC LIMIT 1',
    [user.id, hashToken(token)]);
  if (!row || new Date(row.expires_at) < new Date()) return res.status(400).json(bad);

  await db.tx(async (t) => {
    await t.query('UPDATE password_reset_tokens SET used = 1 WHERE id = $1', [row.id]);
    await t.query('UPDATE users SET password_hash = $1, must_change_password = 0, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $2',
      [hashPassword(newPassword), user.id]);
    await recordAudit({ req, action: 'PASSWORD_RESET_VIA_TOKEN', entityType: 'user', entityId: user.id }, t);
  });
  res.json({ ok: true });
});

module.exports = router;
