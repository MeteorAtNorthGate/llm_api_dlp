#!/bin/bash

# --- 配置区域 ---
REMOTE_USER="devuser"
REMOTE_HOST="10.10.10.86"
REMOTE_DIR="/home/devuser/projects/LLM_API"
IMAGES="llm-dlp-web:latest"
TAR_NAME="llm_dlp_web.tar.gz"
COMPOSE_LOCAL="infra/docker-compose.yml"
COMPOSE_CLOUD="infra/docker-compose.cloud.yml"

# SSH 连接复用 — 首次连接要求密码，后续复用，避免多次输入
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh-deploy-$$-%r@%h:%p -o ControlPersist=120"

# 设置错误即停止
set -e

echo "📝 [1/6] 注入构建变量..."
VITE_KC_URL=$(grep -oP '^VITE_KEYCLOAK_URL=\K.*' infra/.env.cloud 2>/dev/null || echo "http://localhost:8080")
echo "VITE_GIT_HASH=$(git rev-parse --short HEAD)" > apps/web-client/.env.local
echo "VITE_KEYCLOAK_URL=$VITE_KC_URL" >> apps/web-client/.env.local

echo "📦 [2/6] 开始构建 Web Client Docker 镜像..."
DOCKER_BUILDKIT=0 docker compose -f $COMPOSE_LOCAL build web-client

echo "🧹 [3/6] 清理构建缓存..."
docker builder prune -f

echo "💾 [4/6] 导出并压缩镜像 (使用 gzip 提速)..."
docker save $IMAGES | gzip > $TAR_NAME

echo "🚚 [5/6] 传输文件到服务器 $REMOTE_HOST..."
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR/infra"
scp $SSH_OPTS $TAR_NAME $COMPOSE_CLOUD $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/
scp $SSH_OPTS infra/.env.cloud $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/ || echo "⚠️  .env.cloud 不存在，请先创建"

echo "🚀 [6/6] 在服务器上部署 Web Client 更新..."
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST << EOF
    cd $REMOTE_DIR
    echo "--- 正在加载前端镜像 ---"
    gunzip -c $TAR_NAME | docker load

    echo "--- 正在重启前端容器 (不影响后端) ---"
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud up -d --no-deps --force-recreate web-client

    echo "--- 清理服务器临时文件和敏感配置 ---"
    rm $TAR_NAME
    rm infra/.env.cloud
    docker image prune -f
EOF

echo "✅ Web Client 部署完成！"

# 关闭 SSH 复用连接
ssh $SSH_OPTS -O exit $REMOTE_USER@$REMOTE_HOST 2>/dev/null || true
