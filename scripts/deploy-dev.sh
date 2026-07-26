#!/usr/bin/env bash
# deploy-dev.sh — pull develop branch, build, migrate, reload dev (port 3002)
# Dev dir: /home/mastiff/development/bitrograde-vaultworks-dev
# PM2 app: vaultworks-dev
set -euo pipefail

REPO_DIR="/home/mastiff/development/bitrograde-vaultworks-dev"
ENV_FILE="$REPO_DIR/.env"
LOG_FILE="/tmp/vaultworks-dev-deploy.log"
PM2="$HOME/.npm-global/bin/pm2"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Dev deploy started at $(date) ==="

cd "$REPO_DIR"

echo "--- git pull (develop) ---"
git fetch origin
git checkout develop 2>/dev/null || git checkout -b develop origin/develop
git reset --hard origin/develop

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

echo "--- pm2 reload dev ---"
set -a; source "$ENV_FILE"; set +a
if "$PM2" list | grep -q 'vaultworks-dev'; then
  "$PM2" reload vaultworks-dev
else
  cd "/home/mastiff/development/bitrograde-vaultworks"
  "$PM2" start ecosystem.dev.cjs
fi
"$PM2" save

echo "=== Dev deploy complete at $(date) ==="
