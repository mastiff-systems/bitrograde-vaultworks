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
      },
    },
  ],
};
