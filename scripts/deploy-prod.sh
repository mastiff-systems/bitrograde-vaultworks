#!/usr/bin/env bash
# Deploy production environment (port 3000) from the main repo (main branch).
# Self-hosted runner executes this via the CI workflow on pushes to main.
set -euo pipefail

PROD_DIR="/home/mastiff/development/bitrograde-vaultworks-prod"
ENV_FILE="$PROD_DIR/.env"

if [ ! -d "$PROD_DIR" ]; then
  echo "[deploy-prod] ERROR: Production directory $PROD_DIR does not exist."
  echo "[deploy-prod] Run: git worktree add $PROD_DIR main"
  exit 1
fi

echo "[deploy-prod] Pulling latest main..."
git -C "$PROD_DIR" fetch origin main
git -C "$PROD_DIR" reset --hard origin/main

echo "[deploy-prod] Installing backend dependencies..."
pnpm install --frozen-lockfile --dir "$PROD_DIR/backend"

echo "[deploy-prod] Running database migrations..."
cd "$PROD_DIR" && env $(grep -v '^#' "$ENV_FILE" | xargs) \
  pnpm --dir "$PROD_DIR/backend" exec prisma migrate deploy \
  --schema "$PROD_DIR/backend/prisma/schema.prisma"

echo "[deploy-prod] Building backend..."
pnpm --dir "$PROD_DIR/backend" run build

echo "[deploy-prod] Installing frontend dependencies..."
pnpm install --frozen-lockfile --dir "$PROD_DIR/frontend"

echo "[deploy-prod] Building frontend..."
cd "$PROD_DIR/frontend" && \
  env $(grep -v '^#' "$ENV_FILE" | grep '^VITE_' | xargs) \
  pnpm --dir "$PROD_DIR/frontend" run build

echo "[deploy-prod] Reloading PM2 process..."
pm2 reload vaultworks-prod --update-env

echo "[deploy-prod] Done."
