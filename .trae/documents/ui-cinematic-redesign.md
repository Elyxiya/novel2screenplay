# 前端 UI 重设计：电影工作台 / 影院质感

## 1. Summary

把当前浅色玻璃拟态 + 靛蓝/青色霓虹的界面，整体重设计为一套 **「电影工作台 / 影院质感」** 的深色界面——呼应产品「小说 → 剧本 → 拍摄」的影视创作定位，观感像一间影视剪片室 / 制片台：近黑炭色底、钨丝琥珀强调色（主 CTA/创作），青色作为管线/进行中状态色（次强调），排版上标题用衬线字重出电影片名的层次，数据/进度用等宽字呈现时间码感。

覆盖范围：**核心转换链路 5 页（首页 / 上传 / 配置 / 转换 / 结果）+ 全局共享壳（globals.css token、layout、HeaderNav、WorkflowStepper、QuickStats、ModelSelector、RequireAuth、HistoryPanel、AuthStatus）**。其余工具页（工作台/创作台/分镜/历史/设置等）一律不手改，靠全局 token 自动适配深色。

硬约束：不改业务逻辑、SSE、API、数据库；全部为前端视觉/交互层改动。改完需 `lint` `typecheck` `test` `build` 全绿。

## 2. 现状分析（Phase 1 探查结论）

- 设计系统集中在 `apps/screenplay/src/app/globals.css`（Tailwind v4 `@theme` + `@layer components`）：
  - 色板 token：`--color-ink / neon / primary-glow / bg-deep`，`--font-tech`；`data-theme="light"` 由 `layout.tsx` 写入 html。
  - 组件类（`.glass-card`/`.glow-btn`/`.tech-input`/`.terminal-panel`/`.bg-tech-grid`/`.neon-text`/`.step-badge*`/`.step-connector*`/`.tech-tag*`/`.dropzone-tech*`/`.progress-flow`）全部是**浅色玻璃 + 靛蓝→青色霓虹渐变**。
  - body 背景是浅色 `#f8fafc→#eef2ff` 多径向渐变。
- 共享壳：
  - `layout.tsx`：`<html data-theme="light">`，body `text-slate-800`。
  - `components/HeaderNav.tsx`：白 70% 毛玻璃顶栏；Logo 靛蓝→青色方块+呼吸光点；3 步 `WorkflowStepper` / 站点导航切换；工具导航（创作台/Agent/短剧分镜/工作台）各带不同色渐变 active 态；全局「上传/转换」CTA；历史按钮；`AuthStatus`；移动端下拉菜单。
  - `components/WorkflowStepper.tsx`：`step-badge-*` + `step-connector*`；active 用靛蓝→青色渐变 + `pulse-glow`；hover 白色底。
  - `ModelSelector.tsx` / `QuickStats.tsx`：浅色 `tech-input`/`glass-card` 系列。
- 核心页现状：
  - `app/page.tsx`（首页）：Hero 玻璃卡 + `bg-tech-grid`；6 能力卡（`glass-card`）；三步流程；适人群；底部 CTA。主 CTA `glow-btn` 靛→青渐变。
  - `app/upload/page.tsx`：Hero 引导卡；Tab（上传小说/上传 YAML）；`QuickStats`；`dropzone-tech` 拖拽区；粘贴区；章节清单卡（浅色）；YAML 校验区。
  - `app/configure/page.tsx`：返回/步骤标签；章节选择卡（`glass-card` + `ChapterChip` 网格，选中渐变、已转绿色、清空/全选/反选小按钮）；模型与预估费用卡；开始转换 `glow-btn`。
  - `app/convert/page.tsx`：当前进行画像（上一轮已重做过一版：进度环+当前阶段徽章+四阶段时间线+折叠日志）；大量浅色 `text-slate-*` 与 `neon-text`。
  - `app/result/[id]/page.tsx`（编辑器）：「场景/角色/地点/YAML」Tab + 三栏编辑器 + 追加章节弹窗 + 场景 AI 修改 + 全局套用 + 导出。体量最大，本方案只做全局 token 层自动适配 + 顶栏/Tab 轻量统一的局部深色化，不逐元素重排。

## 3. 设计系统（核心，globals.css 重写）

### 3.1 设计方向与原则
- **关键词**：影院/制片台、胶片颗粒、钨丝灯、场景板、时间码、克制的动效。
- **层次**：底（近黑）→ 卡片（微亮面板）→ 分隔弱化，靠内边距与字号而非描边建立层级。
- **主强调**：琥珀金（钨丝灯）`#e8b04a` 系，用于主 CTA、关键数字/标题强调。
- **状态强调**：青色（沿用神经网络/管线语义）用于进行中/管线/通知；翡翠用于成功；红用于错误；统一为深色适配版本。
- **不堆叠装饰**：保留 `bg-tech-grid` 但大幅降透明度成暗色底纹；渐变动效收敛到主 CTA 与进度环，避免满屏发光。

