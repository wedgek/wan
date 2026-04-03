#!/usr/bin/env bash
# 在服务器上安装/更新 Nginx 并部署万相AI站点（静态直出 + /admin-api 反代 Node）
# 用法（在项目根目录）：
#   sudo APP_DIR=/root/wan bash scripts/setup-nginx.sh
# 未指定 APP_DIR 时默认用「本脚本所在目录的上一级」（即仓库根）
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 执行，例如: sudo bash scripts/setup-nginx.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
CONF_SRC="$APP_DIR/deploy/nginx/wan-ai.conf"
CONF_DST="/etc/nginx/conf.d/wan-ai.conf"

if [[ ! -f "$CONF_SRC" ]]; then
  echo "找不到 $CONF_SRC ，请确认 APP_DIR=$APP_DIR 为仓库根目录"
  exit 1
fi

if [[ ! -d "$APP_DIR/frontend/dist" ]]; then
  echo "[警告] 未找到 $APP_DIR/frontend/dist ，请先在该目录执行: npm run build:prod"
fi

install_pkg() {
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nginx
  elif command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y nginx
  else
    echo "无法识别包管理器，请手动安装 nginx 后重试"
    exit 1
  fi
}

if ! command -v nginx >/dev/null 2>&1; then
  echo "[setup-nginx] 安装 Nginx …"
  install_pkg
else
  echo "[setup-nginx] 已安装 Nginx: $(command -v nginx)"
fi

systemctl enable nginx 2>/dev/null || true

if [[ -f /etc/nginx/conf.d/default.conf ]] && grep -qE '^\s*listen\s+80' /etc/nginx/conf.d/default.conf 2>/dev/null; then
  echo ""
  echo "[提示] 检测到 /etc/nginx/conf.d/default.conf（常见欢迎页）。若执行 nginx -t 报错或访问仍是欢迎页，可禁用："
  echo "       mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak"
  echo ""
fi

echo "[setup-nginx] 写入 $CONF_DST （APP_DIR=$APP_DIR）"
sed "s|__APP_ROOT__|${APP_DIR}|g" "$CONF_SRC" >"$CONF_DST"

if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null)" == "Enforcing" ]]; then
  if command -v setsebool >/dev/null 2>&1; then
    echo "[setup-nginx] SELinux Enforcing：允许 Nginx 连后端（反代 127.0.0.1:3000）"
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
  fi
fi

nginx -t
systemctl restart nginx

echo ""
echo "[setup-nginx] Nginx 已加载。请确认 Node 只监听本机并信任反代："
echo "  cd $APP_DIR"
echo "  export NODE_ENV=production PORT=3000 HOST=127.0.0.1 TRUST_PROXY=1"
echo "  export ADMIN_PASSWORD='你的密码'"
echo "  pm2 delete wan-ai 2>/dev/null; pm2 start ecosystem.config.cjs --update-env; pm2 save"
echo ""
echo "  ss -tlnp | grep 3000    # 期望 127.0.0.1:3000"
echo "  curl -sI http://127.0.0.1/        # 经本机 80"
echo ""
echo "云安全组：放行 TCP 80（及后续 443），可关闭公网 3000。"
echo "浏览器访问: http://<公网IP>/ （不要再用 :3000）"
