# Tauri 桌面壳搀接计划（agent-embed 跟进）

> 承接可嵌入 Agent 工作台（`packages/agent-workbench`）。背景：跨域桥 + origin 白名单已在 web / iframe 两宿主验证，本节把最后一块——桌面壳——落到执行层面。

## 1. 为什么是 Tauri

- JD 提出"cross-platform WebView"诉求：一个渲染底座，`web / iframe / 桌面壳`复用同一面板。
- 本方案面板已被抽成**纯展示 + 意图上报**、不含任何 Node/Next 依赖的单文件 UMD，Tauri 的 WebView（Windows WebView2 / macOS WKWebView）可直接承载——这是前两宿主验证的价值背书。

## 2. 现状（已完成）

- `packages/agent-workbench`：IIFE UMD + `defineAgentWorkbench()` + `HostBridge` / `PanelBridge` + 协议校验；React 挂 shadow DOM。
- `apps/embed-hosts/web`（`:3004` 直嵌）+ `apps/embed-hosts` 跨域 iframe（`:3003`）：端到端验证通过（awaiting → approve → 完成，伪造 origin 拒绝）。
- 宿主桩 `setupEmbedHost({ target, targetOrigin })` 已封装"注册桥 + 事件复放"；各类宿主只需换 `target` / `targetOrigin` 与真实 `fetch`。

## 3. 待办（tauri-shell 分支）

### 3.1 Rust 侧（注入宿主逻辑）

- `src-tauri/src/main.rs`：`setup` 里创建 WebView，`with_initialization_script`（或 `with_html`）把 `agent-workbench.umd.js` + 宿主桥脚本注入。
- 适配真实业务：面板通过桥上报 `workbench:start` → Rust `command` 调 `reqwest` 打后端 `/api/agent/start`，SSE 用 `reqwest::stream` 逐行读，把每行 `data.event` 转成 `bridge.sendEvent` 的 JS 调用写回 WebView。

> 注意：桌面壳里 `target` 是 WebView 顶层 `window`（同源 self 桥），`targetOrigin` 用 `*` 或 WebView 固定 origin（`tauri://localhost` / `http://tauri.localhost`）。`WORKBENCH_ORIGIN_ALLOWLIST` 需加入壳 origin，否则会被拦截。

### 3.2 前端侧（宿主页复用）

- 桌面壳入口页与 `apps/embed-hosts/web/index.html` 同构：引 UMD → `NovelAgentWorkbench.defineAgentWorkbench()` → `<agent-workbench>` → `setupEmbedHost({ target: window, targetOrigin: '<webview origin>' })`。
- 真实业务分支：用 Tauri invoke 替代注释掉的 `fetch('/api/agent/...')` 桩；SSE 改从 Rust 事件通道（`listen`）而不是 `fetch` 流。

### 3.3 安全

- 桌面壳没有浏览器同源隔离，WebView 是可信边界，但仍要：
  - 只允许 `tauri://localhost`（或固定本地 origin）进白名单，别宽到 `*`；
  - 开发者模式之外关闭 `devtools`；不注入远程 `<script src>`（一律打包本地 UMD）。

## 4. 落地顺序

1. `cargo new` 脚手 + `tauri` 依赖 + 最小 WebView 载入 `panel.html`；
2. 注入 UMD + `setupEmbedHost` 桩（复放事件）跑通"看一眼就能动"；
3. 接真实后端（Rust command + SSE 流 → `sendEvent`）；
4. `WORKBENCH_ORIGIN_ALLOWLIST` 加壳 origin + 仅本地加载；
5. 用同 `scripts/shot/verify-embed*.mjs` 思路，对 Tauri WebView 做无头冒烟（`tauri-driver` / WebDriver）。

## 5. 验收

- `.msi/.appimage` 产物里：启动即出现工作台面板，可填正文启动、awaiting 挂起可批准/给建议、结束显示完成页；宿主页 CSS 不污染面板（shadow DOM）。
- 桥协议与 web/iframe 宿主共用同一份 `docs/agent-embed/bridge-protocol.md`，无分叉。