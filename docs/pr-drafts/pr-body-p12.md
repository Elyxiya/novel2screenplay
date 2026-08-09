## 概要

p1-2 双执行系统收敛，落实 D6：**保留 `PipelineEngine + jobStore`（SQLite）为主链路，`src/lib/jobs/` 内存队列系统标记为预留、不新增依赖。**

## 背景

改造前两套执行系统并存：主链路（`/api/pipeline/start` + SQLite）是唯一真实执行通道；内存队列（`/api/jobs` + worker）为"无消费者的壳"——worker 从未启动、`JobListPanel`/`ProgressTracker` 零页面引用、`/api/jobs` POST 无调用方。且 `PipelineExecutor` 忽略了 `startJob` 返回的 SQLite jobId，队列 job 的 `output` 恒为 undefined（结构性错位）。

## 改动

### 收敛（移除无消费方暴露面）
- 删除 `/api/jobs` POST/GET（内存队列创建/列表，无调用方）
- 删除 `/api/jobs/[id]/events`（内存队列 SSE，唯一消费方为死组件 ProgressTracker）
- `/api/jobs/[id]` 仅保留 DELETE（历史页实际使用，纯 SQLite + 归属校验）；GET 随死组件移除（现返回 405）
- 删除死组件 `JobListPanel.tsx` / `ProgressTracker.tsx`；`QuickStats` 独立为 `components/QuickStats.tsx`

### 数据源收敛
- `QuickStats`（upload 页）数据源从内存队列 `/api/jobs` 改为 SQLite `/api/jobs/history`

### 库层标记预留（D6）
- `src/lib/jobs/index.ts` / `job-queue.ts` / `worker.ts` / `types.ts` 头部标注预留与共享类型说明，不删代码（types 被 executor/flow-evaluator 复用）

### 结构性错位修复
- `executor.ts`：`execute()` 捕获并返回 `startJob` 的 SQLite jobId（`ExecuteResult.jobId`）
- `worker.ts`：执行成功后将 SQLite jobId 关联写入队列 job 的 `metadata.pipelineJobId`

## 验证

- typecheck ✓ · 单测 23 文件 / 169 用例全绿 ✓
- E2E `e2e-unify-jobs.mjs`（新增）：12 项全绿 —— `/api/jobs` POST/GET/events → 404、GET `/api/jobs/[id]` → 405、`/api/jobs/history` 需登录、`/api/pipeline/start` 主链路正常、DELETE 归属/404 校验
- E2E `e2e-isolation.mjs`（更新回归）：16 项全绿 —— 多用户隔离在收敛后行为不变
- 运行截图（pr-evidence/，不入库）：`p12-upload-quickstats.png`（QuickStats 走 SQLite）、`p12-history-sqlite.png`（历史页正常）
