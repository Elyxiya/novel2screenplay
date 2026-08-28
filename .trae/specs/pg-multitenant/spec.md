# PostgreSQL 多租户迁移（阶段②）

> 版本：v0.1.0 ｜ 编制日期：2026-08-27 ｜ 前置：架构基座（阶段①）已完成并全绿（R1–R5）
> 目标：在**保留 user_id 行级隔离**的前提下，把存储层从「仅 SQLite」升级为「PostgreSQL 为主 + SQLite 回退」双后端，为多租户生产部署铺平地基。

---

## 1. 背景与动机

### 1.1 现状（已核实）

- 存储底座为 **better-sqlite3**（单机、**同步 API**），`getDatabase()` 在 `src/lib/store/sqlite/db.ts` 维护单例。
- **9 层访问**全部直接调 `getDatabase().prepare(...)`（同步）：
  - 8 个 repository：`job / novel / writer-novel / project / history / drama / user / user-llm / agent-task`（其中 agent-task + user-llm 亦在列）。
  - `lib/auth/session.ts`：sessions 表直连。
- 多租户现状：**统一单库 + `user_id` 列行级隔离**，repository 的 `list(...)` 传入 `userId` 过滤；`dramas/jobs/novels/history/agent_tasks/user_llm` 均带 `user_id`。
- `@novel/db` 契约包（阶段① 建立）目前仅承载 `pipelineState` JSON codec，**尚未承载 CRUD 存取层**。

### 1.2 核心难点（迁移的关键约束）

| # | 矛盾 | 影响 |
|---|------|------|
| D1 | better-sqlite3 **同步** vs pg **异步** | 上游调用方（pipeline engine、orchestrator 状态机、executor）是**同步**执行链，直接 await 会连带大批改动 |
| D2 | 数据搬移 | SQLite → Postgres 需 schema 转换 + 存量数据导入，且要保证 `pipeline_state` / 各类 JSON 列语义一致 |
| D3 | schema_version 迁移体系 | 现模型靠 `schema.sql` 建表 + `migrate*` 幂等 ALTER 补齐列，pg 无 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 的等同机制（有 `DO $$` 但笨重） |
| D4 | 双后端一致性 | 需同一套 repository 语义在两个引擎上结果一致，且测试不出歧义 |

### 1.3 决策（已与用户对齐）

1. **租户模型**：保留 `user_id` 行级隔离（不引入显式 tenant 实体）。
2. **数据库策略**：**PostgreSQL 为主 + SQLite 回退**——有 `DATABASE_URL` 则用 Postgres，否则回退 SQLite（本地默认零配置）。
3. **运行环境**：**先出方案**，再定 Docker/CI/托管细节。

### 1.4 范围控制

本阶段聚焦「存储层多后端 + 数据可迁移 + 回退无缝」：

1. 建立**存储适配层**：`packages/db` 升级为承载全部 CRUD 的 repository 实现，暴露与现有 `JobRepository/NovelRepository/...` 一致的**同步接口**（保持调用方与 pipeline/orchestrator 零改动）。
2. 提供 **Sqlite 后端（现行实现迁入）** 与 **Postgres 后端（新增 `pg` 驱动）** 双实现，由环境变量选择单例。
3. 提供 **SQLite → Postgres 数据迁移脚本**（schema 生成 + 数据导入），保留回退能力。

**不做**：不做显式 tenant、不做 PG 特有高级特性（ROWLEVEL/Schema-per-tenant）、不拆 ui/agents 包。

---

## 2. 方案设计

### 2.1 存储适配层架构

```
packages/db/src/
  index.ts               # 公开：getEngine() 单例 + 各 Repository 工厂 + StorageKind 探测
  engine/
    storage-engine.ts    # DbEngine 接口（prepare-run/get/all...，统一同步语义）
    sqlite-engine.ts     # SQLite 实现（better-sqlite3，现行逻辑迁入）
    postgres-engine.ts   # PG 实现（pg Pool，同步 facade 包装异步）
  repo/
    job-repo.ts          # JobRepository（引擎无关，SQL 方言差异经 engine 适配器收敛）
    novel-repo.ts
    ...（对齐现有 9 个 repository 接口）
  job-pipeline-codec.ts  # 从现 job.ts 迁来（契约 codec 保留）
```

**关键解耦**：`DbEngine` 定义**同步**能力（`run/get/all/transaction`），调用方（pipeline/orchestrator）保持同步、零感知。
- `SqliteEngine`：直接透传 better-sqlite3（本就同步）。
- `PostgresEngine`：内部用 `pg` Pool，对外**同步 facade**，规避 D1（详见 §2.2）。

> 现状核实（阶段② 调研）：同步链贯穿 `jobStore` → 9 个 repository → better-sqlite3，pipeline/orchestrator 在热路径**同步**调 `jobStore.update()`。全链路异步化代价极大，故确定采用同步抽象。

