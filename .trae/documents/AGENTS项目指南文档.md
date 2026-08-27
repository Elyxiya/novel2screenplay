# Plan: 依 AGENTS-EDITING-SPEC 重写根目录 AGENTS.md

## Summary
按用户提供的《AGENTS.md 编辑规范》(`C:\Users\ALXY\OneDrive\文档\Downloads\6a8fe9b269bf4da3c18efbb4_AGENTS-EDITING-SPEC.md`) 重写根目录 `e:\桌面\novel\novel2screenplay\AGENTS.md`。当前文件仅含自动注入的 Next.js 占位块，需扩展为给 Agent 看的英文操作手册，条款符合规范；正文用**英文**（用户确认），结构按规范章节顺序，控制在 ~150 行内，写入仓库内的相对链接而非复制大段内容。

## Current State Analysis（探查已确认，非假设）
- 根 [AGENTS.md](file:///e:\桌面\novel\novel2screenplay\AGENTS.md) 现有 5 行 Next.js 自动块；[CLAUDE.md](file:///e:\桌面\novel\novel2screenplay\CLAUDE.md) 为 `@AGENTS.md`，即全局约定由 AGENTS.md 承载。
- monorepo：workspaces `apps/*`、`packages/*`（[package.json](file:///e:\桌面\novel\novel2screenplay\package.json)）；实际共享包仅 `@novel/contracts`。
- 主应用 `apps/screenplay`（[apps/screenplay/package.json](file:///e:\桌面\novel\novel2screenplay\apps\screenplay\package.json)）：Next.js `^16.2.12`、React 19、TS 5、Tailwind 4、better-sqlite3、zod 4、vitest 4；dev 端口 `3001`；dev/build 用 webpack。
- 脚本链：headless 根 `npm run dev/build/start/lint/typecheck/test`；screenplay 的 `pretest/pretypecheck/prebuild` 均先 `build -w @novel/contracts`。
- 测试：[vitest.config.ts](file:///e:\桌面\novel\novel2screenplay\apps\screenplay\vitest.config.ts) `include: src/**/*.test.{ts,tsx}` 同目录存放；`fileParallelism:false`（SQLite 串行）；测试库隔离 `DB_DIR=data-test / DB_FILE=test.db`。
- CI：[.github/workflows/ci.yml](file:///e:\桌面\novel\novel2screenplay\.github\workflows\ci.yml) lint/typecheck/test/build；build 前 `npm rebuild better-sqlite3`。
- 文档现状：根 README 结构章节仍为单应用旧布局（滞后）；[docs/项目框架.md](file:///e:\桌面\novel\novel2screenplay\docs\项目框架.md) 较新但标记 P1/schema v3；[docs/DEVELOPMENT.md](file:///e:\桌面\novel\novel2screenplay\docs\DEVELOPMENT.md) 为 2026-06 旧记录。
- 已知合法缺陷（勿擅自"修复"）：双套执行系统并存（主链路 `PipelineEngine` + `src/lib/jobs/`）、SQLite 单机多实例不共享数据、根 README 结构描述滞后。

## Proposed Changes（仅改 1 个文件）

### 文件：`e:\桌面\novel\novel2screenplay\AGENTS.md`
按规范 Chapter 二 章节顺序（信息价值降序）组织，正文英文，总长 ≤ ~150 行。拟定结构：

1. **Title + one-line positioning**（§2.1）：一句话定位 + 版本化技术栈 + 部署（如 `Next.js 16 / React 19 / TypeScript 5 / SQLite via better-sqlite3; npm-workspaces monorepo; dev on :3001`）。
2. **Setup**（§2.2）：可直接复制的命令——`npm install`；`cp .env.example .env.local`（若存在，无则不杜撰）并列出必需 env（`DEEPSEEK_API_KEY` 等，**只写变量名不写值**）；`npm run dev`。命令全部反引号包裹。
3. **Build & Test**（§2.3，最关键）：`npm run build`、`npm run test`、`npm run lint`、`npm run typecheck`；说明调用前 `pretest/pretypecheck` 自动 build `@novel/contracts`；说明测试与源码同目录、vitest 串行、用独立测试库；注明 CI 门槛 = 以上四项全绿。
4. **Project Structure**（§2.4）：仅列 5-8 个核心目录条目（`apps/screenplay`、`packages/contracts`、`docs/`、`.trae/specs/`、`scripts/e2e/`、`scripts/shot/`），每条一句话用途 + 关键约束；不倾倒整棵树；注明根 README 结构章节滞后、以本文件与 docs/项目框架.md 为准。
5. **Code Style**（§2.5）：真实 Good/Bad 对比，源自本项目事实——契约先改 `packages/contracts`（Zod 4 schema）、路由用 App Router `route.ts` + `@novel/contracts` 校验、测试放 `src/**/*.test.ts`、文件名/导出命名约定（PascalCase 组件、camelCase 函数）；避免空 `catch`。
6. **Commits & PRs**（§2.6）：Conventional Commits；按模块/主题拆 commit；合并前通过 lint+typecheck+test。
7. **Guardrails**（§2.7）：三档 Always / Ask first / Never，具体化为本项目——Always：改后跑 lint+typecheck+test 至绿、新增/改代码补测试、契约变更先动 `packages/contracts`；Ask first：schema.sql 迁移（SQLite schema_version）、新增依赖、改 CI；Never：提交密钥/`.env`、改生成目录、直接推 main 或强推、把 `pr-evidence/`/`scripts/shot/` 临场证据入库（工作流约定）。
8. **Monorepo / Nesting note**（§5）：离被编辑文件最近的 AGENTS.md 优先级最高（closest-file-wins）；根文件为兜底基线；`CLAUDE.md` 引用同源（此处即 `@AGENTS.md`）。
9. **保留原有 `<!-- BEGIN:nextjs-agent-rules -->…<!-- END:nextjs-agent-rules -->` 块**（Next.js 16 破坏性变更提醒，本项目真实依赖它，属最高优先级红线，置于文件头部附近）。
10. 链接规范（§3.3）：细节指向仓库内相对路径，如 `docs/项目框架.md`、`docs/剧本Schema设计文档.md`、`apps/screenplay/src/lib/pipeline/`；不复制大段内容。
11. 安全（§6）：全文无任何密钥/API key/PII。

写作红线：只写探查确认的事实；不引入新架构决策；不改任何源码/配置；不写入本机绝对路径或代理规避项（保持通用可移植，本机 env 事项已在项目 memory 维护）；正文英文、命令反引号、行内注释 `#`。

## Assumptions & Decisions
- 正文语言：英文（用户确认，依 §3.1）。
- 覆盖与可移植性：完整、通用可移植，不写机器专属细节（用户先前确认）。
- 篇幅：≤ ~150 行；细节用仓库内相对链接下沉。
- 仅新增/改写根 AGENTS.md，不触碰其他文件；CLAUDE.md 引用继续有效。

## Verification
- 复读 AGENTS.md：确认字数 ≤ ~150 行、Next.js 自动块原样保留、正文英文、命令可直接复制、无密钥/绝对路径/Git 代理内容。
- 对照规范附录八自检清单逐项核对（一句话定位有版本 / 命令可复制 / 测试命令明确 / 仅核心目录 / Good-Bad 至少一组 / Guardrails 三档 / 无密钥 / ≤150 行 / 细节链接不下沉复制 / 技术栈带版本 / Monorepo 层级优先级已说明）。
- 纯文档改动，无需运行测试/构建；如需可 `git status` 确认仅 AGENTS.md 变更。