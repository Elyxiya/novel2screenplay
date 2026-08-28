# Novel2Screenplay (小说转剧本)

基于 AI 的小说转剧本工具，利用大语言模型将小说章节自动转换为标准剧本格式（YAML）。

## 项目概述

本项目提供一个 Web 界面和 API，帮助编剧和作者将叙事性小说内容转换为结构化的剧本格式。支持多种 LLM 提供商（DeepSeek / OpenAI），输出为结构化的 YAML 剧本格式。

**在线 Demo**: https://pan.quark.cn/s/e254bfd0ee09

## 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | Next.js 16 (App Router) |
| **语言** | TypeScript |
| **UI** | React 19 + Tailwind CSS 4 |
| **数据库** | SQLite (better-sqlite3)；PostgreSQL 可选（`DATABASE_URL` 探择） |
| **AI 集成** | 自定义 LLM 抽象层（DeepSeek / OpenAI / 自定义 OpenAI 兼容与 Anthropic，含用户级 LLM 导入） |
| **序列化** | YAML + Zod 4 校验 |
| **测试** | Vitest + Testing Library + MSW |
| **容器化** | Docker + Docker Compose |

## 核心特性

### 1. SQLite / PostgreSQL 双后端存储
- 使用 better-sqlite3 实现任务持久化（配置 `DATABASE_URL` 可切换 PostgreSQL）
- 支持 jobs / projects / history / novels / dramas / users / agent_tasks / user_llm 表
- 保留 Pipeline 状态，支持任务恢复；按用户数据隔离
- 提供 SQLite→PG 迁移脚本：`node packages/db/scripts/migrate-sqlite-to-pg.mjs`

### 2. SSE 实时推送
- 通过 Server-Sent Events 实时推送转换进度
- 支持多客户端同时订阅
- 自动重连机制，连接失败时降级到轮询

### 3. 多 Agent 编排系统
- AgentRole: supervisor, writer, editor, analyzer, validator
- AgentRegistry: Agent 生命周期管理
- HandoffProtocol: Agent 间任务交接
- ReviewGate: 质量检查点（支持对话式中途追问、任务重启恢复）

### 4. LLM 质量评估与自定义接入
- 传统管线完成后 LLM 四维质量评估 + 质量基准集评测
- 用户级自定义 LLM 导入（OpenAI 兼容 / Anthropic）+ 连通性测试
- API Key AES-GCM 加密存储

## 快速启动

### 开发模式

```bash
# 安装依赖
npm install

# 配置环境变量
# 复制 .env.local 填入你的 API Key
# DEEPSEEK_API_KEY=your_key_here

# 启动开发服务器
npm run dev
```

### Docker 部署

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f app
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 使用流程

1. **上传/导入** — 拖拽 `.txt` 文件或粘贴文本，自动识别章节；也支持直接导入已有 YAML 剧本文件
2. **配置模型** — 选择 LLM 模型、选择要转换的章节、查看预估费用
3. **开始转换** — 四阶段流水线（分析→切割→转换→合并），实时查看进度（SSE 推送）
4. **查看结果** — 原文对照 + 可视化编辑（场景/角色/地点）+ 改编指数仪表盘 + YAML 导出/下载

## 项目结构

