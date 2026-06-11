-- CreateTable
CREATE TABLE "users" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "email"         TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role"          TEXT NOT NULL DEFAULT 'user',
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_role_check" CHECK (role IN ('admin','user'))
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateTable
CREATE TABLE "settings" (
    "key"        TEXT NOT NULL,
    "value"      TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "assets" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "original_name" TEXT NOT NULL,
    "mime_type"     TEXT,
    "size_bytes"    BIGINT,
    "storage_key"   TEXT NOT NULL,
    "asset_type"    TEXT,
    "uploaded_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assets_asset_type_check" CHECK (asset_type IN ('3d','audio','image','other'))
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");
