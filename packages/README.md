# Shared Packages (P1)

P1 阶段抽取的共享层，供各业务模块复用：

- `@novel/contracts` — Zod 数据契约（novel / screenplay / drama）
- `@novel/db` — SQLite 访问层
- `@novel/auth` — 认证与会话
- `@novel/agents` — Agent 编排
- `@novel/ui` — 设计系统组件

各包在后续阶段逐一落地（见 `short-drama-plan/short-drama-plan.html` 的 P1 定义）。
