## P1-4：会话/任务与 users 表打通 —— 多用户数据隔离补漏

### 背景

仓储层（SQLite `jobs/novels/history/dramas`）已具备 `user_id` 隔离能力，但 **Agent 编排任务（orchestrator）完全没有 userId 概念**，`agent/start`、`agent/stream`、`debug/agent-logs`、`debug/flow-eval` 等接口凭 id 直接访问他人数据；`/api/jobs/[id]/events` 甚至**完全没有登录鉴权**。本次将 Agent 会话/任务接入 users 表归属体系，补齐读取路径的归属校验。

### 改动

**会话/任务归属（Agent 链路）**
- [orchestrator.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/multi-agent/orchestrator.ts)：`OrchestratorTask` 加 `userId`；`startConversion` 接收归属用户；调试会话 meta 带 `userId`
- [orchestrator-singleton.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/multi-agent/orchestrator-singleton.ts)（新建）：进程级共享单例，`agent/start` 与 `agent/stream` 共用同一任务 Map
- [conversation-logger.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/agent/debug/conversation-logger.ts)：`DebugSessionMeta` 加 `userId`，新增 `clearByUserId` 按用户清理

**API 归属校验**
- `/api/agent/start`：POST 透传 `userId`；GET 校验任务归属（他人任务 404）
- `/api/agent/stream/[taskId]`：SSE 订阅前校验任务归属（他人任务 404）
- `/api/debug/agent-logs`：会话归属校验；列表仅返回当前用户会话；DELETE 仅清理当前用户
- `/api/debug/flow-eval`：job 归属校验（他人任务不可评测）
- `/api/jobs/[id]/events`：**补登录鉴权 + 归属校验**（此前完全无鉴权，最严重缺口）
- `/api/import/yaml`：创建即带 `userId`，去除"先建后补"窗口

### 验证

**typecheck / 单测**
- `npx tsc --noEmit`：0 错误
- 全量单测：163/163 ✅（新增 `clearByUserId` 用例）

**E2E 用户间隔离（e2e-isolation.mjs，16 项全绿）**
- 未登录 `GET /api/jobs/[id]/events` → 401（此前放行）
- A 创建的 agent 任务：B 查询 / 订阅 SSE / 读调试会话 全部 404，A 全部 200
- B 的会话列表不含 A 的任务，A 的列表包含自己的任务
- A 的 pipeline job：B 评测（flow-eval）404，A 评测 200
- A 的队列 job：B 订阅 events 404，A 订阅 200

**运行截图（shot-isolation.mjs，pr-evidence/，不入库）**
- `p14-agent-authed.png`：登录后 Agent 工作台正常渲染
- `p14-debug-authed.png`：登录后 /debug 评测界面正常渲染

### 兼容性说明

- 旧数据（`user_id` 为 NULL）按既有 `userId &&` 模式放行，不阻断遗留任务
- p1-5（PR #31）合并后需将 `/api/agent/review` 接入共享单例并补归属校验
