# Task 4.2b 桥接数据链验证与互转层（备证记录）

> 阶段：conversion-quality-engineering（Task 4 · 外科式 supervisor）
> 日期：2026-08-29 ｜ 关联 spec：`spec.md §2.6` / tasks：`4.2b`
> 状态：✅ 已核实并补互转层

## 1. 目的

spec §2.6 要求：Task 4 开工前先核实「`task.jobId → StoredJob.pipelineState`」桥接数据链真实存在且格式可用；若 agent 产物从不写经典 pipelineState，则补「agent 产物 ↔ pipelineState 格式互转」层并记录备证。此条与其余"已核实"决策同样必须有出处。

## 2. 验证方法

验证脚本（只读，不入库）：`scripts/verify-bridge-chain.mjs`

- 读 `agent_tasks` 表最近 10 条任务 → 解析 `task_json` → 检查 `OrchestratorTask.jobId` 字段是否存在/被填充
- 读 `jobs` 表最近 15 条任务 → 解析 `pipeline_state` → 用 `@novel/contracts PipelineJobStateSchema`（zod）校验结构 → 检查可重转关键字段（phase1 characters/locations + phase2 scenes + phase3 content）
- 可选：设 `DATABASE_URL` 时同时核验 PG 后端

运行命令（better-sqlite3 按 Node 24 编译）：

```
& "E:\nvm\nodejs\node.exe" scripts/verify-bridge-chain.mjs
```

## 3. 实证结果（SQLite，dev 库）

### 3.1 agent 任务侧 —— 桥接缺失

| 维度 | 结果 |
|---|---|
| agent 任务样本 | 10 条（completed 7 / active 2 / failed 1） |
| 携带 `jobId` 字段 | **0 / 10**（`hasJobIdField: false` 全部） |
| 状态示例 | `analyze=completed, segment=completed, convert=completed, merge=completed` |

**结论：agent 独立任务（`/api/agent/start` → `startConversion()`）从不填充 `jobId`，从不创建经典 job、从不写经典 pipelineState。** agent 产物只走 `agent_tasks` 表自有持久化（`OrchestratorTask` 全量 JSON），与 `jobs` 表完全分离。

代码侧交叉验证（与运行实证一致）：

- [orchestrator.ts](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/multi-agent/orchestrator.ts) `startConversion()` 创建 task 时不设置 `jobId`
- `/api/agent/start` 请求体仅收 `novelText/title/author/instruction/userId`，无 jobId 入口
- `finalizeTask()` 中 `if (task.jobId) { jobStore.update(...) }` 分支因 jobId 恒 undefined **从不执行**

### 3.2 经典 job 侧 —— 目标格式可用

| 维度 | 结果 |
|---|---|
| 经典 job 样本 | 5 条（status=completed） |
| pipelineState 通过 `PipelineJobStateSchema`（zod） | **5 / 5** |
| 含 phase1+phase2+phase3 全链路 | 3 / 5 |
| 可重转（phase1 chars/locs + phase2 scenes>0 + phase3 content） | 3 / 5 |
| 样本示例 | `job_1787929496482_jv3d8e`：chars 4 / locs 4 / scenes 1 / converted 1 / quality 71 |

**结论：经典 `StoredJob.pipelineState` 格式完整可用**（`phase1Output` / `phase2Output` / `phase3Output` / `phase4Output` / `qualityAssessment`），通过契约 zod 校验，具备 Task 4.3 重转所需的全部输入。

> PG 后端复跑说明：本机 Docker 容器 `n2s-pg` 当前未运行，PG 分支为可选路径（设 `DATABASE_URL` 后脚本自动核验）。PG 数据自 R6b 由 SQLite 迁移，结构与 SQLite 一致，结论不因后端而异。

## 4. 结论

**桥接数据链缺失（已实证）**：agent 任务无 jobId → 无经典 pipelineState 可读 → 需补互转层。spec §2.6 前提由此获得出处。

## 5. 互转层（本次补建）

新文件：`apps/screenplay/src/lib/multi-agent/agent-pipeline-bridge.ts`

| 函数 | 方向 | 职责 |
|---|---|---|
| `resolvePipelineState(task, readJob?)` | 统一入口 | 4.3 桥接器入口：`task.jobId` 指向存在的经典 job → 直接返回其 pipelineState（真实经典产物）；无 jobId / job 不存在 → 回退从 agent 任务产物正向互转；两者皆无 → `unavailable` |
| `orchestratorTaskToPipelineState(task)` | agent → 经典 | 从已完成 phase 的 `agentResult` 提取角色/地点（analyze）、场景边界（segment）、已转换场景（convert）。结构化 JSON 优先（zod 校验），文本启发式兜底（标注行提取 + slugline 场景块切分）；无法结构化部分产空数组（不造假），输出保证通过 `PipelineJobStateSchema` |
| `hasReconvertibleState(state)` | 判定 | phase1 有实体 + phase2 有场景边界 → 可重转 |
| `pipelineStateToAgentContext(state)` | 经典 → agent | 渲染角色/地点/场景/剧本统计成监督上下文，供 4.4 supervisor 监督经典 job 用 |

单测：`apps/screenplay/src/__tests__/agent-pipeline-bridge.test.ts`（11 例：优先读经典 job / job 缺失回退 agent / 无 jobId 转换 / unavailable / 文本启发式 / JSON 通道 / 空结构不造假 / hasReconvertibleState / 监督上下文渲染）。

## 6. 回归数字（本次改动后全量）

| 命令 | 结果 |
|---|---|
| `npx vitest run src/__tests__/agent-pipeline-bridge.test.ts` | 11/11 通过 |
| `npm test`（三包全量） | **509 例全绿**：screenplay 46 文件/440 + contracts 4/37 + db 4/32 |
| `tsc --noEmit`（apps/screenplay） | 通过 |
| `eslint`（新增 2 文件） | 通过 |

## 7. 遗留与后续

- 4.3 桥接器将消费 `resolvePipelineState`：当 agent 任务**关联到真实经典 job** 时（未来入口：job 完成后启动 supervisor 并传 jobId），直接复用经典产物重转；独立 agent 任务则走正向互转兜底。
- 4.2/4.4 决策层与 supervisor 接入后，`pipelineStateToAgentContext` 作为监督输入。
- PG 复跑备证：容器启动 + `DATABASE_URL` 后重跑 `scripts/verify-bridge-chain.mjs` 即可。
