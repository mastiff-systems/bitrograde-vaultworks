# VaultWorks — Production Setup Guide (Ubuntu 24.04)

> Generated for MAS-404. Stack: Node 22 · pnpm 10 · Fastify · Prisma · PostgreSQL · PM2.

---

## Architecture Overview

The backend (`Fastify`) serves **both the API and the built React frontend** on a single port (default `3001`, recommend `3000` for production). No separate frontend server is needed. Nginx sits in front as a reverse proxy for port 80/443.

```
Internet → Nginx (80/443) → Fastify on :3000 (API + static SPA)
                                         ↕
                                   PostgreSQL (local)
                                         ↕
                               S3 / DigitalOcean Spaces
```

---

## 1. Initial Server Hardening

```bash
# As root on fresh Ubuntu 24.04
apt update && apt upgrade -y

# Create a deploy user (e.g. "deploy" — do NOT use mastiff on the prod server unless intentional)
adduser deploy
usermod -aG sudo deploy

# Copy your SSH public key from the dev machine
# (run this from your dev machine, not the server)
ssh-copy-id deploy@YOUR_SERVER_IP

# Lock down SSH (optional but recommended)
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Basic firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

---

## 2. Install Node.js 22 (via NodeSource)

```bash
# As deploy user (or root)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # should print v22.x.x
npm --version
```

---

## 3. Install pnpm

```bash
npm install -g pnpm@10
pnpm --version   # should print 10.x.x
```

---

## 4. Install PM2

```bash
npm install -g pm2

# Make PM2 start on boot
pm2 startup systemd
# ↑ This prints a command to run as root — copy and run it, e.g.:
#   sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u deploy --hp /home/deploy
```

---

## 5. Install PostgreSQL 16

```bash
sudo apt install -y postgresql postgresql-contrib

# Start and enable
sudo systemctl enable --now postgresql

# Create database and user
sudo -u postgres psql <<'SQL'
CREATE USER vaultworks WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE vaultworks OWNER vaultworks;
GRANT ALL PRIVILEGES ON DATABASE vaultworks TO vaultworks;
SQL
```

> ⚠️ **Change `CHANGE_THIS_PASSWORD`** to a strong random password and put it in `.env`.

---

## 6. Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

---

## 7. Clone the Repository

> The deploy script expects a **git worktree** layout. The simplest approach on a new server is a plain clone.

```bash
# As deploy user
cd /home/deploy
git clone git@github.com:YOUR_ORG/bitrograde-vaultworks.git bitrograde-vaultworks-prod
cd bitrograde-vaultworks-prod

# Check out main branch
git checkout main
```

> **GitHub SSH access:** If the server needs to pull from GitHub, add a deploy key:
> ```bash
> ssh-keygen -t ed25519 -C "vaultworks-prod-server" -f ~/.ssh/id_ed25519
> cat ~/.ssh/id_ed25519.pub
> ```
> Then paste that key into **GitHub → Repo → Settings → Deploy keys** (read-only is enough).

---

## 8. Configure the Environment File

```bash
cp .env.example .env
nano .env
```

**Production `.env` values to set:**

```dotenv
# ─── Database ───────────────────────────────────────────────
DATABASE_URL=postgres://vaultworks:CHANGE_THIS_PASSWORD@localhost:5432/vaultworks

# ─── S3 / DigitalOcean Spaces ───────────────────────────────
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_BUCKET=vaultworks-assets
S3_REGION=nyc3
S3_ACCESS_KEY=your-do-spaces-access-key
S3_SECRET_KEY=your-do-spaces-secret-key

# ─── Backend ────────────────────────────────────────────────
PORT=3000
# In production the backend serves the frontend — CORS_ORIGIN is not needed unless you have a separate domain
CORS_ORIGIN=https://yourdomain.com

# ─── Auth ───────────────────────────────────────────────────
AUTH_PROVIDER=local
JWT_SECRET=$(openssl rand -hex 32)   # generate with: openssl rand -hex 32
JWT_EXPIRY=24h

# ─── Frontend (Vite build-time) ─────────────────────────────
VITE_API_URL=https://yourdomain.com
VITE_AUTH_PROVIDER=local
```

> Generate `JWT_SECRET` on the server:
> ```bash
> openssl rand -hex 32
> ```

---

## 9. Install Dependencies and Build

```bash
cd /home/deploy/bitrograde-vaultworks-prod

