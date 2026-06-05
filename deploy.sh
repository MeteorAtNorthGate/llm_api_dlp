#!/bin/bash

# --- 配置区域 ---
REMOTE_USER="devuser"
REMOTE_HOST="10.10.10.86"
REMOTE_DIR="/home/devuser/projects/LLM_API"
IMAGES="llm-dlp-api:latest llm-dlp-web:latest"
TAR_NAME="llm_dlp_images.tar.gz"
COMPOSE_LOCAL="infra/docker-compose.yml"
COMPOSE_CLOUD="infra/docker-compose.cloud.yml"

# 设置错误即停止
set -e

echo "📦 [1/6] 开始构建全部 Docker 镜像..."
DOCKER_BUILDKIT=0 docker compose -f $COMPOSE_LOCAL build

echo "🧹 [2/6] 清理构建缓存..."
docker builder prune -f

echo "💾 [3/6] 导出并压缩镜像 (使用 gzip 提速)..."
docker save $IMAGES | gzip > $TAR_NAME

echo "🚚 [4/6] 传输文件到服务器 $REMOTE_HOST..."
scp $TAR_NAME $COMPOSE_CLOUD $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/

echo "📁 [5/6] 首次部署时上传配置文件 (如已上传可跳过)..."
ssh $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR/infra/keycloak $REMOTE_DIR/infra/litellm"
scp infra/.env.cloud $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/ 2>/dev/null || echo "⚠️  .env.cloud 不存在，请先创建"
scp -r infra/keycloak/realm-export.json $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/keycloak/ 2>/dev/null || true
scp -r infra/litellm/config.yaml $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/litellm/ 2>/dev/null || true

echo "🚀 [6/6] 在服务器上部署更新..."
ssh $REMOTE_USER@$REMOTE_HOST << EOF
    cd $REMOTE_DIR
    echo "--- 正在加载镜像 ---"
    gunzip -c $TAR_NAME | docker load
    echo "--- 正在重启全部容器 ---"
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud down
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud up -d
    echo "--- 清理服务器临时文件 ---"
    rm $TAR_NAME
    docker image prune -f
EOF

echo "✅ 部署全部完成！"

# 可选：清理本地生成的压缩包
# rm $TAR_NAME
