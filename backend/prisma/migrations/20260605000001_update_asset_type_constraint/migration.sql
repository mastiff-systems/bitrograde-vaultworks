-- Drop the original narrow constraint and replace with an expanded set
-- that covers all types emitted by detectAssetType plus manually-assigned types.
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_asset_type_check";

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_asset_type_check"
  CHECK (asset_type IN (
    'audio', '3d_model', 'texture', 'video', 'font',
    'document', 'script', 'sprite', 'other',
    '3d', 'image'
  ));
