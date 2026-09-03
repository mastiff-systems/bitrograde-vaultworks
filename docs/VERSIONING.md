# VaultWorks Versioning & Releases

Design: MAS-731. Plumbing: MAS-732 (this doc, vite injection, sidebar display).
Release script: MAS-733 (`scripts/release.sh`).

## Scheme

Plain SemVer, `MAJOR.MINOR.PATCH` (e.g. `1.4.0`), tagged `vX.Y.Z` on `main`.
No pre-release/build suffixes for dev builds in v1: dev always runs `develop`
HEAD, so the displayed version on dev is the last released version. If QA ever
needs exact-build identification on dev, the vite `define` below makes adding a
`-dev.<shortsha>` suffix a two-line change.

## Source of truth

The **root `package.json` `version`** is the single source of truth.

- `scripts/release.sh` writes the same version into `frontend/package.json` and
  `backend/package.json` in the release commit — all three are always equal.
- The frontend build reads the **root** file directly (below), so even a missed
  sync cannot skew the displayed version.
- Drift guard: `frontend/src/test/version-sync.test.ts` fails the suite if the
  three files ever disagree.

## Frontend display

`frontend/vite.config.ts` reads the root `package.json` at build time and
injects the version as the build-time constant `__APP_VERSION__` (declared in
`frontend/src/vite-env.d.ts`). Nothing is hardcoded and nothing is fetched at
runtime. `MainSidebar.tsx` renders it bottom-right of the sidebar; the
Administration menu / Settings About tab (MAS-741) use the same constant.

## Commit convention

Conventional Commits for commit subjects and PR titles: `feat:`, `fix:`,
`chore:`, …, with `!` or a `BREAKING CHANGE:` footer for breaking changes.
`release.sh` derives the bump from the commit range since the last `vX.Y.Z`
tag:

- any `BREAKING CHANGE` / `!` → **MAJOR**
- else any `feat:` or a merge from a `feature/*` branch → **MINOR**
- else → **PATCH**

## How a release happens (develop → main promotion)

Releases are **manual**, run by DevOps from a workstation checkout where `gh`
is authenticated. GitHub Actions is NOT the release path (the self-hosted
runner lives on the agent-runner host, not the app server — `deploy.yml`
cannot deploy).

1. On an up-to-date, clean `develop` checkout, run `scripts/release.sh`.
   It computes the next version (confirmation prompt), writes it into all three
   `package.json` files, commits `chore(release): vX.Y.Z` to `develop`, opens
   and merges the promotion PR `develop -> main` via `gh`, and pushes an
   annotated `vX.Y.Z` tag on the resulting `main` merge commit — i.e. the exact
   commit prod deploys, so `git checkout vX.Y.Z` reproduces prod.
2. Deploy: SSH to the app server and run the existing `scripts/deploy-prod.sh`
   (unchanged second half of the promotion runbook).

Overrides:

- `RELEASE_VERSION=x.y.z scripts/release.sh` bypasses the bump heuristic.
  **Required for the first release** — no `vX.Y.Z` tag exists yet (only
  `pre-mas*-promotion` tags); the script will ask for it and suggest `0.2.0`.
- `RELEASE_BASE_BRANCH` / `RELEASE_HEAD_BRANCH` exist for testing only.

Dev deploys are unversioned: merge to `develop`, then run `deploy-dev.sh` on
the server (see the MAS-580 workflow doc).

## Rules

- Never commit to `main` directly (MAS-580) — the bump commit lands on
  `develop` and reaches `main` through the promotion PR.
- Never hand-edit a version number in any `package.json`; only
  `scripts/release.sh` bumps versions.
