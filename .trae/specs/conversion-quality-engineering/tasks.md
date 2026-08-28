# 转换质量与一致性工程 - 任务分解

> 依赖：pg-multitenant（R1–R6）全绿；仓库说明与验收标准见 `spec.md`（v0.3.0）
> 纪律：**每个 Task 的对比数字（硬性）必须在动下一个 Task 前写入受版本控制的 `docs/`**；每 Task 结束均单独回归（lint/typecheck/test）。
> 架构前提（已核实）：orchestrator 与经典管线**不共享**——Task 4 局部重转执行走经典链，orchestrator 只决策。

---

## Task 1 · Phase1 map-reduce + 实体归并落数据（步骤 1）

**目标**：解除 30k 截断（含超长单章），章节并行抽取 → reduce 归并成全局设定卡；merge 决策落数据带出处。**旧截断路径保留，flag 切换 baseline。**

**前置（ask-first）**：新增 `mergeProvenance`/设定卡类型为增量、非破坏，直接做。`validator` 占位 rawName 保留属**行为变更，需先确认**（见 1.5）。

- [x] 1.1 契约增量（`packages/contracts/src/pipeline.ts`）：`RawCharacter` 增 `mergeProvenance`（别名/出处链）；新增统一输出类型 =「全局设定卡（含**章节摘要**）/ open threads（带章节跨度）」，schema 携带别名索引；rebuild `@novel/contracts`。
- [x] 1.2 map 抽取（含滚动摘要生产者与章内分块）：按章并行抽角色/地点/时间线/open-threads/**每章 2–3 句摘要**，每章带 `sourceChapterIndex`；**超长单章按 size + 少量重叠二次分块**（复用 ContextManager.splitIntoChunks），保证 >30k 的单章不撞墙；做成独立可测函数（`phase1-map.ts#mapChapters`）。
- [x] 1.2b 内置廉价 cap（预算挂点前置）：map 循环内置"每 job 最大章节数 × 每章 token 预估"cap，超限**优雅降级**（有条件跳过/合并分块），不静默爆 token。
- [x] 1.2c 合成长单章 fixture：把几章拼成一个 >30k token 的合成 fixture（免标注、确定性），专门测分块路径。
- [x] 1.3 reduce 归并：跨章合并决策**落数据**（`char_N = 已有实体(别名, 章节出处) 归并入`，形成 merge log & 别名索引），产出全局设定卡；合并交 LLM 决策但不丢出处，可回溯。
- [x] 1.4 双路径 + flag：`Phase1Analyzer` 增 map-reduce 路径，旧截断路径保留；flag/env 切换，默认行为先不动（留 baseline）。
- [x] 1.5 占位 rawName 保留（**ask-first 已确认**）：`validator.ts` 占位 stub 保留原始名 `未知角色(id=<原名>)`（如 `未知角色(id=老秦)`），行为增量。
- [ ] 1.6 验收（硬）：>4 万字（**含 8 万字级单章**）跨界样本不再截断且出全局设定卡；**自洽性代理**（两切序 reduce 实体集差）**与 correctness floor（挑 1 本短篇人工数主要角色，`实体数/人工数`）并列出数**；两路径可切换。（自洽性代理已实现并测；数值验收落档由主线执行）
- [x] 1.7 回归：add 单测（map 分块/摘要/reduce 归并/mergeProvenance/自洽性代理/floor）；lint/typecheck/test 全绿；对比数字落 `docs/`（动 Task 2 前）。（单测 + 三命令全绿已达成；**docs 落档由主线在动 Task 2 前执行**）

## Task 2 · 评估窄版（步骤 2）

**目标**：身份断言集（确定性 + 语义）+ eval runner（git-hash 复现 + manifest 缓存）+ judge 稳定性报告。为 Task 1/3 的可信底座，可与 Task 1 并行（标注是纯人力活）。

- [x] 2.1 eval runner：`npm run eval -- --set <name> --model <id> [--stages analyze|convert]`；manifest=`(prompt 文件 hash, model id, 参数, 数据集 hash, judge prompt hash)` → JSONL；**按 hash 缓存**结果；**提供 `--dry-run`** 输出总 token 预算（manifest 各格预估值求和），跑前先见账。（已实现并验证：`scripts/eval-runner.mjs` + `scripts/eval/*.mjs`；dry-run 账单与零 LLM 规则集实跑均通过）
- [ ] 2.2 身份断言集：**按入选标准筛样本**（3–5 短 + 3–5 中，须"别名密集、多线叙事、有清晰章节边界切分"，标注 1–2h/本）；确定性断言（已死角色不再开口、称谓揭示章前不出现——**依赖标注的死亡/揭示章，非输出推导**）+ 语义断言（身份陈述矛盾，只兜规则查不到的）。（规则与合成 fixture 已实现；**真实样本标注为纯人力活**，标注后填充 `identity` 集）
- [x] 2.3 确定性断言走规则检查（零成本）；语义断言走 judge（双评委）；评委成本被 manifest 缓存控住。（已实现并 24 例单测全绿）
- [ ] 2.4 《judge 稳定性报告》：**方差研究限成本**（每类抽 1 本 × 复跑 k=5 × 双评委）→ 用**方差数据**定阈值（不拍脑袋）；该方差同时供 T5-C1 推导 `Δ_tail`。（`stability.mjs` 噪声带/阈值推导 + `--stability` 已实现并单测；**实跑报告待 2.2 标注样本就绪**）
- [ ] 2.5 分层对比：新旧 Phase1 断言通过率按章节**前/中/后三段**出曲线（截断损伤集中尾段，新管线应压平尾段）。（依赖 Task 1 双路径 + 2.2 样本，后置）
- [ ] 2.6 回归 + 落档：runner 可复现执行；报告入 `docs/`。（单测/lint/typecheck/全量 test 已绿；docs 落档待 2.4/2.5 出数后执行）

## Task 5（插序）· 翻 Phase1 默认（数据门槛驱动，独立小 PR）

**目标**：把 map-reduce 从"仅实验分支"翻为主链默认——唯一触发器是数据门槛，不是"写完了就切"。

- [ ] 5.1 先写决策规则（**出数前**）：尾段（tail 1/3）断面通过率差 ≥ **Δ_tail** 且总分不劣 → 才允许翻默认；**Δ_tail = f(T2-C4 《judge 稳定性报告》方差)**——须大于 judge 复跑噪声带（2×SD 或置信区间宽度），否则差值落进噪声内无从裁决；规则定后不临时改口径。
- [ ] 5.2 依 Task 2.5 分层曲线 + Task 1.6 代理/floor 判定通过 → 翻 `Phase1Analyzer` 默认路径为 map-reduce，**并把 `canRequest`（BudgetController）接到 Phase1 调用点**（堵住翻默认→Task3 无守卫窗口）。
- [ ] 5.3 验收 + 回归：翻默认后 e2e 全绿；`docs/` 落"为什么切默认"决策记录（呼应 ADR 纪律）。
- [ ] 5.4（后续独立 PR）清理旧截断 flag：翻默认稳定后再整体删 baseline 路径。

## Task 3 · 实体键注入 + BudgetController 主链（步骤 3）

**目标**：Phase3 上下文组装器（name→charN 解析 + 主角常驻/配角按键/滚动摘要/open-threads）+ 预算守卫同步落地。依赖 Task 1（设定卡/别名索引）。

- [ ] 3.1 显式"在场角色名→实体"解析：用 Task 1 reduce 的**别名索引**解析 Phase2 `keyCharacterNames` → `char_N`，**未命中名计入占位率**（明确测点）；复用 Phase3 现成的 `buildCharIdMap` 演进。
- [ ] 3.2 Phase3 上下文组装：主角卡常驻 + 配角按键 + 前 N 章滚动摘要 + `open threads` 按章节区间注入；扩展现成 `charContext/locContext` 拼接（不改外围签名）。
- [ ] 3.3 BudgetController 接主链：`canRequest` 检查进 Phase3 调用点，超限**真实拦截**（单测证明）；与 3.2 同步，作单 job token 成本护栏。
- [ ] 3.4 验收（硬）：断言矛盾率降、占位角色率降（validator 计数，逐场景）；token/字增幅**如实入表**；预算超限拦截生效。
- [ ] 3.5 回归 + 落档：add 单测（解析/组装器/拦截/efficiency）；lint/typecheck/test 全绿；对比数字入 `docs/`（动 Task 4 前）。

## Task 4 · 外科式 supervisor（步骤 4）

**目标**：ReviewGate 增 `identity` 信号 → orchestrator 决策层发 re-convert → **经典单场景链**执行重转。escalation 预算 + 默认关。依赖 Task 2（身份断言）+ Task 3（组装器）。

- [ ] 4.1 ReviewGate 增 `identity` 信号：复用 Task 2 身份断言（确定性规则优先），判定"身份不一致"的具体场景。
- [ ] 4.2 orchestrator 决策层：`identity` 未达标 → 发 **re-convert 请求**（只标记场景），**escalation 预算 K（默认 3）**，超了落 `manual_review`；**不执行转换**。
- [ ] 4.2b **开工前先验证桥接数据链**：写验证脚本确认 `task.jobId → StoredJob.pipelineState` 真实存在且格式可用；若 agent 产物从不写经典 pipelineState，补「agent 产物 ↔ pipelineState 格式互转」，并记录备证（其余"已核实"均有出处，此条不例外）。
- [ ] 4.3 经典链重转桥接器（执行层）：经 `task.jobId` 取 StoredJob.pipelineState → 调 Task 3 的组装器 + `Phase3SceneConverter` 重转该场景 → 写回 pipelineState → 重跑身份断言。**重转吃 Task 3 组装器，不用 orchestrator 的 executePhase。**
- [ ] 4.4 `multi-agent/{registry,handoff-protocol}` 接入决策链路（复用 AgentTaskPersistence/restore 作手写 handoff 对照证据）。
- [ ] 4.5 默认关 flag：回调路径与全量动态编排均默认关；主链行为与改造前一致。
- [ ] 4.6 验收（硬）：escalation 率 + 局部重转成功率出对照数字（"固定管线需多少次外科介入"）；flag 关时 e2e 与改造前一致（零回归）。
- [ ] 4.7 回归 + 落档：add 单测（identity 判定/escalation 预算/桥接器/flag 默认）；lint/typecheck/test 全绿；结论入 `docs/`。

---

# Task Dependencies

- Task 1 独立优先（真瓶颈，改动集中 contracts+pipeline）。
- Task 2 可与 Task 1 并行（标注是纯人力活）；但 2.5 分层对比**依赖 Task 1 双路径**（新旧 Phase1）。
- Task 5（翻默认）依赖 Task 1 双路径 + Task 2.5 曲线门槛；在 Task 3 主链改造前完成（让改进作用于新默认）。
- Task 3 依赖 Task 1（设定卡/别名索引）；BudgetController 随 3 同步，不拖到 4。
- Task 4 依赖 Task 2（identity 断言机制）+ Task 3（组装器，供重转执行链）。

# Guardrails（ask-first 项）

- `validator` 占位 rawName 保留 = contracts 行为变更 → 需用户确认。
- 设定卡若落库（`@novel/db` schema）→ 走 schema_version 迁移纪律，需确认；本阶段优先**不落库**（随 pipelineState 携带）以降风险。
- 翻默认为独立 PR（不混入功能改动）；清理旧 flag 另走独立 PR。
- 对比数字一律落 `docs/`（受版本控制），不入 `.trae/`（IDE 目录未跟踪）。