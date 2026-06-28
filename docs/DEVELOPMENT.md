# novel2screenplay 开发记录

## 开发概览

| 项目 | 说明 |
|------|------|
| 分支 | `feat/agent-llm-adapter` |
| 开发周期 | 2026-06-27 ~ 2026-06-28 |
| 新增文件 | 27 个 |
| 代码增量 | +4,234 行 |
| 提交次数 | 5 次 |

---

## 开发阶段

### Phase 1: LLM Adapter 统一接口

**开发时间**: 2026-06-27 ~ 2026-06-28

**Commit**: `3dd8e53`

**改动原因**: 解决多 LLM 提供商（DeepSeek、OpenAI）接口不统一的问题，需要一个抽象层来统一调用方式。

**新增文件**:

| 文件 | 说明 |
|------|------|
| `src/lib/llm/adapter/types.ts` | LLM Adapter 接口定义（161 行） |
| `src/lib/llm/adapter/router.ts` | 模型路由器（209 行） |
| `src/lib/llm/adapter/deepseek-adapter.ts` | DeepSeek 适配器（178 行） |
| `src/lib/llm/adapter/openai-adapter.ts` | OpenAI 适配器（178 行） |
| `src/lib/tools/tool-registry.ts` | 工具注册表（216 行） |
| `src/lib/tools/builtin-tools.ts` | 内置工具（201 行） |

**核心功能**:
- 定义 `LLMAdapter` 统一接口
- 实现 `ModelRouter` 支持多模型自动路由
- 内置 Pipeline、分析、存储工具

---

### Phase 2: 多模型路由策略

**开发时间**: 2026-06-28

**Commit**: `965a110`

**改动原因**: 需要支持多种路由策略以适应不同场景：优先级选择、成本优化、负载均衡、故障转移等。

**新增文件**:

| 文件 | 说明 |
|------|------|
| `src/lib/llm/adapter/routing-strategy.ts` | 路由策略实现（244 行） |
| `src/lib/llm/adapter/budget-controller.ts` | 预算控制器（316 行） |
| `src/app/api/models/route.ts` | Models API 端点（74 行） |

**核心功能**:
- 5 种路由策略：优先级、轮询、负载均衡、成本优先、故障转移
- 预算控制器：月度/小时/分钟预算限制
- 成本估算和警告机制
- Models API 返回模型信息和预算使用情况

---

### Phase 3: Worker/Background Job 系统

**开发时间**: 2026-06-28

**Commit**: `756dcf4`

**改动原因**: 需要支持长时间运行的转换任务在后台执行，避免前端请求超时，同时支持任务取消、进度追踪。

**新增文件**:

| 文件 | 说明 |
|------|------|
| `src/lib/jobs/types.ts` | 任务类型定义（213 行） |
| `src/lib/jobs/job-queue.ts` | 优先级队列（272 行） |
| `src/lib/jobs/worker.ts` | Worker 处理器（259 行） |
| `src/lib/jobs/executor.ts` | Pipeline 执行器（178 行） |
| `src/app/api/jobs/route.ts` | Jobs API（56 行） |
| `src/app/api/jobs/[id]/route.ts` | 单个 Job API（46 行） |

**核心功能**:
- `PipelineJobQueue` 优先级队列
- `PipelineWorker` 后台任务执行
- `PipelineExecutor` 阶段化执行
- RESTful Jobs API

---

### Phase 3.2: SSE 实时进度推送

**开发时间**: 2026-06-28

**Commit**: `c3d599f`

**改动原因**: 前端需要实时获取任务进度，而不是轮询。

**新增文件**:

| 文件 | 说明 |
|------|------|
| `src/app/api/jobs/[id]/events/route.ts` | SSE 端点（109 行） |

**改动文件**:

| 文件 | 改动 |
|------|------|
| `src/lib/jobs/job-queue.ts` | 新增 `update` 事件支持 |

**核心功能**:
- `GET /api/jobs/[id]/events` SSE 端点
- 实时推送任务状态更新
- 任务完成/失败时自动关闭连接

---

### Phase 4: UI 组件

**开发时间**: 2026-06-28

**Commit**: `9d57d5d`

**改动原因**: 需要可复用的 UI 组件来提升用户体验，展示模型选择、进度追踪、任务历史。

**新增文件**:

| 文件 | 说明 |
|------|------|
| `src/components/ModelSelector.tsx` | 模型选择器（210 行） |
| `src/components/ProgressTracker.tsx` | 进度追踪器（353 行） |
| `src/components/JobListPanel.tsx` | 任务历史面板（250 行） |
| `src/components/index.ts` | 组件导出（7 行） |

**核心功能**:

**ModelSelector**:
- 显示模型成本、健康状态
- 预算使用进度条
- 快速切换其他模型

**ProgressTracker**:
- SSE 实时连接 + 轮询降级
- 4 阶段进度指示
- 实时日志显示
- Token 使用统计

**JobListPanel**:
- 最近任务列表
- 状态筛选（全部/已完成/失败）
- 快速统计卡片

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ModelSelector│  │ProgressTracker│ │ JobListPanel│        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     API Layer                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                   │
│  │/api/jobs│  │/api/models│ │/api/pipeline│                 │
│  └─────────┘  └─────────┘  └─────────┘                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Job System                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │JobQueue  │  │ Worker   │  │ Executor │                  │
│  └──────────┘  └──────────┘  └──────────┘                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   LLM Adapter Layer                         │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │RoutingStrategy│  │BudgetController│                     │
│  └──────────────┘  └──────────────┘                       │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │DeepSeekAdapter│  │OpenAIAdapter │                       │
│  └──────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 提交记录

| Commit | 日期 | 说明 |
|--------|------|------|
| `3dd8e53` | 2026-06-27 | feat: LLM Adapter 统一接口 |
| `965a110` | 2026-06-28 | feat: 多模型路由策略 |
| `756dcf4` | 2026-06-28 | feat: Worker/Background Job |
| `c3d599f` | 2026-06-28 | feat: Job SSE 进度推送 |
| `9d57d5d` | 2026-06-28 | feat: UI 组件 |

---

## 后续计划

- [ ] 集成 Phase 1-4 组件到前端页面
- [ ] 实现真正的 Pipeline 执行逻辑
- [ ] 添加数据库持久化
- [ ] 完善错误处理和重试机制
- [ ] 添加单元测试

---

*文档生成时间: 2026-06-28*
