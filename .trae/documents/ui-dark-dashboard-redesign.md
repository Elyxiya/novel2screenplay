# 前端 UI 重构：深色高效仪表盘（核心转换流优先）

## 一、Summary

将当前浅色玻璃拟态 + 青蓝霓虹的「科技风」整体转向**深色高效仪表盘**风格，重构全部共享设计系统（globals.css 设计令牌 + 可复用类），并优先改造**核心转换流 5 页 + 全局顶栏**：首页 `/`、上传 `/upload`、配置 `/configure`、转换 `/convert`、结果 `/result/[id]`，以及顶栏 `HeaderNav` 与其中的 `WorkflowStepper`、上传页用到的 `QuickStats`、结果页引用的编辑器组件（`components/editors/*`、`components/compare/*`）。

目标：深色高对比、信息密度高、可扫读、克制动效；保持现有业务逻辑、路由、SSE、数据流**完全不变**，只改表现层（样式类 + 结构微调）。

> 已知过渡态：本次只重做核心流 5 页 + 共享组件。其余页面（`/features`、`/guide`、`/auth/*`、`/workbench`、`/writer`、`/agent`、`/shortdrama`、`/history`、`/settings`、`/debug`）本轮保持旧样式，会呈现「部分浅色、部分深色」的过渡观感，由下一轮统一。此点是用户已接受的「核心流优先」取舍。

## 二、Current State Analysis（现状）

探索结论（已读 `globals.css`、`layout.tsx`、`HeaderNav.tsx`、`WorkflowStepper.tsx`、`page.tsx`(首页)、`upload`、`configure`、`convert`、`result/[id]`、`workbench`、`QuickStats`）：

1. **设计令牌**在 `globals.css` `@theme`：`--color-ink`、`--color-neon`、`--color-primary-glow`、`--color-bg-deep`、`--font-tech`。`body` 为浅色（`linear-gradient(#f8fafc → #eef2ff)` + 三个浅色 radial glow）。
2. **共享可复用类**全部面向浅色：`glass-card`（白/75 + blur）、`glass-card-hover`、`glow-btn`（indigo→cyan 渐变白字）、`glow-btn-ghost`（白底描边）、`tech-input`（白底）、`terminal-panel`（已是深色，可保留）、`tech-tag`、`dropzone-tech`（白底虚线）、`step-badge-*`、`step-connector-*`、`progress-flow`、`bg-tech-grid`、`neon-text`。
3. **根布局** `layout.tsx`：`<body className="h-full flex flex-col text-slate-800">` + `data-theme="light"` 硬编码；字体是系统字体栈（无品牌字体）。
4. **页面内散落大量硬编码浅色类**（非复用类）：`bg-white/70`、`border-slate-200`、`text-slate-900/800`、`text-slate-500/400`、`bg-slate-50`、`bg-indigo-50/cyan-50`、`bg-gradient-to-r from-indigo-600 to-cyan-500`、`text-indigo-600`、`bg-emerald-50`/`bg-amber-50` 状态条等。这些是深色化路上的主要工作量。
5. **一致性现状**：复用类让各页「结构」统一，但深浅色字色/白底/辉光散落，字号、间距、空态、加载态没有系统化；header 站点导航（首页/功能/指南）与工具导航（创作台/Agent/短剧/工作台）双套导航并存。

## 三、设计系统：深色仪表盘令牌（globals.css）

不新增依赖、不换字体（沿用 system-ui 以保证中文字形与加载成本），用 CSS 变量承载深色令牌，并重定义可复用类。

### 3.1 调色板（`@theme` 新增/调整）

```
--color-bg-deep:      #070b16  页面底（近黑蓝）
--color-surface:      #0e1526  卡片
--color-surface-2:    #131c33  升层/输入框
--color-surface-3:    #18233d  悬浮/激活
--color-line:         #1e2a47  描边（分隔）
--color-line-strong:  #2c3a5e
--color-ink:          #e8eefb  主文字（原 ink 是深色，改为浅色主文字）
--color-dim:          #93a0bf  次级文字
--color-faint:        #5d6b8f  弱文字
--color-neon:         #22d3ee  强调青（保留）
--color-primary-glow: #6366f1  强调靛（保留）
--color-accent-emo:#34d399  成功
--color-accent-warn: #fbbf24  警示
--color-accent-err:  #fb7185  错误
```

`body` 改为深色：
```
background:
  radial-gradient(1100px 520px at 85% -10%, rgba(34,211,238,0.10), transparent 60%),
  radial-gradient(950px 520px at -8% 2%, rgba(99,102,241,0.12), transparent 58%),
  radial-gradient(760px 460px at 50% 118%, rgba(124,58,237,0.07), transparent 60%),
  linear-gradient(180deg, #070b16 0%, #0a1120 100%);
background-attachment: fixed;
color: var(--color-ink);  /* body 深色主文字 */
```
`layout.tsx`：`data-theme="dark"`；`body` 类去掉 `text-slate-800`，改由 body 背景继承深色（或保留 flex 布局类）。

