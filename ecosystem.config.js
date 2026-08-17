// PM2 ecosystem config — used by deploy-prod.sh and initial production setup.
// Adjust cwd and env_file to match the prod server's directory layout.
// See docs/production-setup-ubuntu.md for full setup instructions.
module.exports = {
  apps: [
    {
      name: 'vaultworks-prod',
      script: 'dist/index.js',
      cwd: '/home/mastiff/bitrograde-vaultworks-prod/backend',
      env_file: '/home/mastiff/bitrograde-vaultworks-prod/.env',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