### 3.2 具体改动（`globals.css`）

`@theme` 新增/覆盖 token：

```css
@theme {
  --color-ink: #0b0b0d;           /* 近黑底色 */
  --color-panel: #151519;         /* 卡片面板 */
  --color-panel-2: #1c1c22;       /* 内嵌/悬浮面板 */
  --color-line: rgba(255,255,255,0.08);   /* 弱分隔线 */
  --color-tungsten: #e8b04a;      /* 主强调·钨丝琥珀 */
  --color-amber-soft: #f5c876;
  --color-neon: #22d3ee;          /* 次强调·管线青 */
  --color-ink-text: #f2efe9;      /* 主文字·暖白 */
  --color-ink-muted: #a9a49b;     /* 次级文字·暖灰 */
  --color-ink-faint: #6e6a63;     /* 弱化文字 */
  --color-ink-line: rgba(255,255,255,0.08);
  --font-tech: "SFMono-Regular","Cascadia Code","JetBrains Mono",Consolas,monospace;
  --font-display: "Noto Serif SC","Songti SC","STSong",system-ui,serif; /* 片名衬线 */
}
```

`@layer base` body：底色换为近黑 + 暗色电影颗粒/柔光；文字主色 `--color-ink-text`。

- 背景：多层极暗径向光（琥珀 6%、青色 5%）压在同一条近黑 `#0b0b0d` 上，`background-attachment: fixed`。
- 可选细颗粒：用 `opacity` 极低的准静态细点纹理（CSS 渐变点阵，禁透明 gif）。

`@layer components` 重定义（**类名保持，含义换肤**，使全局引用无需改名 → 最小侵入）：

- `.glass-card` → 深色面板：`bg-panel`、`border` `rgba(255,255,255,0.08)`、`rounded-2xl`、极轻投影。`.glass-card-hover` → hover 边框提亮 + 轻微上移（去除浅色 cyan 阴影）。
- `.glow-btn` → 主 CTA 琥珀：渐变 `#c8892f → #e8b04a`，白字 900 加权，柔和钨丝投影；hover 提亮/上移 1px；disabled 降透明度。别名 `.glow-btn-amber` 保留 `.glow-btn` 原锚点以兼容现有引用（等价替换原类定义即可，不改类名）。
- `.glow-btn-ghost` → 暗色描边按钮：透明底、`rgba(255,255,255,0.14)` 描边、暖白文字；hover 描边转 amber。
- `.tech-input` → 暗色输入：`bg-panel-2`、`rgba(255,255,255,0.1)` 描边、暖白文字；focus 琥珀描边 + 细环。
- `.terminal-panel` → 保持深色但加深，匹配新底色（已经是深色，微调大气）。
- `.bg-tech-grid` → 网格线透明度降到 ~0.04 白，mask 收敛，营造暗色底纹。
- `.neon-text` → 改为琥珀→暖白渐变（片名强调），标题类文字用。
- `.step-badge-*`/`.step-connector*` → active 用琥珀金，done 用翡翠金，idle 用暗灰；`pulse-glow` 动画颜色随之改 amber 光晕。
- `.tech-tag`/`.tech-tag-cyan` → 暗色胶囊：深底、弱描边、琥珀/青文字，去掉浅紫背景。
- `.dropzone-tech*` → 暗色拖拽区：近黑面板 + 1.5px 琥珀虚线描边，hover/active 转琥珀高亮（弱化旧青色）。
- `.progress-flow` → 颜色改琥珀；`flow-shine` 高光调暗以免刺眼。
- 动效：`pulse-glow`/`flow-shine`/`float-up`/`spin-slow` 保留，但参与颜色同步到琥珀/降低强度；尊重 `prefers-reduced-motion`（包一层 media query 关自动/循环动效）。

### 3.3 排版补强（globals.css base or a `@layer`）
- 新增标题辅助类 `.display-font`（`font-family: var(--font-display)`），用于 Hero 大标题、分节标题、结果页主标题，出「片名」衬线层次。
- 数据/进度/时间码用 `--font-tech` 既有等宽。

## 4. 共享壳改动

