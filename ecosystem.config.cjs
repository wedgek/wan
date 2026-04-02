const path = require('path')

/** PM2：单进程 API + 托管前端（先执行 npm run build:prod） */
module.exports = {
  apps: [
    {
      name: 'wan-ai',
      script: 'backend/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DATA_DIR: path.join(__dirname, 'backend', 'data'),
      },
    },
  ],
}
