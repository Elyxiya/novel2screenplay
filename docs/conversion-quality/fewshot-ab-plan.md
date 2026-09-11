# Few-shot AB 对比方案（B-06）

> 日期：2026-09-11 ｜ 状态：技术侧已就绪（样例库 + 注入开关 + 指纹留痕），**盲评执行依赖人工（§八 预算）**
> 假设：3 组"原文→目标 JSON"最小对注入 Phase3，能压低格式性错误（编造/心理句式/群声归属），不显著拖累 token 成本。

## A/B 定义

| 组 | 配置 | 命令要点 |
|---|---|---|
| A（对照） | Few-shot 关闭（现状） | 直接复用既有产物（如 `model-matrix-base-deepseek-chat-m.scenes.json`）或重跑一次 |
| B（实验） | 注入 3 组样例 | server env `PHASE3_FEWSHOTS=1`（或 `PHASE3_FEWSHOTS_DIR=<dir>`），同 prompt 同模型重跑 |

固定条件：同 prompt（指纹 `d4476f2bc226a7bb`）、同模型 `deepseek-chat`、同样本 `zhanlan-short`；
B 组的样例指纹随产物落库（`pipelineState.fewshots.hash`），作为"B 版本"的标识。

## 采集

```bash
node scripts/eval/run-once.mjs --name fewshot-b --sample zhanlan-short --base http://localhost:3001
# server 以 PHASE3_FEWSHOTS=1 启动；产物 once-fewshot-b-once.scenes.json
node scripts/eval/conflict.mjs --scenes <B 产物> --annotation scripts/eval/samples/zhanlan-short/annotation.json
```

## 指标（机器侧）

1. 断言格（identity 三规则，**注意 B-21 修复后 anomaly 规则已非空跑**）；
2. 占位率三段（occupancy.mjs）；
3. 结构化错误代理：`conflict.mjs` 三规则（时间线/已死同场/物品态）违规数；
4. 成本：run.json 的 tokens/耗时对比。

## 盲评协议（人工，≥30 场景）

- 从 A/B 各随机抽 15 个**同场景号**样本，匿名化为 X/Y 两列（顺序随机、去除组标签）；
- 一位评审给每对选"更像可拍剧本"的一侧（或"无差别"）；建议第二位评审独立复核 → 报一致率/κ；
- 记录：判 B 优的比例、无差别比例、典型理由（归类到：心理外化/群声归属/编造与否/格式）。

## 预注册决策规则（出数前锁定）

1. B 组断言格不得劣于 A（FAIL 数增 → 直接弃用）；
2. 盲评"判 B 优" ≥ 60% 且无差别 < 30% → **保留 B，待更多样本复验后考虑默认**；
3. 其余情况 → **弃用**（删除注入开关的启用路径，保留样例库作素材），结论写入 ADR 附录；
4. n=1 机器指标仅作方向性证据（参照 B-02 噪声基线：占位/事件类差异可达数 pt）。

## 成本

- 机器：1 次转换 ≈ ¥0.04；冲突检测/占位率为零 LLM。
- 人工：30 场景盲评 ≈ 1–2 人时（§八 预算内）。
