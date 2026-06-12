#!/bin/bash

# --- 配置区域 ---
REMOTE_USER="devuser"
REMOTE_HOST="10.10.10.86"
REMOTE_DIR="/home/devuser/projects/LLM_API"
SELF_BUILT_IMAGES="llm-dlp-api:latest llm-dlp-web:latest"
EXTERNAL_IMAGES="postgres:17-alpine quay.io/keycloak/keycloak:26.6.3 python:3.14-slim ghcr.io/berriai/litellm:v1.87.1 quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z"
TAR_NAME="llm_dlp_images.tar.gz"
EXTERNAL_SENTINEL=".external-images-loaded"
COMPOSE_LOCAL="infra/docker-compose.yml"
COMPOSE_CLOUD="infra/docker-compose.cloud.yml"

# SSH 连接复用 — 首次连接要求密码，后续复用，避免多次输入
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/ssh-deploy-$$-%r@%h:%p -o ControlPersist=120"

# 设置错误即停止
set -e

# --- 本地准备工作 ---

echo "📦 [1/7] 确保外部依赖镜像已缓存..."
for img in $EXTERNAL_IMAGES; do
    echo "  检查 $img ..."
    docker pull "$img" || echo "  ⚠️  无法拉取 $img，将使用本地缓存"
done

echo "📝 [2/7] 注入前端构建变量..."
VITE_KC_URL=$(grep -oP '^VITE_KEYCLOAK_URL=\K.*' infra/.env.cloud 2>/dev/null || echo "http://localhost:8080")
echo "VITE_GIT_HASH=$(git rev-parse --short HEAD)" > apps/web-client/.env.local
echo "VITE_KEYCLOAK_URL=$VITE_KC_URL" >> apps/web-client/.env.local

echo "📦 [3/7] 开始构建自建 Docker 镜像..."
DOCKER_BUILDKIT=0 docker compose -f $COMPOSE_LOCAL build

echo "🧹 [4/7] 清理构建缓存..."
docker builder prune -f

# --- 判断云端是否需要第三方镜像 ---

echo "🔍 [5/7] 检查云端第三方镜像状态..."
if ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "test -f $REMOTE_DIR/$EXTERNAL_SENTINEL" 2>/dev/null; then
    echo "  ✅ 云端已有第三方镜像（$EXTERNAL_SENTINEL 存在），跳过第三方镜像打包"
    IMAGES="$SELF_BUILT_IMAGES"
    LOAD_EXTERNAL=false
else
    echo "  ⚠️  云端未部署过第三方镜像，全量打包"
    IMAGES="$SELF_BUILT_IMAGES $EXTERNAL_IMAGES"
    LOAD_EXTERNAL=true
fi

echo "💾 [6/7] 导出并压缩镜像..."
echo "  打包: $IMAGES"
docker save $IMAGES | gzip > $TAR_NAME

echo "🚚 [7/7] 传输文件到服务器 $REMOTE_HOST..."
scp $SSH_OPTS $TAR_NAME $COMPOSE_CLOUD $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/

echo "📁       上传配置文件..."
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR/infra/keycloak $REMOTE_DIR/infra/litellm"
scp $SSH_OPTS infra/.env.cloud $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/ || echo "⚠️  .env.cloud 不存在，请先创建"
scp $SSH_OPTS -r infra/keycloak/llm-dlp-realm.json $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/keycloak/ || true
scp $SSH_OPTS -r infra/litellm/config.yaml $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/litellm/ || true

# --- 云端部署 ---

echo "🚀 在服务器上部署更新..."
ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST << EOF
    set -e
    cd $REMOTE_DIR

    echo "--- 正在加载镜像 ---"
    gunzip -c $TAR_NAME | docker load

    # 第三方镜像加载成功后打标记（后续部署跳过）
    if [ "$LOAD_EXTERNAL" = "true" ]; then
        touch $EXTERNAL_SENTINEL
        echo "--- 已创建第三方镜像标记: $EXTERNAL_SENTINEL ---"
    fi

    echo "--- 正在重启全部容器 ---"
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud down
    docker compose -f $COMPOSE_CLOUD --env-file infra/.env.cloud up -d

    echo "--- 清理服务器临时文件和敏感配置 ---"
    rm $TAR_NAME
    rm infra/.env.cloud
    docker image prune -f
EOF

echo ""
echo "✅ 部署全部完成！"

# 关闭 SSH 复用连接
ssh $SSH_OPTS -O exit $REMOTE_USER@$REMOTE_HOST 2>/dev/null || true

# 可选：清理本地生成的压缩包
# rm $TAR_NAME
