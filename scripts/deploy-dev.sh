#!/usr/bin/env bash
# Deploy dev environment (port 3001) from ~/bitrograde-vaultworks-dev.
# Self-hosted runner executes this via the CI workflow on pushes to develop.
# URL: https://dev-vaultworks.bitrograde.com
set -euo pipefail

# Prevent concurrent runs (CI + webhook can both fire on the same push)
LOCK_FILE="/tmp/vaultworks-dev-deploy.lock"
exec 200>"$LOCK_FILE"
flock -x -w 600 200 || { echo "[deploy-dev] Lock timeout after 10 minutes, aborting"; exit 1; }

DEV_DIR="/home/mastiff/bitrograde-vaultworks-dev"
ENV_FILE="$DEV_DIR/.env"

# Ensure NVM / Node / pnpm are available
source "$HOME/.nvm/nvm.sh" 2>/dev/null || true

echo "[deploy-dev] Pulling latest develop..."
git -C "$DEV_DIR" fetch origin develop
git -C "$DEV_DIR" reset --hard origin/develop

echo "[deploy-dev] Installing backend dependencies..."
pnpm install --dir "$DEV_DIR/backend"

echo "[deploy-dev] Running database migrations..."
env $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs) \
  pnpm --dir "$DEV_DIR/backend" exec prisma migrate deploy \
  --schema "$DEV_DIR/backend/prisma/schema.prisma"

echo "[deploy-dev] Building backend..."
pnpm --dir "$DEV_DIR/backend" run build

echo "[deploy-dev] Installing frontend dependencies..."
pnpm install --dir "$DEV_DIR/frontend"

echo "[deploy-dev] Building frontend..."
env $(grep -v '^#' "$ENV_FILE" | grep '^VITE_' | grep -v '^$' | xargs) \
  pnpm --dir "$DEV_DIR/frontend" run build

echo "[deploy-dev] Reloading PM2 process..."
pm2 reload vaultworks-dev --update-env

echo "[deploy-dev] Done — https://dev-vaultworks.bitrograde.com is updated."
