# 导出格式扩展评估（FIX-15）

> 日期：2026-09-11 ｜ 结论先行：**md 已交付**（`serializeToMarkdown` + `/api/result/[jobId]/export?format=md`）；
> **docx 建议实施（~1 天）**；**pdf 建议后置**（触发条件见文末）。

## 现状

- YAML：既有（`@novel/contracts/serializers/yaml-serializer`，落库与历史导出用）。
- 分镜表：drama 层既有序列表化产物。
- **Markdown（本批新增）**：场景/角色/分集一体、可选原文溯源行；接口 `GET /api/result/[jobId]/export?format=md&episodes=1&epMinutes=2&sourceRefs=1`（鉴权+归属复用 snapshot 三查；文件名 UTF-8 安全化）。

## docx 方案对比

| 方案 | 机制 | 成本 | 风险 |
|---|---|---|---|
| **`docx` npm 包（推荐）** | 纯 JS 程序化生成 OOXML；场景/对白层次用 Heading/Bold 模板映射 | ~1 天（含样式模板与单测） | 低（无外部二进制、无浏览器依赖） |
| md → pandoc | 依赖外部 pandoc 二进制 | ~0.5 天 | 部署形态耦合（Dockerfile 需装 pandoc；Windows 本地也要装） |
| md → python-docx（脚本侧） | 需 Python 运行时 | ~1 天 | 与应用内导出链路割裂（客户端要携带 Python） |

## pdf 方案对比

| 方案 | 机制 | 成本 | 风险 |
|---|---|---|---|
| puppeteer/playwright 渲染 md→pdf | 无头 Chromium 打印 | ~1–2 天 | **容器体积 +~300MB**、内存占用、启动冷延迟；对"自用级工具"过重 |
| docx → LibreOffice headless | soffice --convert-to pdf | ~0.5 天 | 依赖 LibreOffice 环境；转换保真度需抽检 |
| pdfkit 程序化排版 | 纯 JS 低层排版 | ~2–3 天 | 中文断行/字体嵌入/对白缩进都要手写；维护成本高 |

## 建议与触发条件

1. **docx 随"第一次有真实外部使用者要可编辑稿"时实施**（`docx` 包路线，与 md 共用同一内容模型）；
2. **pdf 保持后置**：优先走"docx 交付 + 用户自转 pdf"，除非出现"必须系统直出 pdf"的明确需求（如平台交付流程硬性要求）；
3. 无论哪条路径，都复用本批的**结构化中间层**（ScreenplayLike + episodes 视图），不直接拼字符串二次实现——避免出现"导出件与 YAML 事实源不一致"的分叉（呼应 FIX-15 验收：导出文件内容与 YAML 一致）。
