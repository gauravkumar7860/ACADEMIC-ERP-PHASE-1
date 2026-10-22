const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const db = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordAudit } = require('../utils/audit');
const { hashPassword, generateTempPassword } = require('../utils/auth');
const { validateStudentRow, REQUIRED_FIELDS } = require('../utils/studentValidation');

const router = express.Router();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB CSV cap
const ADMIN_ROLES = ['super_admin', 'university_admin'];
router.use(requireAuth, requireRole(...ADMIN_ROLES));

const isUniqueViolation = (e) => e && e.code === '23505';

// ------------------------------------------------------------ DASHBOARD
router.get('/dashboard', async (req, res) => {
  const n = async (sql) => (await db.one(sql)).n;
  res.json({
    totalStudents: await n('SELECT COUNT(*)::int AS n FROM students WHERE is_active = 1'),
    totalFaculty: await n('SELECT COUNT(*)::int AS n FROM faculty WHERE is_active = 1'),
    totalDepartments: await n('SELECT COUNT(*)::int AS n FROM departments WHERE is_active = 1'),
    totalProgrammes: await n('SELECT COUNT(*)::int AS n FROM programmes WHERE is_active = 1'),
    pendingImportBatches: await n("SELECT COUNT(*)::int AS n FROM student_import_batches WHERE status = 'staged'"),
  });
});

router.get('/reference-data', async (req, res) => {
  res.json({
    departments: await db.query('SELECT * FROM departments WHERE is_active = 1 ORDER BY name'),
    programmes: await db.query('SELECT * FROM programmes WHERE is_active = 1 ORDER BY name'),
    sections: await db.query(
      'SELECT s.*, p.code AS programme_code FROM sections s JOIN programmes p ON p.id = s.programme_id ORDER BY p.code, s.semester, s.name'),
  });
});

// ------------------------------------------------------------ FACULTY
router.get('/faculty', async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const faculty = await db.query(
    `SELECT f.id, f.employee_id, f.name, f.designation, f.mobile, f.is_active, d.name AS department,
            u.username, u.email
     FROM faculty f JOIN departments d ON d.id = f.department_id JOIN users u ON u.id = f.user_id
     WHERE f.name ILIKE $1 OR f.employee_id ILIKE $1 ORDER BY f.name`, [q]);
  res.json({ faculty });
});

router.post('/faculty', async (req, res) => {
  const { employee_id, name, department_id, designation, mobile, username, email } = req.body || {};
  if (!employee_id || !name || !department_id || !username) {
    return res.status(400).json({ error: 'Employee ID, name, department and username are required.' });
  }
  const uname = String(username).trim().toLowerCase();
  const tempPassword = generateTempPassword();
  try {
    const facultyId = await db.tx(async (t) => {
      const role = await t.one("SELECT id FROM roles WHERE name = 'faculty'");
      const user = await t.one(
        `INSERT INTO users (username, email, password_hash, role_id, must_change_password, created_by)
         VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
        [uname, email || null, hashPassword(tempPassword), role.id, req.user.id]);
      const f = await t.one(
        `INSERT INTO faculty (user_id, employee_id, name, department_id, designation, mobile)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [user.id, employee_id, name, department_id, designation || null, mobile || null]);
      await recordAudit({ req, action: 'FACULTY_CREATED', entityType: 'faculty', entityId: f.id,
        newValue: { employee_id, name, username: uname } }, t);
      return f.id;
    });
    res.status(201).json({ facultyId, username: uname, temporaryPassword: tempPassword });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: 'That username, email or employee ID is already in use.' });
    throw e;
  }
});

