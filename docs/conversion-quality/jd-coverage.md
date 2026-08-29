# JD 覆盖对照（诚实版）

> 目的：把 JD 1–6 逐条映射到项目已落地特性（带 commit / tag）；**如实标注空档**，不做未落地的能力主张。
> 日期：2026-08-29 ｜ 关联：`jd-analogy.md`、flip-decision-record、conversion-quality spec。
> 引用约定：commit 短哈希 / tag 均可在 `git log` 复现；tag `eval-baseline`、`eval-baseline-task5`、`eval-task5-budget-guard` 为本轮基准快照。

## JD#1 全栈（前端 + 后端 + AI）— ✅ 已具备

- **前端**：Next.js (App Router) + React 19 + TS；转化工作台（writer）+ 剧本/分镜结果页 + Agent 面板 + `/debug` 评估页。
- **后端**：四阶段 pipeline + SSE 实时进度；多 Provider LLM 网关（DeepSeek/OpenAI/Anthropic 原生/自定义 Ollama 兼容）；SQLite + Postgres 双后端 job 存储（`b458dce`）。
- **AI**：AgentCore / MultiAgentOrchestrator / 外科式 supervisor（`69f51e9`）；token 级流式（writer AI + revise 预览流）。

## JD#2 Coding Agent 域 — ◐ 形态同构，真实代码域为空档

- **拿得出手**：Agent 编排（任务持久化、人工介入 awaiting、review gate）、长上下文管理（map-reduce 设定卡 + 实体键检索注入）、效果评估闭环（见 JD#3）。这些与做 Code Agent 的方法论同构（见 `jd-analogy.md`）。
- **诚实空档（如实标注）**：域对象是"小说→剧本"，**不做真实代码仓库的读写工具**（无 Git/文件/终端 Agent 操作、无 code search / AST / test-runner 工具）。求职时定位为"**转换域 Agent + 通用编排能力**"，不冒充 Coding Agent 的经验。

## JD#3 上下文管理 + 流式 + 效果评估 — ✅（对比曲线见 9.3）

| 子条 | 落地 | 证据 |
|---|---|---|
| 上下文管理 | 30k 里程碑：map-reduce 实体归并 + 章节摘要 + 内置预算 cap；Phase3 实体键注入 + BudgetController `canRequest` | `a2bd04a` / `b1e74f3` / `7a8c7fa` |
| 流式 | `chatStream` 逐 token 流式（writer 打字机 + revise 预览流，NDJSON 帧 + AbortController） | 本轮内容（见 `restrained-rework` 点 2） |
| 效果评估 | 机制已落地：身份断言集（`identity.mjs`）+ judge 稳定性（`stability.mjs` Δ_tail 阈值）+ manifest 复现基准。**分层对比曲线（T2.5）= 机制已落地、数据待 9.3**（1b 切样 + 双书分层曲线，数据链解锁后回填） | `5e0f3fb` / `5fd6ad6` |

> 措辞纪律：**不写"曲线判定通过/已验证"**——曲线尚未出数，只写"机制已落地、对比曲线见 9.3"。

## JD#4 代码工具（Git / 终端 / 文件修改 / P4）— ✗ 如实标注空档

- 转换域不涉及真实代码仓库读写，四种代码工具链之一与本项目无对应物。
- 可迁移资产：管道编排、SSE、双后端存储、预算守卫——这些是"工具背后的运行框架"，用作"离代码工具一步之遥"的说辞；但**不主张"已实现代码工具"**。

## JD#5 跨端 WebView 体验与性能 — ✅（点 3 提供）

- 桥协议 + `postMessage` origin 白名单安全 + 跨域 iframe 两宿主（面板被嵌入 = WebView 替身）。
- 性能预算：长列表虚拟化（DOM 有界）、SSE 节流。
- 证据：点 3 可嵌入包（见 `restrained-rework` 点 3）。Tauri 真实壳为后续（`docs/agent-embed/tauri-shell-followup.md`）。

## JD#6 通用组件 / Agent 工程能力沉淀 — ✅（既有 eval 基建 + 点 3 包）

- 可复用：`ModelRouter` 多 provider 注册、`LLMProvider` 抽象、评估 runner（`runner.test` 24 例）、dual-backend 存储抽象。
- 治理：翻默认走**决策记录**（R1/R2/R3，缺数据不裁决）而非凭感觉切换（`599b512`）——体现架构决策纪律。

## 汇总

| JD 条 | 状态 | 一句话定位 |
|---|---|---|
| 1 全栈 | ✅ | 上中下全有 |
| 2 Coding Agent 域 | ◐ | 编排/上下文同构，真实代码域如实空档 |
| 3 上下文+流式+评估 | ✅ | 机制落地；曲线数等 9.3 |
| 4 代码工具 | ✗ | 如实空档 |
| 5 跨端 WebView | ✅ | 点 3 两宿主桥 |
| 6 组件/工程沉淀 | ✅ | eval 基建 + 可嵌入包 |