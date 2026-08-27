// PM2 ecosystem config — used by deploy-prod.sh and initial production setup.
// See docs/production-setup-ubuntu.md for full setup instructions.
//
// NOTE: We use scripts/start-backend.sh as the PM2 entry point instead of
// pointing directly at dist/index.js. This is because PM2's built-in env_file
// option does not reliably inject environment variables in cluster mode.
// The wrapper script sources .env before exec-ing into Node, which guarantees
// DATABASE_URL, S3_*, JWT_SECRET, etc. are always present at startup.
module.exports = {
  apps: [
    {
      name: 'vaultworks-prod',
      script: '/home/mastiff/bitrograde-vaultworks-prod/scripts/start-backend.sh',
      interpreter: '/bin/bash',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
