# 模型 × 样本评测矩阵：base

> 生成时间：2026-09-10T18:55:00.156Z ｜ 样本：`zhanlan-short` ｜ 格数：2　工具：`scripts/eval/model-matrix.mjs`（B-04）
> 提示词指纹：`d4476f2bc226a7bb` —— 各格之间必须同一提示词与样本。

## 主表

| 请求模型 | 实际模型 | 回退 | 断言格 | 占位率 全段/后段 | 场景数 | 耗时(min) | 估算成本(¥) | 终态 |
|---|---|---|---|---|---|---|---|---|
| deepseek-chat | deepseek-chat |  | dead-character-no-speak:PASS reveal-before-chapter:FAIL(8) unresolved-alias-as-id:PASS | 9.8% / 0.0% | 32 | 1.2 | 0.04 | completed |
| openai | deepseek-chat | ⚠ | dead-character-no-speak:PASS reveal-before-chapter:FAIL(5) unresolved-alias-as-id:PASS | 13.6% / 6.3% | 26 | 1.2 | 0.04 | completed |

> ⚠ 存在"请求模型 ≠ 实际模型"的格：app 侧对未知 modelId 会静默回退默认 provider，
> 请按"实际模型"列解读结果；请求侧可靠写法见本文件头注释。

## 解读提示（人工裁决，工具不自动下结论）

- 断言格：FAIL 数少者优；任一格 FAIL 数 >0 时不得以该格作为"扩张默认模型"的依据。
- 占位率与成本对比同一口径（本矩阵为 n=1，参考 B-02 噪声基线：同模型复跑的占位/事件差异可达数 pt 量级——小于噪声级的差距不作模型取舍依据）。
- 结论按纪律回写决策记录（含阴性结果）。

## 复现

```bash
node scripts/eval/model-matrix.mjs --name base --sample zhanlan-short --models deepseek-chat,openai --base <server>
```
