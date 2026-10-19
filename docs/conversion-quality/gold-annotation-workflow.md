# 金标注与评分链路（P2）

> 目标：把「剧本好不好」变成可复现的数字，并且**承认标注是模型预标 + 人工抽检**这个事实，
> 用 provenance 与独立性检查把偏差摆在明面上，而不是假装金标注是天上掉下来的。

## 0. 为什么不是「直接打分」

LLM-as-judge 有两个已知问题：模型自评有系统性偏好；同一配置自标自评是循环论证。
所以评分分两层：

1. **结构化指标**（客观、零成本、可复现）：角色召回/精确、场景边界 F1、sourceRef 溯源命中率；
2. **主观质量**（昂贵、有噪声）：人工盲评，模型 judge 只在通过与人工评分做相关性校准之后才允许进入门禁。

本文档只覆盖第 1 层所需的金标注；第 2 层的 judge 校准在 P2 后半段。

## 1. 四步链路

```bash
# ① LLM 预标：拿一次真实转换任务的 Phase1/Phase2 产物当草案
node scripts/eval/annotate.mjs --sample xiuzhen-short --job job_xxx \
     --db-dir apps/screenplay/data-test --db-file 1b-data.db

# ② 生成抽检单（Markdown，含自动体检）
node scripts/eval/review-sheet.mjs --sample xiuzhen-short

# ③ 人工抽检：改 annotation.draft.json → 另存 annotation.reviewed.json，
#    并把 meta.reviewed 置 true、填 meta.reviewedBy
#    然后冻结（校验 + 定稿 + 确定性切分 + 重建语料清单）→ 产出 gold.json
node scripts/eval/freeze.mjs --sample xiuzhen-short

# ④ 评分（单样本 / 全量）
node scripts/eval/score.mjs --sample xiuzhen-short --job job_xxx
node scripts/eval/score.mjs --all          # 读 samples/<id>/run.json
```

> 注意产物名：金标注是 **`gold.json`**，不是 `annotation.json`。
> 后者在历史样本里已被 `identity-annotation/v1`（身份/死亡/揭示事件标注）占用，
> 同名会直接覆盖旧文件——这是实测踩过的坑。

## 2. 为什么预标要用「真实运行产物」

标注口径必须与被评系统一致：同样的章节切分、同样的段落坐标系。否则场景边界比对没有意义。
代价是预标带有被评模型的偏差——由两件事兜底：

- **人工抽检**：`review.md` 只列需要核对的项，5–10 分钟一个样本；
- **独立性告警**：`score.mjs` 会检查金标注的 `provenance.modelId` 是否等于被评运行的模型，
  相同则显式告警「分数会偏高」（见 `checkIndependence`）。

## 3. 金标注格式（`screenplay-gold/v1`）

```jsonc
{
  "schema": "screenplay-gold/v1",
  "sampleId": "xiuzhen-short",
  "meta": {
    "chapterCount": 15,
    "reviewed": true,
    "reviewedBy": "人工抽检:第 1/5/9 章",
    "split": "train",                    // 由 sampleId 哈希确定性分配
    "provenance": { "source": "llm-draft", "modelId": "deepseek-chat", "jobId": "job_x", "promptHash": "..." }
  },
  "characters": [{ "name": "白冷叶", "aliases": ["韩晓龙"], "isMajor": true }],
  "scenes": [{ "chapterIndex": 0, "startParagraph": 0, "endParagraph": 3, "keyCharacterNames": ["白冷叶"] }],
  "keyDialogues": []
}
```

校验规则（`validateGold`）：schema 与 sampleId 必填、角色 canonical 不重名、别名冲突给 warning、
章号不越界、段落区间不倒置、空 scenes 给 warning。

## 4. 指标口径

| 指标 | 定义 | 为什么这样定 |
|------|------|--------------|
| Phase1 P/R/F1 | 角色按「名字或别名相交」贪心 1:1 匹配 | 别名归一后仍不命中就是漏/多，不引入编辑距离这类口径噪声 |
| Phase2 P/R/F1 | 同章内段落区间 **IoU ≥ 0.5** 记命中 | 边界天然有 ±1 段的摆动，IoU 比精确相等稳健 |
| Phase3 溯源命中率 | `sourceRef.excerpt` 是否真的出现在对应章节原文 | 不需要人工标注，任何运行都能算，直接反映「有没有编」 |

汇总用宏平均（各样本等权），避免长样本主导。**只有 `reviewed=true` 的样本计入 official**，
其余进 pending：允许先跑起来，但不会悄悄污染结论。

## 5. 样本集建议

- **规模**：30–40 条。少于 20 条时，宏平均的方差会盖过真实差异。
- **分层**：长度（<1 万 / 1–5 万 / >10 万）、体裁（对白密集 / 动作密集 / 群像）、
  难度（多别名、同名不同人、时间跳跃、倒叙）、对抗（3–5 条已知会失败）。
- **留出**：约 20% 进 holdout（`splitFor` 按 `sampleId` 哈希确定性分配，跨机器一致），
  只用于最终验证，不参与任何调参。
- **来源**：仓库已有 `scripts/eval/samples/*` 的切片（`chapters.txt`，`# N 标题` 分章），
  可直接在其上预标；新增样本只需建目录放 `chapters.txt`。

## 6. 抽检要看什么（`review.md` 的自动体检）

| 项 | 说明 | 为什么危险 |
|----|------|-----------|
| 未切出场景的章节 | Phase2 整章丢失 | 会让 Phase2 的 recall 虚高（金标注也缺），必须人工补 |
| 单段落场景 | 疑似过切 | 会把一个场景算成两个，拉低系统 precision |
| 未在任何场景出现的角色 | 角色卡与场景脱节 | 模型可能凭空造人，或场景漏标出场 |
| 没有别名的角色 | 疑似漏合并 | 同一人被拆成两条，后续会重复扣分 |
| 场景中出现但角色卡未登记 | 反向漏抽 | 正向体检只查「卡里的人是否出现」，抓不到模型在场景里临时造的名字 |

抽检不需要通读全文：先看体检项，再抽 2–3 章对照原文即可。

## 7. 已知边界

- `annotate.mjs` 依赖一次真实转换（要 API Key 与跑批），不是离线可造的；
- `keyDialogues` 字段已预留但当前评分未使用（先跑通 P/R，再谈对白保真度）；
- 语料清单 `manifest.json` 只收录 `gold.json`（`screenplay-gold/v1`），历史 `annotation.json`（`identity-annotation/v1`）是另一套口径，不混入；
- 评分报告写到 `pr-evidence/`（工作产物，不入库）。