### 4.1 `app/layout.tsx`
- `<html data-theme="dark">`；body `text-slate-800` → `text-ink-text bg-ink`（或保留 `text-[--color-ink-text]`）；`bg-ink` 兜底避免 body 白闪。
- 可顺带把 `<html lang="zh-CN">` 补 `style` 深色背景属性防首帧白闪（`style={{ backgroundColor }}` 或等价）。

### 4.2 `components/HeaderNav.tsx`
顶栏深色化：
- `bg-white/70 border-slate-200/70` → `bg-[#101014]/85 backdrop-blur-xl border-b border-white/8`。
- Logo 方块：`from-indigo-600 to-cyan-400` → 琥珀渐变 `from-[#c8892f] to-[#e8b04a]`，呼吸光点改 amber。
- Logo 文字 `.neon-text` 生效（全局换肤后自动变琥珀片名）。
- 工具导航 idle 态：`border-slate-300 bg-white/70 text-slate-500 hover:...` → 暗色版本 `bg-transparent text-ink-muted border-white/10 hover:text-white hover:border-white/20`；
  active 态：把各页自己的渐变色改为该页保留（创作台琥珀、Agent 洋红紫、短剧青、工作台靛蓝）但使用深色阴影 `shadow-*/30` 降爆，文字白字不变——确保「各有辨识色」仍成立，只是深底更收敛。
- 「上传/转换」CTA `.glow-btn` 换肤后自动变琥珀，无需额外处理。
- are 历史按钮/移动端按钮：同步为暗色描边样式（`border-white/10 text-ink-muted`），active 琥珀填充。
- 移动端下拉：`bg-white/90 border-slate-200/70` → `bg-[#0f0f13]/95 border-white/8`；选项描边 `border-slate-200/70 text-slate-600` → `border-white/10 text-ink-muted hover:bg-white/5`。
- 历史抽屉 `w-72 bg-white/90 border-slate-200/70` → 深色面板 `bg-[#121216] border-white/8`。
- 遮罩 `bg-slate-900/20` 保持（深色页同样适用）。

### 4.3 `components/WorkflowStepper.tsx`
- 文字色：active `text-slate-900` → `text-white`；done `text-slate-700`→`text-ink-muted`；idle `text-slate-400`→`text-ink-faint`；次级 desc 对应的青/绿 → 对应琥珀/翡翠暗色。
- hover 底 `hover:bg-indigo-50/70`/`hover:bg-slate-50` → `hover:bg-white/5`/`hover:bg-white/5`；`group-hover:shadow-emerald-300/40` → 琥珀。
- 徽章态走 `.step-badge-*` 全局换肤，无需改类名。

### 4.4 `components/QuickStats.tsx`
- `StatCard` 的 `neon-text` 自动变琥珀；`text-slate-500` 标签 → `text-ink-muted`；卡片 `glass-card` 自动深色。

### 4.5 `components/ModelSelector.tsx`
- `tech-input` 自动暗色；展开详情 `bg-white/70 border-slate-200/70` → 暗面板 `bg-[#18181d] border-white/10`；行 hover `hover:bg-indigo-50/60` → `hover:bg-white/5`；`text-slate-500/700` → `text-ink-muted`/`text-ink-text`；预算条 `bg-slate-200` → `bg-white/10`（红/黄/绿保留）。

### 4.6 `components/RequireAuth.tsx` / `AuthStatus.tsx` / `HistoryPanel.tsx`
- 仅做浅色类名 → 深色等价类名替换：`text-slate-*` → `text-ink-*`，`bg-white/*` → `bg-*/dark`，描边 `border-slate-*` → `border-white/10`，按钮 active 琥珀。HistoryPanel 依赖 `glass-card`/终端等自动生效，逐处替换文本/描边类即可。

## 5. 核心链路页面改动

### 5.1 `app/page.tsx`（首页）
- Hero 标题：`text-slate-900` → `text-white`；`neon-text` 自动变琥珀；Hero 卡 `glass-card` 自动深色；`bg-tech-grid` 变暗色底纹。
- 标签 `.tech-tag`/`tech-tag-cyan` 自动琥珀/青暗色。
- 能力卡：`glass-card-hover` 自动深色；图标块 `from-indigo-600 to-cyan-400` → 琥珀渐变 `from-[#c8892f] to-[#e8b04a]`（6 个能力图标统一琥珀可辨识，避免满屏花花绿绿）；标题/描述 `text-slate-900/500` → `text-white/ink-muted`。
- 三步流程卡：数字 `font-mono` 渐变 `from-indigo-600 to-cyan-400` → 琥珀渐变；箭头 `text-cyan-400` → `text-amber-400`；内部白底卡 `bg-white/70 border-slate-200/70` → `bg-[#141419] border-white/10`；「了解更多」链接 `text-cyan-600` → `text-amber-400`。
- 底部 CTA 卡：同 Hero 深色；`text-slate-900/500` → 深色文字类。
- 「为谁而生」卡同理。

