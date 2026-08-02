# Novel2Screenplay Agent 化改造方案

> 版本：v1.0 | 日期：2026-08-02 | 分支：feat/agent-orchestration

## 一、背景与目标

Novel2Screenplay 当前是一个"表单驱动"的转换工具：用户上传小说、选择章节、点击转换，系统按四阶段流水线（分析→切割→转换→合并）产出剧本 YAML。这套流程稳定可用，但交互是被动的——用户无法用自然语言指挥转换过程，也无法在转换中途提出"对白更犀利些""只保留主线角色"这类意图化要求。

目标是把项目升级为**对话式 AI Agent**：用户用自然语言下达任务，Agent 自主规划、调用工具执行、评估质量并迭代，最终产出剧本。这个升级建立在现有代码之上，不推倒重来。

### 本次交付目标

1. 打通"工具层真实接线"——把 `builtin-tools.ts` 中所有 mock handler 替换为对 `PipelineEngine` / Phase 模块的真实调用。
2. 重写 `MultiAgentOrchestrator`——把 `simulateAgentWork` 的假执行替换为真实 Agent 调用，质量关卡用 LLM 真评估。
3. 修复工程基线——构建失败、测试配置缺陷、原生模块 ABI 不匹配等问题在改造前清零。
4. 交付完整闭环——分支、实现、测试、推送、PR 全流程。

## 二、现状盘点（基于代码实测）

### 2.1 已有资产

| 模块 | 位置 | 状态 | 说明 |
|------|------|------|------|
| 四阶段流水线 | `src/lib/pipeline/` | ✅ 真实 | Phase1-4 全通，含信号量、限流、重试、降级 |
| Schema + 校验 | `src/lib/schema/` | ✅ 真实 | Zod discriminatedUnion + YAML 序列化 |
| 小说解析 | `src/lib/novel/parser.ts` | ✅ 真实 | 7 种章节正则、GBK 编码检测 |
| SQLite 存储 | `src/lib/store/sqlite/` | ✅ 真实 | jobs/projects/history 三表，WAL 模式 |
| SSE 推送 | `src/lib/sse/` | ✅ 真实 | 多客户端订阅、心跳 |
| Agent 运行时 | `src/lib/agent/AgentCore.ts` | ✅ 真实 | 状态机 + 三级记忆 + 工具调用循环，有测试 |
| LLM 桥接 | `src/lib/agent/llm/` | ✅ 真实 | AgentLLMProvider 适配 function calling，有测试 |
| 角色定义 | `src/lib/multi-agent/roles.ts` | ✅ 真实 | supervisor/writer/editor/analyzer/validator 及 Prompt |
| 编排器 | `src/lib/multi-agent/orchestrator.ts` | ❌ mock | `simulateAgentWork` 是 setTimeout，质量关卡硬编码 80 分 |
| 内置工具 | `src/lib/tools/builtin-tools.ts` | ❌ mock | 7 个 handler 中 5 个返回假数据 |
| 前端 | `src/app/` + `src/components/` | ✅ 部分 | 上传/配置/转换/结果四页齐全，ProgressTracker 未接线 |

### 2.2 工程基线问题（改造前置条件）

| 问题 | 位置 | 影响 |
|------|------|------|
| `EventSource.CLOSING` 不存在的常量 | `src/app/convert/page.tsx:59` | TS 编译失败，`npm run build` 直接挂 |
| `experimental.serverComponentsExternalPackages` 废弃键 | `next.config.ts` | 构建告警，配置无效 |
| vitest include 未排除 node_modules | `vitest.config.ts` | 扫描上千第三方测试，worker 超时 |
| better-sqlite3 ABI 与 Node v22 不匹配 | 原生模块 | 运行时 `new Database()` 抛错，数据库不可用 |
| 历史记录存 localStorage | `src/lib/store/history-store.ts` | 与 SQLite history 表重复且不持久 |

### 2.3 双套执行系统

UI 主链路走 `PipelineEngine`（jobStore → SQLite），另有独立的 `src/lib/jobs/` 队列系统仅被 `/api/jobs` 使用，未接入 UI。两套系统并存，进度格式、日志结构不一致，改造时应收敛为一条主线。

## 三、需求分析

### 3.1 功能需求

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR-1 | 用户可用自然语言发起转换："把第三章转成剧本" | P0 |
| FR-2 | Agent 自主规划任务并调用现有 pipeline 工具执行 | P0 |
| FR-3 | 转换过程以对话形式展示 Agent 推理轨迹与工具调用 | P0 |
| FR-4 | 质量关卡用 LLM 评估剧本，低分自动重试或请求人工介入 | P1 |
| FR-5 | 保留现有可视化编辑、YAML 导入导出、历史记录能力 | P1 |
| FR-6 | 长文处理沿用现有截断/拆分/并发策略，Agent 只经工具拿结果 | P0 |
| FR-7 | 支持中途追问（awaiting 状态），如"对白风格更口语化" | P2 |

