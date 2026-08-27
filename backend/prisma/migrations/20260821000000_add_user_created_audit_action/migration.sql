-- Add USER_CREATED to the audit_action enum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'USER_CREATED';
