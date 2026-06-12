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
        DATABASE_URL: 'postgres://vaultworks:vaultworks@localhost:5432/vaultworks',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'vaultworks-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: 'vaultworks',
        S3_SECRET_KEY: 'vaultworks123',
        S3_FORCE_PATH_STYLE: 'true',
        PORT: '3001',
        CORS_ORIGIN: 'http://openclaw.mastiffsystems.com:3001',
        AUTH_PROVIDER: 'local',
        JWT_SECRET: 'dev-secret-change-in-production-use-openssl-rand-hex-32',
        JWT_EXPIRY: '24h',
      },
    },
  ],
};
