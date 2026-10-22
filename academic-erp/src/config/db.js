// Database layer. One small API, two backends:
//   DATABASE_URL set   -> real PostgreSQL via `pg` (Supabase free tier in production)
//   DATABASE_URL unset -> embedded PGlite (real Postgres in WASM) for zero-setup LOCAL dev only
// SQL uses $1, $2 placeholders and runs unchanged on both.
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL;
let backend;

if (DATABASE_URL) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => parseInt(v, 10)); // bigint (COUNT) -> number
  const pool = new Pool({
    connectionString: DATABASE_URL,
    // Supabase requires TLS. Set PGSSL=disable only for a plain local Postgres.
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5), // keep low for free-tier connection limits
  });
  backend = {
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (s, p) => client.query(s, p) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
} else {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production. Use your Supabase connection string.');
  }
  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.LOCAL_DB_DIR || path.join(__dirname, '..', '..', 'data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir);
  backend = {
    query: (sql, params) => lite.query(sql, params),
    exec: (sql) => lite.exec(sql),
    tx: (fn) => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
  };
  console.log('[db] No DATABASE_URL set - using embedded local PGlite database (dev only).');
}

const wrap = (q) => ({
  query: async (sql, params = []) => (await q(sql, params)).rows,
  one: async (sql, params = []) => (await q(sql, params)).rows[0] || null,
});

const db = {
  ...wrap(backend.query),
  tx: (fn) => backend.tx((t) => fn(wrap(t.query))),
  async init() {
    await backend.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  },
};

module.exports = db;
