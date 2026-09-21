FROM node:24-alpine AS build

# 构建期代理：值由 infra/docker-compose.yml 的 x-build-proxy 注入，
# 说明见 D:\Data_Cache\gd\clash相关\WSL2下Docker构建走Windows代理.md
# 声明出来是为了让"这个构建依赖代理"看得见；实测 npm install 走代理 25s、直连 141s。
# 只在 build 阶段声明 —— 运行阶段（nginx）拿不到代理变量，不会残留进最终镜像。
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

# 用 pnpm 而不是 npm：这是 pnpm 工程（pnpm-lock.yaml + pnpm-workspace.yaml）。
# npm 不读 pnpm 的锁文件，会从 package.json 现场解析 —— 构建不可复现（本地锁的是
# eslint@9.39.4，npm 解析出 9.39.5），而且会撞上 @eslint/js@10 与 eslint@9 的
# peer 冲突：pnpm 容忍它（peerOptional，lint 实测通过），npm 直接 ERESOLVE 让构建失败。
# 版本由 package.json 的 packageManager 字段钉死，corepack 按它装。
#
# ⚠️ corepack 只在 node:24 及以下自带 —— Node 25 已经把它移除。哪天把基础镜像升到
#    node:25-alpine，这里要改成 `RUN npm install -g pnpm@11.5.1`（版本与 package.json
#    的 packageManager 字段保持一致），否则会以 "corepack: not found" 直接挂掉。
RUN corepack enable

WORKDIR /app

# pnpm-workspace.yaml 也要带上：pnpm 10+ 从这里读 allowBuilds 等设置，
# 漏了它 esbuild 的安装脚本会被默认拦掉。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
