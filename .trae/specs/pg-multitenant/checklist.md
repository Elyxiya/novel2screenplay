# PostgreSQL 多租户迁移 - 完成清单

## Phase 0 · 决策确认
- [x] 决策 A：A2 DbEngine 同步抽象（sync-facade）+ 轻量原位路由（仓库原位换 getEngine，避免反向依赖）
- [x] 决策 B：仅迁移脚本先行（实现 PG 后端 + 迁移脚本 + 契约/参数化测试，不搭 PG 环境；R6 留待环境就绪）
- [x] 决策 C：立即纳入 pg（node-postgres）依赖

## Task 1 · packages/db 升级为存储适配层
- [x] T1-C1. `DbEngine` 同步接口（prepare.run/get/all + exec + healthCheck）
- [x] T1-C2. `sqlite-engine.ts`（适配注入的 better-sqlite3）
- [x] T1-C3. job codec 已迁 `@novel/db`（阶段①遗留契约）
- [x] T1-C4. 9 个 repository + session.ts 原位把 `getDatabase()` 换成 `getEngine()`（A2 轻量路由，不入库）
- [x] T1-C5. `auth/session.ts` 走 `getEngine()`
- [x] T1-C6. `apps/.../store/sqlite/index.ts` 薄 re-export 引擎符号，import 面不破
- [x] T1-C7. db 构建通过；vitest（39/319）/tsc/eslint 全绿；修复 closeDatabase 缓存未清空

## Task 2 · PostgresEngine + schema.pg.sql + 引擎选择
- [x] T2-C1. `pg` 依赖已加
- [x] T2-C2. `postgres-engine.ts`（Pool + sync-facade）实现 DbEngine
- [x] T2-C3. `schema.pg.sql` 列类型映射正确
- [x] T2-C4. 引擎按 `DATABASE_URL` 选择；未配回退 SQLite
- [x] T2-C5. `healthCheck()` 反映引擎；.env.example 增加 `DATABASE_URL`/`STORAGE_SYNC_MODE`

## Task 3 · 双后端语义对齐 + 参数化测试
- [x] T3-C1. 关键单测参数化双跑（有 PG 则跑）
- [x] T3-C2. JSON 列/事务/外键行为逐核对
- [x] T3-C3. PG 用独立 db 命名空间隔离

## Task 4 · SQLite → PG 数据迁移脚本
- [x] T4-C1. 迁移脚本（外键序搬移）
- [x] T4-C2. 每表行数 + 关键列抽验
- [x] T4-C3. 旁路脚本不入库

## Task 5 · 环境与文档
- [x] T5-C1. `docs/项目框架.md` 更新
- [x] T5-C2. CI 可选 PG 空间；`DATABASE_URL`/迁移用法文档

## Task 6 · 回归
- [x] R1. vitest 全量
- [x] R2. tsc --noEmit
- [x] R3. eslint src
- [x] R4. prebuild 链
- [x] R5. 全链路 e2e（SQLite）
- [x] R6. 全链路 e2e（Postgres）——本机 Docker PG(16, :5433) + DATABASE_URL 已配好并跑通：R6a vitest 双后端全绿（42/386 + 4/37 + 4/32，含 [postgres] 契约分支）、R6b 迁移全量+双向校验通过、R6c e2e-p0-fullchain ALL OK（数据落 PG）