# Agent 流程可视化与评测方案

## 1. 需求分析

### 1.1 背景

转换管线（`PipelineEngine` 四阶段：analyze → segment → convert → merge）已通过 SSE 推送进度，但缺少两个能力：

1. **流程可视化不足**：前端只有进度条与日志流，看不到每个阶段的具体产物（角色/地点清单、场景边界、场景转换质量、合并后的剧本指标），无法直观判断"哪一步出了问题"
2. **效果无法评测**：`pipelineState` 中沉淀了丰富的结构化数据（角色数、场景 confidence、对白占比等），但没有聚合为可量化的质量指标；`ReviewGate` 的多智能体评估只覆盖编排路径，未覆盖传统管线路径

### 1.2 目标

1. **每个流程可视化**：新增 `/debug` 调试页面，把 4 个阶段渲染为流水线视图，展示各阶段的输入产物、输出摘要、耗时、token 消耗
2. **流程效果可评测**：新增 `FlowEvaluator` 模块，从 `pipelineState` 计算量化指标（每阶段 + 整体），输出 0-100 总分与四维评分（format/consistency/coherence/drama）
3. **调试闭环**：评测结果与已有 `AgentConversationLogger` 对话日志联动，可定位到具体阶段与 LLM 调用

### 1.3 非目标

- 不做实时监控（SSE 已承担实时进度，`/debug` 页按需刷新即可）
- 不改动现有转换逻辑与数据模型，只新增只读评测与展示层

## 2. 方案设计

### 2.1 架构总览

```
StoredJob.pipelineState（既有数据）
        │
        ▼
FlowEvaluator.evaluate(job)  ← 纯函数，只读
        │
        ├── 阶段评测 × 4：analyze / segment / convert / merge
        ├── 整体评测：四维评分 + 总分 + 等级
        └── 统计摘要：耗时、场景置信度分布、对白/动作比例
        │
        ▼
/api/debug/flow-eval?jobId=x  →  /debug 可视化页面（client）
        │
        ▼
AgentConversationLogger（既有） →  LLM 对话详情联动
```

### 2.2 核心模块

#### 2.2.1 `FlowEvaluator`（新增 `src/lib/debug/flow-evaluator.ts`）

纯函数式评测模块，输入 `StoredJob`，输出 `FlowEvaluation`：

```ts
interface FlowEvaluation {
  jobId: string;
  status: string;
  overall: {
    score: number;              // 0-100
    grade: 'excellent' | 'good' | 'fair' | 'poor';
    dimensions: {
      format: number;           // 0-100，结构完整性
      consistency: number;      // 0-100，引用一致性
      coherence: number;        // 0-100，叙事连贯性
      drama: number;            // 0-100，戏剧张力（对白占比合理性）
    };
  };
  phases: {
    analyze: PhaseEval;         // 角色/地点/timeline 提取
    segment: PhaseEval;         // 场景切分
    convert: PhaseEval;         // 场景转换
    merge: PhaseEval;           // 合并校验
  };
  stats: {
    phaseTimings: Record<string, { durationMs: number }>;
    sceneConfidence: { avg: number; min: number; low: number };
    dialoguePercentage: number;
    actionPercentage: number;
    totalScenes: number;
    fixes: number;
  };
  issues: Array<{ level: 'warn' | 'error'; phase: string; message: string }>;
}
```

**各阶段评测规则**（全部为确定性规则，不新增 LLM 调用）：

| 阶段 | 指标 | 评分逻辑 |
|---|---|---|
| analyze | 角色数、地点数、timelineHints 数 | 角色 0 个 → 0 分；1-3 个 → 警告减分；4-30 个 → 满分；>40 → 过度提取减分。地点同理 |
| segment | 场景边界数、每章平均场景数 | 0 场景 → 0 分；场景/章 < 0.5 → 切分不足警告；0.5-10 → 满分 |
| convert | 场景数、平均 confidence、低置信度（<0.5）比例 | avg confidence 直接映射 0-100；低置信度比例 >30% 时额外减分 |
| merge | 场景编号连续性、characterId 引用有效、locationId 引用有效、analytics | 引用全部有效 → 满分；断号/悬空引用逐项减分 |

