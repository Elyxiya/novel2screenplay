# 任务清单 — 架构基座（阶段①）· 依赖图

北极星：解除 C2/C3 反依赖 + 收敛双执行系统为单一主线，为后续阶段铺地基。仅做三件事，不动 UI/SSE/数据表/多用户。

## 阶段① · 架构基座

- [x] Task 0: 双执行系统收敛（死代码清理）
  - [x] 删除 `src/lib/jobs/job-queue.ts`、`worker.ts`
  - [x] 精简 `src/lib/jobs/index.ts` 导出
  - [x] `git grep` 验证无残留引用
  - [x] 核实 `PipelineJob/PipelinePhase` 在 executor/flow-evaluator 的存活引用

- [x] Task 1: 抽 `@novel/db` 包 + 契约化 job 存储（解 C2）
  - [x] contracts 新增 `pipeline.ts`（Phase1/2/3Output）+ 导出
  - [x] 新建 `packages/db/`（job 存取层 + 单测）
  - [x] `job-store.ts` pipelineState 改用 `@novel/contracts/pipeline` 契约类型，移除 `../pipeline/*` import
  - [x] 保持数据表 / JSON 结构不变，零迁移

- [x] Task 2: builtin-tools 下沉为通用（解 C3）
  - [x] `builtin-tools.ts` 移除 pipeline 实现直接 import
  - [x] 引入 `BuiltinToolDeps` 依赖注入，② 业务侧装配
  - [x] pipeline/cancel、analysis.*、conversion.merge handler 改走 deps
  - [x] 工具注册 + Agent 编排测试绿

## 回归验证

- [x] R1. vitest 全量
- [x] R2. tsc --noEmit
- [x] R3. eslint src
- [x] R4. prebuild 链（contracts/auth/db）
- [ ] R5. P0 全链路 e2e 回归

# Task Dependencies

- Task 0（收敛）独立，可先行。
- Task 1（@novel/db）依赖 Task 0 清理干净引用后再动 jobs 目录；contracts 加契约可先做。
- Task 2（builtin-tools）依赖 Task 1 的契约化（job-store/存储不再泄漏 pipeline 类型），避免同时改存储两处。
- 三任务完成后统一跑 R1–R5 回归。