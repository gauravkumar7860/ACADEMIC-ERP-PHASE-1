const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to your .env (or Render environment) before starting.');
}
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);

const signSession = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });

function verifySession(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

const hashPassword = (plain, rounds = 12) => bcrypt.hashSync(plain, rounds);
const checkPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

// Readable one-time temporary password for bulk-created accounts.
function generateTempPassword() {
  const words = ['Maple', 'River', 'Cobalt', 'Falcon', 'Amber', 'Cedar', 'Nova', 'Quartz'];
  const word = words[crypto.randomInt(0, words.length)];
  const symbol = ['@', '#', '$', '%'][crypto.randomInt(0, 4)];
  return `${word}${symbol}${crypto.randomInt(1000, 9999)}`;
}

const generateRawToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

module.exports = { signSession, verifySession, hashPassword, checkPassword, generateTempPassword, generateRawToken, hashToken };
