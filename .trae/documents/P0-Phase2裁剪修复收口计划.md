# P0 收口计划：Phase2 裁剪修复证据升级与基线换血

> 目标：把 Phase2 裁剪修复从「单次证据」升级为「n=3 可发布证据」，并把 3×3 基线统一切换到「默认 auto + 修复后代码」。
> 预算：¥2.75 上限（正常路径 ¥0.95–1.8）｜机上时间：约 65 分钟。
> 执行原则：所有判断用 3 次均值；任何一步不达门槛立即停，不用单次好数据绕过预注册判据。

---

## 1. Summary

本计划执行四件事：

1. **补跑 zhanlan 2 次**，与已有的修复后运行（`job_1792638287888_iratsw`，P2=0.640）组成 n=3，验证 P2 均值 ≥0.62。
2. **回归抽查 doupo / xiuzhen 各 1 次**，确认修复没有把其他样本的 P1/P2 拉低超过 0.02。
3. **基线换血**：三样本 × 3 次，全部使用默认 auto + Phase2 修复后代码；把 9 个新 jobId 写入 `baseline.mjs` 并重新生成快照。
4. **文档与提交**：账本第 38 条证据改为 n=3，更新 flip §7.1、第五节状态、维护日志；按关注点拆分提交。

---

## 2. Current State Analysis

### 2.1 代码与工具现状

| 项 | 现状 |
|---|---|
| Phase2 修复 | 已提交 `2de0b8d fix(phase2): 逐章角色上下文改为「本章原文出现」，修 P2 边界退化` |
| 修复实现 | `apps/screenplay/src/lib/pipeline/phase2-chapter-chars.ts` 的 `selectChapterCharacters()`：按本章原文（含别名）裁剪，0 命中回落全量 |
| 调用点 | `Phase2Segmenter.ts:64` 使用 `selectChapterCharacters(analysis.characters, chapter.text)` |
| 单测 | `src/__tests__/phase2-chapter-chars.test.ts`（4 例：命中/全名/0 命中回落/全量命中） |
| 打分工具 | `scripts/eval/score-jobs.mjs` **已存在但未提交**（untracked），支持 `--sample`、`--jobs`、`--db-dir`、`--db-file`，输出 P1/P2/溯源与均值±σ |
| 基线脚本 | `scripts/eval/baseline.mjs` 的 `RUNS` 仍指向修复前的 9 个 jobId |
| 快照 | `docs/conversion-quality/snapshots/snapshot-2026-10-21.md`：zhanlan P2 `0.6048 ± 0.0129` |
| 文档记录 | 账本第 38 条、flip §7.1 已记录单次证据 `0.605 → 0.640` |

### 2.2 已完成的只读自检

用 Node 24 对 4 个 zhanlan job 打分，实际输出：

| jobId | P1 | P2 | 说明 |
|---|---|---|---|
| `job_1792598293428_tglqn3` | 0.960 | 0.597 | 修复前基线 |
| `job_1792598394521_hg7owe` | 0.960 | 0.597 | 修复前基线 |
| `job_1792598495594_vlzhnk` | 0.960 | 0.620 | 修复前基线 |
| `job_1792638287888_iratsw` | 0.917 | 0.640 | 修复后单次 |

- 修复前三均值：P2 `0.605`（与文档 0.6048 一致）。
- 四 job 合计均值：P1 `0.949 ± 0.022`，P2 `0.614 ± 0.020`，溯源 `87.2%`。
- 结论：`score-jobs.mjs` 可自检通过，无需重写；步骤 0 只需复跑同一命令确认。

### 2.3 工作区注意

当前工作区有大量与 P0 无关的未提交改动（UI 改版、`.env.example`、其他 docs）。本计划：

- **不执行** `git clean`、`git checkout .`、`git reset --hard`；
- 提交时只 `git add` 本计划涉及的具体文件；
- 若 build/test 因无关未提交改动失败，停止并报告，不顺手修改无关文件。

### 2.4 运行环境事实

- `E:\nvm\nodejs\node.exe` = v24.15.0；直接读写 `better-sqlite3` 的脚本必须用它。
- 服务端数据：`apps/screenplay/data-test/1b-data.db`。
- 服务端启动不设 `PHASE1_MODE`，走默认 `auto`。
- `run-conversion.mjs` 通过 HTTP 启动作业，完成后从 SQLite 直读 `pipeline_state`；`--tag old` 只是产物文件名，不代表旧路径。
- `run-conversion.mjs` 的 `estimatedCostCny` 是「Phase1 输入 × 2.5」粗估，用于预算记账，不是精确账单。
- 每次运行会覆盖同一样本的 `old.run.json` / `old.scenes.json`，因此**必须在每次运行结束后立刻提取 jobId**。

