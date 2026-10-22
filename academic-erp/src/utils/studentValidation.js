const db = require('../config/db');

const REQUIRED_FIELDS = [
  'student_id_no', 'roll_number', 'name', 'dob', 'gender', 'mobile', 'email',
  'programme_code', 'semester', 'section_name', 'admission_year',
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9]{7,15}$/;

/** Returns a list of error strings for one row; empty list = ready to import. */
async function validateStudentRow(row, seen) {
  const errors = [];
  for (const f of REQUIRED_FIELDS) {
    if (!row[f] || String(row[f]).trim() === '') errors.push(`Missing required field: ${f}`);
  }
  if (errors.length) return errors;

  if (!EMAIL_RE.test(row.email)) errors.push(`Invalid email format: ${row.email}`);
  if (!MOBILE_RE.test(row.mobile)) errors.push(`Invalid mobile format: ${row.mobile}`);

  if (seen.studentIds.has(row.student_id_no)) errors.push(`Duplicate Student ID within this file: ${row.student_id_no}`);
  if (seen.rollNumbers.has(row.roll_number)) errors.push(`Duplicate Roll Number within this file: ${row.roll_number}`);

  if (await db.one('SELECT id FROM students WHERE student_id_no = $1', [row.student_id_no]))
    errors.push(`Student ID already exists in database: ${row.student_id_no}`);
  if (await db.one('SELECT id FROM students WHERE roll_number = $1', [row.roll_number]))
    errors.push(`Roll Number already exists in database: ${row.roll_number}`);
  if (await db.one('SELECT id FROM users WHERE email = $1', [row.email]))
    errors.push(`Email already used by another account: ${row.email}`);

  const programme = await db.one('SELECT * FROM programmes WHERE code = $1 AND is_active = 1', [row.programme_code]);
  if (!programme) {
    errors.push(`Unknown or inactive programme code: ${row.programme_code}`);
  } else {
    const sem = Number(row.semester);
    if (!Number.isInteger(sem) || sem < 1 || sem > programme.duration_semesters) {
      errors.push(`Semester ${row.semester} is not valid for programme ${row.programme_code}`);
    } else if (!(await db.one(
      'SELECT id FROM sections WHERE programme_id = $1 AND semester = $2 AND name = $3',
      [programme.id, sem, row.section_name]))) {
      errors.push(`No section "${row.section_name}" configured for ${row.programme_code} semester ${row.semester}`);
    }
  }
  seen.studentIds.add(row.student_id_no);
  seen.rollNumbers.add(row.roll_number);
  return errors;
}

module.exports = { validateStudentRow, REQUIRED_FIELDS };
