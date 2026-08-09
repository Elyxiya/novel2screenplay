# p1-5：质量关卡人工介入分支（FR-4 后半段）

## 需求背景
Agent 化改造方案 FR-4：质量关卡用 LLM 评估，低分**自动重试或请求人工介入**。
自动重试此前已实现（`enableAutoRetry` + `retryCount`），本次补齐后半段"请求人工介入（manual_review）"分支：
- 此前 `GateConfig.onFail` 配置从未被消费，重试耗尽后一律 `failed + break` 直接终止整个任务
- 临界区分数（`review` 决策）被静默放行，无人工复核

## 改动清单

### 后端
- `review-gate.ts`：`GateDecision` 增加 `'manual_review'`
- `orchestrator.ts`（核心）：
  - 消费 `GateConfig.onFail`，重试耗尽后按 `manual_review / skip / stop` 三路分发
  - 新增阶段状态 `awaiting`（等待人工介入）与任务级挂起语义 `task.awaiting`
  - `review` 临界区决策纳入人工介入（不再静默通过）
  - 新增 `resolveManualReview(taskId, phaseId, action)`：`approve`（接受输出继续）/ `retry`（重新生成）/ `discard`（放弃终止）
  - 抽出 `finalizeTask` 统一收尾；恢复执行支持从指定阶段续跑（`startIndex`）
  - SSE 事件新增 `phase_awaiting_manual` / `task_awaiting`
- `orchestrator-singleton.ts`（新增）：start/review 两路由共享同一 orchestrator 实例
- `api/agent/start/route.ts`：GET 返回 `awaiting` / `awaitingPhase`
- `api/agent/review/route.ts`（新增）：人工介入端点

### 前端
- `chat-state.ts`：`PhaseStatus` 增加 `awaiting`，`GateResult.decision` 扩展，reducer 处理两个新事件
- `AgentChatPanel.tsx`：待人工介入卡片（琥珀色 + 质量关卡原因）+ 批准继续 / 重新生成 / 放弃 三按钮，SSE/轮询接入 awaiting 状态

## 验证

### 单测（168/168 通过，orchestrator 12/12）
新增 6 用例：
1. merge 重试耗尽 → `awaiting` 挂起（非直接失败）
2. `review` 临界区决策 → `awaiting`
3. `approve` 后任务继续完成
4. `retry` 后重新生成且评分达标
5. `discard` 后任务终止
6. 非 awaiting 状态 resolve 返回 false

### typecheck
`tsc --noEmit` 通过

### E2E（真实 DeepSeek 四阶段）
- 正常流程回归：四阶段全部 completed（34.4s），无回归
- 人工介入链路：merge 质量未达标 → 任务挂起 awaiting → POST review approve → 任务继续完成（50.8s）

### 运行截图（pr-evidence/，不入库）
- `p15-agent-01-awaiting-manual.png`：/agent 工作台"待人工介入"卡片 + 三个操作按钮
- `p15-agent-02-completed.png`：点击"批准继续"后任务完成

## 说明
- 截图与 E2E 脚本（e2e-review.mjs / shot-review.mjs）不入库，仅保留在本地 `pr-evidence/`
- 人工介入挂起状态为内存级（沿用 orchestrator 内存 Map），跨请求持久化与 p1-4 数据隔离联动
