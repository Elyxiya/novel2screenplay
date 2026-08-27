# Tasks

北极星：**P0 = 一条「小说→剧本→分镜」链路全程无手工复制粘贴，且每步可回跳上游**。仅做为此所需的最小缺口。

## 阶段 A · C1 收敛（③ 不穿透 ② 存储，链路基石）

- [x] Task 0: 剧本快照化 + C1 收敛
  - [x] 在 ② 侧提供「剧本快照」接口/契约：给定完成剧本，返回可供 ③ 消费的 `Screenplay`（含 title、scenes、sourceNovelId、sourceNovelTitle）
  - [x] 重构 `app/api/drama/convert/route`：改从快照/契约读取，移除对 `jobStore.get` 与 ② 内部类型的直接依赖
  - [x] 验证 `eslint` 的 `import/no-restricted-paths` 无新增违规；dramatize 单元测试仍绿

## 阶段 B · 分镜溯源链（②→③）

- [x] Task 1: 分镜溯源完整性
  - [x] 确认 `dramatize` 在每个镜头携带 `sceneNumber`、`metadata` 携带 `sourceScreenplayId/sourceNovelId/sourceNovelTitle`
  - [x] `app/shortdrama` 分镜项提供「溯源」入口，逐级跳转 分镜→剧本场景→小说原文（复用现有 result 页溯源机制）
  - [x] 新增/更新 drama 溯源测试

## 阶段 C · ①→② 一键流转

- [x] Task 2: 创作台一键转剧本
  - [x] 校验 `api/writer/novels/[id]/convert` 将章节物化为 ② 输入，字段不丢
  - [x] `app/writer/[id]` 章节「转剧本」一键进入 ② 配置/执行页，可回跳原创作章
  - [x] 新增/更新 writer-novel-repository 与 convert 测试

## 阶段 D · P0 贯通验收

- [x] Task 3: 端到端贯通验证 + 复现步骤
  - [x] 用一份完整小说跑通：导入/创作 → 一键改编 → 剧本 → 一键转分镜 → 分镜溯源回跳
  - [x] 全程无手工复制粘贴；跨线数据不丢失；三步均溯源
  - [x] 产出可复现演示步骤（脚本/文档）
  - [x] 全量测试 / typecheck / lint 回归全绿

# Task Dependencies

- Task 0（C1）先于 Task 1（溯源）——只有输入走快照，溯源才稳定。
- Task 2（①→②）独立于 Task 1，可与 Task 1 并行。
- Task 3（P0 贯通）依赖 Task 1、Task 2 完成。