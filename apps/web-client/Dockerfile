FROM node:24-alpine AS build

# 构建期代理：值由 infra/docker-compose.yml 的 x-build-proxy 注入，
# 说明见 D:\Data_Cache\gd\clash相关\WSL2下Docker构建走Windows代理.md
# 声明出来是为了让"这个构建依赖代理"看得见；实测 npm install 走代理 25s、直连 141s。
# 只在 build 阶段声明 —— 运行阶段（nginx）拿不到代理变量，不会残留进最终镜像。
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
