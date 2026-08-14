-- CreateTable
CREATE TABLE "folders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_user_id" UUID,
    "parent_folder_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folder_assets" (
    "folder_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,

    CONSTRAINT "folder_assets_pkey" PRIMARY KEY ("folder_id","asset_id")
);

-- CreateIndex
CREATE INDEX "folders_created_by_user_id_idx" ON "folders"("created_by_user_id");

-- CreateIndex
CREATE INDEX "folders_parent_folder_id_idx" ON "folders"("parent_folder_id");

-- CreateIndex
CREATE INDEX "folder_assets_asset_id_idx" ON "folder_assets"("asset_id");

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_assets" ADD CONSTRAINT "folder_assets_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_assets" ADD CONSTRAINT "folder_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
