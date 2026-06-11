CREATE TABLE "notifications" (
  "id"          UUID          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     UUID          NOT NULL,
  "type"        TEXT          NOT NULL,
  "title"       TEXT          NOT NULL,
  "body"        TEXT          NOT NULL,
  "resource_id" UUID,
  "read"        BOOLEAN       NOT NULL DEFAULT false,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "notifications_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "assets"("id") ON DELETE SET NULL
);

CREATE INDEX "notifications_user_id_idx"    ON "notifications" ("user_id");
CREATE INDEX "notifications_created_at_idx" ON "notifications" ("created_at" DESC);