### 5.2 `app/upload/page.tsx`
- Hero 引导卡 `glass-card` 自动深色；标题 `text-slate-900`→`text-white`，`neon-text` 自动琥珀。
- Tab 切换器 `bg-white/70 border-slate-200/70` → 暗色 `bg-[#131317] border-white/10`；激活 Tab `from-indigo-600 to-cyan-500` → 琥珀渐变 `from-[#c8892f] to-[#e8b04a]`；未激活 `text-slate-500 hover:text-slate-700` → `text-ink-muted hover:text-white`。
- 错误/成功提示条：`bg-red-50 border-red-200 text-red-700` → 深色 `bg-red-950/40 border-red-500/30 text-red-300`；成功条 `emerald-*` → `bg-emerald-950/40 ... text-emerald-300`。
- 拖拽区 `.dropzone-tech*` 自动暗色。
- 分隔线 `border-t border-slate-200` → `border-white/10`；「或直接粘贴」`text-slate-400` → `text-ink-faint`。
- 章节清单卡 `glass-card` 自动深色；行 `bg-white/70 border-slate-100` → `bg-[#16161b] border-white/8 hover:border-amber-400/40`；序号 `text-slate-400`→`text-ink-faint`；标题 `text-slate-700`→`text-ink-text`；`text-slate-400` 段数 → `text-ink-faint`。
- 已并入资产小胶囊 `bg-indigo-50 border-indigo-200/70 text-indigo-700` → 深色 `bg-amber-500/10 border-amber-500/30 text-amber-300`；已转换提示 `text-cyan-600`/`text-emerald-600` → 对应暗色。
- 按钮 `.glow-btn`/`.glow-btn-ghost` 自动琥珀/暗色。

### 5.3 `app/configure/page.tsx`
- 顶部返回 `.glow-btn-ghost` 自动暗色；步骤标签 `.tech-tag` 自动；标题 `text-slate-900`→`text-white`；副文案 `text-slate-500`→`text-ink-muted`；`text-cyan-600`→`text-amber-400`（章节数强调保留青色做管线计数也可，统一为 amber 更聚焦——采用 amber）。
- 章节选择卡 `glass-card` 自动深色；标题 `text-slate-800`→`text-ink-text`，图标 `text-indigo-500`→`text-amber-400`；全选/清空/反选按钮 `border-slate-300 ... bg-white/60 hover:border-cyan-400/60 hover:text-cyan-700` → `border-white/10 text-ink-muted hover:border-amber-400/50 hover:text-amber-300`;
- `ChapterChip`：选中 `from-indigo-600 to-cyan-500 shadow-indigo-300/50` → 琥珀渐变 `from-[#c8892f] to-[#e8b04a] shadow-amber-500/30`；已转 `bg-emerald-50/80 text-emerald-600 border-emerald-300/60` → 深色 `bg-emerald-500/10 text-emerald-300 border-emerald-500/30`；未选 `bg-white/70 text-slate-500 border-slate-200 hover:border-cyan-300/50 hover:bg-white` → `bg-[#18181d] text-ink-muted border-white/10 hover:border-amber-400/40 hover:bg-[#1e1e24]`。
- 模型与费用卡 `glass-card` 自动深色；标题/icon 同章节卡；费用显示框 `border-slate-200/70 bg-white/70` → `bg-[#141419] border-white/10`，`neon-text` 自动琥珀。
- 底部警告条 `bg-amber-50 border-amber-200 text-amber-700` → 深色 `bg-amber-500/10 border-amber-500/30 text-amber-300`。
- 开始转换 `.glow-btn` 自动琥珀。

