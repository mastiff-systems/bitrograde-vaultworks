-- AlterEnum
-- PostgreSQL ALTER TYPE ADD VALUE cannot run inside a transaction.
-- Prisma handles this by running these statements outside the transaction block.
ALTER TYPE "audit_action" ADD VALUE 'LOGIN';
ALTER TYPE "audit_action" ADD VALUE 'LOGOUT';
ALTER TYPE "audit_action" ADD VALUE 'RESTORE';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "user_name" TEXT;
