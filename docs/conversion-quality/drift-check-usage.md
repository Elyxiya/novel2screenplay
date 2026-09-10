# 漂移检测用法（FIX-09）

> 脚本：`scripts/eval/drift-check.mjs` ｜ 时序来源：`data/eval-drift.jsonl`（drift.mjs 追加，data/ 不入库）

## 最小链路

```bash
# 1) 采集（需要 dev server + LLM key）：同一提示词 N=3 复跑，写时序 JSONL
node scripts/eval/drift.mjs --name <label> --sample zhanlan-short --runs 3 --base http://localhost:3001

# 2) 检查（可离线/无 key）：读时序 → 阈值比对；无阈值文件时仅报告趋势
node scripts/eval/drift-check.mjs

# 3) Mock 硬门（无 key 环境必须有）：评估工具确定性测试全绿才通过
node scripts/eval/drift-check.mjs --mock-gate
```

## 阈值（先测量后定阈）

- 文件：`data/drift-thresholds.json`（缺省不检查）。示例与口径说明见
  `docs/conversion-quality/drift-thresholds.example.json`。
- 字段：`maxSceneVariance` / `maxPerChapterL1`（上限），`minCharacterJaccard` / `minEventConsistency`（下限）；
  缺省字段不检查。**数值必须来自人工按目标声明**——基线参照 `drift-fix10-prompt.md`
  （zhanlan-short 实测：方差 2.89 / L1 7.33 / Jaccard 0.706 / 事件 0.665，n=3）。
- 违例行为：打印 🚨 ALERT 明细并 `exitCode=1`（可接 CI）。

## 调度建议

- **无 key 环境（默认 CI）**：只跑 `--mock-gate` —— 确定性测试守住工具与指标逻辑不腐烂。
- **有 key 环境（nightly/手动）**：先 `drift.mjs --runs 3` 再 `drift-check.mjs --mock-gate`；
  时序 JSONL 按时间累积，趋势回归用同一 name 前后记录比对。
- 现状：调度入口为手动/CI 挂载（本仓无 cron 设施）；本条与任务计划的"先手动后自动化"一致。