### 2.2 异步→同步 facade（决策已定：A1 同步抽象）

业务核心是同步状态机，为不炸全链路，确定实现 `DbEngine` 同步接口，提供两个后端实现：

- **SQLite 后端**：better-sqlite3 天然同步，直接透传。
- **Postgres 后端（同步适配，工程做法）**：Node 无纯同步网络驱动。采用**「单飞连接队列 + 预取」**——
  - 内部维护一个持久的 `pg` Pool；
  - 对每个 `run/get/all/transaction` 调用，通过一个**带互斥锁的串行 Promise 队列**发出真实异步请求，并以同步语义等待其完成（由于主流程按任务串行驱动，单表请求可视为串行）；
  - 对高频读（如 jobStore.fetch）可选**预取/缓存**减少等待。
  - 代价：请求串行化；本应用以 API→单任务流为主，可接受。
- **`STORAGE_SYNC_MODE`** 保留环境量：`sync-facade`（默认，本方案）已落地；`async-native`（A2）列为**长期演进项**，本阶段不做。

> 同步适配实现需在一个独立小模块内保持严格单飞，避免并发死锁；此为保证 PG 后端正确性的关键，测试须覆盖「并发请求仍返回一致结果」。

### 2.3 引擎选择（decision point B）

- 启动时环境变量：`DATABASE_URL` 存在 → Postgres；否则 → SQLite（本地默认 `data/novel2screenplay.db`）。
- 探测健康：`healthCheck()` 反映当前引擎。
- schema：`getEngine().applySchema()` 按引擎分发：
  - SQLite：沿用 `schema.sql`。
  - Postgres：新增 `schema.pg.sql`（列类型映射：INTEGER→BIGINT/INT、TEXT→TEXT、JSON 列→JSONB/TEXT、`'[]'` 默认 → PG 用 `'[]'::jsonb` 或 TEXT）。`pipeline_state` 等 JSON 语义对齐由 job-pipeline-codec 保证，落库序列化格式不变。

### 2.4 数据迁移（SQLite → Postgres）

新增 `scripts/e2e/`（不入库）或 `packages/db/scripts/migrate-sqlite-to-pg.mjs`：

1. 读 SQLite（better-sqlite3，Node 24）。
2. 生成 PG schema（connection 串）。
3. 逐表搬移：`users → sessions → novels → jobs → projects → history → dramas → agent_tasks → user_llm`（按外键顺序）。
4. 对每个 repository 抽样比对行数 + 关键列，校验一致。
5. 迁移仅作为**一次性旁路脚本**，不改运行时路径；可在迁移后切 `DATABASE_URL` 验证。

### 2.5 测试策略

- 单测：repository 单测**双跑**（先 SQLite 现测，再加参数化跑 PG 若有 `DATABASE_URL`，未配则只跑 SQLite）。
- 隔离：Vitest `DB_DIR=data-test`（对 SQLite）；PG 测试用独立 db 空间。
- 回归：R1–R5 全绿要求不变量：现有 `vitest 314` 单测在不同存储下语义一致。

---

## 3. 任务分解（概要，详见 tasks.md）

- **Task 1**：`packages/db` 升级为存储适配层（DbEngine 接口 + SqliteEngine 迁入 + 契约 codec 迁入），job/novel/history/drama 等 repository 迁入包内，`apps/screenplay` 侧改从包获取。
- **Task 2**：新增 `PostgresEngine`（pg 驱动）+ `schema.pg.sql` + 引擎选择 + `sync-facade`。
- **Task 3**：双后端 repository 语义对齐 + 参数化测试（含 PG 空间）。
- **Task 4**：SQLite→PG 数据迁移脚本 + 双向校验。
- **Task 5**：环境（DATABASE_URL）、CI/本地测试策略、`docs/项目框架.md` 落地。
- **Task 6**：回归 R1–R6（vitest/tsc/eslint/prebuild + 全链路 e2e 在 SQLite 与 PG 各跑一次）。

## 4. 风险与缓解

| 风险 | 缓解 |
|------|------|
| sync-facade 串行化性能 | 本应用单任务流为主；A2 异步原生为长期解 |
| PG JSON 列语义漂移 | 全部 JSON 列按 codec 序列化为 TEXT/JSONB，代码层保证不变 |
| 迁移破坏存量 | 迁移为旁路脚本 + 行数比对 + 可在迁移前备份 |
| 双后端隐藏不一致 | 关键单测在双引擎跑，语义断言明确 |
| 依赖新增（pg） | 已列 guardrail 需 ask——本方案即该确认 |

## 5. 产出物清单

- `packages/db`（适配层 + 双引擎 + repository 迁入）
- `schema.pg.sql`
- `packages/db/scripts/migrate-sqlite-to-pg.mjs`
- `.env.example` 增加 `DATABASE_URL` / `STORAGE_SYNC_MODE`
- `docs/项目框架.md` 更新