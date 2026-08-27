// PM2 ecosystem config for the DEV environment (port 3002)
// Deploy: git push to develop branch → CI deploys here automatically
// URL: http://209.38.145.38:3002
// DB: vaultworks_dev  |  S3: vaultworks-dev-assets
module.exports = {
  apps: [
    {
      name: 'vaultworks-dev',
      script: './backend/dist/index.js',
      cwd: '/home/mastiff/development/bitrograde-vaultworks-dev',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'vaultworks-dev-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
        S3_SECRET_KEY: process.env.S3_SECRET_KEY,
        S3_FORCE_PATH_STYLE: 'true',
        PORT: '3002',
        CORS_ORIGIN: 'http://209.38.145.38:3002',
        AUTH_PROVIDER: 'local',
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRY: '24h',
      },
    },
  ],
};
