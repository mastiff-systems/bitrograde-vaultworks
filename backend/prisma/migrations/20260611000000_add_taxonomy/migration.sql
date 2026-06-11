-- CreateTable categories
CREATE TABLE "categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_name_key" UNIQUE ("name"),
  CONSTRAINT "categories_slug_key" UNIQUE ("slug")
);

-- CreateTable subcategories
CREATE TABLE "subcategories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subcategories_category_id_slug_key" UNIQUE ("category_id", "slug")
);

-- AddForeignKey subcategories -> categories (CASCADE on parent delete)
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable assets: add taxonomy and metadata columns (all nullable for backward compat)
ALTER TABLE "assets"
  ADD COLUMN "category_id" UUID,
  ADD COLUMN "subcategory_id" UUID,
  ADD COLUMN "license" TEXT,
  ADD COLUMN "resolution_w" INTEGER,
  ADD COLUMN "resolution_h" INTEGER,
  ADD COLUMN "duration_seconds" DOUBLE PRECISION;

-- AddForeignKey assets -> categories (SET NULL so deleting a category doesn't delete assets)
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey assets -> subcategories (SET NULL)
ALTER TABLE "assets" ADD CONSTRAINT "assets_subcategory_id_fkey"
  FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex for FK columns to support filter queries
CREATE INDEX "assets_category_id_idx" ON "assets"("category_id");
CREATE INDEX "assets_subcategory_id_idx" ON "assets"("subcategory_id");
