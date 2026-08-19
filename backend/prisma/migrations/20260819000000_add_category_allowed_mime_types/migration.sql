-- AlterTable
ALTER TABLE "categories" ADD COLUMN "allowed_mime_types" TEXT[] NOT NULL DEFAULT '{}';