### 3.2 语义化命名与复用类重定义（保留类名以复用，减少改动）

- `.glass-card` → 深色面板（本阶段起作为「面板」基类，后续页也能复用）：`bg-[var(--color-surface)] border border-[var(--color-line)] rounded-2xl shadow-lg shadow-black/30`，去掉 blur/white。
- `.glass-card-hover` → hover 提亮 + 描边转 `--color-line-strong` + 轻微上浮；`hover:border-[color:var(--color-accent? 用 cyan/indigo 强调)]`。
- `.glow-btn` → 保持 indigo→cyan 渐变白字，收敛辉光：`box-shadow: 0 4px 18px rgba(99,102,241,0.30)`；hover 微升。
- `.glow-btn-ghost` → 深色描边幽灵按钮：`bg-transparent border-[var(--color-line-strong)] text-[var(--color-dim)] hover:border-[var(--color-neon)] hover:text-[var(--color-ink)]`（去白底）。
- `.tech-input` → 深色输入：`bg-[var(--color-surface-2)] border-[var(--color-line)] text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-neon)] focus:ring-2 focus:ring-cyan-400/20`。
- `.terminal-panel` → 微调背景贴近 surface，其余保持。
- `.tech-tag` → 深色胶囊：底 `rgba(99,102,241,0.12)`，边 `rgba(99,102,241,0.35)`，字 `#a5b4fc`；`.tech-tag-cyan` 同理对应 cyan。
- `.dropzone-tech` → 深色虚线：边 `rgba(99,102,241,0.4)`，底 `radial + rgba(14,21,38,0.5)`；hover/active 边转 cyan。
- `.neon-text` → 保留渐变字（`#6366f1→#22d3ee→#a78bfa`），去掉旧浅底依赖，仅 `background-clip:text; color:transparent`。
- `.bg-tech-grid` → 线色提高可见：`rgba(99,102,241,0.10)`，mask 保留。
- `.step-badge-*`：done=emerald→cyan 渐变；active=indigo→cyan 渐变 + 呼吸（保留）；idle=`bg-[var(--color-surface-3)] text-[var(--color-faint)] border-[var(--color-line)]`。
- `.step-connector` / `-done`：默认线 `rgba(99,102,241,0.25)`，done 段 emerald→cyan。
- `.progress-flow` 保留（本身渐变）。

### 3.3 新增小工具类（本阶段需要）

- `.panel`：等价于 `.glass-card` 的深色面板（别名，便于语义化），可直接统一指向深色类。
- `.text-dim`（=--color-dim）、`.text-faint`、`.mono-num`（`font-family:var(--font-tech); letter-spacing;-0.02em`，用于统计数字）。
- `.thin-scroll`：细滚动条（`::-webkit-scrollbar{width:8px}` 等），深色面板内容区统一。
- `.status-chip`：状态胶囊基类（可覆色），结果页/工作台通用。

> 说明：为避免对全站做破坏性 class 重命名，`glass-card`/`glow-btn` 等保留原名并改为深色实现；在核心 5 页里把散落的硬编码浅色类替换为上述令牌/工具类。这样共享组件（QuickStats、编辑器等）只要没硬编码浅色字，就能随基类自动变深。

## 四、Proposed Changes（逐文件）

按依赖顺序实施。所有页面**只改表现层**，不改取数/SSE/提交逻辑。

### 4.1 `apps/screenplay/src/app/layout.tsx`
- `data-theme="light"` → `"dark"`；`className` 去掉 `text-slate-800`（改由 body 深色继承）。其余不动。

### 4.2 `apps/screenplay/src/app/globals.css`
- 按第三节整体重写令牌 + 复用类 + 新增工具类（`.thin-scroll`、`.status-chip` 等）。
- 保留 `@media (prefers-reduced-motion)` 兼容：重动画类加 `@media (prefers-reduced-motion: reduce)` 关闭 `pulse-glow`/`flow-shine`/`float-up` 等（深色仪表盘应减少动效）。

### 4.3 `apps/screenplay/src/components/HeaderNav.tsx`（顶栏，全站可见）
- header 容器：`bg-white/70` → `bg-[rgba(7,11,22,0.72)] backdrop-blur-xl border-b border-[var(--color-line)]`。
- Logo：图标渐变与呼吸光点保留（深色下更出挑）；副标题 `text-slate-400` → `text-[var(--color-faint)]`。
- 站点导航 + 工具导航所有 `idleCls`/activeCls 深色化：idle=`text-[var(--color-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]`；active=保留各自色系渐变色块。每个工具 Link 的浅色 border/`bg-white/70` → 深色。
- 「＋ 上传/转换」CTA：保留 `.glow-btn`（已深色化）。
- 历史按钮 idle 态深色化。
- 移动下拉菜单深色化（`bg-white/90` → 深色，条目 active/idle 深色）。
- 历史面板抽屉（`bg-white/90` → 深色）与此处同时处理；`HistoryPanel.tsx` 内的浅色字色一并替换（读该文件后替换）。

