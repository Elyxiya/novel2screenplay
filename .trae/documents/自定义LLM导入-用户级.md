# 自定义 LLM 导入 API（用户级隔离 + 运行时热注册 + 配置页）

## Summary
将 llm 层从"启动时读环境变量一次性注册"升级为"**用户可通过 HTTP API 动态导入 / 编辑 / 删除自定义 LLM**（OpenAI 兼容为主、Anthropic 原生兜底），配置 `user_id` 隔离持久化到 SQLite，**运行时按当前登录用户解析生效**，并配套前端配置页。核心产物：用户级 Provider 存储 + REST API + 模型列表注入 + 配置 UI。

不再依赖改 `.env.local` 重启即可接入任意模型（DeepSeek / Kimi / GLM / 通义 / Ollama / 中转站）。

### 已决定的方向（用户确认）
- **导入形态**：HTTP REST API 动态导入 + DB 用户级持久化 + 运行时热注册（不开文件导入）
- **配置范围**：用户级隔离（per-user）
- **前端**：配套配置页

---

## Current State Analysis（已探明）

现有 llm 层有两套**静态**注册中心，均为环境变量驱动、启动时一次性注册：

- [registry.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/llm/registry.ts)：`LLMProviderRegistry`（内存 `Map<name, LLMProvider>`）+ `initializeProviders()` 从 env 注册 DeepSeek / OpenAI / CustomOpenAI（`getCustomOpenAIProvider()` 全局单例）/ CustomAnthropic。
- [adapter/router.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/llm/adapter/router.ts)：`ModelRouter`（内存 `Map`，`registerAdapter/unregisterAdapter` 已有），由 `getModelRouter()` 构造，同样从 env 注册。

自定义 Provider：[CustomOpenAIProvider.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/llm/CustomOpenAIProvider.ts)、[CustomAnthropicProvider.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/llm/CustomAnthropicProvider.ts) —— 均实现 `LLMProvider` + `LLMAdapter` 双接口，构造器接受 settings，但当前由 `getCustomOpenAIProvider()` 单例缓存、硬编码 name。

