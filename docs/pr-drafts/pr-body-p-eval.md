## 概要

P-评估落地：**传统管线（PipelineEngine）接入 LLM 质量评估 + 质量基准集**，补上"ReviewGate 的多智能体评估只覆盖编排路径、未覆盖传统管线路径"的缺口。

## 背景

/agent 编排路径已有 ReviewGate LLM 四维评估（format/consistency/coherence/drama），但传统管线（/convert → /api/pipeline/*）完成后没有任何 LLM 质量评价，仅 /debug 页有确定性规则评测（flow-eval）。P-评估让传统管线与编排路径在"质量评估"上对齐，并提供基准集验证评估器区分度。

## 改动

### 独立 LLM 评估模块（抽取复用）
- 新增 [llm-quality.ts](apps/screenplay/src/lib/eval/llm-quality.ts)：`VALIDATOR_EVAL_PROMPT` + `assessWithLLM`（LLM JSON → QualityAssessment，坏 JSON 容错 70 分兜底）+ `assessPipelineScreenplay`（Screenplay → YAML → 评估）+ 序列化工具
- orchestrator.evaluateGate 改为复用 `assessWithLLM`，删除本地重复的 Prompt/工具函数（行为不变）

### 传统管线接入
- [PipelineEngine.ts](apps/screenplay/src/lib/pipeline/PipelineEngine.ts)：Phase4 完成后异步执行 LLM 评估（不阻塞 complete），结果持久化到 `job.pipelineState.qualityAssessment`（SQLite），并通过新 SSE 事件 `quality` 推送
- [job-store.ts](apps/screenplay/src/lib/store/job-store.ts)：pipelineState 增加 `qualityAssessment` 字段
- [sse-client-manager.ts](apps/screenplay/src/lib/sse/sse-client-manager.ts)：SSEEvent 类型增加 `quality`

### 质量基准集
- [samples.ts](apps/screenplay/src/lib/eval/benchmark/samples.ts)：3 个 golden 样本（优秀=完整结构+对白 40% / 一般=对白 15%+细节缺失 / 差=断号+悬空引用+无对白），均过 Schema 校验
- [index.ts](apps/screenplay/src/lib/eval/benchmark/index.ts)：`runBenchmark` 逐样本评估，输出排序区分度判定 + 档位命中（相邻容差）
- API：[quality-benchmark/route.ts](apps/screenplay/src/app/api/debug/quality-benchmark/route.ts)（登录后触发，约 3 次真实 LLM 调用）

### 查询与展示
- flow-eval 响应增加 `llmAssessment`（读 pipelineState.qualityAssessment）
- /debug 页新增「LLM 质量评估」卡（分数 + 四维条 + 建议）与「质量基准集」区块（一键运行 + 报告）

## 验证

- typecheck ✓ · 单测 25 文件 / 188 用例全绿（新增 llm-quality 11 例 + benchmark 8 例，mock LLM 覆盖坏 JSON/越界/降级/区分度）
- E2E `e2e-p-eval.mjs` 全绿：真实 LLM 小转换 → 完成后 `llmAssessment` 写入（20 分 + 四维 + 建议）；基准集区分度排序有效（77 > 52 > 8）
- 运行截图（pr-evidence/，不入库）：`peval-debug-llm-assessment.png`（评估卡）、`peval-debug-benchmark.png`（基准报告）
- 说明：基准集为首次校准基线，后续可据结果调参/扩充样本