# Backend
pnpm install --frozen-lockfile --dir backend

# Run database migrations (first-time)
cd backend
env $(grep -v '^#' ../.env | xargs) npx prisma migrate deploy --schema prisma/schema.prisma
cd ..

# Build backend
pnpm --dir backend run build

# Frontend
pnpm install --frozen-lockfile --dir frontend

# Build frontend (inject VITE_ vars from .env)
env $(grep -v '^#' .env | grep '^VITE_' | xargs) pnpm --dir frontend run build
```

---

## 10. Create PM2 Ecosystem Config

Create `/home/deploy/bitrograde-vaultworks-prod/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'vaultworks-prod',
      script: 'dist/index.js',
      cwd: '/home/deploy/bitrograde-vaultworks-prod/backend',
      env_file: '/home/deploy/bitrograde-vaultworks-prod/.env',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
```

> If you cloned to a different path, update `cwd` and `env_file` accordingly.

---

## 11. Start the App with PM2

```bash
cd /home/deploy/bitrograde-vaultworks-prod

# First-time start
pm2 start ecosystem.config.js

# Save the process list so it restarts on reboot
pm2 save

# Check it's running
pm2 status
pm2 logs vaultworks-prod --lines 50
```

---

## 12. Configure Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/vaultworks
```

Paste this config (replace `yourdomain.com` with your actual domain or IP):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Redirect all HTTP to HTTPS (enable after SSL setup)
    # return 301 https://$host$request_uri;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 500M;    # match backend upload limit
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/vaultworks /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 13. SSL Certificate (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal is set up automatically; test it:
sudo certbot renew --dry-run
```

After Certbot runs, uncomment the `return 301` redirect line in the nginx config and reload.

---

## 14. Fix the Deploy Script for Subsequent Deploys

The `scripts/deploy-prod.sh` has two issues for production use:

**Issue 1 — Hard-coded path:** Change `PROD_DIR` to match where you cloned:
```bash
# Line 6 of deploy-prod.sh — change to your server's path
PROD_DIR="/home/deploy/bitrograde-vaultworks-prod"
```

**Issue 2 — `pm2 reload` fails on first run:** The script uses `pm2 reload` which fails if the process doesn't exist yet. After the first manual start above, subsequent `pm2 reload` calls will work fine. Optionally update the script to be safer:
```bash
# In deploy-prod.sh, replace the pm2 line with:
pm2 startOrReload ecosystem.config.js --update-env
```

**Issue 3 — No worktree on a plain clone:** If you did a plain `git clone` (recommended for prod), the deploy script uses `git -C "$PROD_DIR" reset --hard origin/main` which works fine — the worktree check on line 9 is the only thing that's git-worktree-specific. A plain clone passes that check as long as the directory exists.

---

## 15. Smoke Test

```bash
# From the server
curl -s http://localhost:3000/health   # or whatever your health check route is
curl -s http://localhost:3000/api/auth/me   # should return 401 (server is up)

# From your machine
curl -I https://yourdomain.com
```

---

## Ongoing Deploys

After the initial setup, deploying a new version is:

```bash
# On the prod server (or triggered by CI)
cd /home/deploy/bitrograde-vaultworks-prod
git fetch origin main && git reset --hard origin/main
pnpm install --frozen-lockfile --dir backend
env $(grep -v '^#' .env | xargs) pnpm --dir backend exec prisma migrate deploy --schema backend/prisma/schema.prisma
pnpm --dir backend run build
env $(grep -v '^#' .env | grep '^VITE_' | xargs) pnpm --dir frontend run build
pm2 reload vaultworks-prod --update-env
```

This is essentially what `scripts/deploy-prod.sh` does — just run that script on the server after the initial setup.

---

## Checklist

- [ ] Ubuntu 24.04 server provisioned
- [ ] `deploy` user created with SSH key access
- [ ] Node 22 + pnpm 10 + PM2 installed
- [ ] PostgreSQL database + user created
- [ ] Nginx installed
- [ ] Repo cloned to `/home/deploy/bitrograde-vaultworks-prod`
- [ ] `.env` configured (DB password, S3 keys, JWT secret, domain)
- [ ] `ecosystem.config.js` created
- [ ] App built (backend + frontend)
- [ ] PM2 process started and saved (`pm2 save`)
- [ ] Nginx config created and enabled
- [ ] SSL cert from Let's Encrypt installed
- [ ] Smoke test passed
