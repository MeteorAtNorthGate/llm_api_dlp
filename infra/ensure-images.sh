#!/bin/bash
# 确保第三方依赖镜像在本地可用。
#
# 规则：本地已有同 tag 镜像就直接复用，不做拉取。
# postgres:17-alpine 这类 tag 上游会持续发布小版本，本地能用就不必跟着更新——
# 既省带宽，也避免本地与云端镜像版本悄悄漂移。只有本地缺失时才拉取。
#
# 确实要升级到该 tag 的最新小版本时：
#   FORCE_PULL_IMAGES=1 ./infra/ensure-images.sh postgres:17-alpine
#
# 用法: ./infra/ensure-images.sh <镜像> [镜像...]

set -e

FORCE_PULL_IMAGES="${FORCE_PULL_IMAGES:-false}"

if [ "$#" -eq 0 ]; then
    echo "用法: $0 <镜像> [镜像...]" >&2
    exit 1
fi

for img in "$@"; do
    if [ "$FORCE_PULL_IMAGES" != "true" ] && docker image inspect "$img" >/dev/null 2>&1; then
        echo "  ✅ 本地已有 $img，跳过拉取"
        continue
    fi

    echo "  ⬇️  拉取 $img ..."
    if ! docker pull "$img"; then
        echo "  ❌ 无法拉取 $img（本地也没有缓存），后续 docker save 会失败" >&2
        exit 1
    fi
done
