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
| **数据库** | SQLite (better-sqlite3) |
| **AI 集成** | 自定义 LLM 抽象层（支持 DeepSeek / OpenAI） |
| **序列化** | YAML + Zod 校验 |
| **测试** | Vitest + Testing Library + MSW |
| **容器化** | Docker + Docker Compose |

## Phase 1 新特性

### 1. SQLite 持久化存储
- 使用 better-sqlite3 实现任务持久化
- 支持 jobs、projects、history 表
- 保留 Pipeline 状态，支持任务恢复

### 2. SSE 实时推送
- 通过 Server-Sent Events 实时推送转换进度
- 支持多客户端同时订阅
- 自动重连机制，连接失败时降级到轮询

### 3. 多 Agent 编排系统
- AgentRole: supervisor, writer, editor, analyzer, validator
- AgentRegistry: Agent 生命周期管理
- HandoffProtocol: Agent 间任务交接
- ReviewGate: 质量检查点

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
src/
├── app/                    # Next.js App Router 页面
│   ├── page.tsx            # 首页：上传（支持 .txt / YAML 导入）
│   ├── configure/page.tsx  # 配置页：章节选择 + 模型选择 + 费用预估
│   ├── convert/page.tsx    # 转换进度页（使用 SSE 实时推送）
│   ├── result/[id]/page.tsx # 结果页：原文对照 + 可视化编辑 + 导出
│   ├── history/page.tsx    # 历史记录页
│   └── api/                # API 路由
│       ├── health/         # 健康检查
│       ├── pipeline/       # 流水线控制（支持 SSE stream）
│       └── ...
├── components/
│   ├── editors/            # 可视化编辑器组件
│   ├── compare/
│   └── ...
├── lib/
│   ├── agent/              # Agent 框架（单 Agent）
│   │   ├── AgentCore.ts    # 核心 Agent 类
│   │   ├── state-machine.ts # 状态机
│   │   ├── memory.ts       # 记忆系统
│   │   └── llm/           # LLM 集成
│   ├── multi-agent/        # 多 Agent 编排系统
│   │   ├── roles.ts        # Agent 角色定义
│   │   ├── registry.ts     # Agent 注册表
│   │   ├── handoff-protocol.ts # 交接协议
│   │   ├── review-gate.ts  # 质量关卡
│   │   └── orchestrator.ts # 编排器
│   ├── llm/                # LLM 抽象层
│   │   ├── BaseProvider.ts      # 基础 Provider
│   │   ├── DeepSeekProvider.ts # DeepSeek 实现
│   │   ├── OpenAIProvider.ts    # OpenAI 实现
│   │   └── registry.ts          # 注册中心
│   ├── sse/                # SSE 实时推送
│   │   └── sse-client-manager.ts # 客户端管理
│   ├── store/              # 数据存储
│   │   ├── job-store.ts         # 任务存储（SQLite）
│   │   ├── history-store.ts      # 历史记录
│   │   └── sqlite/              # SQLite 实现
│   └── pipeline/           # 四阶段转换流水线
│       ├── PipelineEngine.ts    # 编排器
│       ├── Phase1Analyzer.ts    # 角色/地点分析
│       ├── Phase2Segmenter.ts   # 场景切割
│       ├── Phase3SceneConverter.ts # 场景转换
│       └── Phase4Merger.ts      # 合并去重
└── ...
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
| **SQLite 单机** | 多实例不共享数据 | V2 迁移到 PostgreSQL/Redis |
| **sourceRefs 精度** | 段落索引在长段落内偏移不精确 | V1 提供 excerpt 供用户搜索定位 |
| **对照视图对齐** | LLM 可能重新组织内容顺序 | 左侧展示原文片段供参照 |
| **网络依赖** | DeepSeek API 断网不可用 | V1.1 增加 Ollama 本地模型 |
| **仅桌面端** | 手机/平板未适配 | V1.1 增加响应式布局 |
| **单用户** | 无用户认证和项目管理 | V1.1 添加用户会话 |

## Schema 设计文档

详见 [`docs/剧本Schema设计文档.md`](docs/剧本Schema设计文档.md)，包含完整 Schema 定义和 7 条设计原因说明。

## 许可证

MIT
