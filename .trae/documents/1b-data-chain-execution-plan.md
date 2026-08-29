# 点 1b 数据链执行闭环计划（Plan 落地版）

> 依据：`.trae/documents/1b-data-chain-medium-plan.md`（v3 规格，已三轮收敛）+ 用户最新闭环指令
> 模式：Plan → 获准后全量执行（建分支→分析→代码→测试→E2E 截图→push→PR）
> 分支：当前已在 `feat/eval-data-chain`（History: 5fd6ad6 Task2.2 标注基建 / 599b512 flip-decision 规则 / 7a8c7fa 预算守卫）

---

## 1. 当前状态分析（探索结论）

**已就绪（无需改动）**
- `scripts/eval/contract.test.mjs`：格式契约零成本单测，双消费端覆盖（规则端 + occupancy 端），fixture 内断言正确 → 完成，待实跑验证。
- `scripts/eval/occupancy.mjs`：占位率分层模块（参考集=phase1 分析卡 id 集），零 LLM → 完成。
- `scripts/eval/verify-historical-job.mjs`：历史 job 真实 producer 验证，带归因纪律 → 完成，待实跑验证。
- `scripts/eval/run-conversion.mjs`：转换运行器（双路径共用，90min 超时 + ¥20 硬上限 + partial 导出 + <tag>.scenes.json / <tag>.run.json 落盘）→ 完成。
- 样本：`xiuzhen-medium`（36 章，annotation：王老三 ch8 / 夏建仁 ch36；语义断言为零）。

**唯一代码缺口（需修）**
- `scripts/eval/run-layered-curve.mjs`：`runRules()` 用 `loadScenes` 返回的 `{scenes, refIds, charIdToName, aliasIndex}` 直接展开，但 `runDeadCharacterNoSpeakRule` 访问 `deadCharacters.find()`、`runRevealBeforeChapterRule` 访问 `reveals` —— 未注入 → `Cannot read properties of undefined (reading 'find')`。**需把 annotation 的 `deadCharacters`/`reveals`/`aliasIndex` 合并进规则输入。**

**工作区混杂（已拍板）**
- PR 只提数据链；`apps/screenplay` 的 streaming 重构（restrained-rework §8）保持未跟踪，留作独立 PR。
- scenes/run/db 产物不入库；验收证据 = 真实界面截图 + docs 报告。

---

## 2. 改动清单（本次 PR 内容）

| 文件 | 动作 | 说明 |
|---|---|---|
| `scripts/eval/run-layered-curve.mjs` | **修** | 注入 annotation（deadCharacters/reveals）到规则数据，修 `.find` 崩溃 |
| `scripts/eval/contract.test.mjs` | 已就绪（实跑验证） | 契约单测 |
| `scripts/eval/occupancy.mjs` | 已就绪（实跑验证） | 占位率分层 |
| `scripts/eval/verify-historical-job.mjs` | 已就绪（实跑验证） | producer 验证 |
| `scripts/eval/run-conversion.mjs` | 已就绪（实跑付费） | 转换运行器 |
| `scripts/eval/samples/xiuzhen-medium/*` | 新增 | 标注 + chapters（产物不入库） |
| `scripts/eval/samples/xiuzhen-short/*`、`last-cultivator/*` | 新增 | （标注只读；不经本次管线付费） |
| `docs/conversion-quality/flip-decision-record.md` | **改** | 写「T2.5 实测预注册」（六项）、后追加「实测结论」 |
| `docs/conversion-quality/1b-chain-measurement.md` | 新增 | 第一步实测报告 |
| `docs/conversion-quality/1b-layered-curve.md` | 新增 | 第二步分层曲线报告 |

**不入库**：`samples/<id>/<tag>.scenes.json`、`<tag>.run.json`、`<tag>.partial.json`、`data-test/*`、`pr-evidence/`、截图原图。

**不纳入本次 PR**：restrained-rework-3-points.md 对应的 `apps/screenplay` streaming 改动、`scripts/shot/*`、`pr-evidence/`、`novel2screenplay-docs/`。

