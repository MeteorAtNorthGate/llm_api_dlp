  三个角色

  ┌───────────┬──────────┬───────────────────┬─────────────────┐
  │   用户    │   密码    │        组         │    可见菜单      │
  ├───────────┼──────────┼───────────────────┼─────────────────┤
  │ admin     │ admin123 │ admins, employees │ Chat + System   │
  ├───────────┼──────────┼───────────────────┼─────────────────┤
  │ devuser   │ dev123   │ developers        │ Chat + API Keys │
  ├───────────┼──────────┼───────────────────┼─────────────────┤
  │ demo      │ demo123  │ employees         │ Chat only       │
  └───────────┴──────────┴───────────────────┴─────────────────┘

  IT 运维的操作流程

  1. 用 admin / admin123 登录
  2. 顶部导航出现 "System" 菜单
  3. 点击 "+ Add Model" → 填写：

  1. 用 admin / admin123 登录
  2. 顶部导航出现 "System" 菜单
  3. 点击 "+ Add Model" → 填写：
    - Model Name: gpt-4o
    - Provider: OpenAI
    - Model ID: gpt-4o
    - API Key: sk-proj-...（粘贴厂商给的 Key）
    - RPM/TPM: 按需设置
  4. 点击 Add → 立即生效，无需重启

  数据流

  IT 运维在 Web 页面填写 API Key
    → POST /api/v1/admin/models（FastAPI，校验 admins 权限）
    → POST /model/new（LiteLLM Admin API，Master Key 认证）
    → 模型+Key 存入 PostgreSQL
    → 所有用户立即可用