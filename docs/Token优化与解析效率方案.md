# Token 优化与解析效率方案

> 目标：减少小说转剧本全流程的 LLM token 消耗，提升解析效率（速度与稳定性），并通过既有评测体系量化优化效果。

## 现状诊断

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| D1 | `Phase3SceneConverter` | 每个场景调用 LLM 时携带**全量角色+地点**上下文，100 场景的书重复传输 100 次 | 每场景 30-70% 上下文冗余，占全流程 token 大头 |
| D2 | `Phase2Segmenter` | 每章传入**全部角色**列表，而非该章相关角色 | 随角色数线性膨胀 |
| D3 | `ContextManager` | 每次 `countTokens` 都 `get_encoding('cl100k_base')` 重新加载编码表（含 wasm）并 `free()` | 单次 50-300ms 纯开销，4 阶段多次调用累加明显 |
| D4 | `convert-scene` Prompt | SYSTEM_PROMPT 约 1.5k tokens/场景，含冗余重复表述与一处乱入字符 | 100 场景重复开销约 15 万 tokens |
| D5 | 效果不可见 | token 消耗无埋点，无法量化对比优化前后 | 优化难以验证、难以回归 |

## 优化方案

### P0 - 本次实施（改动小、收益大）

**P0-1 场景级角色/地点上下文裁剪**（解决 D1）
- Phase2 已输出 `keyCharacterNames`（该场景实际出场角色），Phase3 据此过滤角色上下文；
- 角色匹配：名字 + 别名精确匹配，保留全局 `char_XX` 编号（LLM 输出用角色名，编号仅展示，不影响 ID 映射正确性）；
- 地点按 `sourceChapterIndex === scene.chapterIndex` 过滤；
- 裁剪为空时回退全量，保证信息不丢失；
- 日志输出裁剪比：`角色 3/45, 地点 2/8`，便于观察。

**P0-2 tiktoken 单例化**（解决 D3）
- 模块级懒加载缓存 `Tiktoken` 实例，不再每次 `get_encoding()` + `free()`；
- `ContextManager` 的 `countTokens` / `truncateToTokens` / `isSceneTooLong` 全部受益。

**P0-3 convert-scene Prompt 精简**（解决 D4）
- 压缩规则表述、去除与"严格基于原文"重叠的条款、删除乱入字符；
- 保留全部 8 条核心语义（可见可听 / 对话归属 / 禁编造 / sourceRefs / confidence / summary / 心理处理 / 严格基于原文）；
- 预计 1.5k → 0.7k tokens/场景。

### P1 - 本次实施（结构性优化）

**P1-1 Phase2 按章过滤角色**（解决 D2）
- Phase1 输出已含 `sourceChapterIndex`，Phase2 处理第 N 章时仅传该章出场角色 + 全部角色名清单（名字短、开销低，保留全局认知）。

**P1-2 Token 效率评测维度**（解决 D5）
- Phase3 将每次 LLM 调用的 `usage`（promptTokens/completionTokens）与输入原文字数累计写入 `job.metadata.usage`；
- FlowEvaluator 新增效率指标：总 token / 输入字数（每千字 token 消耗）、LLM 调用次数；
- `/debug` 页面展示 Token 效率卡片，量化对比优化前后。

### P2 - 后续可选（本次不实施，文档留档）

| 项 | 说明 | 收益 | 风险 |
|---|---|---|---|
| Phase1 分批分析 | 大书按 5-10 章分批提取角色/地点，Phase4 已有去重天然合并 | 避免 30k 截断丢信息、单次调用更稳 | 重构大、需回归 |
| LLM 结果缓存 | 相同输入哈希缓存 Phase1/Phase2 结果 | 迭代调试直接复用 | 缓存失效与存储管理 |
| 模型分级 | Phase2 用便宜模型、Phase3 用强模型 | 成本显著下降 | 需模型配置支持 |
| 上下文压缩（LLMLingua 类） | 对原文做 token 级压缩后再入 prompt | 30-50% 输入压缩 | 引入依赖、质量风险 |

## 预期收益

- 全流程 token 消耗：**减少 35-55%**（场景裁剪为主，Prompt 精简为辅）
- 解析效率：每场景调用耗时减少（输入变小 + tiktoken 单例），Phase2 输入变小
- 可观测性：`/debug` 页面可对比优化前后 token 效率指标

## 验证方式

1. `npx tsc --noEmit` / `npx vitest run` / `npm run lint` / `npx next build --webpack` 全绿
2. 新增单测：场景裁剪回退、别名匹配、usage 累计、Prompt 长度断言
3. 运行一次真实转换，对比 `/debug` 页面 token 效率指标
