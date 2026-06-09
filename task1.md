# 内部 AI 平台架构规划与任务拆解 (task.md)

## 1. 项目定位与核心目标
本项目旨在为企业内部构建一个统一的大模型服务门户。
主要服务两类受众：
* **非技术员工（C端体验）：** 提供类似 ChatGPT 的 Web 对话界面，支持多轮对话、历史记录查询。
* **研发员工（B端体验）：** 提供企业内部二级 API Key 的自助申请与额度查询看板。

**核心管控要求：**
* 打通企业 AD/LDAP 域控，实现员工无缝单点登录（SSO）。
* 内部拦截与数据脱敏（DLP），确保敏感信息不出域，且脱敏不影响 Token 计费准确性。
* 隐藏企业底层主 API Key，向研发员工下发受控、限额的二级虚拟 Key。

---

## 2. 核心技术栈 (Tech Stack)
* **前端 Web Client：** Vite + React + TailwindCSS
* **业务后端 API Server：** CPython 3.11+ / FastAPI / Uvicorn (纯异步高并发)
* **AI 网关层：** LiteLLM Proxy (承载多模型路由、负载均衡、Token 计费管控)
* **身份认证网关：** Keycloak (桥接企业 LDAP/AD 与前端 OIDC)
* **持久化层：** PostgreSQL (存储前端对话历史 + LiteLLM 账单与 Key 信息)

---

## 3. 总体架构与数据流转拓扑

### 3.1 认证鉴权流 (Auth Flow)
1. 员工访问 Web 首页 -> 前端检测无会话 -> 重定向至 Keycloak 登录页。
2. 员工输入 Windows 域账号密码 (`Acken.xxxx` / `***`)。
3. Keycloak 通过 LDAP Bind 校验 AD 域控。
4. 校验成功，回调 Web 前端，下发 JWT Token (包含用户组信息、部门标识)。

### 3.2 Web 聊天数据流 (Chat Flow)
1. 前端携带 JWT 请求 FastAPI 业务后端 `/v1/chat/completions`。
2. FastAPI 校验 JWT，保存用户提问至本地 DB（历史记录表）。
3. FastAPI 携带 **后端独占的内部系统 Key**，将流式请求转发给 LiteLLM Proxy。
4. **LiteLLM 拦截器 (DLP Plugin)：** 触发 `pre_api_call` 钩子，将 `message` 中的敏感词替换为占位符。
5. LiteLLM 根据内部规则扣除 Token 预算，转发给外部大模型（如 OpenAI/Qwen）。
6. LiteLLM 触发 `post_api_call` 钩子，复原脱敏信息，以 Stream 形式返回给 FastAPI。
7. FastAPI 透传 Stream 给前端，前端逐字渲染。

### 3.3 研发 API Key 分发流 (API Dist Flow)
1. 研发员工登录 Web 面板，进入“开发者中心”，点击“生成二级 Key”。
2. 前端请求 FastAPI 后端 `/v1/keys/generate`。
3. FastAPI 根据用户的 AD 部门属性，确定其额度上限与模型白名单。
4. FastAPI 使用 **Master Key** 调用 LiteLLM 的 Admin API (`/key/generate`)。
5. LiteLLM 生成 `sk-xxxx` 并存入 PostgreSQL，返回给 FastAPI。
6. FastAPI 返回给前端展示（“仅展示一次”逻辑）。

---

## 4. 工程目录规范 (Mono-repo)

```text
llm_api_dlp/
├── apps/                        # 核心业务代码
│   ├── web-client/              # React 前端
│   ├── api-server/              # FastAPI 后端
│   └── dlp-plugin/              # LiteLLM 自定义脱敏 Python 脚本
├── infra/                       # 基础设施部署
│   ├── docker-compose.yml       # 环境一键编排
│   ├── litellm/                 # 网关路由配置 (config.yaml)
│   └── keycloak/                # SSO 配置备份
└── docs/                        # 架构图、接口文档