---

## 3. Assumptions & Decisions

| 决策 | 选择 | 理由 |
|---|---|---|
| 是否复用步骤 1/2 的运行做基线 | **不复用**，步骤 3 仍跑满 9 次 | 按用户给定预算 ¥1.8 与「三样本 × 3 次」执行，避免口径混用 |
| `score-jobs.mjs` | **不新增**，只自检并提交 | 工作区已有该工具，已验证可运行 |
| 服务启动方式 | 显式 Node 24 + Next CLI | 避免 PATH 中其他 Node 版本导致 better-sqlite3 ABI 不匹配 |
| 预算控制 | 每次 `--cost-cap-cny 10`；另设累计估算账本，>¥2.75 立即停 | 单 job 红线不能防总预算超支 |
| 服务健康 | 每次付费运行前检查 `/api/health`；失败重启一次，仍失败则停 | 防止静默跑旧代码/挂起 |
| 工作区 | 不清理，不做破坏性 git 操作 | 有大量无关未提交改动 |
| P1/P2 门槛 | 严格按用户给定值，不自动放宽 | 避免用单次好数据绕过判据 |
| 推送 | 只本地提交，不自动 push | 推送 `main` 属于 ask-first；CI 绿需推送后确认 |
| 文档数字 | 一律用 score-jobs / snapshot 实际输出，不手抄旧数 | 遵守账本「不要静默回退」与「数字带时效」原则 |

---

## 4. Proposed Changes

### 4.1 步骤 0：准备（¥0）

#### 0.1 工作区检查

> 本机 `git` 可能不在 PATH；若 `git` 报 command not found，统一改用
> `& "E:\浏览器下载\Git\cmd\git.exe"`。

```powershell
git status --short
```

只记录，不清理。确认 P0 相关文件：

- `scripts/eval/score-jobs.mjs`（untracked）
- `scripts/eval/baseline.mjs`
- `scripts/eval/snapshot.mjs`
- `docs/conversion-quality/lessons-learned-2026-10.md`
- `docs/conversion-quality/flip-decision-record.md`

#### 0.2 构建

```powershell
npm run build
```

若根级 build 因 `agent-workbench` / `embed-hosts` 等无关包失败，回退为只构建主应用：

```powershell
npm run build -w @novel/screenplay
```

仍失败则停止并报告，不修改无关代码。

#### 0.3 停掉 3001 旧进程

```powershell
$c = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($c) {
  $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force
  }
}
```

#### 0.4 启动生产服务（后台）

在 `apps/screenplay` 下启动，显式使用 Node 24：

```powershell
$env:DB_DIR = "E:\桌面\novel\novel2screenplay\apps\screenplay\data-test"
$env:DB_FILE = "1b-data.db"
Set-Location "E:\桌面\novel\novel2screenplay\apps\screenplay"
& "E:\nvm\nodejs\node.exe" "E:\桌面\novel\novel2screenplay\node_modules\next\dist\bin\next" start -p 3001
```

#### 0.5 健康检查

```powershell
(Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing).StatusCode
```

失败等待 30 秒重试一次；仍失败则停止。

#### 0.6 `score-jobs.mjs` 自检

```powershell
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample zhanlan-short `
  --jobs job_1792598293428_tglqn3,job_1792598394521_hg7owe,job_1792598495594_vlzhnk,job_1792638287888_iratsw
```

验收：前三行 P2 = 0.597 / 0.597 / 0.620，第四行 0.640；均值行 P2 ≈ 0.614 ± 0.020。
若与上述明显不符（例如 job 缺失、gold 变更），停止并报告。

---

### 4.2 步骤 1：zhanlan 补 2 次，凑 n=3（约 ¥0.4）

已有修复后运行：`job_1792638287888_iratsw`（P2 0.640）。

```powershell
New-Item -ItemType Directory -Force -Path pr-evidence\p0-baseline | Out-Null
$ids = @()

