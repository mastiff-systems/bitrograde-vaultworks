-- Repair migration: apply DDL from three 2026-08-26 migrations that were
-- baselined via `prisma migrate resolve --applied` (applied_steps_count=0)
-- and therefore never executed against the database.
--
-- All statements are idempotent (IF NOT EXISTS guards) so this migration
-- is safe to run on any environment, including dev where QA already applied
-- the columns manually.
--
-- Affected baselines:
--   20260826000000_add_first_last_name_to_users
--   20260826000002_extend_audit_action_and_logs
--   20260826000010_add_trash_bin_to_assets

-- ── 20260826000000: first_name / last_name on users ─────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_name" TEXT;

-- ── 20260826000002: audit_action enum values + user_name on audit_logs ───────
-- Note: ALTER TYPE … ADD VALUE cannot run inside a transaction.
-- Prisma detects these statements and executes them outside the transaction block.
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'LOGIN';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'LOGOUT';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RESTORE';

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_name" TEXT;

-- ── 20260826000010: soft-delete columns on assets ───────────────────────────
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "deleted_by" UUID;

CREATE INDEX IF NOT EXISTS "assets_deleted_at_idx" ON "assets"("deleted_at");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name   = 'assets_deleted_by_fkey'
      AND table_name        = 'assets'
  ) THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_deleted_by_fkey"
      FOREIGN KEY ("deleted_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Mark the three baselined migrations as properly resolved ─────────────────
-- Their DDL is now applied by this repair migration; set applied_steps_count=1
-- to match the convention used by all other successfully-applied migrations.
UPDATE "_prisma_migrations"
SET applied_steps_count = 1
WHERE migration_name IN (
  '20260826000000_add_first_last_name_to_users',
  '20260826000002_extend_audit_action_and_logs',
  '20260826000010_add_trash_bin_to_assets'
)
  AND applied_steps_count = 0;
