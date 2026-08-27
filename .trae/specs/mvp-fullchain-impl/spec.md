# MVP 实现 Spec · P0 全链路贯通（狭窄切片）

## Why

项目已具备三条线的大量积木（② 四阶段流水线+多 Agent+SSE+评测+溯源、③ 分镜引擎+统计+导出、① 创作台+convert），但 **P0 硬指标「一条 小说→剧本→分镜 链路全程无手工复制粘贴、且每步可回跳上游」从未被端到端验证**。此 spec 只做这一件事，其余打磨一律排除，防止开发偏离 P0。

## What Changes

- 以 **P0 硬指标为唯一验收目标**：一份小说 → 一条流水线出剧本 → 一条链路出分镜；全程无手工复制粘贴；任一步骤产出可回跳上游。
- **收敛 C1 耦合**：`app/api/drama/convert/route` 从直接读 ② 的 `jobStore`/`getNovelRepository`，改为经**剧本快照/契约**读取（见 II.3），否则 ③ 反向穿透 ②，链路不成立也无法维护。
- 账面上：只补 **P0 贯通所必需的最小缺口**（溯源链、一键流转、端到端验证），不做 ② 长章节打磨、不做 ③ 批量编辑/质量校验/统计面板编排、不做 ① 续写扩写。这些列入 Non-Goals，后续另有 spec。
- **BREAKING**：`app/api/drama/convert/route` 输入源改造为剧本快照。

### MVP 范围（Do）
1. 端到端路径「小说 → 剧本 → 分镜」可用且可溯源。
2. ②→③ 分镜携带溯源（sourceRefs 链：分镜→剧本场景→小说原文）。
3. ①→② 创作台一键转剧本（数据不丢、可回跳）。
4. 一份可复现的 P0 贯通验收/演示步骤。

### 本期不做（Non-Goals，防偏离锚）
- ❌ ② 长章节稳定性打磨、编辑复原、评测引导修订
- ❌ ③ 批量编辑/排序/序号重排、质量校验、统计面板增强
- ❌ ① 续写/扩写/改写/润色打磨
- ❌ AI 出图 / 视频、三线拆分部署、多端、多人协同

## Impact

- 受影响代码：`app/shortdrama/page.tsx`、`app/writer/**`、`api/drama/convert`、`api/novels/*`、`api/writer/novels/[id]/convert`、`lib/drama/**`、`lib/store/sqlite/*`
- 受影响契约：`@novel/contracts`（drama / screenplay / novel schema）
- 受影响文档：`docs/产品定义.md §5`（打通判定）

---

## ADDED Requirements

### Requirement: 分镜溯源链保留（②→③）
系统 SHALL 让生成的每个分镜保留剧本与小说溯源链（`metadata.sourceScreenplayId` / `sourceNovelId` + 镜头级 `sceneNumber`），可逐级回跳。

#### Scenario: 分镜回跳至小说原文
- **WHEN** 用户在分镜列表点击「溯源」
- **THEN** 依次定位 分镜→剧本场景→小说原文，任一级可导航；链路证据完整

### Requirement: 创作台一键流转（①→②）
系统 SHALL 支持创作台章节一键物化为改编输入，数据不丢、可逆。

#### Scenario: 章节一键转剧本
- **WHEN** 用户在创作台对某章节发起「转剧本」
- **THEN** 该章节作为改编输入进入 ②，创作台与改编侧字段一致，可回跳

### Requirement: P0 全链路一键贯通验证
系统 SHALL 提供一份可复现的端到端验证：小说→剧本→分镜全程无手工复制粘贴。

#### Scenario: 贯通判定
- **WHEN** 从一份完整小说开始，仅通过产品操作走到分镜产出
- **THEN** 全程无手工复制粘贴；任一步骤可回跳上游；跨线数据不丢失

---

## MODIFIED Requirements

### Requirement: ②→③ 转换输入改由剧本快照提供（C1 收敛）
`app/api/drama/convert/route` 不得再直接注入 ② 的 `jobStore` / `getNovelRepository`；改为从剧本快照/契约读取输入剧本。

#### Scenario: 分镜转换使用快照
- **WHEN** 短剧工坊基于某剧本生成分镜
- **THEN** 输入来自剧本快照而非 ② 内部存储；`import/no-restricted-paths` 边界无新增违规；溯源仍完整

---

## REMOVED Requirements

### Requirement: 本期 AI 出图 / AI 视频
**Reason**：成本/一致性/合规三风险，立项/产品定义已定本期不做。
**Migration**：图像/视频 Provider 留可插拔接缝，不实现调用。