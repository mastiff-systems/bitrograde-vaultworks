-- Normalize asset_type values to match frontend type declarations.
-- '3d_model' → '3d'  (detectAssetType was returning '3d_model'; frontend expects '3d')
-- 'texture'  → 'image' (detectAssetType was returning 'texture'; frontend expects 'image')
UPDATE "assets" SET "asset_type" = '3d'    WHERE "asset_type" = '3d_model';
UPDATE "assets" SET "asset_type" = 'image' WHERE "asset_type" = 'texture';

-- Replace the constraint, removing legacy '3d_model' and 'texture' (now normalized above)
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_asset_type_check";
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_asset_type_check"
  CHECK (asset_type IN ('audio', '3d', 'image', 'video', 'font', 'document', 'script', 'sprite', 'other'));