### 4.4 `apps/screenplay/src/components/WorkflowStepper.tsx`
- 徽章/文字用令牌类：active 步 `text-[var(--color-ink)]`/`text-[var(--color-neon)]`；已过步绿字；未到步 `text-[var(--color-faint)]`；hover 底 `hover:bg-[var(--color-surface-2)]`。结构（可点击跳转）保持不变。

### 4.5 首页 `apps/screenplay/src/app/page.tsx`（营销首屏 → 深色仪表盘首屏）
- Hero：深色玻璃面板（`.glass-card` 已深色）+ `bg-tech-grid` + 深色辉光；标签 `tech-tag` 深；标题 `text-slate-900` → `text-[var(--color-ink)]`，`neon-text` 保留；描述 `text-slate-500` → `text-[var(--color-dim)]`；主 CTA `.glow-btn`、副 CTA `.glow-btn-ghost`（已深化）。
- 核心能力卡片 / 三步流程 / 适用场景 / 底部 CTA：所有 `text-slate-900/700/500` → 令牌色；卡片描边/阴影深色化；编号 `01/02/03` 渐变字保留。
- 内容与文案保持不变。

### 4.6 上传 `apps/screenplay/src/app/upload/page.tsx`
- Hero 束带、Tab 切换器（active=`glow-btn` 深化，idle 深）、`QuickStats`（见 4.8）、dropzone 深、error 提示 `bg-red-50` → `bg-rose-500/10 border-rose-500/30 text-rose-300`。
- 章节解析成功面板：成功图标/标题/章节列表项深色化（`bg-white/70`→surface，`text-slate-700`→ink，`text-slate-400`→dim）。
- YAML tab 同理：`tech-input`（已深）、yaml 校验通过/失败条深色化。
- 按钮 `.glow-btn`/`.glow-btn-ghost` 已深；「开始转换」保留主 CTA。

### 4.7 配置 `apps/screenplay/src/app/configure/page.tsx`
- 顶部返回 `.glow-btn-ghost`（已深）、`tech-tag`（已深）；标题 `text-slate-900`→ink，摘要行 `text-slate-500`→dim（`text-cyan-600`→`text-[var(--color-neon)]`）。
- 章节选择面板（`.glass-card`→深）、小按钮（全选/清空/反选）深化、ChapterChip 未选态 `bg-white/70 border-slate-200 text-slate-500` → `bg-[var(--color-surface-2)] border-[var(--color-line)] text-[var(--color-dim)] hover:border-cyan-400/50`；选中/已转换态保留渐变与 emerald 语义。
- 模型/费用面板、提示 `text-slate-400`→faint；`cost` 大字 `neon-text` 保留；`bg-gradient-to-r from-indigo-500/5` 处深色化。
- 空选警示条 `bg-amber-50`→`bg-amber-500/10 border-amber-500/30 text-amber-300`。
- 底部主 CTA `.glow-btn`（已深）。

### 4.8 `apps/screenplay/src/components/QuickStats.tsx`
- `StatCard` 的 `glass-card`（已深）+ `neon-text`（已深）+ `text-slate-500`→`text-[var(--color-dim)]`。数据/口径不变。

### 4.9 转换 `apps/screenplay/src/app/convert/page.tsx`
- 主卡片 `.glass-card`（已深）+ `.bg-tech-grid` + 深色辉光；进度环渐变保留；中央百分比 `neon-text`/`text-emerald-600` 保留；状态徽章 `bg-indigo-50`/`emerald-50`/`red-50` → 对应深色 `*-500/10 border-*-500/30 text-*-300`。
- 标题 `text-slate-900`→ink、描述/上下文 `text-slate-500`→dim；`当前作品`、`chapterCount` 深色化。
- 四阶段时间线：徽章令牌化、步名 `text-slate-700/400`→ink/dim、desc `text-slate-400`→faint；底部条 `bg-white/40 border-slate-200`→surface/line。
- 日志折叠条：`hover:bg-slate-50/60`→`hover:bg-[var(--color-surface-2)]`，`text-slate-400`→dim；终端面板沿用（已深）。
- 取消/恢复按钮已深。

