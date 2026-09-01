-- AlterTable: add soft-delete fields to folders (MAS-715 — mirrors assets' trash bin)
ALTER TABLE "folders" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "folders" ADD COLUMN "deleted_by_user_id" UUID;

-- CreateIndex: index for efficient trash bin queries (find folders pending auto-purge)
CREATE INDEX "folders_deleted_at_idx" ON "folders"("deleted_at");

-- AddForeignKey: track which user trashed the folder
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_user_id_fkey"
  FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