**整体评分**：
- `format`：Phase1/2/3/4 全部产物存在 + 结构完整（合并自 format 规则）
- `consistency`：场景 characterIds/locationIds 均能解析到 `phase4Output.characters/locations`
- `coherence`：场景 sourceChapterRange 覆盖度 + 场景编号连续
- `drama`：对白占比在 25%-65% 区间得高分（源自对白过多/过少均不利的原则）
- `score` = 四维加权平均（format 30% + consistency 25% + coherence 25% + drama 20%）
- `grade`：≥85 excellent，≥70 good，≥55 fair，否则 poor

#### 2.2.2 `PipelineEngine` 记录阶段耗时（修改 `src/lib/pipeline/PipelineEngine.ts`）

在 `runPipeline` 的各阶段 start/end 处记录耗时，存入 `job.metadata.phaseTimings`（`metadata` 是 `Record<string, unknown>`，无需改类型）：

```ts
// Phase 1 前
const phaseTimings = { ...((job.metadata?.phaseTimings as Record<string, unknown>) ?? {}) };
// 完成后
phaseTimings.analyze = { durationMs: Date.now() - t0 };
// 每次 update 时合并 metadata: { ...job.metadata, phaseTimings }
```

#### 2.2.3 评测 API（新增 `src/app/api/debug/flow-eval/route.ts`）

- `GET /api/debug/flow-eval?jobId=x`：返回 `{ evaluation }`；jobId 缺失或不存在时 400/404

#### 2.2.4 可视化页面（新增 `src/app/debug/page.tsx`，client）

- URL 参数 `?jobId=x` 或输入框手动指定
- 布局：
  1. 总评分卡：总分（大数字）+ 等级徽章 + 四维条形图 + issue 列表
  2. 流水线视图：4 个阶段卡片（analyze/segment/convert/merge），各显示状态、耗时、核心指标（角色数/场景数/平均置信度/对白占比），失败/警告项高亮
  3. 场景质量：confidence 分布条（0-1 分段条形）
  4. 对话联动：按阶段展示 `AgentConversationLogger` 的 `llm_request`/`llm_response` 条目（折叠展开）
- 刷新按钮 + 自动轮询（可选）

## 3. 实施计划

| 步骤 | 内容 | 交付 |
|---|---|---|
| M1 | `flow-evaluator.ts`（类型 + 四阶段评测 + 整体评分） | 纯函数模块 |
| M2 | `PipelineEngine` 记录 phaseTimings | 耗时数据 |
| M3 | `/api/debug/flow-eval` API | 数据接口 |
| M4 | `/debug` 可视化页面 | 前端展示 |
| M5 | 单元测试 | 全绿 |

## 4. 测试计划

- `flow-evaluator.test.ts`：
  - 完整 job（全部阶段产物 + 高 confidence）→ 总分 ≥85，grade excellent
  - 空 pipelineState → 总分低，issues 含 error
  - 场景引用悬空（characterId 不在列表）→ consistency 减分
  - 对白占比极端（95%）→ drama 减分
  - 场景编号断号 → coherence 减分
  - phaseTimings 缺失 → 不崩溃，显示未知
- 回归：现有 84 个测试 + `tsc --noEmit` + `next build` + `npm run lint` 全绿

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 评分规则主观 | 规则全部写死为确定性逻辑，阈值集中在常量区便于调参 |
| 旧 job 无 phaseTimings | 评测对缺失字段全部兜底（undefined → 显示未知/不扣分） |
| 页面数据量大 | 只读 `pipelineState` 摘要字段，对话日志按阶段懒加载展开 |
