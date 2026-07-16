#!/usr/bin/env bash
# deploy-staging.sh — pull develop, build, migrate, reload staging (port 3001)
# Staging dir: /home/mastiff/development/bitrograde-vaultworks
# PM2 app:     vaultworks  (legacy name kept; see ecosystem.staging.cjs for new restarts)
set -euo pipefail

REPO_DIR="/home/mastiff/development/bitrograde-vaultworks"
ENV_FILE="$REPO_DIR/.env.staging"
LOG_FILE="/tmp/vaultworks-staging-deploy.log"
PM2="$HOME/.npm-global/bin/pm2"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Staging deploy started at $(date) ==="

cd "$REPO_DIR"

echo "--- git pull (develop → staging) ---"
git fetch origin
git checkout develop 2>/dev/null || git checkout -b develop origin/develop
git reset --hard origin/develop

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
set -a; source "$ENV_FILE"; set +a
pnpm exec prisma migrate deploy

echo "--- pm2 reload staging ---"
set -a; source "$ENV_FILE"; set +a
if "$PM2" list | grep -q 'vaultworks-staging'; then
  "$PM2" reload vaultworks-staging
elif "$PM2" list | grep -q '^vaultworks '; then
  "$PM2" reload vaultworks
else
  cd "$REPO_DIR"
  "$PM2" start ecosystem.staging.cjs
fi
"$PM2" save

echo "=== Staging deploy complete at $(date) ==="
