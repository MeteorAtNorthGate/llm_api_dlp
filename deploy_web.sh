#!/bin/bash

# --- 配置区域 ---
REMOTE_USER="devuser"
REMOTE_HOST="10.10.10.86"
REMOTE_DIR="/home/devuser/projects/LLM_API"
IMAGES="llm-dlp-web:latest"
TAR_NAME="llm_dlp_web.tar.gz"
COMPOSE_LOCAL="infra/docker-compose.yml"
COMPOSE_CLOUD="infra/docker-compose.cloud.yml"

# 设置错误即停止
set -e

echo "📝 [1/6] 注入 Git Hash 版本信息..."
echo "VITE_GIT_HASH=$(git rev-parse --short HEAD)" > apps/web-client/.env.local

echo "📦 [2/6] 开始构建 Web Client Docker 镜像..."
DOCKER_BUILDKIT=0 docker compose -f $COMPOSE_LOCAL build web-client

echo "🧹 [3/6] 清理构建缓存..."
docker builder prune -f

echo "💾 [4/6] 导出并压缩镜像 (使用 gzip 提速)..."
docker save $IMAGES | gzip > $TAR_NAME

echo "🚚 [5/6] 传输文件到服务器 $REMOTE_HOST..."
scp $TAR_NAME $COMPOSE_CLOUD $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

echo "🚀 [6/6] 在服务器上部署 Web Client 更新..."
ssh $REMOTE_USER@$REMOTE_HOST << EOF
    cd $REMOTE_DIR
    echo "--- 正在加载前端镜像 ---"
    gunzip -c $TAR_NAME | docker load

    echo "--- 正在重启前端容器 (不影响后端) ---"
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud up -d --no-deps --force-recreate web-client

    echo "--- 清理服务器临时文件 ---"
    rm $TAR_NAME
    docker image prune -f
EOF

echo "✅ Web Client 部署完成！"
