# bitrograde-vaultworks
A Digital Asset Management Software

## Deployment

> **Never run `pm2 restart vaultworks` directly.** It bypasses the build step and will
> load stale compiled output, causing runtime crashes (e.g. `TypeError: assets is not iterable`).

| Goal | Command |
|------|---------|
| Full redeploy (git pull + build + migrate + restart) | `bash scripts/deploy.sh` |
| Restart only — still rebuilds backend | `bash scripts/pm2-restart.sh` |
| Validate dist freshness before restart | `bash scripts/check-dist-freshness.sh` |

### Scripts at a glance

- **`scripts/deploy.sh`** — canonical deploy: pulls `main`, builds frontend + backend, runs DB migrations, reloads PM2. Use for production releases.
- **`scripts/pm2-restart.sh`** — safe restart wrapper: rebuilds `backend/dist` with `pnpm run build`, then reloads the PM2 process. Use when you need to pick up a backend code change without a full redeploy.
- **`scripts/check-dist-freshness.sh`** — exits non-zero with a clear message if `backend/dist` is older than `backend/src`. Run before any manual restart as a sanity check, or wire into CI as a pre-flight guard.
