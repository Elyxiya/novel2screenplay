# Agent Workbench 桥协议（embed bridge protocol）

> 配套：`packages/agent-workbench`（可嵌入工作台包）+ `apps/embed-hosts`（两宿主 demo）。
> 本文档回答：如何在任意宿主（web 页 / iframe / 桌面壳）里嵌入 Agent 工作台，并让面板与宿主的业务逻辑跨域协作。

## 1. 目标与切分

工作台被拆成**宿主（host）**与**面板（panel）**两侧，职责严格分离：

| 侧 | 职责 | 位置 |
|----|------|------|
| 宿主 | 真实业务调用：`/api/agent/start`、`/api/agent/stream/:taskId`（SSE）、Cookie 会话 | 任意嵌入应用（web / iframe 宿主 / Tauri/Electron 壳） |
| 面板 | 纯展示 + **意图上报**：用户输入小说、启停任务、awaiting 挂起时给建议 | `<agent-workbench>` 自定义元素（React 挂进 shadow DOM） |

面板**永不持有** `fetch` / `EventSource` / Cookie / 路由导航。它只通过下面定义的 postMessage 桥把"意图"报给宿主；宿主执行真实调用后，把 agent 事件（`data.event` 行）经桥回推给面板渲染。

## 2. 消息形态

所有桥消息都是 plain object，统一带 `_v`（协议版本，当前 `1`）与 `refId`（请求应答关联，面板生成）：

```ts
interface WorkbenchMessage {
  _v: 1;
  refId: string;
  type: WorkbenchMessageType;   // 见下
  payload?: unknown;
}
```

### 2.1 面板 → 宿主（意图）

| type | payload | 说明 |
|------|---------|------|
| `workbench:start` | `{ novelText, title, author, instruction }` | 启动四阶段转换 |
| `workbench:review` | `{ taskId, phaseId, action: 'approve'\|'retry'\|'discard' }` | 人工介入动作 |
| `workbench:revise` | `{ taskId, phaseId, instruction }` | 带自由文本建议重新生成（FR-7） |
| `workbench:navigate` | `{ to }` | 请求宿主导航（可选，面板不强依赖） |

### 2.2 宿主 → 面板（回推）

| type | payload | 说明 |
|------|---------|------|
| `workbench:event` | 一个 agent 事件对象（与真实 SSE `data.event` 载荷同构） | 驱动面板状态机（reducer） |
| `workbench:error` | `{ message }` | 宿主处理失败 |
| `workbench:hello:ack` | `{ ok }` | 握手应答（可选） |

agent 事件的判别联合与 `apps/screenplay` 的 `AgentChatEvent` 逐字段对齐（`task_start` / `phase_start` / `phase_complete` / `phase_failed` / `phase_awaiting_manual` / `task_awaiting` / `gate_result` / `log` / `task_complete`）。

## 3. 安全模型

### 3.1 双向 origin 白名单

- **宿主侧**入口：`HostBridge` 用 `createOriginGuard` 包裹监听，仅放行白名单 origin 发来的意图命令。
- **面板侧**入口：`<agent-workbench>` 元素内部 `host.on` 监听器同样校验 `isTrustedOrigin(ev.origin)`，只接受白名单宿主回推的事件。

白名单定义在 `packages/agent-workbench/src/bridge/protocol.ts` 的 `WORKBENCH_ORIGIN_ALLOWLIST`：

```ts
export const WORKBENCH_ORIGIN_ALLOWLIST = [
  'http://localhost:3004', // web 宿主（demo）
  'http://127.0.0.1:3004',
  'http://localhost:3003', // iframe 面板宿主（跨域 demo）
  'http://127.0.0.1:3003',
];
```

> 嵌入到生产环境时，把这份列表收敛成宿主自己的 origin（`self.origin` + 可能的面板 origin），不要让 `*` 进白名单。

### 3.2 校验顺序（伪造 origin 拒绝）

任何一条入站消息依次通过：

1. `isValidProtocolMessage` —— schema 校验：`_v`、`type`（必须在白名单 type 内）、`refId`、可选的 `payload`。非对象 / null / 未知 type / 缺 `_v` 一律拒绝。
2. `isTrustedOrigin` —— origin 不在白名单即静默丢弃（不投递给业务 handler）。

两条同时满足才触发 handler。伪造 origin（`https://evil.example.com` 等）或合法 origin + 非法结构都会被拦截。

