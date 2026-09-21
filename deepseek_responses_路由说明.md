# deepseek_responses 特殊路由链路

> 姊妹篇：[`deepseek_for_claude_code_路由说明.md`](./deepseek_for_claude_code_路由说明.md)（Anthropic 兼容面）。
> 两者解决的问题不同，不要混用。

## 背景

DeepSeek 的联网搜索（`web_search`）**只存在于它的 `/v1/responses` 端点上**，Chat Completions 面没有对应能力，Anthropic 兼容面则用另一套协议（见姊妹篇）。

直观的做法是直接经 LiteLLM 调 `/v1/responses`。但这条路会**静默失效**：

```
curl http://llmapi.acken.int/v1/responses \
  -H "Authorization: Bearer sk-<key>" \
  -d '{"model":"deepseek-v4-pro","input":"今天有什么AI新闻","tools":[{"type":"web_search"}]}'
```

返回 HTTP 200、无报错，但模型回答"我无法实时获取新闻"。

## 根因：LiteLLM 的 Responses→Chat 桥接

LiteLLM 并没有为 DeepSeek 实现原生 Responses 适配器。`litellm/utils.py` 的
`ProviderConfigManager.get_provider_responses_api_config()` 对 `deepseek` 返回 `None`
（拥有原生适配器的只有 openai / azure / xai / openrouter 等十余个），于是
`litellm/responses/main.py` 退回到 **chat completions 桥接**：

```
{"type":"web_search"}
  → transform_responses_api_tools_to_chat_completion_tools()
    把它从 tools 里【搬走】，改写成 chat 侧的 web_search_options 参数
  → POST https://api.deepseek.com/v1/chat/completions
  → DeepSeek 的 chat 面没有联网能力，收到后静默忽略
```

注意两个容易误判的点：

1. **参数没有被丢弃。** `DeepSeekChatConfig` 继承自 `OpenAIGPTConfig`，而
   `web_search_options` 正在 OpenAI 的参数白名单里（`llm/llms/openai/chat/gpt_transformation.py`），
   所以它一路发到了上游。所以 `drop_params: true` **不是**元凶。
2. **失败是静默的。** 没有异常、没有警告，答案看起来还挺合理。只有 A/B 对比
   （直连 vs 经代理）才能发现。上游 issue [#35648](https://github.com/BerriAI/litellm/issues/35648)
   正是"为 DeepSeek 增加原生 Responses 支持"，目前仍 open。

## 绕行原理

借 openai 前缀让 LiteLLM 走**原生 OpenAI Responses 适配器**，请求体原样直达
`{api_base}/responses`。前缀只是给 LiteLLM 看的，发出前会被剥掉，DeepSeek 收到的
仍是裸模型名。

```
客户端 (Responses API 格式)
  │  POST /v1/responses  {"model":"ds-search", "tools":[{"type":"web_search"}, ...]}
  ▼
LiteLLM Proxy 标准端点
  ├─ 认证：LiteLLM 虚拟 key（与其它模型一致，治理能力不丢）
  ├─ 模型解析：model_name "ds-search" → deployment
  │    ┌────────────────────────────────────────────────────────┐
  │    │ model_name:     ds-search                              │
  │    │ litellm_params.model:    "openai/deepseek-v4-pro"      │
  │    │ litellm_params.api_base: "https://api.deepseek.com/v1" │
  │    │ model_info.admin_provider: "deepseek_responses"        │
  │    └────────────────────────────────────────────────────────┘
  ├─ 适配器选择：前缀 "openai" → OpenAIResponsesAPIConfig（原生，非桥接）
  └─ 转发
       URL:  {api_base}/responses = https://api.deepseek.com/v1/responses
       Body: {"model":"deepseek-v4-pro", ...}   ← openai/ 前缀已剥掉
       tools 原样透传，零翻译
  ▼
DeepSeek /v1/responses → 真正执行 web_search
  ▼
返回原生 Responses 格式（含 web_search_call 条目），原路返回
```

**api_base 必须带 `/v1`** —— openai 适配器拼的是 `{api_base}/responses`。

## 配置项

全部位于 `apps/api-server/app/api/admin.py`：

| 配置项 | 值 | 是否必需 |
|---|---|---|
| `PROVIDER_PREFIX` | `"openai"` | ✅ 借适配器 |
| `PROVIDER_DEFAULT_BASE` | `"https://api.deepseek.com/v1"` | ✅ |
| `PROVIDER_CUSTOM_LLM_PROVIDER` | —— | ❌ **不需要** |
| `PROVIDER_COST_MAP_KEY_PREFIX` | —— | ❌ 不需要（平台只统计 token 数） |

前端 `apps/web-client/src/pages/System/SystemAdminPage.jsx` 的 `PROVIDERS` 数组里
有对应预设，`prefix` 字段声明实际发给 LiteLLM 的前缀，用于把 Model ID 输入框下方的
提示显示成真实调用路径。

## 与 deepseek_for_cc 的对比

| | `deepseek_for_cc` | `deepseek_responses` |
|---|---|---|
| 适配器 | anthropic | openai |
| 服务的客户端 | Claude Code 等说 Messages API 的 | Codex CLI 等说 Responses API 的 |
| model 前缀 | `""`（空前缀） | `"openai"` |
| 为何这样选 | `/anthropic` 只认裸模型名，前缀位空着，适配器信号只能靠 `custom_llm_provider` 硬覆盖 | 前缀位可用，`openai/` 本身就携带适配器信号 |
| 是否对抗 LiteLLM 前缀语义 | 是（所以叫"特殊链路"） | 否（顺着走） |

## 已知陷阱

1. **不要直接替换现有的 `deepseek` 模型。** `apps/api-server/app/api/chat.py` 的
   `_apply_reasoning_params()` 用 `body.model.startswith("deepseek")` 决定发
   `thinking` 还是 `reasoning_effort`，而 OpenAI 适配器不认 `thinking`（会被
   `drop_params` 静默丢掉）。web chat 那条链路请继续用原来的 `deepseek` 模型，
   本预设**平行新增**给 Responses API 客户端用。

2. **计费记 0。** `openai/deepseek-v4-pro` 在 OpenAI 价目表里查不到，
   `LiteLLM_SpendLogs.spend` 会是 0。平台目前只按 token 数统计，所以无影响；
   但若将来启用 key 级 `max_budget`，预算拦截会因为 spend 恒为 0 而失效。
   届时在 `model_info` 里补 `input_cost_per_token` / `output_cost_per_token` 即可修复
   （实测有效；只设 `model_info.key` 无效）。

3. **依赖两个协议面足够同构。** 若 DeepSeek 日后在 Responses 面上加入 OpenAI 没有的
   字段，OpenAI 适配器的 pydantic 模型可能解析失败。真到那天，上游 #35648 落地后
   切回原生 provider 即可。

## 验证方法

```bash
# 应该出现 web_search_call 条目，total_tokens 上万（搜索内容会灌进上下文）
curl -sS http://<host>/v1/responses \
  -H "Authorization: Bearer sk-<虚拟key>" -H 'Content-Type: application/json' \
  -d '{"model":"<你建的分发模型名>","input":"今天有什么AI新闻","tools":[{"type":"web_search"}]}' \
  | jq '{tools, types: [.output[].type], tokens: .usage.total_tokens}'
```

对照：桥接路径下 `tools` 会是 `[]`，`output` 只有 `reasoning` 和 `message`，
`total_tokens` 只有两位数。