**检测到的 provider 取点（影响"用户级"接入面）**（`grep llmRegistry.`）：
1. [PipelineEngine.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/pipeline/PipelineEngine.ts#L74-L75) L74 `llmRegistry.get(modelId) || getDefault()`、L149 `getDefault()` —— pipeline 已通过 `startJob({userId})` 拿到用户。
2. [orchestrator.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/multi-agent/orchestrator.ts#L671) L671 `config.provider ?? llmRegistry.getDefault()` —— OrchestratorTask 带 `userId` 落库（记忆 P-记忆）。
3. [revise-scene.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/result/revise-scene.ts#L115) L115 `provider ?? llmRegistry.getDefault()` —— 上层 route 有 `getCurrentUser()`。
4. [builtin-tools.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/tools/builtin-tools.ts#L130) L130/167 `llmRegistry.getDefault()` —— Agent 内置工具，**无 userId 上下文**。

**认证取数**：[session.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/auth/session.ts) `getSessionUser()/getCurrentUser()` 返回 `{id,...}`；各 route 已能拿 userId。

**模型列表对接**：[ModelSelector.tsx](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/components/ModelSelector.tsx#L37) 只调 `/api/models` 的 `data.adapters`（按 adapter 分组）。→ 让 `/api/models` 在当前登录用户下把"用户导入的 provider"拼接进返回，前端 configure 下拉即自动出现，**无需改配置页表单**。

**持久化基座**：[schema.sql](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/store/sqlite/schema.sql) 已有 `users`、`schema_version`（v1–v4），用 better-sqlite3 prepared statements。

---

## Proposed Changes

### 1. 数据库：新增 `user_llm` 表（schema v5）
修改 [schema.sql](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/store/sqlite/schema.sql)：
- 新增表 `user_llm(id TEXT PK, user_id TEXT NOT NULL, protocol TEXT NOT NULL /* 'openai'|'anthropic' */, base_url TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, default_model TEXT NOT NULL, supported_models TEXT NOT NULL DEFAULT '[]' /* JSON */, context_window INTEGER NOT NULL DEFAULT 128000, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`。
- 索引 `idx_user_llm_user_id ON user_llm(user_id)`。
- 追加 `INSERT OR IGNORE INTO schema_version ... VALUES (5, ..., 'Add user_llm: per-user custom provider imports')`。

> 决策：`api_key` 明文存库（个人部署约定；前端输入框 `type=password` 且 GET 回传时 `api_key` 打码 `sk-****…`）。加密升级列入后续项，不做本期范围。

### 2. 持久化 Repository
新增 [user-llm-repository.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/store/sqlite/user-llm-repository.ts)（`lib/store/sqlite/`，仿既有 repository 风格，单例导出）：
- `listByUser(userId)`、`getById(id)`（调用侧校验 owner）、`create(record)`、`update(id, patch)`、`delete(id)`、`listApiKeysByUser(userId)`（供后面 key 摘要）。
- 类型 `UserLLMRecord`、`CreateUserLLMParams`、`UpdateUserLLMParams`。
- 在 [store/sqlite/index.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/store/sqlite/index.ts) 导出。

### 3. Provider 实例工厂 + 用户级注册表
新增 `lib/llm/`：
- **user-llm-factory.ts**：`createUserLLMProvider(record: UserLLMRecord): LLMProvider & LLMAdapter` —— 直接复用 `new CustomOpenAIProvider(settings)` / `new CustomAnthropicProvider(settings)`，settings 由 record 组装（复用其 `parseCustomOpenAISettings` 同款字段映射与端点规整）。多用户同协议构造多实例，因按 userId 分流到不同注册表，name 冲突可接受。
- **user-llm-registry.ts**：`getUserLLMRegistry(userId): LLMProviderRegistry` —— 按 userId 懒加载缓存一个**独立** `LLMProviderRegistry`（DB 读 → factory 构造 → register）；提供 `reload(userId)`（导入/编辑/删除后使缓存失效）。与 `llmRegistry` 平级、完全隔离，**不把用户 key 注入全局注册中心**（避免跨用户可见）。

### 4. 解析网关（用户优先，回退 env）
新增 [llm-gateway.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/llm/llm-gateway.ts)：
- `resolveProvider(userId?, modelId?, opts): LLMProvider | undefined` —— 有 userId 且用户导入的 `supported_models` 命中 `modelId`（或兼容 JSONMode 过滤时命中默认）→ 返回用户 provider；否则回退全局 `llmRegistry.get(modelId) || getDefault()`。
- `resolveDefaultProvider(userId?, opts)` —— 用户默认模型优先，回退全局默认。
- `listModelsForUser(userId)` —— 返回 `[{adapterId, adapterName, models:[{modelId}], providerId, ownerUserId}]`，供 `/api/models` 注入与配置页展示。

### 5. 改造 provider 取点（用户级生效）
接入范围以「已拿到 userId 的主链路」为准，按需传递 userId（回退安全：未登录/无 userId 时自然落到全局 env provider）：
- **PipelineEngine.ts** L74/L149：`startJob` 已收 `input.userId`；将两处 `llmRegistry.get/getDefault` 改为经 `llmGateway.resolveProvider/userDefault(`${input.userId}`, modelId)`。Engine 为单例且多任务并发，禁止存实例字段存 userId；改为在 `startJob` 局部求得 userId，并让需要 provider 的阶段调用沿方法参数传入 userId（实现时若某 phase 签名缺 userId，则加可选参数 `userId?: string`，不改公共契约）。
- **orchestrator.ts** L671：改为 `this.config.provider ?? llmGateway.resolveDefaultProvider(task.userId) ?? llmRegistry.getDefault()`；若 task 内部按 `modelId` 走，用 `resolveProvider(task.userId, modelId)`。
- **revise-scene.ts** L115：[revise route](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/app/api/result/revise/route.ts) 已 `getCurrentUser()`，将 userId 传入，L115 用 `resolveProvider(userId, modelId ?? undefined)` 回退全局。
- **builtin-tools.ts** L130/167：Agent 内置辅助工具无 userId 上下文，**保持全局默认**（模型选择主链在 pipeline/orchestrator 已按用户）；记录到假定，不强制本期改造。

### 6. REST API（用户级）
新增 `app/api/llm/`，全部先 `getCurrentUser()`（未登录 `authError()`）：
- `route.ts`：
  - `GET /api/llm` —— 返回当前用户导入列表（`api_key` 打码）。
  - `POST /api/llm` —— 导入。body `{protocol, baseUrl, apiKey?, name?, defaultModel, supportedModels?: string|string[], contextWindow?}`。校验：`protocol ∈ {openai,anthropic}`、`baseUrl`、`defaultModel` 非空；`supportedModels` 支持逗号/数组，去重合并 `defaultModel`。成功后 `getUserLLMRegistry(userId).reload()` 热生效。
- `[id]/route.ts`：
  - `GET`、`PATCH`（允许部分更新，`apiKey` 为空串表示不改密钥）、`DELETE`；均在 Repository 层校验 `userId` owner（非本人返回 404）。

### 7. `/api/models` 注入用户模型
修改 [models/route.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/app/api/models/route.ts)：
- `getCurrentUser()`；有用户时 `getUserLLMRegistry(userId)` 的 providers 经 `llmGateway.listModelsForUser` 拼接为 extra adapter 条目（`adapterId` 用 `user-${providerId}`，`adapterName` 用用户填写 name，`models[].modelId` 用 `supported_models`，`health` 暂置 `'healthy'`）。
- `defaultModel`：用户导入的 `default_model` 优先，否则 `router.getDefaultModel()`。
- 复用现有环境 `ModelRouter` 的 adapters 不变 → `ModelSelector` 自动展示用户模型，configure 无需改表单。

### 8. 前端配置页
- 于现有 [settings/page.tsx](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/app/settings/page.tsx) 新增"自定义 LLM"区块（复用其页面壳与 RequireAuth），不新建导航路由；同时在 [HeaderNav.tsx](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/components/HeaderNav.tsx) 的"设置"入口即可达（若已存在则不需改导航）。
- 新增组件：
  - `components/llm/UserLLMList.tsx`：当前用户已导入列表（名称/协议/模型数/BaseURL 摘要），含删除、编辑。
  - `components/llm/CustomLLMForm.tsx`：表单项（名称、协议下拉、Base URL、API Key、默认模型、其他模型逗号分隔、上下文窗口），复用提交 POST/PATCH。
- 不新增"测试连通性"按钮（可选增强，本期不做，避免范围膨胀）。

### 9. 初始化整合
在 [initializeProviders()](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/llm/registry.ts#L52) 末尾追加"按 active 用户导出/恢复"的说明与 `getUserLLMRegistry` 懒加载入口即可；**不做启动时全量加载所有用户**（懒加载按需，避免启动扫描 + key 内存常驻）。

---

## Assumptions & Decisions
- **用户级隔离落地**：每用户一个独立 `LLMProviderRegistry`（不把用户 key 注入全局 `llmRegistry`/`ModelRouter`），模型选择主链（pipeline / Agent 编排 / revise）注入 `userId` 解析；**未登录或无 userId 时回退全局 env provider，不影响既有接口**。
- `api_key` 明文存 SQLite，GET 回传打码；加密为后续项。
- 用户导入模型**优先于** env 内置模型（默认选择），env 作为回退保留（向后兼容现有 `CUSTOM_*`）。
- 保留 `CustomOpenAIProvider`/`CustomAnthropicProvider` 的 env 单例路径不动，仅新增"任意实例"构造能力。
- 渐进式：本次不在 `/api/llm/[id]` 提供连通性测试接口。

---

## Verification
1. **单测（新增）**：
   - `user-llm-repository.test.ts`：CRUD + owner 校验 + `listApiKeysByUser`。
   - `user-llm-factory.test.ts`：openai/anthropic 两种 record → 实例字段正确（baseUrl/model/supportedModels/contextWindow）、端点规整。
   - `user-llm-registry.test.ts`：懒加载 + reload 缓存失效 + 多用户隔离（a 用户导入不影响 b 用户）。
   - `llm-gateway.test.ts`：用户命中优先、未命中回退全局、无 userId 回退全局、JSONMode 过滤。
   - `app/api/llm` 路由测试（mock session）：GET/POST 校验、PATCH/DELETE owner 校验、api_key 打码。
2. **既有回归**：`apps/screenplay` 全部 Vitest（当前 35 文件 / 269 例）保持绿；`packages/contracts` 稳定。
3. **静态检查**：`tsc --noEmit`、`eslint src`、contracts build。
4. **E2E（沿项目 scripts/shot + docs 约定，产证但按约定不入库）**：登录 → `POST /api/llm` 导入（OpenAI 兼容 + 可选 Anthropic）→ `GET /api/llm` 见打码列表 → `GET /api/models` 含用户 adapter → 用导入的 `default_model` 走 `POST /api/pipeline/start`（真实或 mock LLM）→ 配置页截图（`scripts/shot` 新脚本）。

---

## 文件清单
- 新增：`lib/store/sqlite/user-llm-repository.ts`、`lib/llm/user-llm-factory.ts`、`lib/llm/user-llm-registry.ts`、`lib/llm/llm-gateway.ts`、`app/api/llm/route.ts`、`app/api/llm/[id]/route.ts`、`components/llm/UserLLMList.tsx`、`components/llm/CustomLLMForm.tsx`、相关测试。
- 修改：`lib/store/sqlite/schema.sql`、`lib/store/sqlite/index.ts`、`lib/llm/registry.ts`、`lib/pipeline/PipelineEngine.ts`、`lib/multi-agent/orchestrator.ts`、`lib/result/revise-scene.ts`、`app/api/result/revise/route.ts`、`app/api/models/route.ts`、`app/settings/page.tsx`（+ 必要时 HeaderNav）。