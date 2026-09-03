#!/usr/bin/env bash
# Release automation for the manual prod-promotion step (MAS-733, per MAS-731's
# design). This IS the release mechanism — not GitHub Actions. The self-hosted
# runner (openclaw-self-hosted) lives on the agent-runner host, not the app
# server, so deploy.yml can never run deploy scripts; release/tagging is done
# here, from a workstation checkout with `gh` authenticated, as the first half
# of the develop -> main promotion. The second half stays the existing SSH
# `scripts/deploy-prod.sh` step (see docs/VERSIONING.md once MAS-732 lands it).
#
# What this does, in order:
#   1. Verifies preconditions (clean tree, on the release branch, up to date
#      with origin, `gh` authenticated).
#   2. Computes the next SemVer version from Conventional Commit messages
#      since the last vX.Y.Z tag (or accepts a manual override).
#   3. Writes that version into root/frontend/backend package.json, commits,
#      and pushes to the release branch (default: develop).
#   4. Opens and merges a promotion PR (release branch -> base branch,
#      default: main) via `gh`.
#   5. Tags the resulting base-branch head with an annotated vX.Y.Z tag and
#      pushes it.
#
# Usage:
#   scripts/release.sh                        # auto-compute bump from commits
#   RELEASE_VERSION=1.2.3 scripts/release.sh  # manual override — use when the
#                                              # heuristic would guess wrong,
#                                              # or for the very first release
#                                              # (no vX.Y.Z tag exists yet).
#
# Advanced/testing overrides (do not use for a real release):
#   RELEASE_BASE_BRANCH, RELEASE_HEAD_BRANCH  # default main / develop

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_BRANCH="${RELEASE_BASE_BRANCH:-main}"
HEAD_BRANCH="${RELEASE_HEAD_BRANCH:-develop}"

log() { echo "[release] $*"; }
die() { echo "[release] ERROR: $*" >&2; exit 1; }

# --- Preconditions -----------------------------------------------------

command -v gh >/dev/null 2>&1 || die "gh CLI not found on PATH."
gh auth status >/dev/null 2>&1 || die "gh CLI not authenticated (run 'gh auth login' or check GITHUB_TOKEN)."

current_branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$current_branch" = "$HEAD_BRANCH" ] || die "Must be on '$HEAD_BRANCH' (currently on '$current_branch'). Run: git checkout $HEAD_BRANCH"

[ -z "$(git status --porcelain)" ] || die "Working tree is not clean. Commit or stash changes first."

log "Fetching latest from origin ($HEAD_BRANCH, $BASE_BRANCH, tags)..."
git fetch origin "$HEAD_BRANCH" "$BASE_BRANCH" --tags

local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse "origin/$HEAD_BRANCH")"
[ "$local_head" = "$remote_head" ] || die "'$HEAD_BRANCH' is not up to date with origin/$HEAD_BRANCH. Run: git pull"

# --- Compute next version -----------------------------------------------

last_tag="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1 || true)"

if [ -n "${RELEASE_VERSION:-}" ]; then
  [[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "RELEASE_VERSION must be plain X.Y.Z (got '$RELEASE_VERSION')."
  next_version="$RELEASE_VERSION"
  bump_reason="manual override (RELEASE_VERSION=$RELEASE_VERSION)"
  range="${last_tag:-<none>}..$HEAD_BRANCH"
elif [ -z "$last_tag" ]; then
  die "No existing vX.Y.Z tag found (this is the first release). Re-run with an explicit version, e.g.: RELEASE_VERSION=0.2.0 scripts/release.sh"
else
  range="$last_tag..$HEAD_BRANCH"
  log "Scanning commit range $range for bump signal..."
  subjects="$(git log "$range" --pretty=format:'%s' || true)"
  bodies="$(git log "$range" --pretty=format:'%b' || true)"

  if echo "$bodies" | grep -q 'BREAKING CHANGE' || echo "$subjects" | grep -qE '^[a-zA-Z]+(\([^)]*\))?!:'; then
    bump="major"
  elif echo "$subjects" | grep -qE '^feat(\([^)]*\))?:' || echo "$subjects" | grep -qE '^Merge pull request #[0-9]+ from [^ ]+/feature/'; then
    bump="minor"
  else
    bump="patch"
  fi

  IFS='.' read -r major minor patch <<<"${last_tag#v}"
  case "$bump" in
    major) next_version="$((major + 1)).0.0" ;;
    minor) next_version="${major}.$((minor + 1)).0" ;;
    patch) next_version="${major}.${minor}.$((patch + 1))" ;;
  esac
  bump_reason="conventional-commit heuristic -> $bump"
fi

next_tag="v$next_version"

log "Last release tag: ${last_tag:-<none>}"
log "Commit range considered: $range"
log "Computed bump: $bump_reason"
log "Next version: $next_version (tag $next_tag)"

git rev-parse "$next_tag" >/dev/null 2>&1 && die "Tag $next_tag already exists. Pick a different RELEASE_VERSION."

read -r -p "[release] Proceed with release $next_tag? [y/N] " confirm
case "$confirm" in
  y|Y|yes|YES) ;;
  *) log "Aborted by operator. No changes made."; exit 1 ;;
esac

# --- Write version + commit ---------------------------------------------

set_pkg_version() {
  local pkg="$1"
  python3 - "$pkg" "$next_version" <<'PYEOF'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data["version"] = version
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PYEOF
}

for pkg in package.json frontend/package.json backend/package.json; do
  [ -f "$pkg" ] || die "Expected $pkg to exist."
  set_pkg_version "$pkg"
done

git add package.json frontend/package.json backend/package.json
git commit -m "chore(release): $next_tag"
git push origin "$HEAD_BRANCH"

# --- Promote via PR -------------------------------------------------------

log "Opening promotion PR: $HEAD_BRANCH -> $BASE_BRANCH..."
pr_url="$(gh pr create --base "$BASE_BRANCH" --head "$HEAD_BRANCH" \
  --title "Release $next_tag" \
  --body "Automated release promotion via scripts/release.sh. Bump: $bump_reason. Range: $range.")"
log "PR opened: $pr_url"

log "Merging PR..."
gh pr merge "$pr_url" --merge --delete-branch=false

# --- Tag the promoted main commit -----------------------------------------

log "Fetching updated $BASE_BRANCH..."
git fetch origin "$BASE_BRANCH"
promoted_head="$(git rev-parse "origin/$BASE_BRANCH")"

git tag -a "$next_tag" "$promoted_head" -m "Release $next_tag"
git push origin "$next_tag"

log "Tagged $promoted_head as $next_tag and pushed to origin."
log "Next: SSH to the app server and run scripts/deploy-prod.sh to deploy $next_tag."
