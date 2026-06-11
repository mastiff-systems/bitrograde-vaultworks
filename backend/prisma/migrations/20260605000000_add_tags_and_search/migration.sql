-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index for fuzzy search on asset names
CREATE INDEX "assets_original_name_trgm_idx" ON "assets" USING GIN ("original_name" gin_trgm_ops);

-- GIN trigram index for fuzzy search on tag names
CREATE INDEX "tags_name_trgm_idx" ON "tags" USING GIN ("name" gin_trgm_ops);
