# 转换质量与一致性工程 - 完成清单

事实验证（对照 `spec.md` v0.3.0 §6 硬验收标准；`T#-C#` 编号）、回归与落档。每步对比数字须在动下一步前写入受版本控制 `docs/`。

## Task 1 · Phase1 map-reduce + 实体归并落数据（步骤 1）
- [x] T1-C1. 契约增量：`RawCharacter.mergeProvenance` + 全局设定卡（含**章节摘要**）/open-threads 类型；rebuild `@novel/contracts`
- [x] T1-C2. map 抽取：按章并行抽角色/地点/时间线/open-threads/**每章 2–3 句摘要**；超长单章按 size + 重叠二次分块（复用 splitIntoChunks）；**内置廉价 cap（每 job 最大章节×每章 token 预估，超限优雅降级）**；**合成长单章 fixture（>30k，免标注）专测分块**
- [x] T1-C3. reduce 归并：merge 决策落数据带出处（可回溯到具体 merge），产出全局设定卡 + 别名索引
- [x] T1-C4. 双路径 + flag：map-reduce 新路径、旧截断保留，默认行为留 baseline
- [x] T1-C5. 占位 rawName 保留（**ask-first 已确认**，`未知角色(id=<原名>)`）
- [ ] T1-C6. 验收（硬）：>4 万字（含 8 万字级单章）不再截断且出设定卡；**自洽性代理 + correctness floor 并列出数**；两路径可切换（自洽性代理已实现并测；数值验收由主线执行）
- [x] T1-C7. 回归：分块/摘要/reduce/mergeProvenance/代理/floor 单测 + lint/typecheck/test 全绿（**docs 落档见 T1-C8，由主线执行**）
- [ ] T1-C8. 步骤 1 对比数字落 `docs/`（动 Task 2 前）

## Task 2 · 评估窄版（步骤 2）
- [ ] T2-C1. eval runner：`npm run eval -- --set/--model/--stages`；manifest hash → JSONL + hash 缓存；**`--dry-run` 输出总 token 预算**
- [ ] T2-C2. 身份断言集：**按入选标准筛样本**（别名密集/多线/章节边界，3–5 短 + 3–5 中，标注 1–2h/本）；确定性依赖标注的死亡/揭示章（非输出推导）
- [ ] T2-C3. 确定性断言走规则检查（零成本）；语义断言走双评委
- [ ] T2-C4. 《judge 稳定性报告》：复跑方差（每类 1 本 × k=5 × 双评委）→ 定阈值（不拍脑袋）；**同一方差供 T5-C1 推导 Δ_tail**
- [ ] T2-C5. 分层对比曲线：新旧 Phase1 断言通过率按章节前/中/后三段（尾段应被压平）
- [ ] T2-C6. 报告/复现单元入 `docs/`

## Task 5（插序）· 翻 Phase1 默认（数据门槛驱动，独立小 PR）
- [ ] T5-C1. **出数前**写决策规则（尾段差值阈值 **Δ_tail = f(T2-C4 方差)**，须大于 judge 噪声带 + 总分不劣），不临时改口径
- [ ] T5-C2. 依 T2-C5 曲线 + T1-C6 代理/floor 判过 → 翻默认路径为 map-reduce，**并把 canRequest 接到 Phase1 调用点**
- [ ] T5-C3. 翻默认后 e2e 全绿；`docs/` 落"为什么切默认"决策记录
- [ ] T5-C4.（后续独立 PR）稳定后再清旧截断 flag

## Task 3 · 实体键注入 + BudgetController 主链（步骤 3）
- [ ] T3-C1. 显式"在场角色名→实体"解析：别名索引解析 `keyCharacterNames`→`char_N`，**未命中计入占位率**（明确测点）
- [ ] T3-C2. Phase3 上下文组装：主角常驻/配角按键/滚动摘要/open-threads 区间注入，扩展现成拼接不改外围签名
- [ ] T3-C3. BudgetController 接主链：`canRequest` 进 Phase3 调用点，超限**真实拦截**（单测证明）
- [ ] T3-C4. 验收（硬）：断言矛盾率降、占位角色率降（validator 计数逐场景）；token/字增幅如实入表
- [ ] T3-C5. 回归单测（解析/组装器/拦截/efficiency）+ lint/typecheck/test 全绿
- [ ] T3-C6. 步骤 3 对比数字落 `docs/`（动 Task 4 前）

## Task 4 · 外科式 supervisor（步骤 4）
- [ ] T4-C1. ReviewGate 增 `identity` 信号（复用 Task 2 身份断言）
- [ ] T4-C2. orchestrator 决策层：`identity` 未达标 → **发 re-convert 请求**（只标记场景）+ escalation 预算 K=3，超限落 `manual_review`；不执行转换
- [ ] T4-C2b. **桥接数据链已核实**：`task.jobId → StoredJob.pipelineState` 真实存在且格式可用；否则已补「agent产物↔pipelineState 互转」层并有记录备证
- [ ] T4-C3. **经典链重转桥接器**：jobId→pipelineState→Task3 组装器+Phase3SceneConverter 重转→写回→重跑断言（**不用 executePhase**）
- [ ] T4-C4. registry/handoff 接入决策链路（AgentTaskPersistence/restore 作手写 handoff 对照）
- [ ] T4-C5. 默认关 flag：回调路径与全量动态编排默认关
- [ ] T4-C6. 验收（硬）：escalation 率 + 局部重转成功率对照数字；flag 关时 e2e 与改造前一致（零回归）
- [ ] T4-C7. 回归单测（identity 判定/escalation/桥接器/flag 默认）+ lint/typecheck/test 全绿
- [ ] T4-C8. 结论与对照数字入 `docs/`

## 全局
- [ ] G-C1. 各 Task 硬数字按 ADR/验证纪律落 `docs/`，无跨步遗漏
- [ ] G-C2. 全程不触碰存储双后端/auth/CI 主闸门语义（验收走既有 lint/typecheck/test/build）
- [ ] G-C3. ask-first 项已确认（validator 行为变更；是否落库）
- [ ] G-C4. orchestrator 只决策/经典链执行的原则在 Task 4 落实（重转不吃旧转换链）