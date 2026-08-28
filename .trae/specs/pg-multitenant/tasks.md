# PostgreSQL 多租户迁移 - 任务分解

> 依赖：阶段① 完成（R1–R5 全绿）；仓库说明见 `spec.md`
> 任务顺序按可独立验证的最小增量排布；每个 Task 结束均可单独回归。

---

## Phase 0 · 决策确认（已完成）

- [x] **决策点 A**：采用 **A2 DbEngine 同步抽象（sync-facade）+ 轻量原位路由**——仓库留在 apps 层原位，仅把 `getDatabase()` 换成 `@novel/db` 的 `getEngine()`，避免反向依赖。A1（全量迁入 `packages/db/src/repo/`）列为后续可选演进。
- [x] **决策点 B**：**仅迁移脚本先行**——本阶段实现 PostgresEngine 代码 + SQLite→PG 迁移脚本 + 契约/参数化测试，不搭 PG 运行环境；真实 PG 联跑（R6）留待环境就绪。
- [x] **决策点 C**：**立即纳入 `pg`（node-postgres）依赖**（AGENTS guardrail「新增依赖 ask first」——已确认）。pg 用于实现 PostgresEngine 与编写/校验迁移脚本。

---

## Task 1 · packages/db 升级为存储适配层（同步语义，调用方零改动）

**目标**：把 9 个 repository + auth/session 的存储访问统一收敛到 `@novel/db` 引擎，接口保持同步，现有调用方（pipeline/orchestrator/route）不改。

### A2 轻量粒度（已执行 ✅）

- [x] 定义 `DbEngine` 同步接口（prepare.run/get/all + exec/applySchema/healthCheck/close，语义对齐 better-sqlite3 Statement）。
- [x] 新增 `sqlite-engine.ts`（packages/db/src/engine/）：适配注入的 better-sqlite3 到 DbEngine。
- [x] 新增 `engine-registry.ts`：`useEngine/useSqlite/resetEngine/getEngine/getStorageKind` 单例；`detectStorageKind`（`DATABASE_URL`→postgres，否则 sqlite）。
- [x] job codec 已由阶段① 迁入 `@novel/db`（`pipelineState` 契约不变）。
- [x] 逐一把 9 个 repository + session.ts 的 `getDatabase()` 原位换成 `getEngine()`（仓库不入库，原位路由）。
- [x] `apps/screenplay/src/lib/store/sqlite/index.ts` 薄 re-export `@novel/db` 的引擎符号，`@/lib/store/sqlite` import 面不破。
- [x] `@novel/db` 构建通过（prebuild 链含 db 包）。
- [x] vitest（39 文件/319 用例）/tsc/eslint 全绿，R1–R4 不回归；修复 `closeDatabase()` 未能清空 globalThis 连接缓存导致的引擎单例污染。

> 备注：T1 期间发现并修复 db.ts `closeDatabase()` 的缓存未清空 bug（模块级 `db` 变量从未持连接，原实现从不真正关闭/清空 globalThis 缓存的连接，导致测试间引擎单例残留）。

## Task 2 · PostgresEngine + schema.pg.sql + 引擎选择

**目标**：提供 PG 后端与 A1 sync-facade，`DATABASE_URL` 时启用。

- [x] 新增 `pg` 依赖（决策 C）。
- [x] 新增 `postgres-engine.ts`：pg `Pool` + sync-facade（worker + Atomics 同步桥），实现 `DbEngine`。
- [x] 新增 `schema.pg.ts`：列类型映射（JSON 列→TEXT、INTEGER→BIGINT、`'[]'` 默认→`'[]'` 字面量、INSERT OR IGNORE→ON CONFLICT DO NOTHING）。
- [x] 引擎选择：存在 `DATABASE_URL` → PG，否则 SQLite（`getEngine()` 单例按 env 探择，PG 健康检查通过才启用）。
- [x] `healthCheck()` 反映当前引擎；`.env.example` 增加 `DATABASE_URL` / `STORAGE_SYNC_MODE`。
- [x] PG 引擎在未配置连接时优雅回退 SQLite（不崩溃）。

> 实施：`postgres-engine.ts`（DbEngine 实现，委托 PgSyncRunner）/ `postgres-worker.worker.ts`（独立线程跑 pg，SharedArrayBuffer+Atomics 握手）/ `postgres-runner.ts`（主线程同步桥）/ `postgres-bridge-protocol.ts`（桥协议槽位）/ `schema-pg.ts`（PG schema）。registry 增加 `usePostgres/selectEngine/detectStorageKind`；app 侧 `db.ts registerEngine`：DATABASE_URL 存在且 PG 健康 → 启用 PG 并 applySchema，否则回退 SQLite。单测 `postgres-engine.test.ts` 11 例（fake runner 验证同步语义 + 选择/回退）。验证：vitest（含 db 包 18 例，screenplay 319 例）全绿、tsc/eslint 通过。

## Task 3 · 双后端 repository 语义对齐 + 参数化测试

**目标**：同一 repository 在两个引擎上行为一致，无隐蔽分歧。

- [x] 迁移关键单测为「参数化双跑」：`DATABASE_URL` 存在则跑 PG，否则只跑 SQLite。
- [x] 样本断言逐核对 JSON 列、事务、外键行为。
- [x] 隔离：PG 测试用独立 db 命名空间（DB 级隔离），与 SQLite 的 `data-test` 并行。

## Task 4 · SQLite → Postgres 数据迁移脚本

**目标**：一次性旁路搬移，带双向校验。

- [x] `packages/db/scripts/migrate-sqlite-to-pg.mjs`：按外键顺序搬移 users→sessions→novels→jobs→projects→history→dramas→agent_tasks→user_llm。
- [x] 每个 repository 行数 + 关键列抽验一致。
- [x] 旁路脚本不入库（工作流约定），迁移前可备份。

## Task 5 · 环境与文档落地

- [x] `docs/项目框架.md` 更新 PG/多后端说明。
- [x] CI（`.github/workflows/ci.yml`）可选：有 service 配置则多跑 PG 测试空间；保守则维持 SQLite 单跑 + 说明。
- [x] 运行方式文档：`DATABASE_URL` 用法 + 迁移脚本用法。

## Task 6 · 回归 R1–R6

- [x] R1 vitest 全量（含双引擎对应空间）
- [x] R2 tsc --noEmit
- [x] R3 eslint src
- [x] R4 prebuild 链（contracts/auth/db）
- [x] R5 全链路 e2e（novel→screenplay→drama）在 SQLite 跑
- [x] R6 全链路 e2e 在 Postgres 跑（若环境已配 DATABASE_URL）——无 DATABASE_URL 跳过（决策 B）