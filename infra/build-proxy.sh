#!/bin/bash
# 构建期代理准备 —— 由 deploy.sh / deploy_api.sh / deploy_web.sh **source**（不是执行）。
#
# 背景见: D:\Data_Cache\gd\clash相关\WSL2下Docker构建走Windows代理.md
#
# WSL2 下代理（Clash 等）跑在 Windows 侧 127.0.0.1:7890，构建容器要用上它必须同时满足两条：
#   可达性 —— compose 里的 network: host，容器里的 127.0.0.1 才指向 WSL/Windows
#   传递   —— build-arg，宿主机 shell 里 export 的变量对构建容器无效
# 两条都已写在 infra/docker-compose.yml 的 x-build-proxy 里，本脚本只负责：
#   1. 把 HTTP_PROXY 等变量准备好（供 compose 插值）；
#   2. 探活 —— 代理没起来时构建**不会报错**，npm/pip 只会无限重试、静默卡死，
#      所以在这里提前失败，而不是让人对着没输出的终端猜。
#
# 用法:
#   ./deploy.sh                                      # 走代理（默认 http://127.0.0.1:7890）
#   HTTPS_PROXY=http://127.0.0.1:1080 ./deploy.sh    # 换代理地址/端口
#   BUILD_PROXY=off ./deploy.sh                      # 不走代理，直连

BUILD_PROXY="${BUILD_PROXY:-on}"

if [ "$BUILD_PROXY" = "off" ]; then
    # 赋空值而不是 unset：compose 里用的是 ${HTTP_PROXY-...}（单横线）写法，
    # 空值不会被默认值顶掉，构建容器因此拿到空代理 = 直连。
    # 空值交给各 Dockerfile 自己处理（api-server 的 apt 那步会把空值 unset 掉，
    # 因为 apt 对空 http_proxy 的行为不明确）。
    export HTTP_PROXY= HTTPS_PROXY= NO_PROXY= http_proxy= https_proxy= no_proxy=
    echo "⚠️   BUILD_PROXY=off —— 本次构建直连，不走代理"
    return 0
fi

# mirrored 网络模式下 WSL 与 Windows 共享网络栈，WSL 里的 127.0.0.1 就是 Windows 侧
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-$HTTP_PROXY}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
# 小写变体保持一致：经典构建器（DOCKER_BUILDKIT=0，三个 deploy 脚本都强制用它）
# 只认传入的那几个键，不会像 BuildKit 那样自动补小写
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" no_proxy="$NO_PROXY"

# 探活：直接连代理端口。代理进程在 Windows 侧，所以 WSL 里 `ss -ltn` 看不到 7890 是正常的，
# 别据此判断代理没起来 —— 只有连不上才算没起来。
# 代理对裸 GET 会回 400 Bad Request，那是好消息（TCP 通了），curl 退出码仍是 0。
PROXY_HOSTPORT="${HTTP_PROXY#*://}"
PROXY_HOSTPORT="${PROXY_HOSTPORT%%/*}"
if ! curl -s -o /dev/null -m 5 --noproxy '*' "http://${PROXY_HOSTPORT}/" 2>/dev/null; then
    echo "❌ 构建代理 ${HTTP_PROXY} 不可达（${PROXY_HOSTPORT} 连不上）。" >&2
    echo "   代理没起来时构建不会失败，只会静默卡死在 npm/pip install 上。" >&2
    echo "   请先启动 Clash/v2ray；确实要直连构建：BUILD_PROXY=off $0" >&2
    return 1
fi
echo "🌐 构建走代理 ${HTTP_PROXY}"
