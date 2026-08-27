-- AlterTable
ALTER TABLE "assets" ADD COLUMN "uploaded_by" UUID;

-- CreateIndex
CREATE INDEX "assets_uploaded_by_idx" ON "assets"("uploaded_by");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
