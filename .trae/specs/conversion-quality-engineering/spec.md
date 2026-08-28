# 转换质量与一致性工程（CONTEXT-ENGINEERING 阶段）

> 版本：v0.3.0 ｜ 编制日期：2026-08-29 ｜ 前置：pg-multitenant（R1–R6）已全绿
> 一句话：把埋在 30k token 截断里的转换质量塌方解除——用「Phase1 map-reduce 实体归并 + 实体键检索注入 + 评估迭代闭环 + 外科式 supervisor」重建长篇支持上限，并让每个方向都有可复现的硬性验收数字。
> 本次修订：补 5 项任务书缺口（滚动摘要生产者、name→charN 解析、章内分块、翻默认时点、自洽性代理盲区）+ 架构确认（orchestrator 与经典管线不共享，重转执行走经典链）。落档位置由 `.trae/documents/` 改为受版本控制的 `docs/`。

---

## 1. Why

- **真瓶颈（已核实）**：[Phase1Analyzer](file:///e:/桌面/novel/novel2screenplay/apps/screenplay/src/lib/pipeline/Phase1Analyzer.ts#L46) 用 `MAX_ANALYSIS_TOKENS=30000` 把全文直接截断——超过约 4 万字的小说丢内容，Phase1 抽取崩，Phase3 逐场景转换拿不到足够角色/前情上下文，一致性只能靠 LLM 自评。
- **脚手架闲置（已核实）**：`multi-agent/{registry,handoff-protocol,roles}` 与 `llm/adapter/budget-controller` 已实现但未接入主链路；ReviewGate 只有通用四维，**没有"身份不一致"信号**，无法驱动局部重规划。
- **评估全是手动**：四维 LLM 评估 + flow-evaluator + benchmark 都在 `/debug` 手动触发，无复现单元、prompt 无版本化，"改了 prompt 不知道好坏"。

## 2. 决策（与用户对齐，含修订项）

1. **跑道选型**：实体键检索优先，**本阶段不做向量库**（sqlite-vec/pgvector API 不相容，无法塞进现有 DbEngine 同步抽象，对小说一致性收益存疑）。向量库仅在四方向落地后、仍有证据表明覆盖不足时作为可选项。
2. **实体键检索的承重墙是归并**：Phase1 reduce 本身即实体归并，每次 merge 必须**落成数据**（`char_3 = 老秦(ch5) = 秦爷(ch12)`，带章节出处），保证断言测出矛盾时可回溯到具体 merge 决策。
3. **滚动摘要由 map 生产**：Task 1.2 的 map 抽取顺带让每次调用多输出 2–3 句本章摘要（同一章已读进上下文，边际成本≈100 token/章），落进设定卡契约——否则 Task 3 消费"前 N 章滚动摘要"时发现输入不存在，回头改契约又是一次 schema 往返。
4. **检索失效模式**：在场角色提及不在场角色（"秦爷当年说过"）→ **主角卡（isMajor=true，数量少）常驻注入所有场景，配角按键注入**；`open threads（带章节跨度的伏笔）`在 map 阶段顺带抽取，Phase3 按章节区间查询注入。均确定性。
5. **name→charN 解析显式化**：Task 3.1 组装前需一步显式的"在场角色名→实体"解析（用 Task 1 reduce 的别名索引），未命中名计入占位率——否则按键注入与占位率指标没有明确测点。
6. **外科式 supervisor（执行链已确认，数据链待核）**：**已核实 orchestrator 与经典管线不共享组件**——orchestrator 每相位 `new AgentCore` + `ROLE_PROMPTS` 并整段重喂 `task.input`，从不调用 Phase1Analyzer/Phase3SceneConverter/PipelineEngine。故**局部重转的执行必须走经典管线单场景路径**（复用 Task 3 组装器）：ReviewGate 判"身份不一致"→ orchestrator 仅决策（写 re-convert 请求）→ 经 `task.jobId` 取 StoredJob.pipelineState → 经典 Phase3SceneConverter+组装器重转该场景 → 写回 → 重跑身份断言。orchestrator **只决策不执行**。**桥接数据链开工前必须核实**：Task 4 开工前先写验证脚本确认 `task.jobId → StoredJob.pipelineState` 真实存在且格式可用；若 agent 路径产物从不写经典 pipelineState（探索显示它走 agent_tasks 自己的持久化），桥接还需先补「agent 产物 ↔ pipelineState 格式互转」层——此前提未核实前不算"已核实"（其余决策的"已核实"均有出处，此条同样须有）。
7. **评估窄开局**：只标注"身份一致性断言"；断言分两层——**确定性断言用规则检查（零成本零漂移）、语义断言才用 judge**。断言起草 LLM、人工核验不可省（唯一不可委托的体力活，预算短篇 1–2h/本）；**起草模型 ≠ 被评转换模型**。
8. **样本选取标准编码化**：入选 golden 的样本须"别名密集、多线叙事、有清晰章节边界切分"——否则选到干净样本，断言集测不出东西。3–5 短 + 3–5 中统一按此标准筛。
9. **评估复现单元 = manifest**：`(prompt 文件 hash, model id, 参数, 数据集 hash, judge prompt hash) → JSONL`，**按 hash 缓存**避免重付不变格子的钱；方差研究**限成本**（每类抽 1 本 × 复跑 k=5 × 双评委）；**双评委阈值不拍脑袋**，先跑复跑方差、用方差数据定阈值，产出《judge 稳定性报告》。**eval 战前成本预估**：T2-C5 为 6–10 本 × 新旧两路全跑，eval runner 须提供 `--dry-run` 输出总 token 预算（manifest 各格 token 预估值求和），跑前先见账。
10. **翻默认以数据为门槛**：新路径默认开启的唯一触发器 ="尾段断言通过率被压平 且 总分不劣"；定义门槛后走**专门 PR 翻默认 + e2e 全绿**，形成"数据说服我切默认"的叙事节点，而非"写完就切"。**Δ_tail 的合法来源 = T2-C4《judge 稳定性报告》方差**：Δ_tail 必须大于 judge 复跑噪声带（2×SD 或置信区间宽度），否则曲线差值落进噪声内规则无法裁决；评委方差在 T2-C4 定阈值**同一份数据**驱动 T5-C1。
11. **预算守卫挂点前置（修订）**：真实成本尖峰是 **map-reduce 本身**（旧路径只处理截断后的 30k token，新路径全书 N 章各一次调用），不是实体键注入。故：Task 1 的 **map 循环内置廉价 cap**（每 job 最大章节数 × 每章 token 预估，超限优雅降级）；Task 5 翻默认时把 `canRequest` 接到 **Phase1 调用点**（堵住翻默认 → Task 3 之间的无守卫窗口）；Task 3 只是把守卫**扩到 Phase3 注入点**。不再声称 Task 3 是首个成本增量。
12. **自洽性代理保留但标局限**：两切序 reduce `实体集差`只抓顺序不稳定，抓不了"稳定地错"（始终把老秦/秦爷分成两个实体的 reduce 两种顺序一致、代理满分）。故**并列报一个 correctness floor**：挑 1 本短篇人工数主要角色数，`实体数/人工数`比值作为合并质量基线，与代理并列，不被当成完整度量。
13. **旧路径留 flag**：Phase1 旧截断路径保留做 baseline，步骤间对比数字在其产物上量出；翻默认后再整体清掉 flag（另走一次独立 PR）。

## 3. What Changes

- **契约变更（仅增量，非 breaking）**：
  - `packages/contracts/src/pipeline.ts`：`RawCharacter` 追加 `mergeProvenance`（本次归并的别名/出处链）；新增统一输出类型承载「全局设定卡 + open threads + **章节摘要**」。
  - `packages/contracts/src/screenplay.ts` / `validator.ts`：占位 stub（`未知角色(...)`）改为**保留原始名**（如 `未知角色(id=老秦)`），供后续 resolve——**行为变更，需 ask-first 后再动**。
- **Phase1Analyzer 改 map-reduce**：章节级（章内可分块）并行抽取（角色/地点/时间线/open-threads/**每章 2–3 句摘要**）→ reduce 归并成全局设定卡；实体归并决策落 data（带出处）。
- **评估基础设施**：eval runner（`npm run eval -- --set <name> --model <id>`），manifest 复现 + hash 缓存；身份断言集（确定性 + 语义）+ 样本选取标准 + 分层对比 + 《judge 稳定性报告》。
- **Phase3 上下文组装 + 解析**：显式"在场角色名→实体"解析（别名索引）；主角卡常驻 + 配角按键 + 滚动摘要 + open-threads 区间注入；`BudgetController` 接主链路 `canRequest` 检查于 Phase3 调用点。
- **外科式 supervisor**：ReviewGate 增 `identity` 信号；orchestrator 增 escalation 预算 + 局部重转**请求**（决策层）+ **经典管线重转桥接器**（执行层，吃 Task 3 组装器）；`multi-agent` 现有 registry/handoff 接入该路径。回调路径默认关。

## 4. Impact

- **Affected specs**：`@novel/contracts`（pipeline/screenplay）、`@novel/db`（若设定卡落库；本阶段优先**不落库**，随 pipelineState 携带以降 schema 风险）、Phase1/3 管线、multi-agent orchestrator + review-gate、eval/debug、文档。
- **Affected code（主）**：
  - `apps/screenplay/src/lib/pipeline/Phase1Analyzer.ts`、`ContextManager.ts`、`Phase3SceneConverter.ts`
  - `apps/screenplay/src/lib/pipeline/PipelineEngine.ts`（接翻默认与预算守卫）
  - `apps/screenplay/src/lib/multi-agent/orchestrator.ts`、`review-gate.ts`
  - `apps/screenplay/src/lib/llm/adapter/budget-controller.ts`
  - `packages/contracts/src/{pipeline,screenplay,validator}.ts`
  - 新增：eval runner + manifest + 断言集（`apps/screenplay/src/lib/eval/` 及脚本）
- **不触碰**：存储双后端、auth、CI 主闸门（验收走既有 lint/typecheck/test/build）。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 实体归并误合并（过合并）→ 碎片率失真 | 碎片率仅当"欠合并"哨兵；过合并由步骤 2 语义断言集兜底；correctness floor（1 本人工数）并列报，防当完整度量 |
| 自洽性代理盲区（稳定地错满分） | 代理只测顺序稳定性；**显式并报 correctness floor**，二者互补（spec §2.12） |
| 超长单章（网文 8 万字/章）仍超 30k | map 层**章内二次分块**（按 size + 少量重叠，复用 ContextManager.splitIntoChunks）；验收"不再截断"含此场景 |
| 集中式"降/压平"事后合理化 | 翻默认前**先写决策规则**（尾段差值阈值），出数后照规则判，不临时改口径 |
| 评估体系循环性（judge 评自己产出） | 断言描述的是**原文事实**非输出；起草模型 ≠ 被评转换模型；双评委 + 人工抽检校准 |
| 动态编排成本失控 / 回归面 | escalation 预算 K=3 截断 → 落 `manual_review`；BudgetController 守卫单 job token；默认关 flag 保主链 |
| orchestrator 重转执行链不一致 | **已确认不共享**；重转执行硬走经典管线单场景路径 + Task 3 组装器，orchestrator 只决策 |
| 改 validator 行为影响既有转换 | 占位 rawName 保留为**增量**，不破坏 create，记录里多带名；先 ask 后动 |
| 上下文注入抬高单场景 token | BudgetController 与 Task 3 同步落，token/字增幅**如实入表**再决策 |

## 6. 验收标准（执行表硬标志，逐条可量化，动下一步前必须落 `docs/`）

- **Task 1 完成标志**：30k 跨界样本（>4 万字，**含 8 万字级单章**）**不再被截断**（旧路径 flag 外）且产出全局设定卡（含章节摘要/open-threads/mergeProvenance）；实体自洽性代理 + correctness floor 并列出数（免标注/人工各一）；两路径并存可切换。
- **Task 2 完成标志**：样本按入选标准筛出（别名密集/多线/章节边界）；judge 复跑方差量化成《judge 稳定性报告》，阈值从方差数据定出（成本受限：每类 1 本 × k=5 × 双评委）；新旧 Phase1 断言通过率**按章节前/中/后三段**出对比曲线。
- **翻默认完成标志（独立小 PR）**：尾段曲线压平 且 总分不劣（阈值预先定）→ 专门 PR 翻默认 + e2e 全绿；flag 保留至翻默认后的独立清理 PR。
- **Task 3 完成标志**：显式解析步骤可用（未命中计入占位率）；断言矛盾率降、占位角色率降；token/字增幅**如实入表**；BudgetController 超限**真实拦截**（单测证明）。
- **Task 4 完成标志**：identity 信号判"身份不一致"→ orchestrator 发 re-convert 请求 → **经典单场景链**重转并写回 → 重跑断言通过；escalation 率与局部重转成功率出对照数字；**主链默认行为零变化**（flag 关闭 e2e 与改造前一致）。

## 7. 产出物清单

- `packages/contracts`：`mergeProvenance` + 设定卡(含章节摘要)/open-threads 类型 + 占位 rawName 保留
- `Phase1 map-reduce` 两路径实现（章内分块；flag 切换 baseline）
- eval runner + manifest 缓存 + 身份断言集 + 三层报告（稳定性/分层/对照）
- Phase3 上下文组装器 + name→charN 解析 + BudgetController 主链接入
- ReviewGate `identity` 信号 + orchestrator escalation/re-convert 请求 + 经典链重转桥接器（默认关）
- **翻默认独立 PR**（数据门槛驱动）
- `docs/`（受版本控制）：每步对比数字落档（沿用 ADR/验证纪律）；`docs/项目框架.md` 更新