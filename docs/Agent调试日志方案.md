# Agent 调试日志功能方案

## 1. 需求分析

### 1.1 背景

AI 小说转剧本的 Agent 化改造（M1+M2）已交付：`AgentCore` 状态机 + `MultiAgentOrchestrator` 四阶段编排 + `ReviewGate` 质量关卡 + 8 个真实工具。当前调试验证手段有限：

- `AgentCore.emit()` 仅在 `config.verbose=true` 时输出 `console.debug`，且只覆盖事件级信息，不含 LLM 请求/响应原文
- 编排器的日志通过 SSE 推送给前端，无持久化，任务结束后无法回溯
- 没有统一的调试视图：LLM 每一轮对话、工具调用参数与结果、状态转换序列都不可查

### 1.2 目标

提供一套开箱即用的调试日志能力：

1. **LLM 对话全量记录**：每次 `chat` 的请求消息（role/content）、响应内容、finishReason、token 用量、耗时
2. **工具调用记录**：工具名、参数、执行结果摘要、成功/失败、耗时
3. **Agent 生命周期**：task_start / state_change / task_complete / task_error / token_warning 事件序列
4. **编排器阶段日志**：phase 开始/完成/失败、质量关卡评分、自动重试原因
5. **可查询与可落盘**：内存环形缓冲（按 taskId 会话）+ 可选 JSONL 文件持久化 + HTTP API 查询

### 1.3 非目标

- 不做实时前端监控页（SSE 已承担实时进度）
- 不做日志分级/告警、不接外部日志系统（ELK 等）
- 不改变现有 LLM 调用协议与 Agent 状态机语义

## 2. 方案设计

### 2.1 架构总览

```
编排器 executePhase
   ├─ LLMProvider(原) ──包装──> createLoggingLLMProvider ──> AgentCore
   ├─ ToolExecutor(原) ─包装──> createLoggingToolExecutor ──> AgentCore
   └─ AgentCore.on(handler) 事件订阅
                              │
                              ▼
              AgentConversationLogger（按 taskId 组织会话）
                              │
          ┌───────────────────┼────────────────────┐
          ▼                   ▼                    ▼
   内存环形缓冲(500/会话)   JSONL 落盘(可选)   /api/debug/agent-logs 查询
```

### 2.2 核心模块

#### 2.2.1 `AgentConversationLogger`（新增 `src/lib/agent/debug/conversation-logger.ts`）

日志条目的统一类型（`DebugLogEntry`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 条目 ID |
| `taskId` | string | 所属会话（编排任务 ID） |
| `seq` | number | 会话内自增序号 |
| `timestamp` | number | 时间戳 |
| `type` | union | `llm_request` / `llm_response` / `tool_call` / `state_change` / `task_event` / `orchestrator_log` |
| `level` | 'debug'\|'info'\|'warn'\|'error' | 级别 |
| `data` | Record<string, unknown> | 结构化负载 |

会话（`DebugSession`）结构：

```ts
interface DebugSession {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  entries: DebugLogEntry[];   // 环形缓冲，上限 maxEntriesPerSession（默认 500）
  meta: { phase?: string; role?: string; jobId?: string };  // 会话元信息
}
```

核心能力：

- `beginSession(taskId, meta?)`：开启会话（幂等）
- `append(taskId, entry)`：追加条目，超限时丢弃最旧
- `getSession(taskId)` / `listSessions()` / `clear()` / `getAll()`
- `persistToFile`（可选）：`AGENT_DEBUG_FILE=1` 时按会话写入 `logs/agent-debug/<taskId>.jsonl`（Append 模式），生产默认关闭
- 内置 `truncateText(text, maxLen)` 工具：超长内容（如剧本正文）截断到 `maxTextLength`（默认 2000 字符）再记录，避免日志爆炸

#### 2.2.2 `createLoggingLLMProvider`（新增 `src/lib/agent/debug/logging-llm-provider.ts`）

包装底层 `LLMProvider`（`src/lib/llm/types.ts` 接口），透传全部能力，仅在 `chat` / `chatStream` 边界记录：

```ts
export function createLoggingLLMProvider(
  inner: LLMProvider,
  logger: AgentConversationLogger,
  context: { taskId: string; phase?: string; role?: string },
): LLMProvider
```

- `chat(messages, options)`：记录 `llm_request`（消息数组 + 模型名）→ 调用 inner → 记录 `llm_response`（content 截断、usage、finishReason、耗时）
- `chatStream(...)`：聚合流式 chunks 后记录（同样在结束时写一条 response）
- `supportsJSONMode / estimateTokens / name / modelId / description / contextWindow`：原样转发

