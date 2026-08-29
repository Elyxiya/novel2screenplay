# 点 1b 数据链执行计划（medium 两步付费，不跑 short）

> 阶段：Plan｜版本 v3｜对齐用户 2026-08-29 两轮评审意见
> 目标：给点 1b（conversion-quality 效果评估）产出**实测数据闭环**——medium 样本书分两步各付一次转换管线费用：
> 第一步旧路径验证链路 + 出基线格子，第二步新路径出 Δ_tail + 迷你分层曲线，回填翻默认决策记录。
> 硬纪律：不跑 short（空标注付费不出数）；不造 scenes；31.5k 贴线预期"无显著差"必须出数前预注册；**两个测点定义（语义 ground truth、占位率参考集）与脚本入库分界在付钱前钉死（v2）；历史 job 零成本实测验证 + 预注册时序先于第二步出数（v3）**。

---

## 0. 已确认的机制事实（探索结论，计划据此落地）

| 事实 | 证据 |
|---|---|
| 模式切换：`PHASE1_MODE=mapreduce` 走新路径，缺省（不设）走旧路径 truncate | [Phase1Analyzer.ts L58](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\pipeline\Phase1Analyzer.ts#L58) `options?.mode ?? (process.env.PHASE1_MODE==='mapreduce'?'mapreduce':resolveDefaultPhase1Mode())` |
| 默认模式当前恒为 `truncate`（翻默认开关由 resolveDefaultPhase1Mode 统一把守） | [phase1-budget.ts L93-94](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\pipeline\phase1-budget.ts#L93-L94) |
| 直接喂文本起转换：`POST /api/pipeline/start` 收 `novelText`（需登录） | [pipeline/start/route.ts L15-28](e:\桌面\novel\novel2screenplay\apps\screenplay\src\app\api\pipeline\start\route.ts#L15-L28) |
| 轮询状态：`GET /api/pipeline/status/[jobId]`；产物在 `pipelineState.phase4Output`（即 `Screenplay`）与 `phase1Output` | e2e-p0-fullchain 同款式；db-peek 脚本读取验证 |
| 产物→judge 输入映射：`phase4Output.scenes`=ScreenplayScene[]；`charIdToName` 由 `phase1Output.characters`（id→name）出；`aliasIndex` 来自 phase1 reduce | [Phase4Merger.ts L101](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\pipeline\Phase4Merger.ts#L101)（未解析 id 保留原始名=占位信号）；[sets.mjs buildIdentityRealCells](e:\桌面\novel\novel2screenplay\scripts\eval\sets.mjs#L197-L238) |
| Δ_tail = judge 噪声带（语义格复跑方差），只依赖 scenes+内容，**不依赖 death/reveal** | [stability.mjs](e:\桌面\novel\novel2screenplay\scripts\eval\stability.mjs) judgeNoiseBand / deltaTailThreshold |
| **占位率**不是现成已落地指标，需零成本从 phase4 派生出独立小模块 | 全库 grep 无 occupancy/覆盖率指标；Phase4Merger 未解析 id 保留原始名可作占位信号 |
| DB 隔离：dev server 起 `DB_FILE=data-test/...` 即可不污染真实数据 | 项目仓库测试约定（vitest 用 data-test） |
| `identity` set 只有 `scenes`+`charIdToName` 非空才产真实规则格；否则只出语义占位（in=0） | [sets.mjs L199-201](e:\桌面\novel\novel2screenplay\scripts\eval\sets.mjs#L199-L201) |

**v2 钉死：两个测点定义（付钱前必须确定，不改动不临场发挥）**

- **语义 judge ground truth（问题 1）**：语义格判分基准 = `annotation.json` 的**人工事实断言**（从原文摘出的事实性表述 + 章节锚定，如"角色 X 于 R 章揭示身份名 Y"），**描述原文、非输出推导**，与确定性断言同源。绝不得拿各路径自己的 `phase1Output`/`phase4Output` 设定卡当判分事实（否则截断路径卡片更小、可矛盾事实更少，方向性倒错——循环）。实现上加一个 `semanticAssertions[]` 标注槽位，judge 以槽位表述锚定检查剧本场景。**预注册事实**：medium 目前只有 2 条死亡断言（规则格），语义断言可能为零；若为零，语义格不注入、Δ_tail 仅由规则格（王老三有观察窗、夏建仁窗近乎空）+ 占位率承载——写入预注册，跑到一半不临场加断言。
- **占位率参考集（问题 2）**：占位信号定义 = 场景 `characterIds` 中**不在参考集 id 集**的引用数 / 场景总引用数。参考集 = **`phase1Output.characters`（分析卡）的 id 集**（或等价 `phase4Output.characters` 的 id 集，二者同源）。依据 [Phase4Merger.ts L101](e:\桌面\novel\novel2screenplay\apps\screenplay\src\lib\pipeline\Phase4Merger.ts#L101)：未解析 id 保留原始名进入 `scene.characterIds`，但 `phase4.characters` 只由 `phase1.characters` 去重产出、**不会自动收占位角色**→ 占位引用恒存在、占位率不会恒 0。contract.test 的未解析正例必须同时覆盖 occupancy 模块（而非仅规则消费端）。

**脚本入库分界（问题 4）**：`scripts/eval/` 下的**脚本本身入库 git**（eval runner / judge / occupancy / contract.test 是 Task 2 交付物，也是 manifest hash 可复现的前提——判分代码不版本化 hash 锁不住任何东西，且入库存证是简历叙事的一部分）；**产物不入库**（`samples/<id>/<tag>.scenes.json`、`<tag>.run.json`、`data-test/*.db`）；正式报告入门 `docs/`。

---

## 1. 目标与迭代范围

**做什么**（用户已拍板）：
1. **不跑 short**。`xiuzhen-short` 标注如实为空 → 付管线费也不出断言数据（judge 面前无可判格），只会复现 current dry-run 的 in=0 症状。格式契约疑问用**零成本 fixture 单测**解决，不付费跑管线。
2. **medium 分两步跑**，每步有可验收产物，步间形成成本检查点：
   - **第一步 · 旧路径**（缺省 truncate）：产 `scenes`+`charIdToName` → 注入 → 真实规则格落位 → 基线通过率。全链路验证（格式/流程问题在最便宜处暴露）。
   - **第二步 · 新路径**（`PHASE1_MODE=mapreduce`）：产新 scenes → judge 稳定性迷你 Δ_tail → 双路径分层对比曲线（同书新旧两跑）→ 回填翻默认决策记录。
3. **31.5k 贴线预期如实预注册**：旧路径截断仅切尾部 ~1.5k token（约 1-2 章）。因此**大概率测出"无显著差"而非"尾段曲线被压平"**。此句必须在第二步出数前写进决策记录（T5-C1 口径=出数前定规则），防事后合理化。
4. **补占位率分层曲线作第二信号**（零 judge 成本，比两条死亡断言对该贴线样本更敏感）。
5. **前段三等分作免费阴性对照**：旧路径前段不应有损伤信号（不必用 short 当对照组）。
6. **judge 成本收窄**：语义 judge 只跑断言观察窗覆盖章节的场景；manifest hash 缓存保证重跑不重付。

**交付边界**：不跑 short；不做 `scope:'all'`；Tauri 后置；5.4 旧路径 flag 清理继续压到本数据链出数之后（旧路径是 baseline 来源）；death/reveal 空标注如实保留（§9.3 口径）。

---

## 2. 现状分析

- **已就绪**：两份样本（short 1-15 / medium 20-55）；medium 已填王老三(ch8)/夏建仁(ch36)；§9.3 验收口径已对齐（如实可为空）；`eval-runner --set identity --dry-run` exit 0。
- **阻塞点**：`scenes`+`charIdToName` 未注入 → `identity` set 只会出语义占位（in=0），无法出 Δ_tail / 曲线 / 决策回填。
- **关键认知**：全链路产物（`phase4Output`）已通过 `PipelineJobStateSchema` zod 校验（历史 job 5/5），格式契约成立；剩下只是"把样本喂进管线 + 把产物导出成 judge 输入 + 分层对比"的工程壳。

---

## 3. 改动方案（逐文件）

> **分界（v2 修正）**：新增/修改的脚本本身**入库 git**（Task 2 交付物 + manifest hash 复现前提，见 §0）；仅**运行产物不入库**（`<tag>.scenes.json` / `<tag>.run.json` / `data-test/*.db`）；正式报告落 `docs/` 或 `docs/conversion-quality/`。

### 3.1 格式契约零成本单测（不跑管线验证契约）
**新增** `scripts/eval/contract.test.mjs`（node 原生 assert，`node scripts/eval/contract.test.mjs` 运行，零 LLM）。
- 内含一个最小 `phase4Output`（Screenplay 形状）fixture + `phase1Output.characters` fixture（1-2 个 char id→name，含一个未解析 id=占位案例）。
- 断言：
  a．`phase4Output.scenes` 形状可被 `identity.mjs` 的 `runIdentityRule`'s 消费（scenes + charIdToName + aliasIndex + deadCharacters/reveals 的 data 形状）。
  b．`charIdToName` 由 `phase1Output.characters`（id→name）生成后，`runDeadCharacterNoSpeakRule` & `runUnresolvedAliasAsIdRule` 在已知 fatal/should-pass 场景下各自对（P/F 正确）。
  c．**占位信号提取（v2：同时覆盖 occupancy 参考集）**：未解析 id 保留原始名 → 进入 `scene.characterIds`，且**不在 `phase1Output.characters` id 集**内 → 被 occupancy 模块正确计数（占位率>0）；同时它在规则侧触发 `runUnresolvedAliasAsIdRule`。同一个 fixture 正例**两条消费端都断言**，防"只 cover 规则、占位率定义错整轮白跑"。
- **目的**：把"管线产物 ↔ judge 输入对不上"的担忧在零成本下证伪或证实，避免为契约不确定性去付管线费。

### 3.1b 历史 job 零成本验证（v3：关闭 fixture↔producer 缝隙）
**新增/复用** `scripts/eval/verify-historical-job.mjs`（零 LLM，只读）。
- 手造 fixture（3.1）只验证**消费端**（identity/occupancy 对形状的假设）；它验证不了 **Phase4Merger 实际行为**——若真实产物与假设不符（如占位角色实际被收进 characters、或 scenes/characters 形状另有变体），contract.test 照样绿、占位率在真数据上静默测错。
- 做法：从历史 job 库取一个真实 `pipelineState.phase4Output`（§2 已确认历史 job 5/5 通过 zod 校验），在其上同步跑 contract.test 的消费端断言 + occupancy 占位率——**零成本、真实 producer 输出**，把 fixture-vs-producer 的缝隙在付第一步钱前关掉。
- **判定与归因（v3 修正）**：真实产物下若占位信号>0 且 scenes/characters 形状断言全过 → 假设获支持。若占位率=0，**先排除良性解释再归因 producer 不符**——那可能是所选 job 的小说本身无未解析引用（如短文 / 全量分析自然全命中）。修法：**挑跨过截断线的历史 job**（较长、旧路径跑过所以尾部应含未知引用），或连验几个历史 job、**任一出现占位信号即证假设**，别拿单 job 的 0 直接推翻定义。另须确认所选 job 跑在 **Phase4Merger 当前行为（L101 保留原始名）之后**——太老的 job 可能是旧版 producer 产出，0 值同样无参考意义。
- **目的**：占位率定义成立与否，用真实 producer 决定性的信号验证，而非靠单 job 的 0 值武断下结论。

### 3.2 转换运行为脚本（付管线费，medium 两步共用）
**新增** `scripts/eval/run-conversion.mjs`（HTTP 驱动，e2e 同款式）。
- 入参：`--sample <id>`（读 `samples/<id>/chapters.txt`）、`--tag <old|new>`（决定输出前缀）、`--model`（默认 deepseek-chat）、`--base`（默认 http://localhost:3001）。
- 流程：
  1. 读样本章节文本拼成 `novelText`（保留章序；`selectedChapters` 传全部）。
  2. 注册+登录一次性用户（e2e 同款，取 cookie）。
  3. `POST /api/pipeline/start { novelText, title, author, modelId, selectedChapters: 全部 }` → `jobId`。
  4. 轮询 `GET /api/pipeline/status/[jobId]` 至 `status='completed'` 或超时；**超时/成本红线（v2 显式数值）**：单 job 显式超时 90 分钟（36 章 Phase3 数十次调用刻度如此），到时**导出 partial pipelineState 落 `<tag>.partial.json` 供诊断**，不静默挂起；费用硬上限 ¥20（超出即中止并报告已消耗，不"只记录"）——两条共同决定何时中止。
  5. 从 `pipelineState.phase4Output` 提取 `scenes`（ScreenplayScene[]）+ `characters`；从 `phase1Output.characters` 生成 `charIdToName`；收集 `phase1Output.aliasIndex`。
  6. 写入 `samples/<id>/<tag>.scenes.json`（含 `{scenes, charIdToName, aliasIndex}`），并把 `annotation.scenesRef` 指到它；写 `samples/<id>/<tag>.run.json`（jobId / status / 时长 / token 估算 / 格子数）。
- **运行方式**（重要）：旧路径＝dev server 不带 `PHASE1_MODE`（端口 3001）；新路径＝**另起 dev server 带 `PHASE1_MODE=mapreduce`（换端口，如 3002，避免 --base 默认 3001 撞机）**（或重启当前 server，env 变更生效）。两步共用同一脚本，`--tag` 区分产物 + `--base` 指向各自端口。
- **DB 隔离**：两个 dev server 的 `DB_FILE` 都指向 `data-test/` 下独立文件（如 `data-test/1b-data.db`），避免污染真实库。

### 3.3 占位率分层模块（零 LLM 第二信号）
**新增** `scripts/eval/occupancy.mjs`。
- 输入：`<tag>.scenes.json` 的 `scenes` + **参考集**（**`phase1Output.characters` 的 id 集**，即分析卡；由 run-conversion 一并写入 `<tag>.scenes.json` 的 `charIdSet` 字段）。
- 占位信号 = 场景 `characterIds` 中**不在参考集 id 集**的引用数 / 场景总引用数（v2 钉死，依据 Phase4Merger 未解析 id 保留原始名且不进入 characters）。按 `sourceChapterRange[0]` 归章；输出按章占位率序列 + 前/后各三分之一聚合。
- 旧 vs 新路径占位率对比即"截断区损伤"信号。**不调 LLM，纯计数**。
- 断言：前段（免费阴性对照）两路径占位率差异应≈0（**给容差，不必严格为 0**）；后段若 mapreduce 明显更低 → 截断损伤的证据；若≈0 → 佐证"贴线样本无显著差"。

### 3.4 第二步 judge 稳定性 + 迷你分层曲线（付第二步费用后跑）
**复用**既有 `eval-runner.mjs` / `judge.mjs` / `stability.mjs`，新增一个窄入口 **`scripts/eval/run-layered-curve.mjs`**（或给 eval-runner 加 `--scenes-file` 注入支持）：
- 读 `<old>.scenes.json` 与 `<new>.scenes.json`，各自注入 `identity` set。
- **语义 ground truth（v2 钉死，问题 1）**：语义 judge 判分基准 = `annotation.json` 的 `semanticAssertions[]`（人工从原文摘出的事实性表述 + 章节锚定，描述原文、非输出推导，与确定性断言同源），judge 以此锚定检查场景；**绝不拿各路径自己的设定卡当判分事实**（否则方向性倒错）。若 medium 无人工语义断言（当前预估为零），则语义格不注入、不硬造，Δ_tail 由规则格 + 占位率承载——写进预注册。
- **judge 成本收窄 + 窗口化**：语义 judge 只取"语义/死亡断言观察窗覆盖"的场景（medium 的死亡观察窗 + 贴线截断边界附近），不全书；`--reruns` 用小 k（4-6）；manifest hash 缓存保证重跑不重付。**窗口化的目的是让 judge 在断言可判定的局域内工作**，而非全域空扫描。
- **管线级方差（v2 预注册，问题 3）**：judge 噪声带只量化 judge 复跑方差；两条路径各跑一次，Phase2/Phase3 的 LLM 随机性未量化。预注册写明："n=1 单次运行，管线级方差未量化，任何差异只作方向性证据、不作统计结论；若占位率后段差异显著，先考虑一次定向复跑再下结论"。前段阴性对照给容差（≈0 不必严格为 0）。
- **语义格为零时判据退化（v3）**：§0 定义 Δ_tail 阈值 = judge 噪声带（复跑方差）；但语义格若为零（当前预估），stability 噪声带无从算起，"Δ_tail > 噪声带"沦为悬空条件。预注册补退化口径：语义格为零时，判据退化为**「规则格确定性差异 + 占位率差」**，且受管线级方差（n=1）限制——只作方向性证据，不作统计结论。
- 输出：
  - `docs/conversion-quality/1b-chain-measurement.md`（**第一步**产物：样本、两路径 scenes 格子数、真实规则格 P/F、基线通过率、占位率前/后段数值）。
  - `docs/conversion-quality/1b-layered-curve.md`（**第二步**产物：旧 vs 新 的判分/占位率按"前/中/后"分层表 + Δ_tail 数值 + 区间；结论）。

### 3.5 决策记录预注册 + 回填
**修改** `docs/conversion-quality/flip-decision-record.md`：
- 第二步**跑之前**写一节「T2.5 实测预注册」：31.5k 贴线 ⇒ 旧路径只截尾部 ~1.5k；尾段三等分多数场景两条路径设定卡一致；王老三观察窗全在保留文本内（新旧本就一致）、夏建仁观察窗近乎空 ⇒ **预期 Δ_tail≈0 / "无显著差"**；占位率后段为更敏感的判据；前段作阴性对照（给容差）。**六项必列（v2 三项 + v3 三项）**：①语义 ground truth 源（annotation 人工断言，可能为零则不注入）；②管线级方差未量化（n=1，差异仅方向性证据）；③不跑 short 的原因（空标注付费不出数）；④语义格为零时判据退化（→ 规则格确定性差异 + 占位率差，受 n=1 限制）；⑤旧路径占位率不应全段严格为 0（全 0 先怀疑定义）；⑥step-1 停点先验收再写预注册。
- 第二步**跑之后**追加「实测结论」：如实记录 Δ_tail 数值、占位率前后段、曲线形态，以及它是否支持翻默认（不做任何强扭说法）。
- 遵守「不得写『曲线判定通过』」禁忌：仅当实测 Δ_tail > 噪声带才可写"支持翻转"并附数字；若语义格为零（噪声带不可算），改用退化判据（规则格确定性差异 + 占位率差）并注明证据力度受限。

---

## 4. 假设与决策

1. **投入确认红线**：跑转换=真付 LLM 费。两步之间**必须停**——先看第一步产出的格子是否真的落数（`<tag>.run.json` 格子数>0、规则格非占位、占位率非全段严格为 0），**验收通过后先写「T2.5 实测预注册」再付第二步的钱**（时序见 §6.4-5）。硬上限 ¥20+90 分钟超时（§3.2）作脚本二道保险，主护栏为已接线的 BudgetController。
2. **不跑 short**：空标注付费也出不了断言，格式契约由 contract.test.mjs 覆盖。
3. **占位率模块是新增、非"现成"**：如实标注为"由 phase4 产物派生（复用 charNameToId 未解析保留原始名的占位信号）"，不虚报为已有指标。
4. **31.5k 贴线预期=无显著差**：以"预注册 + 如实报告"处理，不做手动调优去制造显著。
5. **脚本入库/产物入 git 分界（v2 修正）**：`scripts/eval/` 新增脚本入库 git（Task 2 交付物 + hash 复现前提）；产物（`samples/<id>/<tag>.scenes.json`、`<tag>.run.json`、`<tag>.partial.json`、data-test db）不入 git；需入库的正式证据仅 `docs/` 文档。
6. **judge 窗口化**：语义 judge 只跑观察窗覆盖场景，控制第二步成本和重复运行可严酷利用 manifest 缓存。
7. **模式选择**：旧路径=server 不带 `PHASE1_MODE`；新路径=`PHASE1_MODE=mapreduce`。脚本本身不偷偷改全局默认（`resolveDefaultPhase1Mode` 保持 truncate）。

---

## 5. 验证（对齐 9.3 验收，含用户的补充硬约束）

1. **格式契约**：`node scripts/eval/contract.test.mjs` 通过（exit 0，零 LLM）。
2. **历史 job 零成本验证（v3 新增）**：`verify-historical-job.mjs` 在真实 `phase4Output` 上跑消费端断言 + occupancy，占位信号>0 且场景无异常（producer↔fixture 缝隙关闭）。
3. **第一步产物**（旧路径跑完后）：
   - `<tag>.run.json` 存在且 `格子数>0`；`samples/xiuzhen-medium/old.scenes.json` 的 `scenes` 非空且 `charIdToName` 非空。
   - `docs/conversion-quality/1b-chain-measurement.md` 含：真实规则格 P/F（王老三/夏建仁死亡断言）、基线通过率、占位率前/后段数值。
   - **成本检查点（含 sanity）**：此处停下——确认**格子数 >0、规则格非占位、占位率非全段严格为 0**（与 §4.1/§6.4 条件一字不差一致；截断路径尾部场景机理上应出现未知引用，全 0 先怀疑定义而非"跑好了"），再进第二步。
4. **预注册**：`flip-decision-record.md` 含"T2.5 实测预注册"节（写明 31.5k 贴线、预期无显著差、占位率作更敏感判据、前段阴性对照、语义零退化口径、n=1 方差）——**该节在停点验收通过后、第二步付费之前写入（时序见 §6）**。
5. **第二步产物**（新路径跑完后）：`docs/conversion-quality/1b-layered-curve.md` 含旧 vs 新分层表 + Δ_tail 数值/区间；`flip-decision-record.md` 追加"实测结论"（如实，不注明"判定通过"除非 Δ_tail>噪声带且有数字；语义格为零时用退化判据并注明证据受限）。
6. **回归**：`npm run lint` / `npm run typecheck` / `npm test` 不受影响（改动仅 scripts/eval + data-test + docs，不入 app src；contract/run-conversion/occupancy 均与 app 单测无依赖）。若给 eval-runner 加 `--scenes-file`，保持纯 CLI-verify，不引入会跑 LLM 的单测。
7. **诚实口径保持**：§9.3 已对齐（如实可为空），short 的 dead/reveals 保持空，标注不凑数；占位率如实标"派生新增"。

---

## 6. 执行顺序（附成本节奏）

1. `contract.test.mjs`（零成本，先证契约）→ 过。
2. `verify-historical-job.mjs`（零成本，真实 producer 输出上跑消费端断言 + occupancy；关闭 fixture↔producer 缝隙）→ 过。
3. 起隔离 dev server（`DB_FILE=data-test/1b-data.db`，不带 `PHASE1_MODE`），跑 `run-conversion.mjs --sample xiuzhen-medium --tag old`（付第一天）。
4. **停点 · 验收**：生成 3.4 第一步报告 + contract/occupancy 核对——**格子数 >0、规则格非占位、占位率非全段严格为 0**（与 §4.1/§5.3 条件一字不差一致）。
5. **写「T2.5 实测预注册」**（§3.5 六项）到 `flip-decision-record.md`——**必须先于第二步出数写入**（反事后合理化纪律：规则先于数据）。
6. 换 **`PHASE1_MODE=mapreduce`** server（端口 3002，`--base http://localhost:3002`），跑 `--tag new`（付第二天）；judge 稳定性 + `run-layered-curve`（窗口化，控成本）。
7. 生成 `1b-layered-curve.md`、追加 `flip-decision-record.md` **实测结论**。
8. 全量回归（lint/typecheck/test）一次。

> 备注：若你第二步前仍想先跑 short（不推荐，见 X1），此处不改——默认严格按"memory 短样不跑"执行。