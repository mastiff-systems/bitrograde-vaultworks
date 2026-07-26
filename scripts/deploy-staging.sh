#!/usr/bin/env bash
# Deploy staging environment (port 3001) from the main repo.
# Self-hosted runner executes this via the CI workflow on pushes to develop.
set -euo pipefail

STAGING_DIR="/home/mastiff/development/bitrograde-vaultworks"
ENV_FILE="$STAGING_DIR/.env.staging"

echo "[deploy-staging] Pulling latest develop..."
git -C "$STAGING_DIR" fetch origin develop
git -C "$STAGING_DIR" reset --hard origin/develop

echo "[deploy-staging] Installing backend dependencies..."
npm ci --prefix "$STAGING_DIR/backend"

echo "[deploy-staging] Running database migrations..."
cd "$STAGING_DIR" && env $(grep -v '^#' "$ENV_FILE" | xargs) \
  npx --prefix "$STAGING_DIR/backend" prisma migrate deploy \
  --schema "$STAGING_DIR/backend/prisma/schema.prisma"

echo "[deploy-staging] Building backend..."
npm run build --prefix "$STAGING_DIR/backend"

echo "[deploy-staging] Installing frontend dependencies..."
npm ci --prefix "$STAGING_DIR/frontend"

echo "[deploy-staging] Building frontend..."
cd "$STAGING_DIR/frontend" && \
  env $(grep -v '^#' "$ENV_FILE" | grep '^VITE_' | xargs) \
  npm run build --prefix "$STAGING_DIR/frontend"

echo "[deploy-staging] Reloading PM2 process..."
pm2 reload vaultworks-staging --update-env

echo "[deploy-staging] Done."
