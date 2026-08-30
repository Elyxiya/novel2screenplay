# Task 2.2 · 身份断言集 — 标注任务说明

> 关联 spec：`.trae/specs/conversion-quality-engineering/tasks.md` → Task 2.2、2.4、2.5
> 消费端：`scripts/eval/identity.mjs`（eval 侧规则）+ `apps/screenplay/src/lib/eval/identity-rules.ts`（运行时规则）
> 性质：**纯人力标注活**（规则与合成 fixture 已实现，只差真实样本真值）
> 预计耗时：**每本 1–2 小时** ×（3–5 短 + 3–5 中）

---

## 1. 这份文档是干什么的

Task 2.2 的产出一份**身份断言集**——从真实小说中挑选切片，人工标注三件事：

1. **谁在那一章死了**（死亡章）
2. **哪个隐藏身份在哪一章被揭示**（揭示章）
3. **主角/角色的化名 → 实名**（别名索引）

这些标注是**确定性断言规则**的输入，不是流水线输出反推出来的。标注完成后：
- 供 **Task 2.4《judge 稳定性报告》** 出方差、定噪声带阈值；
- 供 **Task 2.5 分层对比曲线**（前/中/后三段）出数；
- 供 **Task 1.6 / 3.4 数值验收**；
- 供 **Task 5 翻默认** 的 `Δ_tail` 数据口径。

一句话：**代码工程已完成，评估数据的真值全靠这批人工标注。** 生产这条标注链是本任务的唯一瓶颈。

---

## 2. 样本入选标准

从候选切片里选出 **3–5 本短 + 3–5 本中**，必须同时满足：

| 标准 | 含义 | 为什么 |
|------|------|--------|
| **别名密集** | 角色有多个称谓/化名（阿X、老X、绰号、真实姓名互指） | 让 `dead-character-no-speak`、`reveal-before-chapter`、`unresolved-alias-as-id` 三条规则都有戏可查 |
| **多线叙事** | 至少 2 条以上叙事线 / 派系 | 提高身份冲突与揭示事件密度，语义断言有料 |
| **清晰章节边界** | 章节切分规则稳定，能被 `novel/parser` 稳定识别 | 保证切片边界与流水线 `sourceChapterIndex` 对齐 |
| **（优先）含真实死亡/揭示事件** | 切片内有**文内真实死亡**或**身份揭示**，而非全依赖修辞 | **完全空的标注（无死亡/无揭示）对 judge 没有任何有效断言**——只有非空断言才能产出可用的稳定性方差与分层曲线。参见已标注样例的取舍（§7） |

> 切片长度：短 ≈ 8–20 章 / ≤30k token；中 ≈ 30–50 章 / ≈30k token（接近 `truncate` 上限，正好用来对比新旧 Phase1）。

---

## 3. 标注产物格式（`annotations.json`）

写回 `scripts/eval/samples/<sampleId>/annotation.json`，`schema` 固定为 `identity-annotation/v1`。对照现有两份已标注样例：
[xiuzhen-short](../../scripts/eval/samples/xiuzhen-short/annotation.json) · [xiuzhen-medium](../../scripts/eval/samples/xiuzhen-medium/annotation.json)

```jsonc
{
  "schema": "identity-annotation/v1",        // 固定，勿改
  "sampleId": "xxx",                        // 切片唯一 id
  "title": "书名（首部 N-M 章）",
  "author": "作者",
  "type": "short | medium",
  "sourceFile": "绝对路径原书",
  "originalChapterRange": [1, 15],          // 原书章节区间（书目全局编号）
  "chapterCount": 15,                       // 切片内章节数
  "inputTokensHint": 14771,                 // 切片近似 token 数（供成本预估）
  "_note": "诚实标注说明（见 §6）",

  "deadCharacters": [],                     // 见 §4.1
  "reveals": [],                            // 见 §4.2
  "aliasIndex": {},                         // 见 §4.3

  "charIdToName": {},                       // 脚本产物注入后填，标注阶段留空
  "scenesRef": null,                        // 脚本产物引用，标注阶段留空

  "candidates": {                           // 预筛候选，标注者需逐条裁决（见 §5）
    "deathHits": [ { "chapterIndex": 5, "chapterTitle": "初入京城", "line": "…" } ],
    "revealHits":  [ { "chapterIndex": 4, "chapterTitle": "衣锦回乡", "line": "…" } ]
  }
}
```

---

## 4. 三条确定性规则消费什么标注

### 4.1 `deadCharacters` — 已死角色不再开口（`dead-character-no-speak`）

