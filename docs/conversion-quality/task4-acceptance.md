# Task 4 · 外科式 supervisor 验收与回归记录

> 阶段：conversion-quality-engineering（Task 4 · 外科式 supervisor）
> 日期：2026-08-29 ｜ 关联 spec：`spec.md` / tasks：`Task 4`（4.1–4.7）｜ 前置备证：[task4-bridge-verification.md](task4-bridge-verification.md)
> 状态：✅ 代码 + 单测 + 三命令回归 + e2e 零回归全部达成；真实数据上的数值验收待 Task 2.2 标注样本（人力标注，主线执行）

---

## 1. 交付清单（4.1–4.5）

| 子任务 | 交付 | 验证 |
|---|---|---|
| 4.1 identity 信号 | `src/lib/eval/identity-rules.ts`（确定性断言规则移植 TS 运行时）+ `handoff-protocol.ts` `QualityAssessment.identity` 可选字段 + `review-gate.ts` 接入 `runIdentityAssessment`/`evaluateIdentity` | identity-rules 11 例 + review-gate-identity 7 例 |
| 4.2 决策层 | `reconvert-decision.ts` `makeReconvertDecision`（只决策不执行；escalation 预算 K=3）| reconvert-decision 10 例 |
| 4.2b 桥接数据链 | 验证脚本 `scripts/verify-bridge-chain.mjs` 实证 agent 任务从不写经典 pipelineState → 补互转层 `agent-pipeline-bridge.ts` | 备证已落 docs；互转层 11 例 |
| 4.3 经典链重转桥接器 | `reconvert-bridge.ts` `reconvertClassicJobScenes`（jobId 取 pipelineState → Phase3SceneConverter 重转 → 按 sceneNumber 合并 → Phase4Merger 重合并 → 写回 → 重跑身份断言）+ `executeReconvertForTask` 双路径 | reconvert-bridge 8 例 |
| 4.4 多 agent 接入 | `supervisor-reconvert.ts` `executeSurgicalReconvert`（registry busy/idle + handoff 证据链；经典 job 重转 → supervisor→writer；无写回目标/超预算 → supervisor→validator）+ `handoff-protocol.ts` `HandoffContext.id` + `handoff-manager.ts` 回填 | supervisor-reconvert 7 例 |
| 4.5 默认关 flag | `OrchestratorConfig.enableIdentityReconvert` 默认 `false`；回调路径/动态编排默认关 | orchestrator.test 身份决策组（flag 默认关返回 null 等）|

**主链零变化**：`enableIdentityReconvert=false` 时决策层直接返回 `null`/空决策，identity 不达标走既有重试/人工介入逻辑（`orchestrator.test.ts`「flag 关闭时 identity 不达标走既有重试/人工介入逻辑（主链零变化）」用例）；经典管线（`pipeline/*`）本任务未触碰。

---

## 2. 验收数字（4.6，硬）

### 2.1 escalation 率（K=3 预算，确定性上界）

「固定管线需多少次外科介入」——决策层对**每个身份失败场景**最多允许 `K=3` 次外科重转请求，之后必然升级 `manual_review`：

| 场景累计重转请求 | 决策 | 说明 |
|---|---|---|
| 0–2 次 | `shouldReconvert=true`（继续自动外科重转） | 预算内，只标记场景不执行 |
| ≥3 次（第 4 次） | `shouldEscalate=true`（升级人工，`escalated=true` 请求） | 防无限循环，人工兜底 |

- **确定性**：由 `countReconvertsForScene` 严格计数（含升级记录——升级代表已尝试过），fixture 逐档验证（0/1/2/3 次 → 决策分流）。**无概率噪声**，上界 = K=3/场景。
- 自定义预算（K=1 等）经 `maxEscalationsPerScene` 注入，单测覆盖。

### 2.2 局部重转成功率（fixture 实证）

桥接器端到端 fixture（`reconvert-bridge.test.ts`）：前置 pipelineState 含「已死角色 老秦 在场景 #1 仍开口」→ 身份断言失败（前置条件用例证实）→ 对场景 #1 发一次外科重转：