---

## 3. 实现步骤

### 3.1 修 `run-layered-curve.mjs`（先证契约，零成本）
- 入参扩展：在接受 `--semantic-json <annotation.json>` 的同时，用它读 annotation，取 `deadCharacters`、`reveals`、`aliasIndex`，合并进传给 `runRules`/`computeOccupancy` 的 data。
- `runRules(data)` 改为：`runIdentityRules(RULE_IDS, { ...data, scenes: data.scenes, deadCharacters: data.deadCharacters ?? [], reveals: data.reveals ?? [] })`，杜绝 `undefined.find`。
- 占位率计算保持 `computeOccupancy(old.scenes, old.refIds)`（参考集=charIdSet，已由 run-conversion 写入）。
- 语义格逻辑保持：`--semantic-json` 的 `semanticAssertions` 非空才启用 Δ_tail 阈值判据；为空则打印退化口径备注。**语义 judge 只窗口化观察窗覆盖场景**——但当前 medium 语义断言为零，故直接走退化判据，不实际调 judge（零 LLM）。

### 3.2 零成本验证（均为 node 原生，不跑 LLM）
- `node scripts/eval/contract.test.mjs` → exit 0（契约 + 双消费端）。
- `node scripts/eval/verify-historical-job.mjs --db apps/screenplay/data/novel2screenplay.db` → exit 0（真实 producer 占位信号确认；用 Node 24）。若确认数为 0，按归因纪律取更长/更新的跨截断线 job 复验。
- `node scripts/eval/occupancy.mjs <一个真实产出或手工场景>` 冒烟 → 分层表打印正常。

> 前置：DEEPSEEK_API_KEY 仅跑管线才需要；上述零成本验证不需要。Node 24 = `E:\nvm\nodejs\node.exe`（better-sqlite3 按 137 编译）。

### 3.3 第一步付费·旧路径（truncate，端口 3001）
- 起隔离 dev server：`DB_FILE=data-test/1b-data.db`，**不带** `PHASE1_MODE`。
  ```
  & "E:\nvm\nodejs\node.exe" "...\next\dist\bin\next" dev -p 3001   # cwd=apps/screenplay, 环境设 DB_FILE=D:\...data-test\1b-data.db
  ```
- 跑 `node scripts/eval/run-conversion.mjs --sample xiuzhen-medium --tag old`。
- **停点验收（一字不差的硬条件，对应 §4.1/§5.3）**：`old.run.json` 存在且**格子数 >0、规则格非占位、占位率非全段严格为 0**。
- 生成 `docs/conversion-quality/1b-chain-measurement.md`（样本、两路径 scenes 格子数、真实规则格 P/F、基线通过率、占位率前/后段数值）。

### 3.4 停点后写预注册（先于第二步出数，反事后合理化）
- 在 `flip-decision-record.md` 写「T2.5 实测预注册」六项：
  ①语义 ground truth = annotation 人工断言（当前为零则不注入）；②n=1 管线级方差未量化（差异仅方向性证据）；③不跑 short 原因（空标注付费不出数）；④语义格为零判据退化（→规则格确定性差异+占位率差，受 n=1 限制）；⑤旧路径占位率不应全段严格 0（全 0 先怀疑定义）；⑥step-1 停点先验收再写预注册。**落 31.5k 贴线预期 = 「无显著差」。**

### 3.5 第二步付费·新路径（mapreduce，端口 3002）
- 另起 dev server：`DB_FILE=data-test/1b-data.db` + `PHASE1_MODE=mapreduce`，**端口 3002**（避免 --base 撞 3001）。
- 跑 `node scripts/eval/run-conversion.mjs --sample xiuzhen-medium --tag new --base http://localhost:3002`。
- 跑 `node scripts/eval/run-layered-curve.mjs --old samples/xiuzhen-medium/old.scenes.json --new samples/xiuzhen-medium/new.scenes.json --semantic-json samples/xiuzhen-medium/annotation.json --out docs/conversion-quality/1b-layered-curve.md` → 生成分层表 + Δ_tail（退化判据或噪声带）+ 结论。
- 回填 `flip-decision-record.md`「实测结论」：如实，不写“判定通过”除非 Δ_tail>噪声带且有数字；语义零退化时用退化判据并注明证据受限。