### 3.3 自回声容忍

`targetOrigin` 为 `*` 或 self 时，`window.postMessage` 会把消息回投到同一窗口的**所有** `message` 监听器（包括发送方自己的桥）。基类 `WorkbenchBridge.handle` 对未提供 `onMessage` 的对端做无操作放行，宿主桥 `HostBridge.handle` 只路由命令型消息、对其余（含自身 `workbench:event` 自回声）静默丢弃，避免监听器抛错。

## 4. 使用方式

### 4.1 宿主侧（真实业务）

```ts
import { defineAgentWorkbench, HostBridge } from '@novel/agent-workbench';

// （在宿主 script 里）定义自定义元素，供宿主页/面板文档使用
defineAgentWorkbench();

// 宿主注册桥：target 是面板所在窗口
const bridge = new HostBridge({
  target: iframe.contentWindow,        // 同窗则为 window
  targetOrigin: 'http://localhost:3003',
  onCommand: async (cmd) => {
    if (cmd.type === 'workbench:start') {
      const taskId = await startApi(cmd.payload);          // 真实 /api/agent/start
      streamEvents(taskId, (evt) => bridge.sendEvent(evt)); // 真实 SSE → bridge.sendEvent
    }
    // workbench:review / workbench:revise → 对应 /api/agent/review
  },
});
```

`packages/agent-workbench` 已导出：`PanelBridge`、`HostBridge`、`WorkbenchBridge`、`defineAgentWorkbench`、`isTrustedOrigin`、`createOriginGuard`、`isValidProtocolMessage`、`WORKBENCH_ORIGIN_ALLOWLIST`，以及 `agentChatReducer` / `initialState`（若宿主想复刻面板状态机）。

### 4.2 面板侧（纯展示）

面板文档只需一行：

```html
<link href="/lib/agent-workbench.umd.js" rel="preload" as="script">
<agent-workbench id="wb"></agent-workbench>
<script>NovelAgentWorkbench.defineAgentWorkbench();</script>
```

元素 `connectedCallback` 会自动向 `window.parent`（同窗时即 `window` 自身）建立 `PanelBridge` 上报意图，并订阅宿主回推事件渲染。宿主页 CSS 不会污染面板（React 挂进 shadow DOM）。

## 5. 构建与分发

- 构建：`npm run build -w @novel/agent-workbench` —— esbuild 出单文件 IIFE `dist/agent-workbench.umd.js`（`globalName: NovelAgentWorkbench`，背 React 运行时，无需宿主装 React）+ tsc 产 `dist/types/*.d.ts`。
- 浏览器直引：`<script src="/lib/agent-workbench.umd.js"></script>`（demo 服务把 dist 流式映射到 `/lib/`）。
- TS 宿主：按包名 `import { ... } from '@novel/agent-workbench'`（`exports` 已声明 `types`）。

## 6. 宿主 demo（apps/embed-hosts）

| 端点 | demo | 桥形态 |
|------|------|--------|
| `http://localhost:3004/` | 同源直嵌 | 面板与宿主同窗口，self postMessage |
| `http://localhost:3004/iframe-host.html` | 真跨域 iframe | 宿主 `:3004` ↔ 面板 `:3003` 不同 origin，origin 白名单被真实命中 |

启动：`node apps/embed-hosts/web/web-host.mjs`（web `:3004` + 面板 `:3003`，两个端口的静态服务）。

> 业务真相：demo 里宿主用一个**确定性事件复放器**替代真实 `/api/agent/*` 调用（同构于真实 SSE `data.event` 行），以便无后端地端到端跑通桥 + origin 守卫 + 虚拟化。把注释掉的真实 `fetch` / `readNDJSON` 还原即可接入真实后端。

## 7. 验收口径（无头验证）

- 直嵌宿主：`node scripts/shot/verify-embed.mjs http://localhost:3004/`
- 跨域宿主：`node scripts/shot/verify-embed-cross.mjs`
- 单测：`packages/agent-workbench` —— `protocol.test.ts`（schema / 白名单 / 伪造 origin / 事件往返 9 例）；全仓回归见 AGENTS.md。

验证点：bundle 加载 → 填正文点开始 → 出现 `待人工介入` + 场景 8 卡片 → `批准继续` → `转换完成` → 伪造 origin 事件 `FORGED-ENTERED` 不进日志 → 日志区 DOM 有界（>120 条折叠计数）。