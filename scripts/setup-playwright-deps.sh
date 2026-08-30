#!/usr/bin/env bash
# Install Chromium's shared-library dependencies for Playwright WITHOUT root.
#
# Why this exists (MAS-588):
#   Playwright's browsers download fine on the `openclaw` runner, but Chromium
#   links against ~12 system libraries that are not installed on the host
#   (libatk-1.0.so.0, libgbm.so.1, libcairo.so.2, libasound.so.2, ...). The
#   supported fix is `playwright install-deps chromium`, which shells out to
#   `apt-get install` and therefore needs root. The runner's `mastiff` user has
#   no passwordless sudo (same gap tracked on MAS-405), so that path is closed.
#
#   Instead we fetch the exact same Debian packages Playwright would install,
#   unpack them into a user-owned prefix, and point Chromium at them by
#   rewriting the ELF run paths. No root, no host mutation, fully reversible.
#
# Run as user `mastiff` on the runner:
#   ./scripts/setup-playwright-deps.sh
#
# Idempotent: safe to run repeatedly. Re-run after any `playwright install`,
# since freshly downloaded browser binaries come back unpatched.
#
# Rollback:
#   rm -rf ~/.local/playwright-deps
#   (browsers keep working once the libs are gone only if the host later gains
#    them system-wide; otherwise re-run this script or install the deps as root)
set -euo pipefail

PREFIX="$HOME/.local/playwright-deps"
LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Canonical dependency set for chromium on ubuntu24.04-x64, lifted verbatim from
# playwright-core's own native-deps table (lib/coreBundle.js). Keep this in sync
# with the installed Playwright version rather than hand-maintaining an apt list.
PKGS="
libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64
libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64
libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1
libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
"

echo "[playwright-deps] Resolving dependency closure..."
# --print-uris needs no root and yields the full transitive set, skipping
# anything already present system-wide.
apt-get install --print-uris -y $PKGS 2>/dev/null \
  | grep -oP "^'\K[^']+" > "$WORKDIR/uris.txt" || true

# patchelf is needed to rewrite run paths and is itself not installed on the host.
# `apt-get download` writes to the current directory, so run it inside WORKDIR to
# avoid dropping .deb files into whatever tree the caller happened to be in.
( cd "$WORKDIR" && apt-get download patchelf 2>/dev/null ) || true

COUNT=$(wc -l < "$WORKDIR/uris.txt")
echo "[playwright-deps] $COUNT package(s) to fetch"

if [ "$COUNT" -gt 0 ]; then
  echo "[playwright-deps] Downloading..."
  ( cd "$WORKDIR" && wget -q -i uris.txt )
fi

echo "[playwright-deps] Unpacking into $PREFIX..."
mkdir -p "$PREFIX"
for deb in "$WORKDIR"/*.deb; do
  [ -f "$deb" ] || continue
  dpkg-deb -x "$deb" "$PREFIX"
done

PATCHELF="$PREFIX/usr/bin/patchelf"
if [ ! -x "$PATCHELF" ]; then
  echo "[playwright-deps] ERROR: patchelf unavailable at $PATCHELF" >&2
  exit 1
fi

# Each unpacked library must be able to find its siblings in the same prefix.
# DT_RUNPATH is NOT inherited by transitively-loaded objects (libcups -> libavahi
# would fail), so every library gets its own $ORIGIN run path instead of relying
# on the executable's.
echo "[playwright-deps] Setting \$ORIGIN run path on unpacked libraries..."
for so in "$LIBDIR"/*.so*; do
  [ -f "$so" ] || continue
  "$PATCHELF" --set-rpath '$ORIGIN' "$so" 2>/dev/null || true
done
for so in "$LIBDIR"/gbm/*.so* "$LIBDIR"/gio/modules/*.so*; do
  [ -f "$so" ] || continue
  "$PATCHELF" --set-rpath '$ORIGIN/../..' "$so" 2>/dev/null || true
done

# Point the browser binaries at the prefix. Doing this on the ELF header (rather
# than exporting LD_LIBRARY_PATH) means it works for any caller — a bare shell
# command, the Playwright Node API, or a CI step — with no environment setup.
echo "[playwright-deps] Patching browser binaries in $BROWSERS..."
PATCHED=0
while IFS= read -r bin; do
  [ -f "$bin" ] || continue
  "$PATCHELF" --set-rpath "$LIBDIR" "$bin" 2>/dev/null || continue
  PATCHED=$((PATCHED + 1))
  echo "[playwright-deps]   patched ${bin#$BROWSERS/}"
done < <(find "$BROWSERS" -type f \
  \( -name 'chrome' -o -name 'chrome-headless-shell' -o -name 'chrome_crashpad_handler' \) 2>/dev/null)

echo "[playwright-deps] Patched $PATCHED browser binary/binaries"

echo "[playwright-deps] Verifying..."
FAILED=0
while IFS= read -r bin; do
  [ -f "$bin" ] || continue
  MISSING=$(ldd "$bin" 2>/dev/null | grep -c 'not found' || true)
  if [ "$MISSING" -ne 0 ]; then
    echo "[playwright-deps]   STILL MISSING $MISSING lib(s): ${bin#$BROWSERS/}" >&2
    FAILED=1
  fi
done < <(find "$BROWSERS" -type f \
  \( -name 'chrome' -o -name 'chrome-headless-shell' \) 2>/dev/null)

if [ "$FAILED" -ne 0 ]; then
  echo "[playwright-deps] FAILED — unresolved libraries remain" >&2
  exit 1
fi

echo "[playwright-deps] OK — all Chromium libraries resolve"
