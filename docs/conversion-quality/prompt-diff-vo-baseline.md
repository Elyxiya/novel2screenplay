# Prompt 版本对比：vo-baseline

> 生成时间：2026-09-10T18:37:03.890Z ｜ 样本：`zhanlan-short` ｜ 模型：`deepseek-chat`　工具：`scripts/eval/prompt-diff.mjs`（B-07）

## 版本指纹

| 侧 | 来源 | prompt sha256（前 16） | 字符数 |
|---|---|---|---|
| old | E:/桌面/novel/novel2screenplay/data/prompt-dump/vo-baseline-old.txt | 777a7aa6e769421f | 1087 |
| new | E:/桌面/novel/novel2screenplay/data/prompt-dump/vo-baseline-new.txt | d4476f2bc226a7bb | 1109 |

## 身份断言格（确定性规则，PASS 为佳）

| 侧 | 规则结果 |
|---|---|
| old | dead-character-no-speak: PASS；reveal-before-chapter: FAIL(5)；unresolved-alias-as-id: PASS |
| new | dead-character-no-speak: PASS；reveal-before-chapter: FAIL(6)；unresolved-alias-as-id: PASS |

## 占位率（越低越好）

| 侧 | 前段 | 中段 | 后段 | 全段 | 占位/总数 |
|---|---|---|---|---|---|
| old | 0.0% | 19.2% | 0.0% | 7.2% | 5/69 |
| new | 4.2% | 21.4% | 6.7% | 11.9% | 8/67 |

**差值（新 − 旧）**：全段 4.7pt ｜ 后段 6.7pt（负=改善）。

## 运行元数据

| 侧 | 耗时(min) | 场景数 | 参考卡角色 | 估算成本(¥) | 终态 |
|---|---|---|---|---|---|
| old | 1.1 | 27 | 8 | 0.04 | completed |
| new | 1.1 | 26 | 7 | 0.04 | completed |

## 预注册判据提示（人工裁决，工具不自动下结论）

- 断言格出现新 FAIL：除非新 FAIL 数 < 旧 FAIL 数（净改善），否则不得采纳新提示词。
- 占位率差值：与噪声带/Δ_tail 口径比较（见 docs/conversion-quality 既有决策记录），n=1 仅作方向性证据。
- 结论必须回写决策记录（flip-decision-record 风格）；阴性结果同样入档。

## 复现命令

```bash
# server A（旧提示词）: CONVERT_PROMPT_FILE=<old.txt> 端口 3001，DB_DIR/DB_FILE 指向 data-test/1b-data.db
# server B（新提示词）: CONVERT_PROMPT_FILE=<new.txt> 端口 3002，同一隔离库
node scripts/eval/prompt-diff.mjs --name vo-baseline --sample zhanlan-short --old-file <old.txt|git:ref> --new-file <new.txt|builtin>
```
