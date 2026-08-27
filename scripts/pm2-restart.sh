#!/usr/bin/env bash
# pm2-restart.sh — rebuild backend then reload PM2 (safe alternative to bare `pm2 restart`)
# For full redeploy (git pull + frontend + migrations), use: scripts/deploy.sh
set -euo pipefail

REPO_DIR="/home/mastiff/development/bitrograde-vaultworks"
LOG_FILE="/tmp/vaultworks-deploy.log"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== pm2-restart started at $(date) ==="

echo "--- backend build ---"
cd "$REPO_DIR/backend"
pnpm run build

echo "--- pm2 reload ---"
PM2="$HOME/.npm-global/bin/pm2"
if "$PM2" list | grep -q vaultworks; then
  "$PM2" reload vaultworks
else
  cd "$REPO_DIR"
  "$PM2" start ecosystem.config.cjs
fi

echo "=== pm2-restart complete at $(date) ==="
