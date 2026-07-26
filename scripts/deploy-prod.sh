#!/usr/bin/env bash
# deploy-prod.sh — pull main, build, migrate, reload production (port 3000)
# Prod dir: /home/mastiff/development/bitrograde-vaultworks-prod
# PM2 app:  vaultworks-prod
set -euo pipefail

REPO_DIR="/home/mastiff/development/bitrograde-vaultworks-prod"
ENV_FILE="$REPO_DIR/.env"
LOG_FILE="/tmp/vaultworks-prod-deploy.log"
PM2="$HOME/.npm-global/bin/pm2"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Production deploy started at $(date) ==="

cd "$REPO_DIR"

echo "--- git pull (main) ---"
git fetch origin
git checkout main
git reset --hard origin/main

echo "--- backend deps + build ---"
cd "$REPO_DIR/backend"
pnpm install --frozen-lockfile
pnpm run build

echo "--- frontend deps + build ---"
set -a; source "$ENV_FILE"; set +a
cd "$REPO_DIR/frontend"
pnpm install --frozen-lockfile
pnpm run build

echo "--- db migrations ---"
cd "$REPO_DIR/backend"
set -a; source "$ENV_FILE"; set +a
pnpm exec prisma migrate deploy

echo "--- pm2 reload prod ---"
set -a; source "$ENV_FILE"; set +a
if "$PM2" list | grep -q 'vaultworks-prod'; then
  "$PM2" reload vaultworks-prod
else
  cd "/home/mastiff/development/bitrograde-vaultworks"
  "$PM2" start ecosystem.prod.cjs
fi
"$PM2" save

echo "=== Production deploy complete at $(date) ==="
