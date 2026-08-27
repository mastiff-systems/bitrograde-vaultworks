-- AlterTable: add soft-delete fields to assets
ALTER TABLE "assets" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN "deleted_by" UUID;

-- CreateIndex: index for efficient trash bin queries (find assets pending auto-purge)
CREATE INDEX "assets_deleted_at_idx" ON "assets"("deleted_at");

-- AddForeignKey: track which user deleted the asset
ALTER TABLE "assets" ADD CONSTRAINT "assets_deleted_by_fkey"
  FOREIGN KEY ("deleted_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
