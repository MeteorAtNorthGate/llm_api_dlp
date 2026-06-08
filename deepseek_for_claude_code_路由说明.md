# deepseek_for_cc 特殊路由链路

## 背景

DeepSeek 提供了一个 Anthropic 兼容端点 `https://api.deepseek.com/anthropic`，可以接收 Anthropic Messages API 格式的请求，但只接受 DeepSeek 的原生模型名（如 `deepseek-v4-pro`，不带 provider 前缀）。

我们的项目在 LiteLLM 之上新增 provider `deepseek_for_cc`，让管理员可以像添加普通模型一样，通过 System 页面创建基于 DeepSeek Anthropic 兼容端点的模型。

## 为什么是"特殊"链路

标准的 LiteLLM provider 配置中，model 前缀决定两个行为：

1. **适配器选择** — `deepseek/` 用 DeepSeek 适配器，`anthropic/` 用 Anthropic 适配器
2. **协议转换** — DeepSeek 适配器把 Anthropic → OpenAI 格式，Anthropic 适配器保持 Anthropic 格式

普通 `deepseek` provider 的链路：

```
Claude Code (Anthropic格式) → LiteLLM → deepseek适配器(转OpenAI格式) → https://api.deepseek.com/v1 (OpenAI格式✅)
```

但 `deepseek_for_cc` 的目标端点 `https://api.deepseek.com/anthropic` **期望 Anthropic 格式**，所以不能走 DeepSeek 适配器。同时 model 名又不能带 `anthropic/` 前缀（否则会被 passthrough 劫持到 `api.anthropic.com`）。

因此 `deepseek_for_cc` 的三项配置相互配合，形成了一条特殊路由：**model 无前缀 + api_base 用 Anthropic 兼容端点 + custom_llm_provider 强制 Anthropic 适配器**。

---

## 完整路由链路

以客户端配置为例：

```
ANTHROPIC_BASE_URL=http://localhost:4000/
ANTHROPIC_MODEL=ds-for-cc-1730
ANTHROPIC_AUTH_TOKEN=sk-<二级key>
```

```
Claude Code 客户端
  │
  ▼
① Anthropic SDK 构造 URL
  │  base_url + "/v1/messages"
  │  → http://localhost:4000/v1/messages?beta=true
  │  ⚠️ 不要带 /anthropic 前缀，否则走 passthrough 直连 api.anthropic.com
  │
  ▼
② LiteLLM Proxy 标准端点 (POST /v1/messages)
  │
  ├─③ 认证
  │    读取 x-api-key → 查 LiteLLM DB → 二级 key 有效，无 models 限制 → ✅
  │    （二级 key 不传 models 字段 = 允许所有模型）
  │
  ├─④ 模型解析
  │    读取 body.model: "ds-for-cc-1730"
  │    查 model_name 匹配 → 找到 deployment:
  │
  │    ┌──────────────────────────────────────────────────────┐
  │    │ model_name:              ds-for-cc-1730              │
  │    │ litellm_params.model:    "deepseek-v4-pro"           │
  │    │ litellm_params.api_key:  "<DeepSeek API key>"        │
  │    │ litellm_params.api_base: "https://api.deepseek.com/  │
  │    │                         anthropic"                   │
  │    │ custom_llm_provider:     "anthropic"   ← 关键覆盖    │
  │    └──────────────────────────────────────────────────────┘
  │
  ├─⑤ 适配器选择
  │    custom_llm_provider = "anthropic"
  │    → 强制使用 Anthropic 适配器
  │    → 保持 Anthropic Messages 格式，不转 OpenAI
  │
  └─⑥ 转发到上游
       URL:  api_base + "/v1/messages"
            = https://api.deepseek.com/anthropic/v1/messages
       Auth: x-api-key: <DeepSeek API key>
       Body: {"model": "deepseek-v4-pro", "messages": [...], ...}
       │
       ▼
⑦ DeepSeek Anthropic 兼容端点
  │  识别 model: "deepseek-v4-pro" ✅
  │  返回 Anthropic Messages 格式
  │
  ▼
⑧ 响应原路返回
    Anthropic 适配器解析 → LiteLLM → Claude Code
```

---

## 三个核心配置及其协作关系

全部位于 `apps/api-server/app/api/admin.py`：

### 1. `PROVIDER_PREFIX` — 控制 model 字段

```python
"deepseek_for_cc": "",   # 空字符串 → model 不带前缀，直接透传 model_id
```

`_build_litellm_model("deepseek_for_cc", "deepseek-v4-pro")` → `"deepseek-v4-pro"`

空前缀的作用：
- 写入 LiteLLM 的 `model` 字段就是纯净的 `"deepseek-v4-pro"`
- Anthropic 适配器看到无前缀的 model 名，直接传给上游
- DeepSeek 端点收到的 model 名就是 `"deepseek-v4-pro"`，可以识别

### 2. `PROVIDER_DEFAULT_BASE` — 控制 api_base

```python
"deepseek_for_cc": "https://api.deepseek.com/anthropic",
```

管理员创建模型时如果留空 `api_base`，自动填入此 URL。

### 3. `PROVIDER_CUSTOM_LLM_PROVIDER` — 覆盖适配器

```python
"deepseek_for_cc": "anthropic",
```

在 `add_model` 中注入 `litellm_params.custom_llm_provider = "anthropic"`，告诉 LiteLLM：**不要按 model 前缀推断适配器，强制使用 Anthropic 适配器**。

三个配置的关系：

```
PROVIDER_PREFIX["deepseek_for_cc"]              = ""                                    → model 字段无前缀
PROVIDER_DEFAULT_BASE["deepseek_for_cc"]        = "https://api.deepseek.com/anthropic"  → 发到 DeepSeek
PROVIDER_CUSTOM_LLM_PROVIDER["deepseek_for_cc"] = "anthropic"                           → 用 Anthropic 协议
                                                                                                ↑
                                                                                      缺一不可，共同构成特殊路由
```