### 5.4 `app/convert/page.tsx`（核心，重点）
- 大卡片 `glass-card` 自动深色；`bg-tech-grid` 变暗；内层文字 `text-slate-900`→`text-white`，`text-slate-500`→`text-ink-muted`，`neon-text` 自动琥珀。
- 顶栏：返回 `.glow-btn-ghost` 自动；「当前作品」`text-slate-400/700` → `text-ink-muted/ink-text`；章数 `text-cyan-600` → `text-amber-400`。
- 进度环：轨道 `text-slate-200/80` → `text-white/10`；`ringGrad` 渐变 `#6366f1→#22d3ee` → 琥珀 `#c8892f→#e8b04a`；完成 `text-emerald-600` 保留暗色。
- 当前阶段徽章：完成 `bg-emerald-50 text-emerald-600 border-emerald-200` → 深色；错误 `bg-red-50...` → 深色红；进行中 `bg-indigo-50 text-indigo-600` → `bg-amber-500/10 text-amber-300 border-amber-500/30`。
- 取消按钮 `.glow-btn-ghost !text-red-500 !border-red-200` → 深色红描边。
- 四阶段时间线：内层 `border-t border-slate-200/70 bg-white/40` → `border-white/8 bg-[#0f0f13]`；标识 `isNow text-indigo-600`→`text-amber-400`，`isDone text-slate-700`→`text-ink-muted`，idle `text-slate-400`→`text-ink-faint`；desc `text-slate-400`→`text-ink-faint`。
- 日志折叠卡 `glass-card` 自动深色；头 `hover:bg-slate-50/60` → `hover:bg-white/5`；分隔 `border-slate-200/70` → `border-white/8`；`terminal-panel` 已深色；`streaming` 青色保留。

### 5.5 `app/result/[id]/page.tsx`（体量大，局部轻改 + token 全局适配）
- 原则：不逐元素重排，仅全局 token 自动深色 + 少量高权重类名替换（顶栏标题、Tab、工具栏 active 琥珀、场景/角色/地点卡片文字色、弹窗面板底色）。
- 改顶层容器该类名对 `text-slate-*`/`bg-white/*`/`border-slate-*` 做一轮到深色等价的批量替换；编辑器内深色滚动区（如 `SceneEditor` 等子组件）如已用暗色则不动，否则统一走 token。
- Tab 激活态 `from-indigo-600 to-cyan-500` → 琥珀渐变，保证「当前查看」在深色下聚焦。
- 追加章节弹窗 / AI 修改面板：`bg-white/90` → 深面板，按钮 active 琥珀，错误/成功条深色。
- YAML 编辑器面板保持等宽深色。

## 6. 假设与决策

- **类名沿用、语义换肤**：不改任何组件/页面类名，只改 globals.css 定义 + 逐处浅色 Tailwind 类 → 深色类。将浅色显式类（`text-slate-*`/`bg-white/*`/`border-slate-*`/`from-indigo-600 to-cyan-500`）统一切换到新增的深色 token/类，避免深色下残留浅色块。
- **主色决策**：琥珀金做主强调（契合影院钨丝光与「创作」）；青色降级为管线/进行中语义色，仍保留。各工具页保留各自辨识色但深底收敛。
- **排版**：标题用 `--font-display`（Noto Serif SC 等中文字体栈）强化片名感；等宽字体用于数据/时间码。若用户环境无 Noto Serif，回退宋体栈——不引入外部字体加载（约束内）。
- **动效**：保留现有 4 个 keyframes 但染色/调降；加 `@media (prefers-reduced-motion)` 关闭自动动画。
- 不新增依赖、不改 SSR/API/DB/SSE、不手改非选定范围页面（工作台/创作台/分镜/历史/设置/Agent/指南/功能等仅依赖全局 token）。
- 主题固定深色（不做运行时切换），由 `data-theme="dark"` 承载，语义上为后续可选切换预留。

## 7. 验证步骤

1. `npm run lint`、`npm run typecheck`、`npm test`（600 用例）、`npm run build` 依次通过。
2. 启动 dev server（记忆中的启动方式），浏览器逐页检查：首页 / upload / configure / convert / result 五个核心页在深色下的对比度与布局；响应式断点（lg 折叠、移动端菜单）；动效不刺眼、`reduced-motion` 生效。
3. 快捷键/可访问性抽查：Tab 焦点环在深色下可见；按钮 disabled 态可辨；文本与背景对比度达 AA。
4. 回归确认：上传→配置→转换→结果 全流程操作仍可用（SSE/API 未动，仅视觉）。

## 8. 交付物

- 改 `apps/screenplay/src/app/globals.css`（token + 组件类换肤 + 排版补强 + reduced-motion）。
- 改 `apps/screenplay/src/app/layout.tsx`（dark 主题 + body 底色）。
- 改共享壳：`HeaderNav.tsx`、`WorkflowStepper.tsx`、`QuickStats.tsx`、`ModelSelector.tsx`、`RequireAuth.tsx`、`AuthStatus.tsx`、`HistoryPanel.tsx`。
- 改核心页：`app/page.tsx`、`app/upload/page.tsx`、`app/configure/page.tsx`、`app/convert/page.tsx`、`app/result/[id]/page.tsx`。