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
  "scenes": [{
    "chapterIndex": 0,
    "startParagraph": 0,
    "endParagraph": 3,
    "keyCharacterNames": ["白冷叶"],          // 实际在场（允许未点名的角色）
    "mentionedCharacterNames": ["云韵"]       // 对话/背景提及、但不在场
  }],
  "keyDialogues": []
}
```

### 出场 vs 提及（实测口径）

抽检 `doupo-short` 时暴露过一个必须写死的问题：**「提到」和「在场」不是一回事**。

- **`keyCharacterNames` = 实际在场**。允许「在场但未点名」——例如《斗破苍穹》第 3 章那位
  「戴绿色玉坠、三星斗者的少女」就是纳兰嫣然，全章没写她的名字，但她确实在厅上。
  金标注按事实把她计入，模型的漏标就是真实漏标。
- **`mentionedCharacterNames` = 对话/背景中提及、但不在场**。例如云韵（只出现在
  「被云韵收为弟子」「云岚宗宗主云韵」这类叙述里）、纳兰桀、古河。

这条区分同时修掉了抽检单的一个误报：只按 `keyCharacterNames` 判「孤儿角色」时，
云韵/纳兰桀/古河会被误判成「角色卡里有、场景里没有」；实际他们是**提及型**角色。
（Phase 3 构造上下文时只应注入「在场」角色，所以两个字段不能合并。）

### 别名 vs 描述（同一个坑的第二面）

**别名是双向同一性断言，描述只是场景内单向指代。** 这两者绝不能混：

| 类型 | 例子 | 能否进 `aliases` | 为什么 |
|------|------|------------------|--------|
| 姓名 | 白冷叶、纳兰嫣然 | ✅ | 全书唯一指代 |
| 稳定绰号/称号 | 万年老鬼、丹王古河、狮心元帅、万物怀表之主 | ✅ | 全书稳定指代同一人 |
| 关系/职务称谓 | 大副、豆豆妈、萧族长 | ✅（在多处唯一时） | 文本本身用它当称呼 |
| 外观/性别年龄描述 | **中年男子**、青衫老者、黄袍老者、妇女、开马六的男子、烧伤疤痕老头 | ❌ | 只在某一场景指代某人；别处的「中年男子」可能是另一个人 |

错误示范（真实踩过）：「方晓语的父亲是中年男子」→ 把「中年男子」写成别名 →
等价于宣称「所有中年男子都是方晓语父亲」，后续任何出现「中年男子」的场景都会被错误并入。

正确处理：场景的 `keyCharacterNames` 写规范名 `方晓语父亲`，把「这一场他是中年男子」
留在抽检记录/场景备注里；描述不进全局别名表。校验器 `validateGold` 对描述性别名给 warning
（`DESCRIPTOR_ALIAS_RE`）。

> 注意与上一条的区别：「在场但未点名」是**场景事实**（计入 `keyCharacterNames`），
> 而「用某个描述指代他」是**称呼问题**（不进 `aliases`）。纳兰嫣然那次只补了场景，没有加别名，是对的。

校验规则（`validateGold`）：schema 与 sampleId 必填、角色 canonical 不重名、别名冲突给 warning、
描述性别名给 warning、章号不越界、段落区间不倒置、空 scenes 给 warning、
`mentionedCharacterNames` 里出现角色卡之外的名字给 warning（可能是漏抽或别名未归一）。

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
| 未在任何场景出现的角色 | 角色卡与场景脱节 | 模型可能凭空造人，或场景漏标出场（判孤儿时把 `mentionedCharacterNames` 也算上） |
| 没有别名的角色 | 疑似漏合并 | 同一人被拆成两条，后续会重复扣分 |
| 场景中出现但角色卡未登记 | 反向漏抽 | 正向体检只查「卡里的人是否出现」，抓不到模型在场景里临时造的名字 |

抽检不需要通读全文：先看体检项，再抽 2–3 章对照原文即可。

## 7. 背景解释与人物关系放在哪

原文里大量信息不是「戏」，而是解释：某人是谁的孙女、谁的师父、和谁有旧交。
这类内容如果被写成场景里的动作块，剧本就会变成有声书。按落点分三类：

| 类型 | 原文形态 | 应该落到哪 | 例子（doupo） |
|------|----------|-----------|---------------|
| **对话交代** | 由在场角色说出口 | 保留为 `dialogue` 块；说话人进 `keyCharacterNames`，被谈及者进 `mentionedCharacterNames` | 熏儿向萧炎解释婚约来历 |
| **叙述/旁白** | 叙述者概述，无人在说 | **不进场景**；抽为角色卡的 `description` / 关系 | 「纳兰桀在家族中拥有绝对的话语权……」 |
| **关系设定** | 祖孙 / 师徒 / 婚约 / 旧交 | 角色卡的 `description`（现在是自由文本），后续升级为结构化 `relationships` | 纳兰桀–纳兰嫣然（祖孙）、云韵–纳兰嫣然（师徒） |

**实测结论**：Phase 1 其实已经把这些写进了 `description`，例如
`纳兰桀 = 加玛帝国狮心元帅，纳兰嫣然的爷爷，与萧炎爷爷是生死好友，定下婚约`。
问题不在抽取，而在下游：

1. 早期 `buildDraftAnnotation` 把 `description` / `personalityTags` 丢了（已修，金标注现在保留）；
2. Phase 3 注入上下文时只截 `description` 前 20 字（`buildSceneContext`），关系信息基本没用上；
3. `description` 是自由文本，无法查询、无法校验一致性——「谁是谁的爷爷」只能靠人读。

**建议的最小演进**（不做图数据库也能做，按优先级）：

1. ✅ `convert-scene` prompt 已加硬约束（合并进规则 7，保持 8 条规则 / <900 token 的既有护栏）：
   **身世、关系、师承、恩怨等设定信息不得写成 action 或「心想」，只能由在场角色逐字对白交代，旁白直述一律丢弃**；
2. ✅ Phase 3 上下文改为注入「身份分句」（`identityClause`：按句读切第一个分句、上限 40 字），
   取代原来硬截 20 字（旧实现常截在「纳兰嫣然的孙…」处，关系词被切断）；
3. ✅ 评测新增 `expositionRate`（action 块中的关系断言占比），**实测口径**：
   只看 action、不看 sourceRef——第一版按「无出处」筛，结果 348/348 块都带引用，筛不出任何东西；
4. ⬜ `RawCharacter` 增加 `relationships: [{ target, type, chapterIndex }]`，Phase 3 只注入 1-hop 关系；
5. ⬜ 关系结构化之后，再决定要不要上图存储。

**实测结论（doupo-short，改 prompt 前 3 次 / 后 2 次）**：`action` 块里的关系断言始终是 **0**
（166 / 192 / 186 / 179 / 177 个 action 块）。也就是说现有提示词本来就基本挡住了这类泄漏——
这次改动是**护栏**，不是修 bug；它的价值在于把「不许做」写死，防止后续调提示词时回退。

这条路线同时也是 GraphRAG 的最小前置：先有字段级关系，再决定是否值得上图存储。

## 8. 已知边界

- `annotate.mjs` 依赖一次真实转换（要 API Key 与跑批），不是离线可造的；
- `keyDialogues` 字段已预留但当前评分未使用（先跑通 P/R，再谈对白保真度）；
- 语料清单 `manifest.json` 只收录 `gold.json`（`screenplay-gold/v1`），历史 `annotation.json`（`identity-annotation/v1`）是另一套口径，不混入；
- 评分报告写到 `pr-evidence/`（工作产物，不入库）。
