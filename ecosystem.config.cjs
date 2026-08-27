module.exports = {
  apps: [
    {
      name: 'vaultworks',
      script: './backend/dist/index.js',
      cwd: '/home/mastiff/development/bitrograde-vaultworks',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'vaultworks-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
        S3_SECRET_KEY: process.env.S3_SECRET_KEY,
        S3_FORCE_PATH_STYLE: 'true',
        PORT: '3001',
        CORS_ORIGIN: 'http://openclaw.mastiffsystems.com:3001',
        AUTH_PROVIDER: 'local',
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRY: '24h',
      },
    },
  ],
};
