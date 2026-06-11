CREATE TABLE "asset_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "size_bytes" BIGINT,
  "mime_type" TEXT,
  "message" TEXT,
  "uploaded_by" UUID,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_versions_asset_id_version_number_key" UNIQUE ("asset_id", "version_number")
);

CREATE INDEX "asset_versions_asset_id_idx" ON "asset_versions"("asset_id");

ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
