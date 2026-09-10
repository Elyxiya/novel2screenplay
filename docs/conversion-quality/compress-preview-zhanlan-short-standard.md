# 压缩预览大纲：zhanlan-short × profile=standard

> job=job_1789066893149_qx1khu ｜ 场景总数 26 → 输出 23（MERGE 3 / DROP 0 / CONDENSE 标记 0）
> 目标比率 0.5 ｜ 实际比率 0.8846（POC 数据用于校准档位，见 ADR-0003 第四节）

## 保护集命中（永 DROP 例外，v1 无例外）

- 保护章（死亡/揭示/open threads 起止）：[0, 1, 2, 3, 4, 5, 6, 8, 11]
- 命中场景 26 个：#1(major-present)、#2(major-present)、#3(protected-chapter)、#4(protected-chapter)、#5(major-present)、#6(major-present)、#7(major-present)、#8(major-present)、#9(major-present)、#10(major-present)、#11(major-present)、#12(major-present)、#13(major-present)、#14(major-present)、#15(major-present)、#16(major-present)、#17(major-present)、#18(major-present)、#19(major-present)、#20(major-present)、#21(major-present)、#22(major-present)、#23(major-present)、#24(major-present)、#25(major-present)、#26(major-present)

## 决策清单（按输出顺序）

| 序号 | 动作 | 场景 | 章 | 规则 | 说明 |
|---|---|---|---|---|---|
| 1 | KEEP | #1 | 0 | R-PROTECT-MAJOR | major:尼斯 / major:黎恩 / chapter:0 |
| 2 | KEEP | #2 | 0 | R-PROTECT-MAJOR | major:尼斯 / major:黎恩 / chapter:0 |
| 3 | KEEP | #3 | 1 | R-PROTECT-CHAPTER | chapter:1 |
| 4 | KEEP | #4 | 1 | R-PROTECT-CHAPTER | chapter:1 |
| 5 | KEEP | #5 | 1 | R-PROTECT-MAJOR | major:黎恩 / major:尼斯 / chapter:1 |
| 6 | KEEP | #6 | 2 | R-PROTECT-MAJOR | major:黎恩 / major:尼斯 / major:琼斯 / chapter:2 |
| 7 | KEEP | #7 | 3 | R-PROTECT-MAJOR | major:黎恩 / major:尼斯 / major:琼斯 / chapter:3 |
| 8 | KEEP | #8 | 3 | R-PROTECT-MAJOR | major:黎恩 / major:尼斯 / major:维克托·莫特森 / major:琼斯 / chapter:3 |
| 9 | KEEP | #9 | 3 | R-PROTECT-MAJOR | major:黎恩 / major:尼斯 / major:维克托·莫特森 / chapter:3 |
| 10 | MERGE | #10+11 | 4 | R-PROTECT-MAJOR | major:维克托·莫特森 / chapter:4 |
| 11 | KEEP | #12 | 5 | R-PROTECT-MAJOR | major:维克托·莫特森 / major:黎恩 / major:尼斯 / chapter:5 |
| 12 | KEEP | #13 | 6 | R-PROTECT-MAJOR | major:尼斯 / chapter:6 |
| 13 | KEEP | #14 | 6 | R-PROTECT-MAJOR | major:艾瑞克 / major:黎恩 / chapter:6 |
| 14 | KEEP | #15 | 7 | R-PROTECT-MAJOR | major:黎恩 / major:艾瑞克 |
| 15 | KEEP | #16 | 8 | R-PROTECT-MAJOR | major:黎恩 / major:琼斯 / major:艾瑞克 / chapter:8 |
| 16 | MERGE | #17+18 | 9 | R-PROTECT-MAJOR | major:艾瑞克 |
| 17 | KEEP | #19 | 9 | R-PROTECT-MAJOR | major:黎恩 / major:艾瑞克 |
| 18 | KEEP | #20 | 10 | R-PROTECT-MAJOR | major:黎恩 / major:艾瑞克 / major:琼斯 |
| 19 | KEEP | #21 | 10 | R-PROTECT-MAJOR | major:黎恩 / major:艾瑞克 |
| 20 | KEEP | #22 | 10 | R-PROTECT-MAJOR | major:尼斯 / major:黎恩 / major:艾瑞克 |
| 21 | KEEP | #23 | 11 | R-PROTECT-MAJOR | major:黎恩 / major:尼斯 / chapter:11 |
| 22 | KEEP | #24 | 11 | R-PROTECT-MAJOR | major:黎恩 / major:琼斯 / major:尼斯 / chapter:11 |
| 23 | MERGE | #25+26 | 12 | R-PROTECT-MAJOR | major:琼斯 / major:黎恩 |

## 被删清单（DROP，仅 standard+）

（无）

## 人工评审要点（ADR-0003 第八节）

- 「该保的保了」：保护集命中报表是否覆盖你心中不可删的场次？
- 「该删的删了」：DROP 清单是否误伤主线/反差点；有无明显的"水场"未被删？
- 校准：目标比率 vs 实际比率 → 回写 ADR 档位建议值。
