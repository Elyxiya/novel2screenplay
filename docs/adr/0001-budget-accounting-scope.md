# ADR-0001：预算计数的部署语义（单实例内存态，多副本不共享）

- 状态：**已生效（A 案）**；B 案设计留档待触发
- 日期：2026-09-11
- 相关代码：`apps/screenplay/src/lib/llm/adapter/budget-controller.ts`、`apps/screenplay/src/lib/pipeline/phase1-budget.ts`
- 相关台账：D-14（FIX-06）

## 背景

BudgetController 以 `globalThis` 单例持有 `hourlyUsage / minuteUsage / monthlyUsage / totalUsage`
（进程内存 Map + 数值），用于 Phase1/Phase3 调用前的预算守卫（`canRequest`）。同一进程内语义正确，
但**多副本部署时各副本独立计数**：N 个副本 = 实际可消耗 N 倍预算。

该边界此前只存在于代码事实中，未文档化、无启动告警——部署方可能在不知情的情况下扩容副本，
导致预算静默超额。本 ADR 把语义显式化，并给出共享计数的替代方案与触发条件。

## 决策（A 案：维持单实例语义 + 显式告警）

1. **维持**进程内存计数（现状）：无新表、无跨进程同步、热路径零额外延迟。
2. **部署方声明副本数**：环境变量 `INSTANCE_COUNT`（缺省 1）；`>1` 时首次创建
   BudgetController 即输出显著告警（一次性），指向本 ADR。
3. 文档化边界：预算守卫的保证范围 = **每进程**，不是全局。多副本部署下如需全局预算，
   走 B 案（下方设计），触发条件见文末。

## 后果

- 正向：语义诚实、零运行时成本；扩容时不再"静默超额"（告警 + 文档双保险）。
- 负向：多副本部署下预算上限实际为 `LIMIT × INSTANCE_COUNT`——由部署方自行收敛
  （调低单副本 LIMIT）或启用 B 案。

## 替代方案（B 案：PG 共享计数，设计留档，暂不实施）

- 表：`budget_usage(scope TEXT, window_kind TEXT, window_start BIGINT, cost DOUBLE PRECISION,
  calls INTEGER, PRIMARY KEY(scope, window_kind, window_start))`，与 `schema.sql`/`schema-pg.ts`
  同步（走契约批 C1 类"零契约变更落库扩展"流程 + schema_version 版本行）。
- 写入：调用后 `INSERT ... ON CONFLICT(scope, window_kind, window_start) DO UPDATE
  SET cost = budget_usage.cost + EXCLUDED.cost, calls = budget_usage.calls + EXCLUDED.calls`
  （原子累加，PG/SQLite 同语义）。
- 读取（热路径约束）：`canRequest` 每场景会被调用多次，**不能**每次查库。方案：
  本地内存缓存 + 周期/计数触发的批量同步（默认每 30s 或每 64 次调用同步一次），
  超限判定取 `max(本地估算, 最近一次 DB 快照)`；窗口滚动由 `window_start` 归一化处理。
- 代价：PG 走 worker + Atomics 同步桥，热路径引入跨线程同步延迟（需实测）；实现与
  双后端契约测试工作量约 1–2 人天。

## 触发条件（何时启动 B 案）

满足任一即启动：
1. 出现**真实多副本部署**（`INSTANCE_COUNT > 1` 且预算守卫被依赖为硬约束）；或
2. 单副本模式下预算守卫误判率有可观测证据（例如需要跨重启延续的月预算）。

在此之前，`INSTANCE_COUNT > 1` 的部署应调低单副本 LIMIT 作为补偿。