### 4.10 结果 `apps/screenplay/src/app/result/[id]/page.tsx`（含 4 个编辑器组件）
- 工具栏 sticky：`bg-white/70`→`bg-[rgba(7,11,22,0.72)] backdrop-blur border-b border-line`；标题 `text-slate-900`→ink，统计徽章 `text-slate-500`→dim（保持 emerald/cyan 语义）。
- 工具栏按钮组：`.glow-btn`/`.glow-btn-ghost` 已深；`disabled:opacity-*` 保留。
- Tabs：容器 `bg-white/80 border-slate-200`→深 panel；active 保留渐变；idle `text-slate-500 hover:bg-slate-100/70`→`text-dim hover:bg-surface-2`；count 徽章深。
- 场景导航栏：`bg-white border-slate-200`→surface/line；列表项 active（`from-indigo-50 to-cyan-50 border-indigo-200 text-indigo-700`）→深色选中态（`bg-gradient-to-r from-indigo-500/15 to-cyan-500/15 border-indigo-400/40 text-indigo-300`），idle `hover:bg-slate-50 text-slate-600`→`hover:bg-surface-2 text-ink/80`；折叠条深化。
- 场景详情面板、头部 `bg-white/40 border-slate-200`→surface；AI 修改栏 `bg-amber-50/50 border-amber-100`→`bg-amber-500/10 border-amber-500/25`，文案 `text-amber-700`→`text-amber-300`；流式预览 `bg-white/70`→surface-2，`text-slate-500`→dim。
- 角色/地点 Tab：新增按钮 `.glow-btn-ghost`（已深）；空态面板深。
- YAML Tab：面板深、头部字 `text-slate-700`→ink、编辑按钮（`border-slate-300 ... text-slate-600`）→深 ghost；textarea `bg-transparent`/`bg-cyan-50/50`→`bg-transparent`/`bg-cyan-500/10`，字色改 `text-[var(--color-dim)]`。
- **编辑器组件**（结果页子组件，需先读后改）：`components/editors/SceneEditor.tsx`、`CharacterEditor.tsx`、`LocationEditor.tsx`、`components/compare/SceneCompare.tsx` —— 统一把其内部 `border-slate-*`、`text-slate-*`、`bg-white`、`bg-indigo-50`/`bg-cyan-50` 等浅色硬编码替换为深色令牌/工具类；数据与交互回调不改。
- 追加章节 / 全局套用两个弹窗：遮罩 `bg-slate-900/40`→`bg-black/60`；面板 `bg-white`/`.glass-card`→深；dashed dropzone、`tech-input`、成功/错误条、按钮全部深色化。
- 加载/空态：`text-gray-400`→`text-[var(--color-dim)]`。

### 4.11 其它共用（随基类自动变深，仅兜底微调）
- `components/RequireAuth.tsx` 加载态 `text-gray-400` → `text-[var(--color-dim)]`（可改可不改，低风险一并改）。

> 不在本轮：`/workbench`、`/writer`、`/agent`、`/shortdrama`、`/history`、`/settings`、`/features`、`/guide`、`/auth/*`、`/debug` 及 `HistoryPanel` 页内局部（除非 HeaderNav 抽屉共用部分）→ 保留旧样式，下一轮统一。

## 五、Assumptions & Decisions

1. **方向**：用户已确认「深色高效仪表盘风」——不追求戏剧化，以信息清晰/密度/克制动效为先。
2. **范围**：用户已确认「核心转换流优先」。因此 4.10 范围包含结果页引用的 4 个编辑器组件（属核心流交付完整性），其余页面留归第二轮。
3. **过渡态**：本轮后非核心页会出现深浅混排；这是「核心流优先」的预期结果，不视为缺陷。
4. **字体**：沿用系统字体栈（含中文字形），不引入新 webfont（避免加载成本/加载闪烁）。用 `mono-num` 类强化统计数字。
5. **类名策略**：保留 `glass-card`/`glow-btn`/`glow-btn-ghost`/`tech-input`/`tech-tag` 等现有类名，仅改其实现为深色；页面只替换硬编码浅色类，不做大范围 class 重命名，降低回归风险。
6. **数据/逻辑零改动**：不触碰 API、SSE、pipeline、store、zod schema。

## 六、Verification Steps

1. `npm run typecheck` 全绿；`npm run lint` 0 errors（允许既有 writer 页 2 条 warning 保留）。
2. `npm test` 全绿（600 例——本任务纯前端表现层，不应影响单测；作为回归基线）。
3. dev server `:3001` 启动，逐页 `Invoke-WebRequest` 检查 `HTTP 200` 且含关键新 UI 锚点文本（首页 CTA / header）；确认无模块编译报错。
4. 手工/浏览器抽查（需要时用已登录会话）：首页、上传、配置、转换、结果页在深色下对比度与层级正常；窄屏（移动菜单）正常。
5. `git status` 确认仅改动预期文件。

## 七、Out of Scope（本轮不做）
- 非核心页面深色化（第二轮）。
- 引入品牌字体、暗/亮主题开关、i18n、性能优化专项。
- 任何后端、存储、schema、路由结构变更。