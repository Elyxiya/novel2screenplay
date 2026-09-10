# Phase1 三模式首测对比：truncate vs longctx vs mapreduce（B-01）

> 日期：2026-09-11 ｜ 样本：`zhanlan-short`（13 章 / 34.1k 字符 ≈ 44.5k token）｜ 模型：`deepseek-chat` ｜ 提示词指纹：`d4476f2bc226a7bb`（三轮同 prompt）
> 口径：同一 server 代码，仅以 `PHASE1_MODE` 切换；每模式一次运行（n=1）；成本各 ¥0.04、耗时 1.1–1.2min、均 completed。

## 运行口径

| 模式 | server env | Phase1 调用形态 | 本样本实际 |
|---|---|---|---|
| truncate | 默认（无 PHASE1_MODE） | 单次，截断到 30k token | 全文 44.5k → **截尾约 14.5k token** |
| longctx | `PHASE1_MODE=longctx` | 单次，不截断（窗口守卫 ≤90%） | 44.5k ≤ 58.98k（65536×0.9）→ **全文单次** |
| mapreduce | `PHASE1_MODE=mapreduce` | 每章一次性抽取 + 一次归并 | 13+1 次调用 |

## 指标对比

| 模式 | 场景数 | 角色 | 参考卡 idSet | 占位率 前/中/后/全段 | 身份断言格 | 耗时 | 估算成本 |
|---|---|---|---|---|---|---|---|
| truncate | 32 | 13 | 8 | 9.4% / 15.2% / **0.0%** / 9.8% | dead=P **reveal=FAIL(8)** alias=P | 1.2min | ¥0.04 |
| longctx | 29 | 12 | 7 | 7.4% / 16.1% / 6.7% / 11.0% | dead=P **reveal=FAIL(6)** alias=P | 1.2min | ¥0.04 |
| mapreduce | 26 | 15 | **13** | 0.0% / 20.0% / **0.0%** / **7.2%** | dead=P **reveal=PASS** alias=P | 1.1min | ¥0.04 |

## 观察（n=1，方向性证据；噪声参照见 drift-fix10-prompt.md）

1. **mapreduce 是唯一 reveal 规则全过的模式**，且参考卡 idSet 最大（13 vs 7–8）——与既有结论一致：map-reduce 的收益集中在**识别面扩容**（角色卡覆盖更大 → 别名/揭示解析更全）。本样本仅 44.5k token，截断只丢尾部 ~14.5k，但 reveal 违规数（8/6 vs 0）显示**长文本一致性信号的差距在中等长度样本上即可出现**。
2. **longctx 未优于 truncate**：reveal FAIL 6 vs 8（同在噪声量级内，B-02 基线显示同类差异可达数点），占位率全段 11.0% vs 9.8%（方向不利）。longctx 的价值不在本样本（44.5k 尚未严重超限）；其目标场景是**超出截断上限但仍在窗口内的长文本**（30k–58k token 区间），且**必须配大窗口模型**（deepseek-chat 64k；更大的书会触发窗口守卫降级）。
3. **中段占位率三模式均偏高（15–20%）**：切分密度与角色引用集中在段落中部的样本特征，非模式差异。

## 预注册与后续

- 本对比为 n=1 首测，**不构成任何模式取舍结论**；三模式比较若要定论，需按 B-02 纪律做 n≥3 复跑并比对噪声基线。
- 已知适用边界（实现保证）：longctx 在 `token > 窗口×0.9` 或预算超限时自动降级 truncate（单测覆盖），不会把超窗请求打给 provider。
- 复现：`PHASE1_MODE=<mode> npm run dev` + `node scripts/eval/run-once.mjs --name phase1-<mode> --sample zhanlan-short`（两次）。
