#!/usr/bin/env bash
# PM2 start wrapper for the VaultWorks DEV environment.
# Branch: develop | Port: 3001 | Schema: vaultworks_dev
# This mirrors scripts/start-backend.sh from the prod setup.

set -euo pipefail

DEV_DIR="/home/mastiff/bitrograde-vaultworks-dev"
NODE_BIN="/home/mastiff/.nvm/versions/node/v22.23.2/bin/node"
ENV_FILE="$DEV_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[start-dev] ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Load all env vars from .env into the process environment.
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Replace this bash process with node (exec ensures PM2 tracks the node PID).
cd "$DEV_DIR/backend"
exec "$NODE_BIN" dist/index.js