### 3.2 非功能需求

| 维度 | 要求 |
|------|------|
| 兼容性 | 现有 `/api/pipeline/*`、编辑器、历史页不回归 |
| 成本 | 多轮 LLM 调用需受 `BudgetController` 预算约束 |
| 性能 | 场景转换并发沿用信号量 3 + Token Bucket 50/min |
| 可观测 | 每个 agent 步骤产生结构化日志，SSE 实时推送 |
| 恢复 | 任务状态持久化到 SQLite，进程重启可恢复 |

### 3.3 范围界定

本次 PR 实现 FR-1、FR-2、FR-3、FR-6 与工程基线修复；FR-4、FR-5、FR-7 列入后续迭代，但方案设计需为其预留接口。

## 四、方案设计

### 4.1 架构决策：改造而非新建

三处关键事实支撑"在现有架构上改造"：

1. **通用 agent 运行时已存在且有测试**——`AgentCore` 的状态机、三级记忆、工具循环、token 预算全部真实可用，这是最昂贵、最难写的部分。
2. **业务能力已存在**——四阶段流水线、Schema、解析器、SQLite、SSE 都是现成资产，重新实现无收益。
3. **缺的只是三层胶水**——编排器真执行、工具真接线、前端对话化。这三层无论改造还是新建都必须写，新建只会叠加重写成本。

### 4.2 目标架构

```
用户自然语言
    │
    ▼
Supervisor Agent（规划 · 分派 · 决策）
    │  HandoffProtocol
    ▼
Analyzer / Writer / Editor / Validator Agent
    │  调用工具（ToolExecutor）
    ▼
内置工具（真实接线）
    ├── analyze_novel      → Phase1Analyzer
    ├── segment_scenes     → Phase2Segmenter
    ├── convert_scene      → Phase3SceneConverter
    └── merge_validate     → Phase4Merger
    │
    ▼
ReviewGate（LLM 质量评估，低于阈值重试/人工）
    │
    ▼
Screenplay YAML → 现有结果页/编辑器/历史
```

### 4.3 关键设计决策

**D1：Agent 是指挥者而非翻译者。** 整本小说不进入 Agent 上下文。长文处理继续走 pipeline 的截断（Phase1 30k token）、拆分（Phase3 4000 字符/块）与并发策略，Agent 通过工具调用获取阶段结果。这决定了工具接线必须先于编排器重写。

**D2：工具粒度按 Phase 对齐。** 每个 Phase 暴露为一个工具（`analyze_novel`/`segment_scenes`/`convert_scene`/`merge_validate`），而非合并成一个黑盒 `start_pipeline`。细粒度让 Supervisor 能干预中间环节（例如只重跑失败的场景转换）。

**D3：编排器复用 AgentCore 而非另写循环。** `MultiAgentOrchestrator.executePhase` 实例化 `AgentCore`，以 `roles.ts` 的 `ROLE_PROMPTS` 作为 systemPrompt，以 `AgentLLMProvider` 桥接现有 LLM 层。不重复实现循环与记忆。

**D4：质量关卡为 LLM 真评估。** `ReviewGate` 用 validator 角色 Prompt 让 LLM 对剧本输出打分（格式/一致性/连贯性/戏剧性四维度），分数低于 `defaultQualityThreshold`（75）时触发 `retry` 或 `manual_review` 分支。评估结果与建议写回任务日志供用户查看。

**D5：状态持久化沿用 SQLite。** Agent 任务挂载到现有 `jobs` 表（新增 `pipeline_state` 列已由遗留改动实现），重启后从断点恢复。

**D6：双执行系统收敛。** 保留 `PipelineEngine + jobStore` 为主链路，`src/lib/jobs/` 队列系统标记为预留，不新增依赖。

### 4.4 前端对话化

新增对话面板（复用现有 SSE 与编辑器）：

- 输入区：自然语言指令 + 快捷建议（"转换全部章节""只转第三章"）
- 消息流：用户指令 → Agent 轨迹（状态变更/工具调用卡片）→ 最终剧本摘要
- AgentCore 事件（`state_change`/`step_complete`/`task_complete`/`token_warning`）直接映射为前端事件，与现有 SSE `progress`/`log` 事件并存
- 完成后跳转现有结果页做可视化精修，保证 FR-5 不回归

### 4.5 接口设计