router.patch('/faculty/:id/status', async (req, res) => {
  const active = req.body && req.body.is_active ? 1 : 0;
  const f = await db.one('SELECT * FROM faculty WHERE id = $1', [req.params.id]);
  if (!f) return res.status(404).json({ error: 'Faculty record not found.' });
  await db.tx(async (t) => {
    await t.query('UPDATE faculty SET is_active = $1, updated_at = NOW() WHERE id = $2', [active, f.id]);
    await t.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [active, f.user_id]);
    await recordAudit({ req, action: active ? 'FACULTY_ACTIVATED' : 'FACULTY_DEACTIVATED', entityType: 'faculty', entityId: f.id,
      oldValue: { is_active: f.is_active }, newValue: { is_active: active } }, t);
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------ STUDENTS
router.get('/students', async (req, res) => {
  const { q = '', programme_id, semester, section_id, status = 'active' } = req.query;
  const limit = Math.min(Number(req.query.pageSize) || 25, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const where = [];
  const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (q) { p.push(`%${q}%`); const i = p.length; where.push(`(s.name ILIKE $${i} OR s.student_id_no ILIKE $${i} OR s.roll_number ILIKE $${i})`); }
  if (programme_id) add('s.programme_id = ?', Number(programme_id));
  if (semester) add('s.semester = ?', Number(semester));
  if (section_id) add('s.section_id = ?', Number(section_id));
  if (status === 'active') where.push('s.is_active = 1');
  if (status === 'inactive') where.push('s.is_active = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await db.one(`SELECT COUNT(*)::int AS n FROM students s ${w}`, p)).n;
  const students = await db.query(
    `SELECT s.*, p.code AS programme_code, d.name AS department_name, sec.name AS section_name
     FROM students s JOIN programmes p ON p.id = s.programme_id JOIN departments d ON d.id = s.department_id
     LEFT JOIN sections sec ON sec.id = s.section_id ${w}
     ORDER BY s.name LIMIT ${limit} OFFSET ${(page - 1) * limit}`, p);
  res.json({ total, page, pageSize: limit, students });
});

router.get('/students/export', async (req, res) => {
  const rows = await db.query(
    `SELECT s.student_id_no, s.roll_number, s.name, p.code AS programme_code, s.semester,
            sec.name AS section_name, s.mobile, u.email, s.is_active
     FROM students s JOIN programmes p ON p.id = s.programme_id JOIN users u ON u.id = s.user_id
     LEFT JOIN sections sec ON sec.id = s.section_id ORDER BY s.name`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="students_export.csv"');
  res.send(stringify(rows, { header: true }));
});

router.patch('/students/:id', async (req, res) => {
  const s = await db.one('SELECT * FROM students WHERE id = $1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Student not found.' });
  const editable = ['mobile', 'address', 'section_id', 'semester'];
  const keys = editable.filter((k) => k in (req.body || {}));
  if (!keys.length) return res.status(400).json({ error: 'No editable fields supplied.' });
  await db.tx(async (t) => {
    const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await t.query(`UPDATE students SET ${set}, updated_at = NOW() WHERE id = $${keys.length + 1}`, [...keys.map((k) => req.body[k]), s.id]);
    await recordAudit({ req, action: 'STUDENT_PROFILE_UPDATED', entityType: 'student', entityId: s.id,
      oldValue: Object.fromEntries(keys.map((k) => [k, s[k]])), newValue: Object.fromEntries(keys.map((k) => [k, req.body[k]])),
      reason: req.body.reason }, t);
  });
  res.json({ ok: true });
});

router.post('/students/bulk-status', async (req, res) => {
  const { student_ids, is_active, reason } = req.body || {};
  if (!Array.isArray(student_ids) || !student_ids.length) return res.status(400).json({ error: 'Select at least one student.' });
  const ids = student_ids.map(Number).filter(Number.isInteger);
  const active = is_active ? 1 : 0;
  await db.tx(async (t) => {
    const rows = await t.query('UPDATE students SET is_active = $1, updated_at = NOW() WHERE id = ANY($2::int[]) RETURNING id, user_id', [active, ids]);
    await t.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = ANY($2::int[])', [active, rows.map((r) => r.user_id)]);
    for (const r of rows) {
      await recordAudit({ req, action: active ? 'STUDENT_ACTIVATED' : 'STUDENT_DEACTIVATED', entityType: 'student', entityId: r.id, reason }, t);
    }
  });
  res.json({ ok: true, affected: ids.length });
});

// ------------------------------------------------------------ BULK IMPORT
// Step 1: upload + validate + preview. Nothing is created yet.
router.post('/students/bulk/validate', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV file to upload.' });
  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    return res.status(400).json({ error: 'This file could not be read as CSV. Check the format and try again.' });
  }
  if (!records.length) return res.status(400).json({ error: 'The file has no data rows.' });
  if (records.length > 2000) return res.status(400).json({ error: 'Please upload at most 2000 rows per file.' });

  const seen = { studentIds: new Set(), rollNumbers: new Set() };
  const validated = [];
  for (let i = 0; i < records.length; i++) {
    validated.push({ row_number: i + 2, data: records[i], errors: await validateStudentRow(records[i], seen) });
  }
  const validCount = validated.filter((r) => r.errors.length === 0).length;

  const batchId = await db.tx(async (t) => {
    const b = await t.one(
      `INSERT INTO student_import_batches (uploaded_by, original_filename, total_rows, valid_rows, error_rows)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.user.id, req.file.originalname, records.length, validCount, records.length - validCount]);
    for (const r of validated) {
      await t.query('INSERT INTO student_import_rows (batch_id, row_number, row_json, errors_json) VALUES ($1,$2,$3,$4)',
        [b.id, r.row_number, JSON.stringify(r.data), JSON.stringify(r.errors)]);
    }
    return b.id;
  });

  res.json({ batchId, totalRows: records.length, validRows: validCount, errorRows: records.length - validCount,
    requiredFields: REQUIRED_FIELDS, preview: validated.slice(0, 200) });
});

// Step 2: commit. Rows that still have errors are always skipped.
router.post('/students/bulk/commit', async (req, res) => {
  const batch = await db.one('SELECT * FROM student_import_batches WHERE id = $1', [Number((req.body || {}).batchId)]);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });
  if (batch.status !== 'staged') return res.status(409).json({ error: `This batch was already ${batch.status}.` });

  const rows = await db.query('SELECT * FROM student_import_rows WHERE batch_id = $1 ORDER BY row_number', [batch.id]);
  const studentRole = await db.one("SELECT id FROM roles WHERE name = 'student'");
  const session = await db.one('SELECT id FROM academic_sessions WHERE is_current = 1');
  const created = [];

  try {
    await db.tx(async (t) => {
      for (const r of rows) {
        if (JSON.parse(r.errors_json || '[]').length) continue;
        const d = JSON.parse(r.row_json);
        const prog = await t.one('SELECT * FROM programmes WHERE code = $1', [d.programme_code]);
        const sec = await t.one('SELECT id FROM sections WHERE programme_id = $1 AND semester = $2 AND name = $3',
          [prog.id, Number(d.semester), d.section_name]);
        const temp = generateTempPassword();
        const username = d.student_id_no.toLowerCase();
        const u = await t.one(
          `INSERT INTO users (username, email, password_hash, role_id, must_change_password, created_by)
           VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
          [username, d.email, hashPassword(temp, 10), studentRole.id, req.user.id]);
        const s = await t.one(
          `INSERT INTO students (user_id, student_id_no, roll_number, name, fathers_name, mothers_name, dob, gender, mobile,
             programme_id, department_id, semester, section_id, admission_year, academic_session_id, address)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [u.id, d.student_id_no, d.roll_number, d.name, d.fathers_name || null, d.mothers_name || null, d.dob, d.gender, d.mobile,
           prog.id, prog.department_id, Number(d.semester), sec.id, Number(d.admission_year) || null, session ? session.id : null, d.address || null]);
        await t.query('UPDATE student_import_rows SET committed = 1 WHERE id = $1', [r.id]);
        created.push({ studentId: s.id, student_id_no: d.student_id_no, username, temporaryPassword: temp });
      }
      await t.query("UPDATE student_import_batches SET status = 'committed' WHERE id = $1", [batch.id]);
      await recordAudit({ req, action: 'STUDENT_BULK_IMPORT_COMMITTED', entityType: 'student_import_batch', entityId: batch.id,
        newValue: { created: created.length, skipped: rows.length - created.length } }, t);
    });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: 'Some records were added by someone else since the preview. Upload the file again to re-check.' });
    throw e;
  }
  res.json({ createdCount: created.length, skippedCount: rows.length - created.length, created });
});

router.post('/students/bulk/:batchId/cancel', async (req, res) => {
  const b = await db.one('SELECT * FROM student_import_batches WHERE id = $1', [Number(req.params.batchId)]);
  if (!b) return res.status(404).json({ error: 'Import batch not found.' });
  await db.query("UPDATE student_import_batches SET status = 'cancelled' WHERE id = $1 AND status = 'staged'", [b.id]);
  res.json({ ok: true });
});

// ------------------------------------------------------------ AUDIT LOG (read-only)
router.get('/audit-logs', async (req, res) => {
  const limit = Math.min(Number(req.query.pageSize) || 50, 200);
  const offset = (Math.max(Number(req.query.page) || 1, 1) - 1) * limit;
  const p = [];
  let w = '';
  if (req.query.entity_type) { p.push(req.query.entity_type); w = 'WHERE entity_type = $1'; }
  const total = (await db.one(`SELECT COUNT(*)::int AS n FROM audit_logs ${w}`, p)).n;
  const logs = await db.query(`SELECT * FROM audit_logs ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, p);
  res.json({ total, logs });
});

module.exports = router;
