const express = require('express');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

// The row is always looked up from the session's user id - never from a client-supplied id.
const getOwn = (userId) => db.one(
  `SELECT s.*, p.name AS programme_name, p.code AS programme_code, d.name AS department_name, sec.name AS section_name
   FROM students s JOIN programmes p ON p.id = s.programme_id JOIN departments d ON d.id = s.department_id
   LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.user_id = $1`, [userId]);

router.get('/profile', async (req, res) => {
  const student = await getOwn(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student profile not found.' });
  res.json({ student });
});

const SELF_EDITABLE = ['mobile', 'address']; // academic fields are never student-writable

router.patch('/profile', async (req, res) => {
  const student = await getOwn(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student profile not found.' });
  const updates = {};
  for (const f of SELF_EDITABLE) if (f in (req.body || {})) updates[f] = req.body[f];
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: `Only ${SELF_EDITABLE.join(', ')} can be updated by students.` });

  await db.tx(async (t) => {
    const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await t.query(`UPDATE students SET ${set}, updated_at = NOW() WHERE id = $${keys.length + 1}`, [...keys.map((k) => updates[k]), student.id]);
    await recordAudit({ req, action: 'STUDENT_SELF_PROFILE_UPDATED', entityType: 'student', entityId: student.id,
      oldValue: Object.fromEntries(keys.map((k) => [k, student[k]])), newValue: updates }, t);
  });
  res.json({ ok: true });
});

module.exports = router;