规则：**标注为某章死亡的角色的对白，不得出现在源章节晚于死亡章的场景中。**

```json
{ "name": "王老三", "deathChapter": 8 }
```

- `name`：角色常用名（最终与剧本 `characterId → name` 对得上）。
- `deathChapter`：**角色真实死亡的章节号**（坐标体系见 §8 预检，须与流水线 `sourceChapterIndex` 一致）。

### 4.2 `reveals` — 揭示称谓不提前（`reveal-before-chapter`）

规则：**标注在 R 章揭示的隐藏身份名，不得出现在源章节早于 R 章的场景中。**

```json
{ "secretName": "白冷叶", "revealChapter": 12 }
```

- `secretName`：在 R 章才被揭开的隐藏身份名。
- `revealChapter`：揭示发生的章节号（同一坐标体系）。

### 4.3 `aliasIndex` — 别名未被解析成实体 id（`unresolved-alias-as-id`）

别名 → 规范实名。标注阶段**可先填已知的清晰化名**（如 `韩晓龙 → 白冷叶`）；完整的别名索引待剧本产物（角色表）注入后补全，不属于「编制死亡/揭示」主任务：

```json
{ "韩晓龙": "白冷叶" }
```

---

## 5. 工作步骤（每本 1–2h）

1. **预检（开工先验证，勿跳过）**：跑一次该切片的 `script/eval` 预处理（或抽 1–2 章过 `novel/parser`），确认切片的 `sourceChapterIndex` 用的是**原书全局编号**还是**切片内局部编号**；标注的 `deathChapter`/`revealChapter` 必须与流水线场景用的同一套编号，否则规则比对全错位。（参考 [task4-bridge-verification](./task4-bridge-verification.md) 的「先验证再开工」纪律）
2. **通读切片**：标记出所有「疑似死亡」「疑似揭示」的句子。
3. **裁决 deathHits**：对每条候选判断——这是否是**文内真实死亡事件**？（修辞排除见 §6）
4. **裁决 revealHits**：判断是否**真身份揭示**，记录揭示章。
5. **填 aliasIndex**：主角/常用角色化名。
6. **本地契约校验**：`node scripts/eval/contract.test.mjs`（零 LLM 成本），确认 annotation schema 合法、`name`/`secretName` 与 aliasIndex 无自相矛盾。
7. 每本**单独一个 commit**，`_note` 写诚实标注说明。

---

## 6. 诚实标注纪律（最重要，读三遍）

> 这是本任务的高压线。参考 [flip-decision-record](./flip-decision-record.md) 的「写实、无暗示」口径。

- **只标文内真实事件**。`deathHits` 预筛的多数是**修辞/语气用法**，**一律不算**：
  - 例：「笑死 / 累死 / 要饿死了 / 差一点被口水呛死」→ 修辞，不算死亡；
  - 例：「除非我死了 / 死了也要 / 人死了不成 / 急死了」→ 语气/夸张，不算死亡；
  - 例：「原来是X / 原来是老王」→ 认人语气，不算身份揭示，除非确实构成身份揭开节点。
- **如实为空是被允许的**。切片内没有干净死亡/揭示事件，就写空数组 + 在 `_note` 说明「honest empty，候选均为修辞用法」。**宁可空，不要无中生有**——编造死亡=喂给规则的假真值，污染下游全部稳定性/分层/翻默认决策。
- **后果**：完全空标注 → 三条确定性规则全 passed（零误报零成本），但**对 judge 无有效断言**。所以样本筛选阶段要尽量挑**含真实死亡/揭示**的切片；实在没有就如实空，并在 `_note` 记录，不硬凑。
- 已标注范例：短篇 `xiuzhen-short` 因干净事件缺失而全空；中篇 `xiuzhen-medium` 仅认两起真实死亡（王老三、夏建仁）——**这正是「有真实断言」优先于「数量多」的范本**。

---

## 7. 已就绪/待标注现状

