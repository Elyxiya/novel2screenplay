# Checklist — 架构基座（阶段①）

## 任务 T1 · 双执行系统收敛（死代码清理）
- [x] T1-C1. `src/lib/jobs/job-queue.ts`、`worker.ts` 已删除
- [x] T1-C2. `src/lib/jobs/index.ts` 仅导出 `types` + `screenplay-snapshot`，去掉 job-queue/worker 与 pipeline/executor 再导出
- [x] T1-C3. `git grep -l "lib/jobs/worker\|lib/jobs/job-queue"` 无产物（仅文档/规格文本提及）
- [x] T1-C4. typecheck / 全量单测绿（executor、flow-evaluator 类型引用完好）

## 任务 T2 · 抽 @novel/db 契约化（解 C2）
- [x] T2-C1. `packages/contracts/src/pipeline.ts` 新增 `Phase1Output/Phase2Output/Phase3Output` schema + 类型
- [x] T2-C2. `packages/contracts/src/index.ts` 补充导出 `pipeline`
- [x] T2-C3. `packages/db/` 包已建立，job 存取层迁入并有单测
- [x] T2-C4. `job-store.ts` 不再 `import ... from '../pipeline/*'`，pipelineState 改用契约类型
- [x] T2-C5. 数据库 schema / pipelineState JSON 结构不变（零数据迁移）
- [x] T2-C6. db 包构建通过；job-store 相关测试绿

## 任务 T3 · builtin-tools 下沉（解 C3）
- [x] T3-C1. `builtin-tools.ts` 移除 `PipelineEngine/Phase1Analyzer/Phase4Merger/ContextManager` 直接 import
- [x] T3-C2. 引入 `BuiltinToolDeps` 依赖注入，业务侧（②）装配并注入
- [x] T3-C3. `git grep` 确认 `builtin-tools.ts` 无 `pipeline/` import
- [x] T3-C4. 工具注册 + Agent 编排测试绿

## 回归
- [x] R1. vitest 全量通过
- [x] R2. tsc --noEmit 通过
- [x] R3. eslint src 通过
- [x] R4. contracts/auth/db 预构建链通过（CI 对齐）
- [x] R5. P0 全链路 e2e（novel→screenplay→drama）回归通过