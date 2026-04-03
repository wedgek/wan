#!/usr/bin/env bash
# 服务器上一键更新：拉代码 → 装依赖（含 dev，便于 vite 构建）→ 打前端包 → 重启 PM2
# 用法：在仓库根目录执行 bash scripts/deploy.sh，或先 chmod +x scripts/deploy.sh 再 ./scripts/deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[deploy] 目录: $ROOT"

echo "[deploy] git pull"
git pull

echo "[deploy] 安装依赖（去掉 NODE_ENV=production，避免漏装 devDependencies）"
env -u NODE_ENV npm ci || env -u NODE_ENV npm install

echo "[deploy] 前端生产构建"
npm run build:prod

echo "[deploy] 重启 PM2 进程 wan-ai"
pm2 restart wan-ai

echo "[deploy] 保存 PM2 列表"
pm2 save

echo "[deploy] 完成"
