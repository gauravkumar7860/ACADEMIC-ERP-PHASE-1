const express = require('express');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

router.get('/profile', async (req, res) => {
  const faculty = await db.one(
    'SELECT f.*, d.name AS department_name FROM faculty f JOIN departments d ON d.id = f.department_id WHERE f.user_id = $1', [req.user.id]);
  if (!faculty) return res.status(404).json({ error: 'Faculty profile not found.' });
  res.json({ faculty });
});

module.exports = router;
