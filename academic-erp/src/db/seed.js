// npm run seed - safe to re-run; every insert is guarded.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const ROLES = ['super_admin', 'university_admin', 'dean', 'hod', 'faculty', 'student'];

async function main() {
  await db.init();
  for (const r of ROLES) await db.query('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [r]);

  const username = (process.env.SEED_ADMIN_USERNAME || 'admin').toLowerCase();
  if (await db.one('SELECT id FROM users WHERE username = $1', [username])) {
    console.log(`Super admin "${username}" already exists - skipping.`);
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123';
    const role = await db.one("SELECT id FROM roles WHERE name = 'super_admin'");
    await db.query(
      'INSERT INTO users (username, email, password_hash, role_id, must_change_password) VALUES ($1,$2,$3,$4,1)',
      [username, process.env.SEED_ADMIN_EMAIL || 'admin@example.edu', bcrypt.hashSync(password, 12), role.id]);
    console.log(`Created super admin "${username}". It must change its password on first login.`);
  }

  if (!(await db.one('SELECT id FROM departments LIMIT 1'))) {
    const cs = await db.one("INSERT INTO departments (name, code) VALUES ('Computer Science','CS') RETURNING id");
    await db.query("INSERT INTO departments (name, code) VALUES ('Humanities','HUM')");
    const bca = await db.one('INSERT INTO programmes (name, code, department_id, duration_semesters) VALUES ($1,$2,$3,$4) RETURNING id',
      ['BCA', 'BCA', cs.id, 6]);
    await db.query("INSERT INTO academic_sessions (name, start_date, end_date, is_current) VALUES ('2026-2027','2026-07-01','2027-06-30',1)");
    for (const s of ['A', 'B']) await db.query('INSERT INTO sections (programme_id, semester, name) VALUES ($1,5,$2)', [bca.id, s]);
    console.log('Seeded demo departments, BCA programme, academic session and sections.');
  }
  console.log('Seed complete.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
