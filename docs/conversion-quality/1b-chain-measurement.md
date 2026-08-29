# 1b 链路实测记录（medium · 第一步旧路径 + 基线格子）

> 生成时间：2026-08-29
> 目的：记录 medium 样本数据链跑通后"产 scenes → judge → 格子落位"的实测链路，含格子数、真实规则格 P/F、基线通过率、占位率前/后段数值，作为第二步（mapreduce 新路径）分层对比的基线。

## 1. 样本与运行

- 样本：`xiuzhen-medium`（`《最后一个修真者》` 原书 20–55 章，36 章，`inputTokensHint≈31539`，跨 30k 边界）。
- 第一步 · 旧路径（truncate，dev server 不带 `PHASE1_MODE`）：`old.run.json`，终态 `completed`，耗时 7.8min，估算费用 ¥0.15（≤ ¥20 上限）。
- 引擎隔离：dev server `DB_FILE=data-test/1b-data.db`，不污染真实库。

## 2. 链路格子（grid cells，产物落位）

| 格子 | 旧路径 |
|---|---|
| scenes（ScreenplayScene 数） | 36 |
| charIdToName（id→name 数） | 65 |
| deadCharacters（死亡断言） | 2（王老三 ch8 / 夏建仁 ch36） |
| 参考卡（phase1 命中 id 集，占位率参考） | 28 |

- scenes 非空、charIdToName 非空、死亡断言真实落到 `char_XX`（王老三→`char_08` 在参考集，非占位）。

## 3. 真实规则格 P/F（确定性，零 LLM）

| 规则 | 旧路径判定 | 明细 |
|---|---|---|
| `dead-character-no-speak` | PASS | 王老三（ch8 死）/ 夏建仁（ch36 死）均未检出"死后开口" |
| `reveal-before-chapter` | PASS | reveals 如实为空（无干净在篇身份揭示），空断言不违规 |
| `unresolved-alias-as-id` | PASS | 未检出直接用别名作 characterId |

- **基线通过率**：3/3 规则格全过，旧路径身份违规数 0。

## 4. 占位率（第二信号，前/后段）

| 段 | 旧路径 |
|---|---|
| 前段 | 27.3% |
| 中段 | 38.2% |
| 后段 | 29.3% |
| 全段 | 32.0%（占位 58/181） |

- sanity：全段非全段严格为 0（32%）→ 定义成立，非"全 0 需先怀疑定义"。（⚠️ 首次提取曾因读取 `phase1.characters[].characterId`（该字段不存在）导致 charIdSet 全 null、占位恒 100%；已修正为按 phase4 `{characterId,name}` 名字命中 phase1 卡映射回 `char_XX`——见 `scripts/eval/run-conversion.mjs`。）

## 5. 成本检查点（停点验收记录）

- 格子数>0：✅（36/65/2）。
- 规则格非占位：✅（死亡断言落真实 `char_XX`）。
- 占位率非全段严格为 0：✅（32%）。
- 结论：第一步产物链路成立，验收通过 → 才写「T2.5 实测预注册」并付第二步费用。

---
> 第二步（mapreduce 新路径）结果见 `docs/conversion-quality/1b-layered-curve.md`；翻默认决策见 `docs/conversion-quality/flip-decision-record.md`。