```typescript
// 编排器公开 API（对齐现有 OrchestratorTask）
startConversion(input: {
  novelText: string;
  title?: string;
  selectedChapters?: number[];
  instruction?: string;   // 用户自然语言意图，如"对白更口语化"
}): Promise<string>;

// 工具注册（tool-registry 保持原接口）
registerTool({
  id: 'pipeline.analyze',
  name: 'analyze_novel',
  handler: async (args) => {
    const phase1 = new Phase1Analyzer(provider, ctxManager);
    return phase1.analyze(chapters);   // 真实调用，替代 mock
  },
});
```

## 五、实施计划

### M1 工程基线修复（前置）

| 动作 | 文件 | 验收 |
|------|------|------|
| 修复 `EventSource.CLOSING` 类型错误 | `src/app/convert/page.tsx` | `npm run build` 通过 |
| 迁移废弃配置键 | `next.config.ts` | 构建无告警 |
| vitest 排除 node_modules/.next | `vitest.config.ts` | `npx vitest run` 一键全绿 |
| 重建 better-sqlite3 原生模块 | `npm rebuild better-sqlite3` | health 检查通过 |
| 固定 Node 版本声明 | `package.json` + `.nvmrc` | 环境可复现 |

### M2 Agent 编排真实接线（本次核心）

| 动作 | 文件 | 验收 |
|------|------|------|
| 工具 handler 接真 | `src/lib/tools/builtin-tools.ts` | `analyze_novel` 等 4 个工具调用真实 Phase |
| 编排器去 mock | `src/lib/multi-agent/orchestrator.ts` | `executePhase` 实例化 AgentCore，不再 setTimeout |
| 质量关卡真评估 | `src/lib/multi-agent/review-gate.ts` | validator 用 LLM 打分，低于阈值走 retry/manual |
| 新增编排 API | `src/app/api/agent/start/route.ts` | POST 后返回 taskId，SSE 推送进度 |
| 对话前端 | `src/app/agent/page.tsx` + 组件 | 自然语言指令 → 轨迹展示 → 跳转结果页 |

### M3 后续迭代（本次仅预留接口）

历史记录落库、服务重启恢复、BudgetController UI 接入、`awaiting` 追问交互、Ollama 本地模型。

## 六、测试验证

### 6.1 单测

| 用例 | 覆盖 |
|------|------|
| `orchestrator.test.ts` | 编排器真实执行：Phase 顺序、失败分支、质量关卡触发 |
| `builtin-tools.test.ts` | 工具 handler 返回真实 Phase 输出而非 mock 数据 |
| 现有回归 | `pipeline-engine`、`phase4-merger`、`parser`、`screenplay.schema` 等 13 个文件 |

### 6.2 集成验证

1. `npx vitest run` —— 全部通过，排除 node_modules 后约 106+ 用例。
2. `npm run build` —— 零 TS 错误、零告警。
3. 手动链路：`/api/agent/start` 提交指令 → SSE 观察 Agent 轨迹 → 结果页打开剧本 → YAML 导出。

### 6.3 验收标准

- 构建、lint、测试三绿
- 工具层不再存在返回假数据的 handler（`grep "实际实现中" src/lib/tools/` 为空）
- 编排器不再出现 `simulateAgentWork` 的 setTimeout mock
- 现有 `/api/pipeline/*` 链路回归通过

## 七、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 多轮 Agent 调用成本不可控 | 费用超标 | 接入 `BudgetController`，任务级 token 预算 |
| better-sqlite3 同步 API 阻塞事件循环 | 长任务卡顿 | Phase 输出保持在单次调用粒度，避免循环内频繁读写 |
| Agent 输出 JSON 不稳定 | 编排中断 | 复用 `safeJsonParse` 四层降级 + 重试 |
| LLM 上下文膨胀 | 上下文窗口溢出 | 记忆系统三级裁剪 + `evictWorkingMemory`，小说文本只经工具传递 |
| 双系统并存导致状态混乱 | 进度不同步 | 收敛到 PipelineEngine 主线，jobs 系统标记预留 |

## 八、变更清单

| 类型 | 文件 |
|------|------|
| 新增 | `src/app/api/agent/start/route.ts`、`src/app/agent/page.tsx`、`docs/Agent化改造方案.md` |
| 修改 | `src/lib/tools/builtin-tools.ts`、`src/lib/multi-agent/orchestrator.ts`、`src/lib/multi-agent/review-gate.ts`、`vitest.config.ts`、`next.config.ts`、`package.json` |
| 修复 | `src/app/convert/page.tsx` |
| 沿用 | 遗留未提交改动（job-store pipelineState 持久化等）一并纳入本次提交 |
