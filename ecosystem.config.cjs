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
        PORT: Number(process.env.PORT) || 3000,
        DATA_DIR: process.env.DATA_DIR || path.join(__dirname, 'backend', 'data'),
        // 启动前 export ADMIN_PASSWORD / ADMIN_USERNAME，勿把密码写进仓库
        ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
        // Nginx 反代时：export TRUST_PROXY=1 再 pm2 start/restart --update-env
        TRUST_PROXY: process.env.TRUST_PROXY || '',
      },
    },
  ],
}
