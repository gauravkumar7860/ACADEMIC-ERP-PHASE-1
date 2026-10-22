-- AI-Integrated Academic ERP - Phase 1 schema (PostgreSQL / Supabase)
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL CHECK (name IN
    ('super_admin','university_admin','dean','hod','faculty','student'))
);

CREATE TABLE IF NOT EXISTS academic_sessions (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS programmes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  duration_semesters INTEGER NOT NULL DEFAULT 6,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  semester INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(programme_id, semester, name)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  student_id_no TEXT UNIQUE NOT NULL,
  roll_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  fathers_name TEXT,
  mothers_name TEXT,
  dob TEXT,
  gender TEXT,
  mobile TEXT,
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  semester INTEGER NOT NULL,
  section_id INTEGER REFERENCES sections(id),
  admission_year INTEGER,
  academic_session_id INTEGER REFERENCES academic_sessions(id),
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_prog_sem_sec ON students(programme_id, semester, section_id);

CREATE TABLE IF NOT EXISTS faculty (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  designation TEXT,
  mobile TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_import_batches (
  id SERIAL PRIMARY KEY,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  original_filename TEXT,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','committed','cancelled')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_import_rows (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES student_import_batches(id),
  row_number INTEGER NOT NULL,
  row_json TEXT NOT NULL,
  errors_json TEXT,
  committed INTEGER NOT NULL DEFAULT 0
);

-- Insert-only audit trail (no route updates or deletes rows here).
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
