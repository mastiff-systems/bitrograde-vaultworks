#!/usr/bin/env bash
# deploy.sh — pull main, build, migrate, restart
set -euo pipefail

REPO_DIR="/home/mastiff/development/bitrograde-vaultworks"
LOG_FILE="/tmp/vaultworks-deploy.log"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Deploy started at $(date) ==="

cd "$REPO_DIR"

echo "--- git pull ---"
git fetch origin
git checkout main
git reset --hard origin/main

echo "--- backend deps + build ---"
cd "$REPO_DIR/backend"
pnpm install --frozen-lockfile
pnpm run build

echo "--- frontend deps + build ---"
cd "$REPO_DIR/frontend"
pnpm install --frozen-lockfile
pnpm run build

echo "--- db migrations ---"
cd "$REPO_DIR/backend"
set -a; source "$REPO_DIR/.env"; set +a
pnpm exec prisma migrate deploy

echo "--- pm2 restart ---"
PM2="$HOME/.npm-global/bin/pm2"
if "$PM2" list | grep -q vaultworks; then
  "$PM2" reload vaultworks
else
  cd "$REPO_DIR"
  "$PM2" start ecosystem.config.cjs
fi
"$PM2" save

echo "=== Deploy complete at $(date) ==="
