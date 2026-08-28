# Shared Packages (P1 + 架构基座)

当前实际抽取的共享包（npm workspaces）：

- `@novel/contracts` — Zod 数据契约（novel / screenplay / drama / pipeline）+ 序列化器
- `@novel/db` — 共享存取层：`DbEngine` 双后端抽象（SQLite better-sqlite3 / PostgreSQL pg+Atomics 同步桥）、job 状态 codec、`engine-registry`、schema-pg、SQLite→PG 迁移脚本（`scripts/migrate-sqlite-to-pg.mjs`）

规划中尚未抽取（逻辑目前在应用内，后续按需拆包）：

- `@novel/auth` — 认证与会话（当前在 `apps/screenplay/src/lib/auth`；`packages/auth/` 目录仅剩历史编译产物）
- `@novel/agents` — Agent 编排（当前在 `apps/screenplay/src/lib/agent`、`multi-agent`）
- `@novel/ui` — 设计系统组件（当前在 `apps/screenplay/src/components`）

抽取优先级参考 `docs/产品线归属清单.md` 的耦合点 C2/C3（已由 `@novel/db` 与 builtin-tools 注入解决）。
