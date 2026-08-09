## 概要

P-记忆落地：**MultiAgentOrchestrator 任务持久化**。Agent 编排任务（含人工介入挂起 awaiting 的任务）落盘 SQLite，服务重启后自动恢复，未完成任务续跑——补齐"任务状态全部在内存、重启即丢"的缺口，并与既有数据隔离/鉴权（p1-4）对齐。

## 背景

`orchestrator.tasks` 为纯内存 `Map`：任务创建、阶段产物、质量关卡结果、人工介入挂起（`awaiting`）全部随进程消亡。服务重启后：

- 挂起等待人工介入的任务直接消失（最严重的丢失场景）
- 执行中的任务阶段产物丢失，无法续跑
- 无法查询任务历史终态

SQLite 层已有成熟的 repository 模式与 `schema_version` 迁移机制，直接复用。

## 改动

### 表结构与 Repository
- [schema.sql](apps/screenplay/src/lib/store/sqlite/schema.sql)：v4 新增 `agent_tasks` 表（`id` 主键 / `status` active|completed|failed / `user_id` 归属列，对齐 p1-4 隔离 / `task_json` OrchestratorTask 全量 / 时间戳）+ 索引
- 新增 [agent-task-repository.ts](apps/screenplay/src/lib/store/sqlite/agent-task-repository.ts)：`upsert`（全量覆盖）/ `get` / `loadActive`（未完成，按创建时间升序）/ `delete`，JSON 往返还原任务状态机
- [sqlite/index.ts](apps/screenplay/src/lib/store/sqlite/index.ts)：导出 `getAgentTaskRepository`

### Orchestrator 接入
- [orchestrator.ts](apps/screenplay/src/lib/multi-agent/orchestrator.ts)：
  - 新增 `AgentTaskPersistence` 适配器接口（可注入，未注入则纯内存运行，现有行为不变）
  - 落库时机：任务创建（active）、阶段终态变更（completed / awaiting / skipped / failed）、重试计数、`resolveManualReview` 清除挂起、任务终态标记（completed / failed）
  - 新增 `restoreFromPersistence()`：服务重启恢复未完成任务——**awaiting 挂起任务保持挂起等待人工介入（不自动续跑）**；崩溃遗留的 `running` 阶段置回 `pending` 并自动续跑
- [orchestrator-singleton.ts](apps/screenplay/src/lib/multi-agent/orchestrator-singleton.ts)：注入 SQLite 持久化，单例初始化时自动恢复

### 其他
- 修复 [benchmark.test.ts](apps/screenplay/src/lib/eval/__tests__/benchmark.test.ts) typecheck 报错（P-评估遗留：`analytics` 可选字段判空），使全仓 typecheck 通过

## 验证

- typecheck ✓ · 全量单测 ✓（新增 [agent-task-repository.test.ts](apps/screenplay/src/lib/store/sqlite/agent-task-repository.test.ts) 6 例 + [orchestrator-persistence.test.ts](apps/screenplay/src/lib/multi-agent/orchestrator-persistence.test.ts) 8 例：落库快照 / 终态标记 / 恢复挂起不续跑 / 恢复后可人工介入完成 / 崩溃 running 续跑 / 无 persistence no-op）
- E2E（真实 dev 环境 + 真实 SQLite）：
  1. 启动真实 Agent 任务 → `agent_tasks` 落库（status=active，phases=4）
  2. 注入"崩溃遗留 awaiting"任务 → **重启 dev server** → GET 查询：任务恢复且 `awaiting=true`、merge 阶段保持 `awaiting`（人工介入挂起不丢失）
  3. 重启后人工介入 `discard` 可用 → 终态 `failed` 落库
- 运行截图（pr-evidence/，不入库）：`pmem-restore-awaiting-task.png`（浏览器查询恢复的挂起任务：awaiting=true + merge 挂起 + 阶段状态条）
- 说明：E2E 依赖 Node 24（better-sqlite3 原生模块按 NODE_MODULE_VERSION 137 编译），重启 dev server 时使用 `E:\nvm\nodejs\node.exe` 与根 node_modules 的 next bin
