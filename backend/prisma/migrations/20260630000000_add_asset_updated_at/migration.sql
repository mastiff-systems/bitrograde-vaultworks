-- Add updated_at column to assets table
ALTER TABLE "assets" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
