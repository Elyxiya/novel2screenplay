# B-05 逻辑漏洞检测首跑记录（2026-09-11）

> 工具：`scripts/eval/conflict.mjs` ｜ 产物：`model-matrix-base-deepseek-chat-m.scenes.json`（zhanlan-short，26 场景）｜ 标注：`annotation.json`

## 结果

| 规则 | 结果 |
|---|---|
| `timeline-monotonic` | ✅ PASS |
| `dead-character-presence` | ❌ **FAIL(1)** |
| `prop-state-consistency` | ⏭ SKIP（未提供 props 输入） |

**违规明细**：`已死角色出场：维克托·莫特森（第 6 章死亡）出现在第 8 章场景 #23`

## 场景 #23 现场核对

- 摘要：`黎恩以预言诱惑海盗船长`；场景章号 8；
- `characterIds`（在场集合）：黎恩·怀特、琼斯、艾瑞克·弗瑞德里希、摩根·狄福尔特、**维克托·莫特森**；
- 对白块前 6 条均为黎恩·怀特的台词——**维克托未开口**，仅在"在场集合"中。

## 两种归因（待人工裁决）

1. **真矛盾**：转换让已死角色形式上"在场"（剧本层面即缺陷——分镜会把尸体/亡者列入画面）；
2. **在场集合过度包含**：Phase4 的 `characterIds` 混入"被提及/被回忆"的名字（该场景文本可能提及维克托），并非真的在场。

**参考证据**：同场景还包含 摩根·狄福尔特——标注 `_note` 明确其为"尸体/背景叙述死"，说明本样本的在场集合**确有混入非活动个体**的倾向，归因 2 的概率不低，但需人工看原文与场景文本定夺。

## 处置

- 本记录 = 规则的设计意图正例：**确定性抓取候选 → 人工裁决**（与 identity-rules 同源纪律）；
- 若裁决为归因 2：后续可给规则加"仅对白说话人"模式（更严口径）或给 Phase4 增加"在场 vs 提及"分离；
- 若裁决为归因 1：进入"转换层缺陷"清单，供 prompt/一致性修复参考。

## 复现

```bash
node scripts/eval/conflict.mjs \
  --scenes scripts/eval/samples/zhanlan-short/model-matrix-base-deepseek-chat-m.scenes.json \
  --annotation scripts/eval/samples/zhanlan-short/annotation.json
# exit=1
```
