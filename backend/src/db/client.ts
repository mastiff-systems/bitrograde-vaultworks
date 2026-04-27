import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Add role column to existing deployments that pre-date this migration
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
      CHECK (role IN ('admin','user'));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      original_name TEXT NOT NULL,
      mime_type     TEXT,
      size_bytes    BIGINT,
      storage_key   TEXT NOT NULL UNIQUE,
      asset_type    TEXT CHECK (asset_type IN ('3d','audio','image','other')),
      uploaded_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
