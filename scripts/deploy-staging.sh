#!/usr/bin/env bash
# Deploy staging environment (port 3001) from the main repo.
# Self-hosted runner executes this via the CI workflow on pushes to develop.
set -euo pipefail

# Prevent concurrent runs (CI + webhook can both fire on the same push)
LOCK_FILE="/tmp/vaultworks-staging-deploy.lock"
exec 200>"$LOCK_FILE"
flock -x -w 600 200 || { echo "[deploy-staging] Lock timeout after 10 minutes, aborting"; exit 1; }

STAGING_DIR="/home/mastiff/development/bitrograde-vaultworks"
ENV_FILE="$STAGING_DIR/.env.staging"

echo "[deploy-staging] Pulling latest develop..."
git -C "$STAGING_DIR" fetch origin develop
git -C "$STAGING_DIR" reset --hard origin/develop

echo "[deploy-staging] Installing backend dependencies..."
pnpm install --frozen-lockfile --dir "$STAGING_DIR/backend"

echo "[deploy-staging] Running database migrations..."
cd "$STAGING_DIR" && env $(grep -v '^#' "$ENV_FILE" | xargs) \
  pnpm --dir "$STAGING_DIR/backend" exec prisma migrate deploy \
  --schema "$STAGING_DIR/backend/prisma/schema.prisma"

echo "[deploy-staging] Building backend..."
pnpm --dir "$STAGING_DIR/backend" run build

echo "[deploy-staging] Installing frontend dependencies..."
pnpm install --frozen-lockfile --dir "$STAGING_DIR/frontend"

echo "[deploy-staging] Building frontend..."
cd "$STAGING_DIR/frontend" && \
  env $(grep -v '^#' "$ENV_FILE" | grep '^VITE_' | xargs) \
  pnpm --dir "$STAGING_DIR/frontend" run build

echo "[deploy-staging] Reloading PM2 process..."
pm2 reload vaultworks-staging --update-env

echo "[deploy-staging] Done."
