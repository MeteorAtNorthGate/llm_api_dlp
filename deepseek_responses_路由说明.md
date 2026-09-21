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

## web chat 的接入方式（模型即开关）

网页端不需要任何新控件：**选中哪个模型就决定了走哪条传输协议**。
`app/services/model_service.py` 的 `resolve_transport()` 按 `model_info.admin_provider`
把模型映射到 `chat` / `responses`，`chat.py` 据此换端点和请求体形状。
旧模型没有这个字段 → 一律 `chat`，行为完全不变。

对应地，`chat.py` 的 `_apply_reasoning_params()` **按 transport 分支而不是按模型名前缀**：
responses 面发 `reasoning: {effort}`（`thinking` 在那个面上会被静默丢弃）。
这一条是关键——搜索模型不必叫 `deepseek*`。

### 浏览器的 SSE 契约没有变

LiteLLM 的 Responses 事件**不会**原样转给浏览器。`app/services/responses_adapter.py`
把 Responses 事件归一化成前端本来就认识的 chat-completions 形状，只新增一个 `search` 帧：

```
{"choices":[{"delta":{"content":"..."}}]}                ← 与原来逐字节一致
{"choices":[{"delta":{"reasoning_content":"..."}}]}      ← 同上
{"search":{"queries":[...],"sources":[...],"count":N,"in_progress":bool}}   ← 新增，累计下发
{"error":"..."}
data: [DONE]
```

`search` 帧每次都发**全量**状态而非增量，前端整个赋值，丢帧或重复都不会让 UI 失步。

### 实测得到的两个非显然点

1. **推理 delta 的事件名是 `response.reasoning_text.delta`**，不是 OpenAI 规范的
   `response.reasoning_summary_text.delta`。照文档写解析器会**静默丢掉全部推理**。
   （桥接路径反而用 `reasoning_summary_text` 那个拼写，所以适配器两个都认。）
2. **搜索关键词和打开的网页在 `response.output_item.done` 的 `item.action` 里**，
   `response.web_search_call.*` 那几个事件**不带** `action`。
   `action.type` 有两种：`search`（`queries`）和 `open_page`（`url`）——所以 UI 能给出
   可点击的来源链接，不只是关键词。两种形状都带一个必须剥掉的内部标记：
   search 末尾会多一个 `ws_call_id=...` 的假关键词，URL 上带 `#ws_call_id=...` 片段。

一次搜索会产生**多个** `reasoning` item 与 `web_search_call` item 交替出现，
适配器在 reasoning item 之间补 `\n\n`，否则模型的多段思考会连成一句。

## 已知陷阱

1. **一个 turn 里模型可以搜很多次。** 实测单次提问触发了 7 次搜索、消耗 4 万 input tokens
   （不联网仅 87）。模型即开关意味着选中即这个开销。

2. **计费记 0。** `openai/deepseek-v4-pro` 在 OpenAI 价目表里查不到，
   `LiteLLM_SpendLogs.spend` 会是 0。平台目前只按 token 数统计，所以无影响；
   但若将来启用 key 级 `max_budget`，预算拦截会因为 spend 恒为 0 而失效。
   届时在 `model_info` 里补 `input_cost_per_token` / `output_cost_per_token` 即可修复
   （实测有效；只设 `model_info.key` 无效）。

3. **依赖两个协议面足够同构。** 若 DeepSeek 日后在 Responses 面上加入 OpenAI 没有的
   字段，OpenAI 适配器的 pydantic 模型可能解析失败。真到那天，上游 #35648 落地后
   切回原生 provider 即可。

4. **DLP：掩码生效，且还原是被刻意否决的——不要"修"它。** 这是本次排查的副产物，
   记清楚免得后人好心改坏。

   **现状**：掩码只由 api-server 做（`chat.py` 构建 `litellm_messages` 时调
   `apply_masking`）。用户自己的消息气泡显示原文（入库存 `msg.content` 原文，掩码只作用于
   发给 LLM 的 payload），所以**往外发的内容是干净的，而模型回答里回显的敏感信息会保持
   `██████` 形状**——实测：发「请原样重复：13812345678」，模型回答就是 `███████████`。

   **这是产品决策，不是缺陷。** 还原（`restore_masking`）刻意不启用，两个理由：
   1. **还原会让"降级过的回答"看起来正常**——模型是在 `███` 上推理的，它没看到真实值，
      给出的内容必然是泛化的；换回原文只是让答案表面上通顺，具有误导性。
   2. **还原会让掩码对用户完全静默**——用户永远不知道自己的 PII 被拦下了，也就学不会
      别往对话框里贴身份证号。可见的 `███` 本身就是 DLP 的信号。

   **因此**：`dlp_service.restore_masking`（api-server 侧，零调用）和
   `apps/dlp-plugin/custom_logger.py` 的 post-hook 都**不要接上**。插件本身另外还完全没在
   跑（`config.yaml` 里 `callbacks:` 是注释的、两个 compose 都没挂载它、容器里没这两个
   文件，**而且**它用的方法名 `async_pre_api_call` / `async_post_api_call` 在 LiteLLM
   v1.87.1 里根本不存在）——但即使这些全部"修好"，也不应该启用它的还原步骤。

   **已知缺口**：用二级 key 直接打 LiteLLM 的请求不经过 api-server，因此**完全没有掩码**。
   目前已确认该入口对大多数员工不开放，故暂不处理。

   含义：**用二级 key 直接打 LiteLLM 的用户没有任何 DLP 掩码**（api-server 那条路径
   仍然在 `chat.py` 里正常掩码）。这是既有问题，与本预设无关，但不要以为网关层有兜底。

   顺带一提，Responses 面的载荷形状和 chat 面不同（`input` 而不是 `messages`，
   `output[].content[].text` 而不是 `choices[].message.content`），将来真要补网关层
   DLP，得按这个形状写钩子。

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