```
apps/screenplay/            # 主应用（Next.js，端口 3001）
├── src/app/                # App Router 页面 + API 路由
│   ├── page.tsx            # 首页：上传（支持 .txt / YAML 导入）
│   ├── configure/          # 配置页：章节选择 + 模型选择 + 费用预估
│   ├── convert/            # 转换进度页（SSE 实时推送）
│   ├── result/[id]/        # 结果页：原文对照 + 可视化编辑 + 导出
│   ├── writer/             # 创作台（章节树/正文/AI 助手）
│   ├── shortdrama/         # 短剧分镜页
│   ├── history/ debug/     # 历史记录 / 调试评测
│   └── api/                # API 路由（pipeline/jobs/result/drama/writer/agent/llm/auth/debug）
├── src/components/         # UI 组件（editors / compare / debug / ui）
├── src/lib/                # 业务逻辑
│   ├── pipeline/           # 四阶段转换流水线（PipelineEngine）
│   ├── llm/                # LLM 抽象层（Provider / adapter / 用户级 LLM / api-key-cipher）
│   ├── agent/ multi-agent/ # Agent 框架 + 多 Agent 编排
│   ├── drama/ novel/ eval/ # 分镜 / 小说解析 / 质量评测
│   ├── sse/ store/         # SSE 推送 / 存储（sqlite 双后端）
│   └── tools/ jobs/ result/ agent-chat/
packages/
├── contracts/              # @novel/contracts：Zod 数据契约（novel/screenplay/drama/pipeline）
└── db/                     # @novel/db：共享存取层（DbEngine 双后端 + 迁移脚本）
docs/                       # 方案与记录文档
```

## API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查（含数据库状态） |
| `/api/upload` | POST | 上传文件或粘贴文本 |
| `/api/import/yaml` | POST | 导入已有 YAML 剧本 |
| `/api/pipeline/start` | POST | 启动转换流水线 |
| `/api/pipeline/status/:jobId` | GET | 轮询任务状态 |
| `/api/pipeline/stream/:jobId` | GET | SSE 流式推送进度 |
| `/api/pipeline/cancel/:jobId` | POST | 取消任务 |
| `/api/pipeline/resume/:jobId` | POST | 恢复失败任务 |
| `/api/result/:jobId` | GET | 获取剧本 |
| `/api/models` | GET | 可用模型列表 |
| `/api/cost-estimate` | GET | 费用预估 |

## SSE 事件类型

| 事件类型 | 说明 |
|----------|------|
| `init` | 初始状态 |
| `progress` | 进度更新 |
| `phase` | 阶段切换 |
| `log` | 日志消息 |
| `complete` | 任务完成 |
| `error` | 错误发生 |
| `heartbeat` | 心跳保活 |

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key |
| `OPENAI_API_KEY` | 否 | OpenAI API Key（备选） |
| `DB_DIR` | 否 | 数据库目录（默认 `./data`） |
| `DB_FILE` | 否 | 数据库文件名（默认 `novel2screenplay.db`） |
| `DEFAULT_MODEL_ID` | 否 | 默认模型（默认 `deepseek-chat`） |
| `DATABASE_URL` | 否 | PostgreSQL 连接串，配置后启用 PG 后端（否则 SQLite） |
| `USER_LLM_KEY` | 否 | 用户级 LLM API Key 加密密钥（AES-256-GCM 派生） |
| `STORAGE_SYNC_MODE` | 否 | PG 同步桥模式（`bridge`） |

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口 3001） |
| `npm run build` | 构建生产版本 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint 代码检查 |
| `npx vitest run` | 运行测试 |

## 已知限制

> ⚠️ V1 版本的设计时限制，将在后续版本中解决：

| 限制 | 影响 | 缓解措施 |
|------|------|----------|
| **PG 实跑待环境** | PostgreSQL 后端代码/测试已就绪，未在真实环境验证 | 配置 `DATABASE_URL` 后跑双后端契约测试与迁移脚本 |
| **sourceRefs 精度** | 段落索引在长段落内偏移不精确 | V1 提供 excerpt 供用户搜索定位 |
| **对照视图对齐** | LLM 可能重新组织内容顺序 | 左侧展示原文片段供参照 |
| **移动端适配** | 已做玻璃拟态 + 移动端适配，复杂编辑页仍以桌面优先 | 持续迭代 |

## Schema 设计文档

详见 [`docs/剧本Schema设计文档.md`](docs/剧本Schema设计文档.md)，包含完整 Schema 定义和 7 条设计原因说明。

## 许可证

MIT
