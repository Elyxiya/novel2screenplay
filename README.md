# Novel2Screenplay (小说转剧本)

基于 AI 的小说转剧本工具，利用大语言模型将小说章节自动转换为标准剧本格式（YAML）。

## 项目概述

本项目提供一个 Web 界面和 API，帮助编剧和作者将叙事性小说内容转换为结构化的剧本格式。支持多种 LLM 提供商（DeepSeek / OpenAI），输出为结构化的 YAML 剧本格式。项目demo链接：https://pan.quark.cn/s/e254bfd0ee09

## 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | Next.js 16 (App Router) |
| **语言** | TypeScript |
| **UI** | React 19 + Tailwind CSS 4 |
| **AI 集成** | 自定义 LLM 抽象层（支持 DeepSeek / OpenAI） |
| **序列化** | YAML + Zod 校验 |
| **测试** | Vitest + Testing Library + MSW |

## 依赖清单

| 依赖 | 版本 | 用途 |
|------|------|------|
| next | ^16 | 框架 |
| react / react-dom | ^19 | UI |
| zod | ^4 | Schema 定义与校验 |
| yaml | ^2 | YAML 序列化/反序列化 |
| tiktoken | ^1 | Token 精确估算（cl100k_base） |

## 快速启动

```bash
# 安装依赖
npm install

# 配置环境变量
# 复制 .env.local 填入你的 API Key
# 至少需要配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY
# DEEPSEEK_API_KEY=your_key_here

# 启动开发服务器
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 使用流程

1. **上传/导入** — 拖拽 `.txt` 文件或粘贴文本，自动识别章节；也支持直接导入已有 YAML 剧本文件
2. **配置模型** — 选择 LLM 模型、选择要转换的章节、查看预估费用
3. **开始转换** — 四阶段流水线（分析→切割→转换→合并），实时查看进度
4. **查看结果** — 原文对照 + 可视化编辑（场景/角色/地点）+ 改编指数仪表盘 + YAML 导出/下载

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面
│   ├── page.tsx            # 首页：上传（支持 .txt / YAML 导入）
│   ├── configure/page.tsx  # 配置页：章节选择 + 模型选择 + 费用预估
│   ├── convert/page.tsx    # 转换进度页（完成后自动保存到历史）
│   ├── result/[id]/page.tsx # 结果页：原文对照 + 可视化编辑 + 导出
│   └── history/page.tsx    # 历史记录页（localStorage 持久化）
├── components/
│   ├── editors/            # 可视化编辑器组件
│   │   ├── SceneEditor.tsx      # 场景编辑器（动作/对白增删改）
│   │   ├── CharacterEditor.tsx  # 角色编辑器（别名/标签/描述/删除）
│   │   └── LocationEditor.tsx   # 地点编辑器（类型/描述/删除）
│   ├── compare/
│   │   └── SceneCompare.tsx     # 原文对照组件（分屏/剧本/原文模式）
│   ├── HeaderNav.tsx       # 导航栏（面包屑 + 历史按钮）
│   └── HistoryPanel.tsx    # 历史侧边栏面板
├── lib/
│   ├── llm/                # LLM 抽象层
│   │   ├── BaseProvider.ts      # 基础 Provider（超时/重试/限流/日志）
│   │   ├── DeepSeekProvider.ts  # DeepSeek 实现（支持模型 ID 配置）
│   │   ├── OpenAIProvider.ts    # OpenAI 实现
│   │   ├── registry.ts          # 注册中心
│   │   ├── rate-limiter.ts      # TokenBucket 限流器
│   │   └── prompts/             # 提示词模板（含防幻觉约束）
│   ├── schema/             # 剧本数据模型
│   │   ├── screenplay.schema.ts # Zod Schema
│   │   ├── validator.ts         # 校验器（含自动修复）
│   │   └── yaml-serializer.ts   # YAML 序列化
│   ├── pipeline/           # 四阶段转换流水线
│   │   ├── PipelineEngine.ts    # 编排器（支持章节选择过滤）
│   │   ├── Phase1Analyzer.ts    # 角色/地点分析
│   │   ├── Phase2Segmenter.ts   # 场景切割（章节局部偏移）
│   │   ├── Phase3SceneConverter.ts # 场景转换（分段并行，内容清洗）
│   │   ├── Phase4Merger.ts      # 合并去重
│   │   └── ContextManager.ts    # Token 管理
│   ├── novel/              # 小说解析
│   │   └── parser.ts
│   └── store/              # 作业状态存储
│       ├── job-store.ts         # 内存 JobStore
│       └── history-store.ts     # localStorage 历史记录
└── api/                    # API 路由
    ├── upload/             # 文件上传
    ├── import/yaml/        # YAML 剧本导入（支持 dry-run）
    ├── pipeline/           # 流水线控制
    └── result/             # 结果获取/更新（支持局部实体更新和删除）
```

## API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/upload` | POST | 上传文件或粘贴文本 |
| `/api/import/yaml` | POST | 导入已有 YAML 剧本（支持 dry-run 预览） |
| `/api/pipeline/start` | POST | 启动转换流水线（`selectedChapters` 可选） |
| `/api/pipeline/status/:jobId` | GET | 轮询任务状态 |
| `/api/pipeline/cancel/:jobId` | POST | 取消任务 |
| `/api/pipeline/resume/:jobId` | POST | 恢复失败任务 |
| `/api/result/:jobId` | GET | 获取剧本（含 YAML + chapterTexts） |
| `/api/result/:jobId` | PATCH | 更新剧本（支持 scene/character/location 局部更新及删除） |
| `/api/models` | GET | 可用模型列表 |
| `/api/cost-estimate` | GET | 费用预估 |

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint 代码检查 |
| `npx vitest run` | 运行测试 |

## 已知限制

> ⚠️ V1 版本的设计时限制，将在后续版本中解决：

| 限制 | 影响 | 缓解措施 |
|------|------|----------|
| **内存 JobStore** | Next.js 热重载丢失数据；多实例不共享 | V1 单机开发/测试；迁移到 SQLite/Redis |
| **sourceRefs 精度** | 段落索引在长段落内偏移不精确 | V1 提供 excerpt 供用户搜索定位 |
| **对照视图对齐** | LLM 可能重新组织内容顺序，左右不完全逐句对应 | 左侧展示原文片段供参照 |
| **网络依赖** | DeepSeek API 断网不可用 | V1.1 增加 Ollama 本地模型 |
| **仅桌面端** | 手机/平板未适配 | V1.1 增加响应式布局 |
| **单用户** | 无用户认证和项目管理 | V1.1 添加用户会话 |

## Schema 设计文档

详见 [`docs/剧本Schema设计文档.md`](docs/剧本Schema设计文档.md)，包含完整 Schema 定义和 7 条设计原因说明。

## 许可证

MIT
