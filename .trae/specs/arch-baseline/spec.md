# 架构基座：双执行系统收敛 + 契约化存储（阶段①）

> 版本：v0.1.0 ｜ 编制日期：2026-08-27 ｜ 前置：P0 全链路已交付（mvp-fullchain-impl 全绿）
> 目标：解决产品线归属清单 §5 的 C2/C3 反依赖 + 项目框架"已知限制"中的"双套执行系统并存"，为后续分镜导出/批量化、PostgreSQL/多租户、评测闭环铺平地基。

---

## 1. 背景与动机

### 1.1 三个已确认的架构债

| # | 位置 | 现状 | 影响 |
|---|------|------|------|
| 双执行 | `src/lib/jobs/`（job-queue/worker）vs `src/lib/pipeline/`（PipelineEngine） | 主链路走 PipelineEngine；`lib/jobs/` 队列/worker **已无任何消费方**，仅 `types.ts` 被 executor/flow-evaluator/快照复用（见 §1.2） | 重复的进度/日志/事件模型，误导后续维护者；阻塞 PostgreSQL 迁移（两套状态需对齐） |
| C2 | `src/lib/store/job-store.ts` L12-14、L50-57 | 反向 import `Phase1Output/Phase2Output/Phase3Output`；`StoredJob.pipelineState` 持有 pipeline 内部输出类型 | ②（改编线）内部类型泄漏到共享底座，后续抽 `@novel/db` 无法打包 |
| C3 | `src/lib/tools/builtin-tools.ts` L11-14、L21-56、L130-148、L209-220 | 工具层直接实例化 `PipelineEngine/Phase1Analyzer/Phase4Merger/ContextManager` | 共享工具层反向依赖 ② 实现，工具下沉为通用受阻 |

### 1.2 `lib/jobs/` 消费方盘点（已核实）

- `@/lib/jobs/screenplay-snapshot`（快照，P0 已接入）——保留，属共享底座。
- `@/lib/jobs/types` 被 **pipeline/executor、flow-evaluator** 复用 `PipelineJob` 等类型——保留类型定义。
- `job-queue.ts`、`worker.ts` —— **零消费方**，删除候选。

### 1.3 范围控制

本阶段**只做三件事**，不做多用户 PostgreSQL、不抽 ui/agents 包（后置阶段）：

1. 删除 `lib/jobs/` 的死代码（job-queue/worker/未用导出），收敛执行系统为 PipelineEngine 单主线。
2. 抽出 `@novel/db` 包（SQLite 存取层），把 `job-store.ts` 的 pipeline 反向类型依赖收敛为契约类型，解除 C2。
3. 把 `builtin-tools.ts` 的 pipeline 实现依赖改为"业务回调注入"，解除 C3。

---

## 2. 方案设计

### 2.1 任务 T1：删除死代码，收敛单一执行主线

- 删除 `src/lib/jobs/job-queue.ts`、`src/lib/jobs/worker.ts`。
- 精简 `src/lib/jobs/index.ts`：仅导出 `types`、`screenplay-snapshot`，去掉 `job-queue/worker` 与 `pipeline/executor` 再导出（executor 由 `lib/pipeline/executor` 自身提供，避免二义）。
- 全面 grep 确认 `jobStore` 内存队列的 `createPipelineJob/canRetry/isCompleted` 仅被 executor 消费的情况下保留在 `types.ts`（归属 ② 契约），否则一并清理。
- 核对 `PipelineJob/PipelinePhase` 类型在 executor/flow-evaluator 的引用，确认无死引用。

**验收**：`git grep -l "lib/jobs/worker\|lib/jobs/job-queue"` 无产物；`lib/jobs/index.ts` 只导出存活模块。

### 2.2 任务 T2：抽 `@novel/db` 包，解 C2（job-store 契约化）

**包结构**：新建 `packages/db/`

```
packages/db/
  package.json            # name: @novel/db
  tsconfig.json
  tsconfig.build.json
  src/
    index.ts              # 公开：Repository 工厂 + job 存取接口
    job.ts                # Job 存取（由 job-repository 的 SQL 逻辑迁入）
    types.ts              # JobRecord / JobPipelineState（zod schema 化）
  src/__tests__/
    job.test.ts           # 存取层单测
```

**契约化关键点**：`StoredJob.pipelineState` 不再 import `Phase1Output/Phase2Output/Phase3Output`。改为 `@novel/contracts` 新增的中间产物契约：

```ts
// packages/contracts/src/pipeline.ts（新增）
export const Phase1OutputSchema = z.object({ characters: ..., locations: ..., /* 与 Phase1Analyzer 输出对齐 */ });
export type Phase1Output = z.infer<typeof Phase1OutputSchema>;
// Phase2Output / Phase3Output 同理
```

