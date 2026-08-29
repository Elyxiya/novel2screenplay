# Task 5.2 进度 · Phase1 canRequest 守卫落地 + 翻默认单一决策点

> 阶段：conversion-quality-engineering（Task 5 · 翻 Phase1 默认）
> 日期：2026-08-29 ｜ 关联 spec：`spec.md §2.10/§2.11` / tasks：`5.2`
> 状态：⚠️ 部分完成（数据无关承重件已落地；**翻默认本身受 Task 2.4/2.5 数据门槛约束，暂未触发**）

## 1. 本次落地（数据无关的承重件）

**目的**：spec §2.11「预算守卫挂点前置」——真实成本尖峰是 map-reduce 本身（全书 N 章各一次调用）。翻默认前若不先把守卫接到 Phase1，翻默认→Task 3 之间就存在无守卫窗口。故先接守卫，翻默认仅是改一个决策点。

### 1.1 守卫模块 `lib/pipeline/phase1-budget.ts`
- `Phase1BudgetController.canCall(site, usage)`：调用前查 `BudgetController.canRequest`；超限 → 计数 + 触发 `onBlocked(site, reason)`。
- `createPhase1Budget({ budget, modelId, enabled, onBlocked })`：`enabled=false` 时零影响（保住现状）；无 `modelId` 无法折算成本 → 判放行不误伤。
- token 预估：`estimateMapPromptTokens` / `estimateReducePromptTokens`。

### 1.2 接到三个 Phase1 调用点
| 调用点 | 超限语义 |
|---|---|
| `mapChapters`（phase1-map） | 跳过该章/分块抽取 → 返回空抽取，map 结果置 `budgetBlocked=true` |
| `reduceSetting`（phase1-reduce） | 跳过 LLM 合并决策 → 回退朴素 merge，reduce 结果置 `budgetBlocked=true` |
| `Phase1Analyzer.analyzeTruncate` | 跳过整路径分析 → 返回空结果 + `rawResponse` 说明 |

- **PipelineEngine**：`new Phase1Analyzer(provider, ctx, createPhase1Budget({ modelId: provider.modelId, enabled: true, onBlocked }))`，超限写入 `jobStore.metadata.budgetBlocked` 计数（与 Phase3 `recordBudgetBlocked` 语义一致）。

### 1.3 翻默认单一决策点
- 默认路径收敛为 `resolveDefaultPhase1Mode()`：**当前返回 `truncate`**。
- 翻默认 = 把该函数改为返回 `mapreduce`（配合守卫 + Task 5.3 决策记录），不靠随手改 env；`PHASE1_MODE=mapreduce` 保留作实验逃生通道。

## 2. 尚未落地（数据门槛决定）

- **实际翻默认未触发**：`decidePhase1Flip` 的输入（`tailDropPct` / `totalNotWorse` / `Δ_tail`）依赖 Task 2.4《judge 稳定性报告》与 Task 2.5 分层曲线，而 Task 2.2 真实样本标注已暂停。按 R1「缺数据不裁决」，本次**不翻**。
- Task 5.3 的「翻默认后 e2e 全绿」与「为什么切默认」决策记录，待数据门槛通过后执行。

## 3. 单测与回归

- `phase1-budget.test.ts`：8 例（未启用零影响 / 无 modelId 放行 / 超限拦截计数 onBlocked / 预算充足放行 / reset / 默认 truncate / token 预估）。
- `phase1-mapreduce.test.ts` 增补：map 超限降级、reduce 超限回退朴素 merge、Phase1Analyzer 双路径带守卫不崩（共 18 例该文件全绿）。
- **全量回归**：typecheck 绿；lint 0 error（2 条 writer 页既有 warning）；全量 test 绿。

## 4. 后续

- 2.2 标注就绪 → 2.4 稳定性报告出 `Δ_tail` → 2.5 分层曲线出 `tailDropPct`/`totalNotWorse` → `decidePhase1Flip` 判定通过 → 改 `resolveDefaultPhase1Mode()` 返回 `mapreduce`（5.2 完成）→ e2e + 决策落档（5.3）→ 清旧 flag 独立 PR（5.4）。