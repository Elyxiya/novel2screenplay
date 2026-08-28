# Agent 编排与质量关卡

> 关联图：[数据流-Agent编排与质量关卡.svg](./数据流-Agent编排与质量关卡.svg)

面向「多 Agent 协作 + 人工质量把关」的执行链，覆盖任务调度、角色分工、质量关卡、任务持久化与实时反馈。

## 主链

```
/api/agent → MultiAgentOrchestrator → 角色池 → 任务执行
                                 ↘         ↙
                              ReviewGate 质量关卡
                                ↙      ↘
                        auto-pass    awaiting（人工介入）
                                ↘      ↙
                         AgentTask 持久化 / SSE 推送
```

## 角色池（role division）

| 角色 | 职责 |
|---|---|
| writer | 撰写剧本 / 场景内容 |
| editor | 编辑、润色、衔接 |
| analyzer | 素材分析、要素抽取 |
| validator | 合规 / 结构校验 |

任务由 Orchestrator 按既定策略分配给对应角色执行，全部经 LLM 推理引擎（DeepSeek / OpenAI / Custom）生成。

## ReviewGate 质量关卡

- **auto-pass**：自动通过，流转到下一阶段。
- **awaiting**：挂起等待人工介入——前端在 awaiting 卡片可输入修订建议，调用 `POST /api/agent/review` 的 `revise` 动作 + `instruction` 参数。

```
awaiting + instruction(非空) → 按建议重新生成 → 累积进 task.instruction（后续阶段沿用）
```

## 任务持久化

- `agent-task-repository` 在状态变更点落库（创建 / 阶段终态 / awaiting / retry / 人工介入 / 终态）。
- **重启恢复**：awaiting 保持挂起不续跑；running 回置 pending 自动续跑。

## 实时反馈

- 全程经 SSE 推送 `progress / phase / log / complete`，前端 AgentChatPanel 实时呈现。

## 关键语义

- **人工是在关键时刻介入**，非全程监督：只有质量关卡 `awaiting` 才请求建议。
- **指令累积**：一次 revise 的 instruction 会带入后续阶段，保持意图一致。