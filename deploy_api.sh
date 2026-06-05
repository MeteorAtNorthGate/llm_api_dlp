#!/bin/bash

# --- 配置区域 ---
REMOTE_USER="devuser"
REMOTE_HOST="10.10.10.86"
REMOTE_DIR="/home/devuser/projects/LLM_API"
IMAGES="llm-dlp-api:latest"
TAR_NAME="llm_dlp_api.tar.gz"
COMPOSE_LOCAL="infra/docker-compose.yml"
COMPOSE_CLOUD="infra/docker-compose.cloud.yml"

# 设置错误即停止
set -e

echo "📦 [1/5] 开始构建 API Server Docker 镜像..."
DOCKER_BUILDKIT=0 docker compose -f $COMPOSE_LOCAL build api-server

echo "🧹 [2/5] 清理构建缓存..."
docker builder prune -f

echo "💾 [3/5] 导出并压缩镜像 (使用 gzip 提速)..."
docker save $IMAGES | gzip > $TAR_NAME

echo "🚚 [4/5] 传输文件到服务器 $REMOTE_HOST..."
scp $TAR_NAME $COMPOSE_CLOUD $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

echo "🚀 [5/5] 在服务器上部署 API Server 更新..."
ssh $REMOTE_USER@$REMOTE_HOST << EOF
    cd $REMOTE_DIR
    echo "--- 正在加载 API 镜像 ---"
    gunzip -c $TAR_NAME | docker load

    echo "--- 正在重启 API 容器 (不影响其他服务) ---"
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud up -d --no-deps --force-recreate api-server

    echo "--- 清理服务器临时文件 ---"
    rm $TAR_NAME
    docker image prune -f
EOF

echo "✅ API Server 部署完成！"
