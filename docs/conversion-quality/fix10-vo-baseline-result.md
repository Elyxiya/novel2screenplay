# FIX-10（VO 决策）baseline 对比结果与裁决

> 日期：2026-09-11 ｜ 工具：`scripts/eval/prompt-diff.mjs`（B-07 首例）｜ 报告：[prompt-diff-vo-baseline.md](./prompt-diff-vo-baseline.md)
> 样本：`zhanlan-short`（13 章 / 34.1k 字符，真实断言 1 死 + 1 揭示 + 1 别名）｜ 模型：`deepseek-chat` ｜ 成本：¥0.04/侧

## 对比对象

| 侧 | 提示词 | sha256（前 16） | 字符数 |
|---|---|---|---|
| old | FIX-10 之前（含 `心理→(VO) 内心独白或表情动作`） | `777a7aa6e769421f` | 1087 |
| new | FIX-10 之后（B 案：心理→可见表情动作，禁旁白式改写） | `d4476f2bc226a7bb` | 1109 |

## 结果（n=1，逐字照录）

- **身份断言格**：old = dead PASS / **reveal FAIL(5)** / alias PASS；new = dead PASS / **reveal FAIL(6)** / alias PASS。
- **占位率**：old 全段 7.2%（前 0.0 / 中 19.2 / 后 0.0）；new 全段 11.9%（前 4.2 / 中 21.4 / 后 6.7）。**差值：全段 +4.7pt、后段 +6.7pt（方向不利）**。
- 运行元数据：两侧均 completed，1.1min，27 vs 26 场景，参考卡 8 vs 7 角色。

## 裁决（诚实，不让步）

1. **维持 B 案（不因本结果回退）**。FIX-10 的第一性理由是**契约一致性**——旧提示词承诺了 `ContentBlockSchema` 无法承载的 VO 通道（D-09 裂缝），这不是质量优化实验，回退等于把已知裂缝放回去。质量信号在本例中方向不利，但属 n=1 单次运行，且与 VO 分支无因果通道（reveal/占位差异更可能来自 27v26 场景与单次运行方差）。
2. **本结果如实入档为"方向不利的阴性证据"**，并进入前车之鉴：若后续对规则 7 措辞再迭代，必须带 n≥3 复跑（drift.mjs，B-02）作为采纳门，不接受 n=1 定论——两侧皆同。
3. **预注册后续动作**（触发即执行，不追溯修改本记录）：
   - 若同类样本复跑（n≥3）中 reveal FAIL 均值仍高于旧版，或占位率后段仍显著劣化 → 立项"规则 7 措辞迭代"（例如把"外化不了则忽略"改为"外化不了则保持动作最小化改写"，仍不恢复 VO）；
   - 迭代同样走 prompt-diff 并附 n≥3 报告后方可翻默认。

## 后续补测：同提示词稳定性基线（B-02，加固本裁决）

2026-09-11 对同一（新）提示词做 N=3 复跑（见 [drift-fix10-prompt.md](./drift-fix10-prompt.md)）：

| 指标 | 实测（zhanlan-short，N=3） |
|---|---|
| 场景边界数 | 28 / 32 / 29，**方差 2.89** |
| 每章场景数 L1 漂移 | 7.33 |
| 角色集合 Jaccard | mean 0.71（min 0.64） |
| 事件一致率 | mean 0.67（min 0.63） |

**单次运行噪声显著**——本对比的 reveal FAIL(5→6) 与占位率 +4.7pt 差值明确落在噪声量级内，
"维持 B 案、n=1 不作质量定论"的判断由此加固。同时该基线成为后续任何 prompt 采纳门的参照：
在同一采样口径下，**小于噪声级的差异不构成采纳/回退依据**。

## 复现

```bash
# 双 dev server（Next 项目级单实例锁：串行执行）
CONVERT_PROMPT_FILE=data/prompt-dump/vo-baseline-old.txt npm run dev -w @novel/screenplay   # 3001
node scripts/eval/prompt-diff.mjs --name vo-baseline --sample zhanlan-short \
  --old-file data/prompt-dump/vo-baseline-old.txt --new-file data/prompt-dump/vo-baseline-new.txt --only old
# 重启 server 指向 new.txt 后再跑 --only new，最后 --report-only
```
