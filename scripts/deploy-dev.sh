#!/usr/bin/env bash
# Deploy dev environment (port 3002) from the bitrograde-vaultworks-dev worktree.
# Self-hosted runner executes this via the CI workflow on pushes to develop.
set -euo pipefail

DEV_DIR="/home/mastiff/development/bitrograde-vaultworks-dev"
ENV_FILE="$DEV_DIR/.env"

echo "[deploy-dev] Pulling latest develop..."
git -C "$DEV_DIR" fetch origin develop
git -C "$DEV_DIR" reset --hard origin/develop

echo "[deploy-dev] Installing backend dependencies..."
npm ci --prefix "$DEV_DIR/backend"

echo "[deploy-dev] Running database migrations..."
cd "$DEV_DIR" && env $(grep -v '^#' "$ENV_FILE" | xargs) \
  npx --prefix "$DEV_DIR/backend" prisma migrate deploy \
  --schema "$DEV_DIR/backend/prisma/schema.prisma"

echo "[deploy-dev] Building backend..."
npm run build --prefix "$DEV_DIR/backend"

echo "[deploy-dev] Installing frontend dependencies..."
npm ci --prefix "$DEV_DIR/frontend"

echo "[deploy-dev] Building frontend..."
cd "$DEV_DIR/frontend" && \
  env $(grep -v '^#' "$ENV_FILE" | grep '^VITE_' | xargs) \
  npm run build --prefix "$DEV_DIR/frontend"

echo "[deploy-dev] Reloading PM2 process..."
pm2 reload vaultworks-dev --update-env

echo "[deploy-dev] Done."
