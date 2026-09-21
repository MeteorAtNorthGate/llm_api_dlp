FROM python:3.11-slim

WORKDIR /app

# 构建期代理：值由 infra/docker-compose.yml 的 x-build-proxy 注入，
# 说明见 D:\Data_Cache\gd\clash相关\WSL2下Docker构建走Windows代理.md
# 声明出来是为了让"这个构建依赖代理"看得见 —— 删掉它们，apt 和 pip 就直连了。
# 只作用于构建阶段，不会写进镜像运行环境（docker inspect 确认过）。
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

# apt 只认小写 http_proxy，而经典构建器（DOCKER_BUILDKIT=0）只设传入的那几个键，
# 不会自动补小写变体 —— 所以这里显式把大写落到小写上，否则 apt 会绕过代理。
# 代理为空串时（BUILD_PROXY=off）把这些变量 unset 掉：apt 对空 http_proxy 的处理
# 并不明确，不如让它彻底看不到代理变量、走直连。
RUN if [ -n "$HTTP_PROXY" ]; then \
        export http_proxy="$HTTP_PROXY" https_proxy="${HTTPS_PROXY:-$HTTP_PROXY}"; \
    else \
        unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; \
    fi \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*
# 这里只装运行时真正需要的系统库（libmagic1 对应 requirements 里的 python-magic）。
# 原本还有两个，都已移除：
#   build-essential —— 用来编译没有预编译 wheel 的 Python 包，但实测不需要：
#     在 python:3.11-slim 上按 --only-binary=:all: 解析 requirements.txt，
#     68 个包（含 asyncpg / cryptography / pydantic-core / uvloop / lxml / pymupdf
#     这些带 C 或 Rust 扩展的）全部命中预编译 wheel，没有一个需要现场编译。
#     它却会拖进 gcc/g++/make/libc6-dev 整个工具链：约 127 个包、下载 ~90MB。
#     以后若真引入了没有 wheel 的依赖（pip 会明确报 No matching distribution），
#     再加回来 —— 更好的做法是多阶段构建，别把工具链留在运行镜像里。
#   poppler-utils —— 全仓没有任何 pdftotext / pdfinfo / subprocess 调用，
#     PDF 解析走的是 pymupdf（自带 MuPDF），与 poppler 无关。
#
# Acquire::Retries=3：apt 默认不重试，而走代理时偶发 502（上游节点抖动）会让
# 整个构建前功尽弃 —— 109MB 下到一半失败就是它。

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Migrations run from the entrypoint, which works out the correct starting
# revision instead of blindly stamping. Invoked via `sh` rather than directly so
# it does not depend on the executable bit surviving a checkout.
CMD ["sh", "/app/docker-entrypoint.sh"]
