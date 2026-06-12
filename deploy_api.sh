#!/bin/bash

# --- 配置区域 ---
REMOTE_USER="devuser"
REMOTE_HOST="10.10.10.86"
REMOTE_DIR="/home/devuser/projects/LLM_API"
IMAGES="llm-dlp-api:latest"
TAR_NAME="llm_dlp_api.tar.gz"
COMPOSE_LOCAL="infra/docker-compose.yml"
COMPOSE_CLOUD="infra/docker-compose.cloud.yml"

# SSH 连接复用 — 首次连接要求密码，后续复用，避免多次输入
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh-deploy-$$-%r@%h:%p -o ControlPersist=120"

# 设置错误即停止
set -e

echo "📦 [1/5] 开始构建 API Server Docker 镜像..."
DOCKER_BUILDKIT=0 docker compose -f $COMPOSE_LOCAL build api-server

echo "🧹 [2/5] 清理构建缓存..."
docker builder prune -f

echo "💾 [3/5] 导出并压缩镜像 (使用 gzip 提速)..."
docker save $IMAGES | gzip > $TAR_NAME

echo "🚚 [4/5] 传输文件到服务器 $REMOTE_HOST..."
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR/infra"
scp $SSH_OPTS $TAR_NAME $COMPOSE_CLOUD $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/
scp $SSH_OPTS infra/.env.cloud $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/ || echo "⚠️  .env.cloud 不存在，请先创建"

echo "🚀 [5/5] 在服务器上部署 API Server 更新..."
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST << EOF
    cd $REMOTE_DIR
    echo "--- 正在加载 API 镜像 ---"
    gunzip -c infra/$TAR_NAME | docker load

    echo "--- 正在重启 API 容器 (不影响其他服务) ---"
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud up -d --no-deps --force-recreate api-server

    echo "--- 清理服务器临时文件和敏感配置 ---"
    rm infra/$TAR_NAME
    rm infra/.env.cloud
    docker image prune -f
EOF

echo "✅ API Server 部署完成！"

# 关闭 SSH 复用连接
ssh $SSH_OPTS -O exit $REMOTE_USER@$REMOTE_HOST 2>/dev/null || true