`job-store.ts` 改为 import `@novel/contracts/pipeline` 的 `PipelineJobState`（含 phase1/2/3 的契约类型），`pipelineState` 字段类型收敛为兼容序列化（JSON-safe）的契约形态。**数据表结构不变**（`pipelineState` 列仍存 JSON），仅类型来源变化，保证无数据迁移。

> 对齐方式：`Phase1Analyzer/Phase2Segmenter/Phase3SceneConverter` 导出类型改为「re-export 契约」或保持自身类型 + 契约做结构类型兼容（非严格 equal）。优先采用结构兼容，避免动 pipeline 内部实现逻辑。

**验收**：`job-store.ts` 不再 import `../pipeline/*`；`packages/db` 构建通过；`git grep "src/lib/pipeline.*from.*job-store"` 无反向泄漏；全部单测绿。

### 2.3 任务 T3：builtin-tools 下沉为通用，解 C3（业务回调注入）

- `src/lib/tools/builtin-tools.ts` 移除对 `PipelineEngine/Phase1Analyzer/Phase4Merger/ContextManager` 的直接 import。
- 引入**工具依赖注入**：`initializeBuiltinTools(getDeps)`，依赖对象由**业务侧（②）注入**：

```ts
export interface BuiltinToolDeps {
  startPipeline(input): Promise<{ jobId: string }>;
  merge(title, author, phase1, phase2, phase3s): Promise<{ screenplay; fixes }>;
  analyzeText(text): Promise<{ characters; locations; rawResponse }>; // 走 Phase1
}
```

`pipeline.start/cancel`、`analysis.characters/locations`、`conversion.merge` 的 handler 改为调用注入的 deps。
- **调用方接线**：在 `lib/agent` 或 orchestrator 装配处构造 deps（内部 new `PipelineEngine`/`Phase1Analyzer`），业务隔离在 ② 内部，工具层保持纯净。
- `pipeline.status/cancel`、`storage.history/result` 依赖 `jobStore`/repo——这些属存储，保留（契约化后无 pipeline 类型泄漏）。

**验收**：`builtin-tools.ts` 无 `pipeline/` 直接 import；工具注册与 Agent 编排测试绿；`docker-build + lint` 通过。

---

## 3. 边界与新契约

### 3.1 依赖方向（本阶段后）

```
L2 ② 改编线（lib/pipeline / job-store / builtin-tools 的 deps 注入点）
      │ 依赖
      ▼
L0 共享底座：@novel/db（SQLite 存取） · @novel/contracts（screenplay/pipeline 契约）
      │ 不再反向依赖 ② pipeline 内部类型
```

- job-store 属共享底座，其 `StoredJob` 类型依赖 `@novel/contracts`（screenplay + 新增 pipeline），不再依赖 `lib/pipeline/*`。
- builtin-tools 属共享底座，不再 import pipeline 实现，由 ② 业务侧注入 deps。

### 3.2 新增/变更契约（`@novel/contracts`）

- 新增 `src/pipeline.ts`：`Phase1Output/Phase2Output/Phase3Output` schema + 类型。
- `screenplay.ts`：不变。
- `src/index.ts`：补充导出 `pipeline`。

### 3.3 不变项

- 数据表 schema / `pipelineState` JSON 存储结构：不变（零迁移）。
- UI 事件模型（SSE progress/phase/log）：不变。
- 用户可见行为：不变（纯重构，无功能增减）。

---

## 4. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| `Phase*Output` 结构与契约 schemazod 化后不完全一致 | tsc 结构兼容报错 | 优先结构兼容（不要求类型 equal）；字段以实际输出为准补全 schema |
| executor/flow-evaluator 依赖 `lib/jobs` 导出被误删 | 编译失败 | 只删`job-queue/worker`，保留 `types.ts`；`git grep` 全覆盖核对 |
| builtin-tools deps 注入点有遗漏装配 | 工具 handler 运行时 undefined | 装配处集中构造 deps；新增单测覆盖各工具 |
| 抽包改动 CI 构建顺序 | 构建失败 | 预构建链加入 `db` 包（仿 contracts/auth 的 prebuild） |

---

## 5. 工作量分解（Task→验证）

| 任务 | 主改动 | 验证 |
|------|--------|------|
| T1 死代码收敛 | jobs/ 目录删文件 + index 精简 | git grep 无残留；typecheck/test |
| T2 抽 @novel/db + 契约化 | contracts 加 pipeline.ts；db 包新建；job-store 改类型来源 | db 包测试；job-store 无反向 import |
| T3 builtin-tools 下沉 | 移 direct import；引入 deps 注入 | tool 测试；Agent 编排测试 |

总共 3 个任务、对应 3+ 组单测、1 次 fullchain 回归。