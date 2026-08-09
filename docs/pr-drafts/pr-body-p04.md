## 变更说明

**P0-4：Agent 对话工作台前端 UI** + 修复四阶段空输出问题。

### 背景
Agent 后端（四阶段 Multi-Agent 编排 + SSE 实时推送）已就绪，但缺少可交互的前端界面。本 PR 补齐 `/agent` 对话工作台，让用户用自然语言指导 Agent 完成"分析 → 场景切割 → 场景转换 → 合并去重"全流程。

### 变更内容
1. **`/agent` 工作台页面**（`apps/screenplay/src/app/agent/page.tsx`）：RequireAuth 保护，全屏工作台布局
2. **AgentChatPanel 对话组件**（`apps/screenplay/src/components/agent/AgentChatPanel.tsx`）：
   - 左侧输入区：标题/作者/小说正文/自然语言指令 + 4 个快捷建议 + 启动按钮
   - 右侧实时轨迹：用户消息气泡 → 四阶段 PhaseCard（含质量关卡结果、错误、进度条）→ Agent 日志控制台 → 完成摘要卡片（含"前往可视化精修"跳转）
   - SSE 接入 `/api/agent/stream/:taskId`，按 complete/phase/progress/log 类型分发，连接中断自动轮询兜底
3. **纯函数状态机**（`apps/screenplay/src/lib/agent-chat/chat-state.ts` + 10 项单测）：SSE 事件 → UI 状态映射，含空 phases 快照回退修复
4. **导航接入**（`HeaderNav.tsx`）：创作台与短剧分镜之间新增"Agent 对话"入口
5. **BUG 修复**（`apps/screenplay/src/lib/multi-agent/orchestrator.ts`）：**小说原文从未注入 Agent prompt** —— `buildAgentContext` 只传前面阶段输出，导致 LLM 以"未提供原文"为由输出空结果、质量关卡拒绝。现已在每个阶段 prompt 中注入 `小说原文`。

### 验证结果
- **单元测试**：Agent 相关 9 文件 / 72 用例全部通过（chat-state 10 项 + orchestrator 6 项 + AgentCore 等）
- **Typecheck**：`tsc --noEmit` 通过
- **E2E 全链路**（真实 DeepSeek 四阶段转换，`e2e-agent.mjs`）：**ALL OK**，四阶段全部 completed，耗时 52.5s；质量评分 analyze 80 / segment 82 / convert 84 / merge 通过
- **运行截图**（本地文件，未进仓库，见 `pr-evidence/`）：
  - `pr-evidence/p04-agent-01-workbench.png` — 工作台空态（登录后）
  - `pr-evidence/p04-agent-02-running.png` — 四阶段执行轨迹运行中（SSE 实时推送 + Agent 日志）
  - `pr-evidence/p04-agent-03-completed.png` — 转换完成摘要卡片

### 备注
- 全量 vitest 中 `auth/session`、`store/sqlite/*` 共 3 文件存在预存失败（"Cannot find package '@/…'"，经 git stash 验证与本 PR 改动无关，属 main 分支基线问题）
