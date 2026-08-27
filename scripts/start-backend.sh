#!/usr/bin/env bash
# PM2 start wrapper for the VaultWorks backend.
#
# PURPOSE: PM2's built-in `env_file` option does not reliably inject environment
# variables into child processes in cluster mode (a known PM2 limitation).
# This wrapper loads the .env file explicitly before exec-ing into Node, which
# guarantees all vars (DATABASE_URL, S3_*, JWT_SECRET, etc.) are present.
#
# PM2 ecosystem.config.js references this script and sets interpreter to /bin/bash.
# Because we exec into node (replacing the bash process), PM2 tracks the node
# PID directly, so health monitoring and auto-restart work correctly.
#
# Usage: called by PM2 via ecosystem.config.js — not meant to be run manually.

set -euo pipefail

PROD_DIR="/home/mastiff/bitrograde-vaultworks-prod"
NODE_BIN="/home/mastiff/.nvm/versions/node/v22.23.2/bin/node"
ENV_FILE="$PROD_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[start-backend] ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Load all env vars from .env into the process environment.
# set -a exports every var set after this point; set +a restores normal mode.
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Replace this bash process with node (exec ensures PM2 tracks the node PID).
cd "$PROD_DIR/backend"
exec "$NODE_BIN" dist/index.js
