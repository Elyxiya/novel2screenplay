# Checklist

## 阶段 A · C1 收敛
- [x] A1. ② 侧提供「剧本快照」契约/接口，供 ③ 消费
- [x] A2. `api/drama/convert` 不再直接读 `jobStore.get` 与 ② 内部类型，改为快照输入
- [x] A3. `eslint` 的 `import/no-restricted-paths` 无新增违规；dramatize 测试绿

## 阶段 B · 分镜溯源
- [x] B1. 分镜镜头携带 `sceneNumber`，metadata 携带完整的 source 溯源字段
- [x] B2. 分镜「溯源」可逐级跳转 分镜→剧本场景→小说原文
- [x] B3. 溯源相关测试通过

## 阶段 C · ①→② 一键流转
- [x] C1. 章节一键转剧本，字段不丢、可回跳
- [x] C2. writer 流转相关测试通过

## 阶段 D · P0 贯通
- [x] D1. 端到端「小说→剧本→分镜」全程无手工复制粘贴
- [x] D2. 跨线数据不丢失，三步产出均可溯源回跳
- [x] D3. 有可复现演示步骤
- [x] D4. 全量测试 / typecheck / lint 回归全绿