1..2 | ForEach-Object {
  (Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing).StatusCode | Out-Null
  & "E:\nvm\nodejs\node.exe" scripts/eval/run-conversion.mjs `
    --sample zhanlan-short --tag old --model deepseek-chat `
    --timeout-min 45 --cost-cap-cny 10
  if ($LASTEXITCODE -ne 0) { throw "zhanlan run $_ 失败" }

  $run = Get-Content scripts\eval\samples\zhanlan-short\old.run.json -Raw | ConvertFrom-Json
  if ($run.finalStatus -ne 'completed' -or -not $run.jobId) { throw "zhanlan run $_ 未完成" }
  $ids += $run.jobId
  "zhanlan run $_ jobId=$($run.jobId) estimate=¥$($run.estimatedCostCny)" |
    Tee-Object -Append pr-evidence\p0-baseline\run-ledger.txt
}

$ids | Set-Content pr-evidence\p0-baseline\zhanlan-fix-new.txt
```

打分：

```powershell
$new = (Get-Content pr-evidence\p0-baseline\zhanlan-fix-new.txt) -join ','
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample zhanlan-short `
  --jobs "job_1792638287888_iratsw,$new"
```

**判据**：三个修复后运行的 P2 均值 ≥ 0.62。

**失败分支（P2 均值 < 0.62）**：

1. 只回滚代码，不抹掉已记录的实验事实：
   - `Phase2Segmenter.ts:64` 恢复为 `analysis.characters.filter(c => c.sourceChapterIndex === chapter.index)`，并保留 0 命中回落全量的旧逻辑；
   - 删除 `phase2-chapter-chars.ts` 与 `phase2-chapter-chars.test.ts`；
   - 不动账本第 38 条与 flip §7.1 的历史文字，另加一条「第 39 条：修复假设无效（n=3 未达 0.62）」；
2. 提交 `revert(phase2): 回滚逐章原文裁剪（n=3 未达门槛）`；
3. **P0 终止**，不进入步骤 2/3。

---

### 4.3 步骤 2：回归抽查 doupo / xiuzhen（约 ¥0.55）

```powershell
$regression = @{}

foreach ($sample in @('doupo-short', 'xiuzhen-short')) {
  (Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing).StatusCode | Out-Null
  $timeout = if ($sample -eq 'xiuzhen-short') { 60 } else { 45 }
  & "E:\nvm\nodejs\node.exe" scripts/eval/run-conversion.mjs `
    --sample $sample --tag old --model deepseek-chat `
    --timeout-min $timeout --cost-cap-cny 10
  if ($LASTEXITCODE -ne 0) { throw "$sample 回归运行失败" }

  $run = Get-Content "scripts\eval\samples\$sample\old.run.json" -Raw | ConvertFrom-Json
  if ($run.finalStatus -ne 'completed' -or -not $run.jobId) { throw "$sample 未完成" }
  $regression[$sample] = $run.jobId
  "$sample jobId=$($run.jobId) estimate=¥$($run.estimatedCostCny)" |
    Tee-Object -Append pr-evidence\p0-baseline\run-ledger.txt
}

$regression | ConvertTo-Json | Set-Content pr-evidence\p0-baseline\regression-jobs.json
```

逐个打分：

```powershell
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample doupo-short --jobs <doupo jobId>
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample xiuzhen-short --jobs <xiuzhen jobId>
```

**判据**（修复前基线来自快照，允许 −0.02）：

| 样本 | 修复前 P1 | P1 下限 | 修复前 P2 | P2 下限 |
|---|---|---|---|---|
| doupo-short | 0.8866 | 0.8666 | 0.6943 | 0.6743 |
| xiuzhen-short | 0.8420 | 0.8220 | 0.6030 | 0.5830 |

**失败分支（任一指标低于下限）**：

1. 在 `phase2-chapter-chars.ts` 增加「命中 <2 回落全量」：

```ts
if (hits.length < 2 || hits.length === characters.length) {
  return { selected: characters, cropped: false, hits: hits.length };
}
```

2. 在 `phase2-chapter-chars.test.ts` 增加用例：「只命中 1 个 → 回落全量」；
3. 只重跑失败的那个样本 1 次（约 ¥0.2），重新打分；
4. 仍不达门槛 → 停止 P0，报告失败样本与三项指标；
5. 若通过，继续步骤 3。注意：若此分支被触发，需在文档记录「步骤 1 的 zhanlan 运行早于 fallback 改动」，并确认 zhanlan 每章命中数为 3–7（fallback 不会触发），否则不得把它们直接当最终基线。

---

### 4.4 步骤 3：基线换血（9 次，约 ¥1.8）

仅当步骤 1、2 全部通过后执行。