---

## 模型创建流程

管理员在 System 页面创建 `deepseek_for_cc` 模型时：

```
System 页面（前端）
  │  Provider: "DeepSeek (Anthropic-Compatible)"
  │  Model ID: "deepseek-v4-pro"
  │  API Key:  <DeepSeek API key>
  │
  ▼
api-server: POST /api/admin/models  (admin.py)
  │
  ├─ _build_litellm_model("deepseek_for_cc", "deepseek-v4-pro")
  │   → PROVIDER_PREFIX["deepseek_for_cc"] = ""
  │   → 空前缀 → 返回 "deepseek-v4-pro"
  │
  ├─ _resolve_api_base("deepseek_for_cc", None)
  │   → PROVIDER_DEFAULT_BASE["deepseek_for_cc"]
  │   → "https://api.deepseek.com/anthropic"
  │
  ├─ PROVIDER_CUSTOM_LLM_PROVIDER["deepseek_for_cc"]
  │   → "anthropic"
  │
  └─ POST {LITELLM_BASE_URL}/model/new
       │
       └─ 存入 LiteLLM 数据库 (litellm)
            {
              "model_name": "ds-for-cc-1730",
              "litellm_params": {
                "model": "deepseek-v4-pro",
                "api_key": "<DeepSeek key>",
                "api_base": "https://api.deepseek.com/anthropic",
                "custom_llm_provider": "anthropic",
                "rpm": 500,
                "tpm": 100000
              }
            }
```

---

## 二级 API Key 生成流程

开发者在 API Keys 页面生成 key 时：

```
api-server: POST /api/keys/generate  (keys.py)
  │
  ├─ _resolve_model_whitelist(user_claims, requested_models)
  │   └─ 未指定 models → 返回 None
  │       → litellm_payload 不包含 "models" 字段
  │       → LiteLLM 创建的 key 没有模型限制，可访问所有模型
  │
  └─ POST {LITELLM_BASE_URL}/key/generate
       {
         "key_alias": "key-devuser",
         // 不传 "models" → 全部模型可访问
       }
```

---

## 踩坑记录

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| 1 | 请求发到 `api.anthropic.com` 报 403 | model 前缀用 `deepseek/`，DeepSeek 适配器把协议转成 OpenAI 格式，但 endpoint 期望 Anthropic 格式 | 加 `custom_llm_provider: "anthropic"` 覆盖适配器 |
| 2 | DeepSeek 报 "unsupported model: deepseek/deepseek-v4-pro" | Anthropic 适配器不剥离 `deepseek/` 前缀，带前缀的 model 名原样传给 API | `PROVIDER_PREFIX` 设空字符串，不生成前缀 |
| 3 | 二级 key 无法访问新模型（403） | `_resolve_model_whitelist` 硬编码 `["deepseek-v4-flash"]`，新模型不在白名单 | 不指定 models 时不传 `models` 字段，默认无限制 |
| 4 | Passthrough 端点直连 `api.anthropic.com`（403） | 客户端 URL 带了 `/anthropic`（如 `http://localhost:4000/anthropic`），走到 passthrough，忽略 deployment 的 `api_base` | 客户端 URL 去掉 `/anthropic`，用 `http://localhost:4000` |

---

## 客户端的正确配置

```
ANTHROPIC_BASE_URL=http://localhost:4000/     # ← 不带 /anthropic！
ANTHROPIC_MODEL=ds-for-cc-1730                # ← admin 设定的 model_name
ANTHROPIC_AUTH_TOKEN=sk-<二级key>             # ← 从 API Keys 页面获取
```

### 为什么不能带 `/anthropic`

LiteLLM 在 `/anthropic` 路径上挂载了 **Anthropic Passthrough** 端点。这个端点的行为是：
- 只要 deployment 的 provider 是 `anthropic`，就直接把请求原封不动转发到 `https://api.anthropic.com`
- 完全忽略 deployment 配置的 `api_base`
- 设计目的是给 BYOK（自带 Anthropic key）场景用的

我们的 `deepseek_for_cc` 用 `custom_llm_provider: "anthropic"` 是为了**协议格式**（Anthropic Messages），但**目标服务器**是 DeepSeek 而不是 Anthropic。所以必须走标准端点 `/v1/messages`，不能走 passthrough。

### 端点对比

| 端点 | 路由方式 | 查 deployment 配置 | 用 api_base | 适用场景 |
|------|---------|-------------------|-------------|---------|
| `POST /v1/messages` | 标准路由 | ✅ 是 | ✅ 是 | 所有 provider |
| `POST /anthropic/v1/messages` | Passthrough | ❌ 否（直连 api.anthropic.com） | ❌ 否 | 仅 Anthropic BYOK |

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `apps/api-server/app/api/admin.py:22-66` | 三个 PROVIDER_* 字典定义 |
| `apps/api-server/app/api/admin.py:130-148` | `_build_litellm_model` 和 `_resolve_api_base` |
| `apps/api-server/app/api/admin.py:199-245` | `add_model` 端点，注入 custom_llm_provider |
| `apps/api-server/app/api/keys.py:70-80` | `_resolve_model_whitelist`，二级 key 模型权限 |
| `apps/api-server/app/api/keys.py:149-154` | `generate_key`，litellm_payload 构造 |
| `apps/web-client/src/pages/System/SystemAdminPage.jsx:10-31` | 前端 PROVIDERS 下拉列表 |
| `infra/litellm/config.yaml` | LiteLLM 启动配置，STORE_MODEL_IN_DB=true |
