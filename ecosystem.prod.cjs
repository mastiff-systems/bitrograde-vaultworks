// PM2 ecosystem config for the PRODUCTION environment (port 3000)
// Deploy: git push to main branch → CI deploys here automatically
// URL: http://209.38.145.38:3000
// DB: vaultworks_prod  |  S3: vaultworks-prod-assets
module.exports = {
  apps: [
    {
      name: 'vaultworks-prod',
      script: './backend/dist/index.js',
      cwd: '/home/mastiff/development/bitrograde-vaultworks-prod',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'vaultworks-prod-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
        S3_SECRET_KEY: process.env.S3_SECRET_KEY,
        S3_FORCE_PATH_STYLE: 'true',
        PORT: '3000',
        CORS_ORIGIN: 'http://209.38.145.38:3000',
        AUTH_PROVIDER: 'local',
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRY: '24h',
        // SMTP — primary config is DB-driven (Admin → Settings → Email).
        // Set these in the system environment only if you need an env-var
        // fallback before the UI is configured (see .env.example for details).
        ...(process.env.SMTP_HOST ? {
          SMTP_HOST: process.env.SMTP_HOST,
          SMTP_PORT: process.env.SMTP_PORT,
          SMTP_USER: process.env.SMTP_USER,
          SMTP_PASS: process.env.SMTP_PASS,
          SMTP_FROM: process.env.SMTP_FROM,
          SMTP_ENCRYPTION: process.env.SMTP_ENCRYPTION,
        } : {}),
      },
    },
  ],
};
