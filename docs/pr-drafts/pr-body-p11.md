## 变更说明

**P1-1：/debug 流程可视化验收微调**（核心功能已在 main 合入，本次补齐验收差距）

### 验收差距分析
对照 `docs/Agent流程可视化与评测方案.md` 2.2.4 节验收标准逐条核对：
- ✅ 总评分卡（总分 + 等级徽章 + 五维条形图 + issue 列表）
- ✅ 流水线视图（4 阶段卡片 + 状态/耗时/指标/分数）
- ⚠️ **场景置信度分布条（0-1 分段条形）缺失** → 本次补上
- ✅ 对话联动（LLM 日志折叠展开）
- ⚠️ **URL 携带 jobId 打开页面不会自动评测**（需手动点按钮，分享链接无法直达）→ 本次修复

### 变更内容
1. **场景置信度分布条**（`flow-evaluator.ts` + `FlowDebugClient.tsx`）：
   - 评测器 `sceneConfidence` 新增 `buckets: number[]`：将各场景 confidence 按 0-0.2 / 0.2-0.4 / 0.4-0.6 / 0.6-0.8 / 0.8-1.0 五桶分桶统计
   - UI 在"关键统计"卡片内渲染分桶条形图：低分段（<0.6）橙色、高分段绿色，柱顶标注场景数
2. **jobId 直达自动评测**（`FlowDebugClient.tsx`）：`useEffect` 挂载时若 URL 带 `jobId` 参数则自动触发评测，分享链接即可直达结果
3. **测试**（`flow-evaluator.test.ts` 新增 3 用例）：完整任务分桶正确（0.8/0.85/0.9 → 桶 [0,0,0,0,3]）、低置信度分桶（0.3/0.2 → 桶 [0,2,0,0,0]）、无数据全零

### 验证结果
- **单元测试**：debug 相关 17/17 通过（flow-evaluator 17 用例，含新增 3 项）
- **Typecheck**：`tsc --noEmit` 通过
- **E2E**（真实 DeepSeek 传统管线转换，`e2e-debug.mjs`）：job `job_1786237846772_khlinu` 转换完成（analyzing → converting → completed），`/debug?jobId=` 评测得分 **91 / excellent**（结构完整 100 / 引用一致 100 / 叙事连贯 100 / 戏剧张力 95 / Token 效率 60）
- **运行截图**（本地文件，未进仓库，见 `pr-evidence/`）：
  - `pr-evidence/p11-debug-01-overview.png` — 评测总览（总分 91 + 五维 + 置信度分布条 + 流水线阶段）
  - `pr-evidence/p11-debug-02-logs.png` — LLM 对话日志联动（展开状态）

### 备注
- 全量 vitest 中 `auth/session`、`store/sqlite/*` 3 文件存在预存失败（"Cannot find package '@/…'"，经 git stash 验证与本 PR 无关，属 main 基线问题）
