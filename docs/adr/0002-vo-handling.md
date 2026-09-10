# ADR-0002：内心独白（VO）的处理——删除提示词承诺，心理一律动作外化

- 状态：**已生效（B 案）**；A 案留档待风格批
- 日期：2026-09-11
- 相关代码：`apps/screenplay/src/lib/llm/prompts/convert-scene.ts`（规则 7）、`packages/contracts/src/screenplay.ts`（ContentBlockSchema）
- 相关台账：D-09（FIX-10）；关联 D-10（回忆忽略的改编损失口径）

## 背景

convert-scene 提示词规则 7 原文为「心理→(VO) 内心独白或表情动作」，**承诺了 VO 输出通道**；
但产物契约 `ContentBlockSchema` 是 `discriminatedUnion('type', [ActionBlockSchema, DialogueBlockSchema])`
——**只有 action / dialogue 两型，没有 monologue/VO 类型**，且没有"叙述者"实体语义。
即：提示词要求模型"写 VO"，契约无处安放——模型只能把独白塞进 action 描述或丢弃，
行为不可预期、无法校验（台账 D-09 记为"裂缝"）。

## 备选方案

### A 案：契约补 monologue 块类型
- 内容：`ContentBlockSchema` 增加 `{ type: 'monologue', speaker?: 'narrator', line, direction?, sourceRefs }`；
  同步序列化器（YAML）、drama 层消费（分镜规则如何对待独白）、评估端（断言覆盖面）。
- 收益：为"有声剧/广播剧"形态铺路（该形态里 VO 是主叙事通道）。
- 成本与风险：契约 + 序列化 + drama + 评估四层联动；且当前唯一在产形态（短剧分镜）
  **没有任何声音通道概念**，单方面加 monologue 会在下游产生悬空类型。属 C6 级改动。

### B 案：删除提示词 VO 分支（选定）
- 内容：规则 7 改为「心理→可见表情动作（外化不了则忽略并压低 confidence）」，
  并显式禁止"旁白式改写"；契约不变（零契约变更，C3 批记录为"无需变更"）。
- 收益：提示词与契约一致；行为可预期、可校验（action 可见可听原则已有单测约束）；
  零新增类型、零下游改动。
- 代价：内心戏只能靠动作外化——**承认的改编损失**，与 D-10（回忆忽略）同口径，
  由 confidence 档位（部分缺失 0.4–0.6）承担"改编距离"刻度，低置信场景标记给人工。

## 决策

**采用 B 案**。契约先行原则下，提示词不得承诺契约无法承载的产物；VO 的真正语义
（叙述者声部）依赖"产物体裁 = 有声剧"这一风格维度，应在风格参数化（FIX-12）里
与 artifactForm 一并设计，而不是在单一 prompt 里先行泄漏。

## 后果与重访

- D-09 以"提示词与契约一致"关闭（B 案处置）；A 案作为 `monologue` 块设计草案留档于本 ADR。
- `CONVERT_PROMPT_HASH`（版本行记录用）将随本次提示词变更而变化——这正是 hash 的意义：
  版本表能区分"改过提示词"的转换。
- **重访触发**：FIX-12 风格参数化启动"有声剧"preset（契约批 C6）时，本 ADR 的 A 案
  作为该批输入一并决策（届时的评测口径：VO 条数占比 + 可听性人工审阅）。
