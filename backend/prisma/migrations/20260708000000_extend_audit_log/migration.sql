-- Extend audit_action enum with missing values (PostgreSQL only allows adding, not removing)
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'SHARE';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'REVOKE_SHARE';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'UPDATE_METADATA';

-- Add new columns
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "asset_name" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;

-- Rename metadata column to details
ALTER TABLE "audit_logs" RENAME COLUMN "metadata" TO "details";