| 样本 | 类型 | 现状 |
|------|------|------|
| `xiuzhen-short`（首部 1–15 章） | short | ✅ 已标注（死亡/揭示如实为空 + `韩晓龙→白冷叶`） |
| `xiuzhen-medium`（中部 20–55 章） | medium | ✅ 已标注（2 起真实死亡，`flip=false` 数据链已走通，见 `docs/conversion-quality/`） |
| `xiuzhen-medium2`（中段 60–95 章） | medium | ✅ 已标注（死亡/揭示如实为空 + `雷锋→白冷叶` 化名） |
| `zhanlan-short`（湛蓝之誓 118–130 章） | short | ✅ 已标注（维克托·莫特森死 6 / 黎恩·怀特揭示 4，坐标已对齐切片 `#N`） |
| `zhanlan-short2`（湛蓝之誓 161–179 章） | short | ✅ 已标注（死亡/揭示如实为空——白斯第 16 章自我献祭但文内未确认死亡、且于 zhanlan-long 切片存活故除；考特骑士死为背景回溯；别名 `琼斯·波诺佛尔→黎恩·怀特`） |
| `zhanlan-medium`（湛蓝之誓 118–160 章） | medium | ✅ 已标注（同 zhanlan-short 锚点扩 43 章，两条断言坐标已对齐切片 `#N`） |
| `zhanlan-short3`（湛蓝之誓 1–19 章） | short | ✅ 已标注（死亡/揭示如实为空——序章黎恩战死属背景设定、老师之死为回忆回溯、众神陨落是世界观背景均非文内事件；无干净隐藏真名揭示；无新增别名，覆盖首段 1–19 章） |
| `xiuzhen-short2`（中段 180–195 章） | short | ✅ 已标注（死亡/揭示如实为空，同 xiuzhen 系列） |
| `xiuzhen-medium3`（中段 110–145 章） | medium | ✅ 已标注（1 起文内死亡：陈长老#3 当场咽气，姓氏+职衔可个体锚定；排除匿名服毒探子/合云宗武王/藏尸双胞胎等；无揭示；`无香→长孙无香`） |
| `zhanlan-medium2`（湛蓝 50–90 章） | medium | ✅ 已标注（死亡/揭示如实空——波诺佛尔爵士 22 年前片外死、亡灵残魂处置非活体死亡、主角真名未在本片揭晓；别名 `琼斯·波诺佛尔/快手琼斯/黎恩·舒华泽 → 黎恩·怀特`） |
| `zhanlan-medium3`（湛蓝 70–110 章） | medium | ✅ 已标注（死亡/揭示如实空——沉船水手无名、卡尔森杀意预告非屏内确认；伪装冒名段无真名揭晓；别名 `琼斯·波诺佛尔/快手琼斯 → 黎恩·怀特`） |
| `last-cultivator` 长篇 | long | ❌ 未入选（724 章过载，仅留骨架） |
| `zhanlan-long`（中段 180–269 章） | long | ✅ 完整逐章标注（90 章，≈58.8k token 超 30k 截断上限；真实死亡 4 起：白斯@9 / 奥本·格雷戈里@67 / 妮娜@89 / 莱斯林@90；揭示 1 起：艾德萨斯@90；别名索引含 琼斯·波诺佛尔→黎恩·怀特、老亨利→艾德萨斯、亚哈·斯雷变体；供长样本 mapreduce 验证；坐标=切片内 1 起） |
| `xiuzhen-long`（长段 196–285 章） | long | ✅ 完整逐章标注（90 章，≈85.5k token 超 30k 截断上限；真实死亡 2 起：刘拳王@32 / 方晓语@68；揭示 1 起：亚伯罕@58；别名 叶白→白冷叶、干尸→亚伯罕；供长样本 mapreduce 验证；坐标=切片内 1 起） |

**余量缺口**：short 5 本、medium 6 本，均已超过 3–5 区间下限并向上限靠齐。long 非 2.2 强制项，已按扩展补 2 本长样本完整标注（zhanlan-long / xiuzhen-long，各超 30k 截断，供长样本 mapreduce 验证）。后续如需扩展可再各补 1–2 本，优先公共版权/自创作文本，原则：**有真实死亡/揭示事件的切片优先**。

---

## 8. 完成判定（验收）

- [ ] 获取 **3–5 短 + 3–5 中** 全量标注，`annotation.json` 全部通过 `schema=identity-annotation/v1` 契约校验；
- [ ] 至少包含 **2 本以上**含**非空** `deadCharacters` 或 `reveals` 的样本（保证 judge 有有效断言 + 稳定性方差可出）；
- [ ] **每类短/中各 ≥1 本**可用于 §2.4 复跑 k=5 × 双评委的方差研究；
- [ ] `deathChapter`/`revealChapter` 坐标体系与流水线 `sourceChapterIndex` 对齐（§5 预检有验证记录）；
- [ ] 每本独立 commit，`_note` 写诚实标注说明；标注链产出 `docs/` 落档（供 2.4/2.5 出数）。

> 落档位置跟随本计划纪律：**对比数字一律进 `docs/`（受版本控制），不入 `.trae/`**。