```powershell
$baseline = [ordered]@{ 'doupo-short' = @(); 'zhanlan-short' = @(); 'xiuzhen-short' = @() }

foreach ($sample in @('doupo-short', 'zhanlan-short', 'xiuzhen-short')) {
  $timeout = if ($sample -eq 'xiuzhen-short') { 60 } else { 45 }

  1..3 | ForEach-Object {
    (Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing).StatusCode | Out-Null
    & "E:\nvm\nodejs\node.exe" scripts/eval/run-conversion.mjs `
      --sample $sample --tag old --model deepseek-chat `
      --timeout-min $timeout --cost-cap-cny 10
    if ($LASTEXITCODE -ne 0) { throw "$sample run $_ 失败" }

    $run = Get-Content "scripts\eval\samples\$sample\old.run.json" -Raw | ConvertFrom-Json
    if ($run.finalStatus -ne 'completed' -or -not $run.jobId) { throw "$sample run $_ 未完成" }
    $baseline[$sample] += $run.jobId
    "$sample run $_ jobId=$($run.jobId) estimate=¥$($run.estimatedCostCny)" |
      Tee-Object -Append pr-evidence\p0-baseline\run-ledger.txt
  }
}

$baseline | ConvertTo-Json | Set-Content pr-evidence\p0-baseline\baseline-jobs.json
```

**预算守卫**：每轮结束后累加 `estimatedCostCny`；累计估算 > ¥2.75 立即停止，不再发起新运行。

逐个样本打分：

```powershell
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample doupo-short   --jobs <3 ids>
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample zhanlan-short --jobs <3 ids>
& "E:\nvm\nodejs\node.exe" scripts/eval/score-jobs.mjs --sample xiuzhen-short --jobs <3 ids>
```

**判据**：

- 每个样本 P1 均值：doupo ≥ 0.88、zhanlan ≥ 0.95、xiuzhen ≥ 0.84；
- 三个样本 P2 均值的总体平均 ≥ 0.62；
- 任一样本 P1/P2 不得低于修复前基线 −0.02（步骤 2 已抽查，基线 3 次再确认）。
- 若 zhanlan P1 落在 0.94–0.95 之间：不自动放宽，记录逐次运行并暂停向用户报告。

**达到判据后修改文件**：

1. `scripts/eval/baseline.mjs`
   - 将 `RUNS` 替换为本次 9 个 jobId（doupo 3 / zhanlan 3 / xiuzhen 3）；
   - 注释更新为：`2026-10-22 P0 收口：默认 auto + Phase2 原文裁剪修复后的 3×3`。
2. `scripts/eval/snapshot.mjs`
   - 将基线说明从「这批运行使用当前代码与默认 auto」改为「这批运行使用当前代码、默认 auto，并包含 Phase2 逐章原文裁剪修复」；
   - 不改快照生成逻辑。
3. 运行：

```powershell
& "E:\nvm\nodejs\node.exe" scripts/eval/snapshot.mjs
```

产物：`docs/conversion-quality/snapshots/snapshot-2026-10-22.md`（同日重复运行会覆盖，保留最终版本）。

**失败分支**：任一判据不达 → 不换基线，保留旧 `RUNS`，停止并报告逐次数据。

---

### 4.5 步骤 4：文档与提交（¥0）

#### 4.5.1 账本 `docs/conversion-quality/lessons-learned-2026-10.md`

| 位置 | 改动 |
|---|---|
| 问题全景第 38 条 | 证据从「P2 zhanlan 0.605→0.640（2026-10-22 单次）」改为「P2 zhanlan 0.605→<n=3 均值>（2026-10-22，n=3）」；保留「裁剪数 1/13 → 3–7/12」 |
| 第五节表头 | 状态日期 `2026-10-21 核对` → `2026-10-22 核对` |
| 第五节「别名覆盖」 | 只有当本次 3 次运行出现未登记别名且 `alias-normalize` 合并路径真实触发时才改写；否则保留「未触发」并把核对日期更新为 2026-10-22，不编造证据 |
| 第五节「基线刷新（3×3，当前代码）」 | 标注为「历史（truncate 路径），已被 auto 基线取代」 |
| 第五节「auto 默认下的基线（3×3）」 | 改为「已完成两次：修复前 2026-10-22（zhanlan P2 0.605）；修复后 2026-10-22（zhanlan P2 <n=3 均值>）」 |
| 第七节关键数字 | 若新 Phase2 跨运行 F1 超出当前 `0.556–0.703` 区间，同步更新该行并标 2026-10-22；否则只补充 n=3 说明 |
| 维护日志 | 追加行，引用本次 3 个提交 hash；格式 `\| 2026-10-22 \| ... \| \`hash\` \|` |

