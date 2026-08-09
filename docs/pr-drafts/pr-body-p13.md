## P1-3：RequireAuth 补漏 + API 鉴权（P-安全）

### 背景

`/debug` 页面及 4 个 Agent/Debug API 此前无鉴权，任何未登录用户可访问评测界面与调试日志。审计项 P-安全，补齐页面守卫与接口鉴权，对齐 `/api/pipeline/start` 的既有鉴权模式。

### 改动

**页面守卫（RequireAuth 补漏）**
- `apps/screenplay/src/app/debug/page.tsx`：用 `RequireAuth` 包裹，未登录自动重定向 `/auth/login?next=/debug`

**API 鉴权（getCurrentUser + authError）**
- `apps/screenplay/src/app/api/agent/start/route.ts`：POST 与 GET 均加鉴权
- `apps/screenplay/src/app/api/agent/stream/[taskId]/route.ts`：SSE 订阅鉴权（EventSource 自动携带 cookie）
- `apps/screenplay/src/app/api/debug/agent-logs/route.ts`：GET/DELETE 均加鉴权
- `apps/screenplay/src/app/api/debug/flow-eval/route.ts`：GET 加鉴权

### 验证

**typecheck / 单测**
- `npx tsc --noEmit`：0 错误
- 全量单测：162/162 ✅

**E2E（e2e-auth.mjs，13 项全绿）**
- 未登录：POST/GET `agent/start`、`agent/stream`、`agent-logs` GET/DELETE、`flow-eval` 全部 401
- 登录后：上述端点全部放行

**运行截图（shot-auth.mjs，pr-evidence/，不入库）**
- 截图1 `p13-debug-01-unauthed-redirect.png`：未登录访问 /debug → 重定向登录页
- 截图2 `p13-debug-02-authed.png`：登录后 /debug 正常渲染评测界面

### 说明

- p1-5 合并后需补 `/api/agent/review` 鉴权（后续处理）
- 截图仅作为 PR 证据，`pr-evidence/` 不入库