| 场景 | 结果 |
|---|---|
| provider 返回修复后场景 | **重转成功，重跑断言通过**（`identityAfter.passed=true`）；未重转场景 0 原样保留；phase3Output 按 sceneNumber 替换、phase4Output 重合并写回；subProgress/scenesStatus 恢复；日志落库 |
| provider 返回未修复场景 | 执行成功但 `identityAfter.passed=false`（场景仍失败）→ 进入下一轮决策，累计至 K 后升级人工 |

- 成功率（fixture）：**1/1 场景一次重转修复**；未修复场景不静默吞掉，走 escalation 预算闭环。
- 错误路径（jobId 不存在 / 场景号不存在 / pipelineState 不可重转 / agent 独立任务无写回目标 → `needs-manual`）全部单测覆盖。

> **真实数据数值验收**（escalation 率 / 成功率对真实剧本）：依赖 Task 2.2 的标注样本（「别名密集、多线叙事」筛选 + 死亡/揭示章标注），该批样本为纯人力活，标注完成后由主线在真实 pipelineState 上复跑本决策 + 桥接器出数。本轮以确定性 fixture 数字作为实现期验收依据（与 Task 1.6 / 3.4 相同的「数值验收待标注样本」纪律）。

### 2.3 flag 关时 e2e 与改造前一致（零回归）

默认配置（`enableIdentityReconvert=false`，即**改造前**行为）实跑 e2e 全链路：

```
node scripts/e2e/e2e-p0-fullchain.mjs  →  ALL OK
```

覆盖：注册登录 → 创作台建小说两章 → 物化 → `pipeline/start`（带 novelId）→ 轮询 completed → `drama/convert` → 分镜溯源回跳 URL 推导，**全部断言通过**。经典管线路径 Task 4 未触碰 + agent 链 flag 关时单测证明零变化 → **零回归成立**。

---

## 3. 回归（4.7）

### 3.1 单测覆盖（Task 4 新增 6 个测试文件，54 例）

| 测试文件 | 用例 | 覆盖 |
|---|---|---|
| `identity-rules.test.ts` | 11 | 确定性断言规则（已死角色开口/称谓揭示/别名） |
| `review-gate-identity.test.ts` | 7 | ReviewGate 接入 identity 判定 + evaluateIdentity 入口 |
| `reconvert-decision.test.ts` | 10 | escalation 预算 K=3 分流/去重/历史计数/自定义预算/升级记录计入 |
| `reconvert-bridge.test.ts` | 8 | 经典链重转端到端（前置失败→重转→断言）+ 错误路径 + `executeReconvertForTask` 双路径 |
| `agent-pipeline-bridge.test.ts` | 11 | agent↔pipelineState 互转（优先经典 job/回退 agent/文本启发式/空结构不造假/监督上下文） |
| `supervisor-reconvert.test.ts` | 7 | registry busy/idle 状态机 + handoff 证据链（writer/validator 路由、无 agent 降级、审计 metadata） |

另有 `orchestrator.test.ts` 身份决策组（flag 默认关 / identity 通过 / 未达标只决策 / escalation 到顶 / 持久化 / 质量关卡路由 / flag 关主链零变化）。

### 3.2 三命令全绿

| 命令 | 结果 |
|---|---|
| `npm test`（三包全量） | **561 例全绿**：screenplay 51 文件/492 + contracts 4/37 + db 4/32 |
| `npm run lint` | 通过（0 error，2 个 writer 页存量 warning，与 Task 4 无关） |
| `npm run typecheck` | 通过（apps/screenplay + contracts + db 三包） |

---

## 4. 结论

- Task 4.1–4.5 交付闭环：identity 信号 → 只决策不执行 → 经典链外科重转 → supervisor/handoff 证据链 → 默认关 flag。
- 4.6 硬验收：escalation 上界 K=3/场景（确定性）；fixture 局部重转成功率 1/1；flag 关 e2e `ALL OK` 零回归。真实数据数值留待 Task 2.2 标注样本。
- 4.7 回归：54 例专项单测 + 全量 561 例 + lint/typecheck 全绿，结论本档入 `docs/`。

## 5. 遗留与后续

- Task 2.2 标注样本就绪后：真实 pipelineState 上跑本决策 + 桥接器出 escalation 率/成功率对照数，更新本档 §2.1/§2.2。
- 未来入口：job 完成后启动 supervisor 并传 `jobId`，`resolvePipelineState` 直接复用经典产物重转（当前独立 agent 任务走正向互转兜底）。
