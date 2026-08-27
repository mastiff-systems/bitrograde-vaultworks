// PM2 ecosystem config for the DEV environment
// Branch: develop | Port: 3001 | Schema: vaultworks_dev
// URL: https://dev-vaultworks.bitrograde.com
module.exports = {
  apps: [
    {
      name: 'vaultworks-dev',
      script: '/home/mastiff/bitrograde-vaultworks-dev/scripts/start-dev.sh',
      interpreter: '/bin/bash',
      cwd: '/home/mastiff',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
