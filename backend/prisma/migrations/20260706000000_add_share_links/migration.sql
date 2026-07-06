-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE 'SHARE';
ALTER TYPE "audit_action" ADD VALUE 'REVOKE_SHARE';

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_asset_id_key" ON "share_links"("asset_id");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
