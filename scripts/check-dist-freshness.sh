#!/usr/bin/env bash
# check-dist-freshness.sh — exit non-zero if backend/dist is older than backend/src
# Use as a CI pre-check or pre-flight guard before pm2 restart.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_DIR/backend/src"
DIST_DIR="$REPO_DIR/backend/dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: $DIST_DIR does not exist — run 'pnpm run build' in backend/ first." >&2
  exit 1
fi

newest_src=$(find "$SRC_DIR" -name "*.ts" -printf "%T@\n" 2>/dev/null | sort -n | tail -1)
newest_dist=$(find "$DIST_DIR" -printf "%T@\n" 2>/dev/null | sort -n | tail -1)

if [ -z "$newest_src" ]; then
  echo "ERROR: No .ts files found under $SRC_DIR" >&2
  exit 1
fi

if [ -z "$newest_dist" ]; then
  echo "ERROR: $DIST_DIR is empty — run 'pnpm run build' in backend/ first." >&2
  exit 1
fi

if (( $(echo "$newest_dist < $newest_src" | bc -l) )); then
  echo "ERROR: dist is older than src — rebuild required ('pnpm run build' in backend/)." >&2
  exit 1
fi

echo "OK: dist is up to date with src."