#### 4.5.2 `docs/conversion-quality/flip-decision-record.md` §7.1

在现有「根因已定位」后追加「修复后复核（2026-10-22，n=3）」：

- 表格新增一行或一组：

| 指标 | truncate | auto（修复前） | auto + 修复（n=3） |
|---|---|---|---|
| Phase2 准确率 zhanlan | 0.713 | 0.605 | `<实测均值> ± <σ>` |

- 结论按实测写：
  - 若均值 ≥0.62：写「修复有效，P2 不再作为翻默认的阻塞项；与 truncate 的差距从 −0.108 收窄到 `<差值>`」；
  - 若未达：按步骤 1 失败分支回滚，并把本节改为「修复假设无效，已回滚」。
- 保留「后续必须补 Δ_tail 与分层占位率」的未完成声明，不因为 P2 改善而删除。

#### 4.5.3 提交顺序

只 `git add` 指定文件，禁止 `git add -A`。

1. `chore(eval): 新增 job 批量评分工具（P1/P2/溯源 + 均值±σ）`
   - `scripts/eval/score-jobs.mjs`
2. `docs: 回填 P2 裁剪修复证据（n=3）`
   - `docs/conversion-quality/lessons-learned-2026-10.md`（第 38 条、第五节、第七节）
   - `docs/conversion-quality/flip-decision-record.md`（§7.1）
3. `chore(eval): 基线换血到默认 auto + Phase2 修复（3×3）`
   - `scripts/eval/baseline.mjs`
   - `scripts/eval/snapshot.mjs`
   - `docs/conversion-quality/snapshots/snapshot-2026-10-22.md`
4. `docs: 补维护日志（P2 证据 n=3 与基线换血）`
   - `docs/conversion-quality/lessons-learned-2026-10.md`（维护日志行，引用前 3 个提交 hash）

> 若步骤 2 触发 fallback 分支，则先加一个提交：
> `fix(phase2): 命中 <2 回落全量（回归保护）`（`phase2-chapter-chars.ts` + test）。

---

## 5. Verification

### 5.1 数值验收

- [ ] zhanlan 修复后 3 次 P2 均值 ≥ 0.62；
- [ ] doupo 回归 P1 ≥0.8666、P2 ≥0.6743；
- [ ] xiuzhen 回归 P1 ≥0.8220、P2 ≥0.5830；
- [ ] 新基线：doupo P1 ≥0.88、zhanlan P1 ≥0.95、xiuzhen P1 ≥0.84；
- [ ] 新基线三样本 P2 均值总体 ≥0.62；
- [ ] 累计估算花费 ≤ ¥2.75。

### 5.2 工程门禁

依次运行，直到全绿：

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
& "E:\nvm\nodejs\node.exe" scripts/eval/doc-check.mjs
```

验收：

- [ ] `doc-check` 12/12 PASS；
- [ ] `npm run test` 全绿（记录实际用例数；若与账本 §七的 721 不一致，按实际数更新并标日期）；
- [ ] `snapshot-2026-10-22.md` 中的基线表与本次 score-jobs 输出一致；
- [ ] 快照第 ② 节明确写「默认 auto + Phase2 修复」。

### 5.3 提交验收

```powershell
git status --short
git show --stat --oneline HEAD
```

- [ ] 每个提交只包含本节列出的文件；
- [ ] 未提交 UI 改版、`.env.example`、无关 docs；
- [ ] 维护日志每行都有提交号；
- [ ] 不自动 push；CI 需用户确认后再推送验证。

---

## 6. 风险与处置

| 风险 | 处置 |
|---|---|
| 3001 旧进程占用导致静默跑旧代码 | 启动前杀端口；每次付费运行前 `/api/health` |
| 服务中途挂掉 | 重启服务，作废该次 jobId，重跑该次；不把失败 job 计入均值 |
| 单次噪声误判 | 一律 3 次均值；P1 异常（如 zhanlan 0.917）只记录，不单独下结论 |
| 总预算超支 | 每次运行后累计 `estimatedCostCny`；>¥2.75 停止 |
| 基线换血后数字看起来「退步」 | 快照与文档同时标注「旧基线 = 修复前」，并给出两列对照 |
| 无关未提交改动影响 build/test | 停止并报告；不清理、不修改无关文件 |
| `score-jobs.mjs` 与 baseline 口径不一致 | 自检阶段用同一 4 个 job 对照；基线仍以 `baseline.mjs` 输出为准，二者差异写入文档 |
