# Task 5.1 · Phase1 翻默认决策规则（出数前固化）

> 阶段：conversion-quality-engineering（Task 5 · 翻 Phase1 默认）
> 日期：2026-08-29 ｜ 关联 spec：`spec.md §5.1` / tasks：`5.1`
> 状态：✅ 规则代码 + 单测（9 例）+ 本文档已固化；阈值数值落档待 2.4 稳定性报告

## 1. 目的

在翻默认**前**先写死决策规则，出数后照规则判，**不临时改口径**（防集中式"压平已达标"式事后合理化）。翻默认唯一触发器是数据门槛，不是"写完了就切"。

## 2. 决策口径（定死不改）

翻默认（`flip=true`）的条件是 **R3 全部满足**，且受 **R1** 前置约束。

| 规则 | 条文 |
|---|---|
| **R1** | 无 judge 复跑方差（`Δ_tail` 未填充/非有限）→ **缺数据不裁决**，暂不翻默认。 |
| **R2** | `Δ_tail` 须大于 judge 噪声带，否则尾段差值落进噪声内无从裁决。 |
| **R3** | 翻默认 = **尾段差 ≥ Δ_tail** 且 **总分不劣**；任一不满足不翻。 |

## 3. Δ_tail 的来源（职责分离）

- **算阈值**：eval 稳定性报告 `scripts/eval/stability.mjs` →
  `judgeNoiseBand = max(2×SD, 95%CI半宽)`（保守取大）→
  `Δ_tail = max(minDelta=5, ceil(噪声带))`（`deltaTailThreshold`）。
- **判门槛**：`apps/screenplay/src/lib/eval/flip-decision.ts` `decidePhase1Flip` 只消费调用方注入的 `Δ_tail`，**不重复推导**。

## 4. 决策输入（数据注入点）

| 输入 | 含义 | 来源 |
|---|---|---|
| `tailDropPct` | 旧→新 尾段（最后 1/3 章节断面）通过率升幅（百分点） | Task 2.5 分层曲线（前/中/后三段） |
| `totalNotWorse` | 总分是否不劣于旧（允许相等或更好） | Task 2.5 / Task 1 代理与 floor 综合判定 |
| `deltaTail` | 阈值（百分点） | Task 2.4《judge 稳定性报告》→ `deltaTailThreshold` |

## 5. 决策结果语义

- `flip=true`：允许翻默认 → 触发 Task 5.2：翻 `Phase1Analyzer` 默认路径为 map-reduce，并把 `canRequest`（BudgetController）接到 Phase1 调用点。
- `flip=false`：附逐条 `reasons`（R1 缺数据 / R3 尾段差不足 / R3 总分劣化），供人工核验口径。

## 6. 单测与回归

- `apps/screenplay/src/__tests__/flip-decision.test.ts`：9 例（R1 三种空态、R3 满足/边界≥/不满足/总分化、双原因、阈值 0）。

```
npx vitest run src/__tests__/flip-decision.test.ts   # 9/9 通过
```

## 7. 后续（数据门槛驱动，非本次）

- `5.2` 依 Task 2.5 分层曲线 + Task 1.6 代理/floor → `decidePhase1Flip` 判定 → 翻默认 + `canRequest` 接 Phase1。
- `5.3` 翻默认后 e2e 全绿；本决策记录（"为什么切默认"）入 `docs/`。
- `5.4` 独立 PR 清理旧截断 flag。

## 遗留

- `Δ_tail` 的数值实跑落档依赖 Task 2.2 真实样本标注（当前暂停）→ 2.4 稳定性报告就绪后回填本文档 §3 数值。