#### 2.2.3 `createLoggingToolExecutor`（新增 `src/lib/agent/debug/logging-tool-executor.ts`）

包装 `ToolExecutor`（`AgentCore` 定义接口），记录工具调用：

```ts
export function createLoggingToolExecutor(
  inner: ToolExecutor,
  logger: AgentConversationLogger,
  context: { taskId: string },
): ToolExecutor
```

- `execute(call, signal)`：记录 `tool_call`（name、arguments 截断）→ 执行 → 记录结果（success、output 截断、error、durationMs）
- `listTools()`：原样转发

#### 2.2.4 AgentCore 事件订阅（修改 `src/lib/agent/AgentCore.ts`）

在 `AgentCore` 上新增最小事件订阅 API（不改状态机逻辑）：

```ts
type AgentEventHandler = (event: AgentCoreEvents) => void;
on(handler: AgentEventHandler): () => void;   // 返回取消订阅函数
```

- `emit()` 在现有逻辑基础上，把事件分发给所有订阅者（`console.debug` 逻辑保留，仍受 `verbose` 控制）
- 这样编排器可订阅 `state_change` / `task_start` / `task_complete` / `task_error` / `token_warning` / `step_complete` 并写入 logger，无需侵入状态机

#### 2.2.5 编排器接线（修改 `src/lib/multi-agent/orchestrator.ts`）

在 `executePhase()` 内：

1. `const debugLogger = getAgentDebugLogger()`（模块级单例，见下）
2. `beginSession(task.id, { phase: phase.name, role: phase.role, jobId: task.jobId })`
3. 包装 provider：`createLoggingLLMProvider(provider, debugLogger, { taskId, phase, role })`
4. 包装 toolExecutor：`createLoggingToolExecutor(toolExecutor, debugLogger, { taskId })`
5. `agent.on((e) => logger.append(task.id, toEntry(e)))` 订阅事件
6. `evaluateGate` 的评估调用同样走包装后的 provider，质量评分一并入日志

#### 2.2.6 单例与开关（新增 `src/lib/agent/debug/index.ts`）

```ts
export function getAgentDebugLogger(): AgentConversationLogger; // 全局单例
export function isDebugEnabled(): boolean; // NODE_ENV !== 'production' || AGENT_DEBUG=1
```

- 默认内存记录始终开启；JSONL 落盘需显式 `AGENT_DEBUG_FILE=1`
- 生产环境（`NODE_ENV=production` 且无 `AGENT_DEBUG=1`）下包装器直接透传、不收集，零开销

#### 2.2.7 查询 API（新增 `src/app/api/debug/agent-logs/route.ts`）

- `GET /api/debug/agent-logs`：列出全部会话摘要（taskId、phase、role、条目数、起止时间）
- `GET /api/debug/agent-logs?taskId=<id>`：返回单个会话的完整条目
- `DELETE /api/debug/agent-logs`：清空内存日志
- 响应统一 `{ sessions: [...] }` / `{ session: {...} }`

## 3. 实施计划

| 步骤 | 内容 | 交付 |
|---|---|---|
| M1 | `conversation-logger.ts` + `debug/index.ts`（核心日志器、单例、开关） | 类型 + 类 + 单例 |
| M2 | `logging-llm-provider.ts` + `logging-tool-executor.ts` + AgentCore 事件订阅 | 两个包装器 + `on()` |
| M3 | 编排器接线 + API 端点 | 全链路可查 |
| M4 | 单元测试 | 58 + 新增 ≥ 12 全绿 |

## 4. 测试计划

- `conversation-logger.test.ts`：会话创建/追加/环形缓冲/截断/clear/单例
- `logging-llm-provider.test.ts`：chat 记录请求与响应、流式聚合、参数透传
- `logging-tool-executor.test.ts`：工具调用记录、异常路径、listTools 透传
- 回归：现有 58 个测试 + `tsc --noEmit` + `next build` + `npm run lint` 全绿

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 日志体积过大（剧本正文长） | `truncateText` 默认截断 2000 字符，环形缓冲上限 500 条/会话 |
| 生产环境性能损耗 | 包装器仅在 `isDebugEnabled()` 时收集，生产默认纯透传 |
| JSONL 并发写同一文件 | 按 taskId 独立文件 + 同步 append（Node fs.appendFileSync 原子性可接受） |
| 状态机语义被改动 | AgentCore 仅新增 `on()`，不改任何状态转移/记忆逻辑 |