### 3.6 回归
- `npm run lint` / `npm run typecheck` / `npm test` 一次全绿（改动仅 scripts/eval + docs + data-test，不入 app src；如给 eval-runner 加参数则纯 CLI-verify，不引入跑 LLM 的单测）。

### 3.7 截图取证（E2E，证明功能完成）
- 起 dev server（端口 3001）后，对**真实运行界面**截图：
  - eval 零成本脚本 CLI 输出（contract.test / verify-historical-job / occupancy）。
  - 转换管线页面（SPA 实时进度/结果，展示 medium 场景剧本产物 + 角色卡 + SSE 推送）。
  - `1b-layered-curve.md` / `1b-chain-measurement.md` 报告渲染。
  - 存入 `pr-evidence/`（**不入库**，仅作 PR 描述附件）。
- 截图内容体现：scenes 落位、规则格 P/F、占位率前后段、Δ_tail 数值。

### 3.8 提交 + 推送 + PR
- 只暂存：`scripts/eval/**`（含新样本）＋ `docs/conversion-quality/**` ＋ `.trae/documents/1b-data-chain-execution-plan.md`（若入库）。
- RESTRICTED：不 stage `apps/screenplay` streaming 改动、`scripts/shot/`、`pr-evidence/`、`.trae/documents/restrained-rework-3-points.md`（属另一职责）。
- Conventional Commits，按关注点拆分：fix(run-layered-curve) / feat(eval 数据链脚本与样本) / docs(实测报告+预注册)。
- `git push -u origin feat/eval-data-chain`（git 用 `E:\浏览器下载\Git\cmd\git.exe`；规避代理 `git -c http.proxy= -c https.proxy= push`）。
- 创建 PR → main，描述附功能说明 + 真实运行截图（截图不入库）。lint/typecheck/test 全绿后合入门槛满足。

---

## 4. 假设与决策

1. PR 范围 = 数据链 eval 交付（含修复 run-layered-curve）；streaming 重构另开独立 PR。
2. 产物（scenes/run/db）不入库；证据 = 真实界面截图（存 pr-evidence，不入库）+ docs 报告。
3. medium 语义断言为零 → Δ_tail 走退化判据（规则格确定性差异 + 占位率差），不实际调 judge；窗口化仅作记录。
4. 付费两步之间存在停点（§3.3→§3.4），验收通过才付第二步。
5. 31.5k 贴线样本预期「无显著差」，预注册写死，出数后如实回填不做强扭。

## 5. 风险与兜底
- 历史 job 占位信号为 0 → 按归因纪律取更长/更新的跨截断线 job 复验，别用单 job 0 推翻定义。
- 第一步跑完验收不过（格子=0 / 占位全 0）→ 停在此处修脚本/确认 producer，不付第二步。
- run-conversion 超时/超费 → partial 导出 + 报告已消耗，按红线中止。
- eval 脚本运行需 Node 24（better-sqlite3 137）；git 显式路径 + 去代理。

## 6. 完成定义（DoD）
- [ ] contract.test / verify-historical-job / occupancy 零成本全绿。
- [ ] old.run.json 验收通过（格子>0、规则格非占位、占位率非全段严格 0）。
- [ ] flip-decision-record 预注册先写、实测结论后回填。
- [ ] 1b-layered-curve.md / 1b-chain-measurement.md 落 docs。
- [ ] lint/typecheck/test 全绿。
- [ ] 真实运行截图（pr-evidence，不入库）zuo证。
- [ ] 推分支 + 建 PR（数据链关注点），描述含截图。