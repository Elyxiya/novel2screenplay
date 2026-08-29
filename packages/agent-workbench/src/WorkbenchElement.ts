// WorkbenchElement.ts
// 点 3：注册自定义元素 <agent-workbench>。
// 面板（纯展示 + 意图上报）挂进 shadow DOM；真实业务调用（/api/agent/* + SSE）由宿主执行。
// 通信：面板用 PanelBridge 向 window.parent 上报意图；并监听宿主回推的
//   workbench:event / workbench:error 消息，喂给 agentChatReducer 更新 UI。
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { WorkbenchPanel, WorkbenchHost } from './components/WorkbenchPanel';
import { PanelBridge } from './bridge/bridge';
import { isTrustedOrigin } from './bridge/protocol';

const ROOT_ANIMATION = `
:host { display:block; height:100%; }
* { box-sizing:border-box; }
@keyframes awb-pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
`;

export class AgentWorkbenchElement extends HTMLElement {
  private root: Root | null = null;
  private shadowRootEl: ShadowRoot;
  private bridge: PanelBridge | null = null;
  private hostImpl: WorkbenchHost;
  private eventListener: ((ev: MessageEvent) => void) | null = null;

  constructor() {
    super();
    this.shadowRootEl = this.attachShadow({ mode: 'open' });
    // 面板宿主实现：把意图通过桥发给宿主窗口；从 window message 订阅宿主回推事件。
    this.hostImpl = {
      start: (payload) => this.bridge?.sendStart(payload),
      review: (payload) => this.bridge?.sendReview({ taskId: this.taskId ?? '', phaseId: payload.phaseId, action: payload.action }),
      revise: (payload) => this.bridge?.sendRevise({ taskId: this.taskId ?? '', phaseId: payload.phaseId, instruction: payload.instruction }),
      on: (fn) => {
        const listener = (ev: MessageEvent) => {
          // 面板同样只接受白名单 origin 回推的事件（伪造 origin 拒绝）。
          if (!isTrustedOrigin(ev.origin)) return;
          const msg = ev.data as { type?: string; payload?: unknown };
          if (msg?.type === 'workbench:event') fn(msg.payload as never);
          else if (msg?.type === 'workbench:error') {
            fn({ event: 'task_awaiting', taskId: '', phaseId: '', name: '宿主错误', reason: (msg.payload as { message?: string } | null)?.message ?? '宿主处理失败' } as never);
          }
        };
        window.addEventListener('message', listener);
        this.eventListener = listener;
        return () => window.removeEventListener('message', listener);
      },
    };
  }

  private get taskId(): string | null { return this.getAttribute('data-task-id'); }

  connectedCallback(): void {
    // 面板始终向 window.parent 上报（同窗嵌入 parent===window，iframe 嵌入 parent=宿主页）。
    const target = window.parent === window ? window : window.parent;
    this.bridge = new PanelBridge({
      target,
      targetOrigin: '*',
      onMessage: () => { /* 面板不处理来自宿主的命令；事件经 hostImpl.on 订阅消费 */ },
    });
    const hostEl = document.createElement('div');
    hostEl.style.cssText = 'height:100%;';
    const style = document.createElement('style');
    style.textContent = ROOT_ANIMATION;
    this.shadowRootEl.appendChild(style);
    this.shadowRootEl.appendChild(hostEl);
    this.root = createRoot(hostEl);
    this.root.render(React.createElement(WorkbenchPanel, { host: this.hostImpl }));
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = null;
    if (this.eventListener) window.removeEventListener('message', this.eventListener);
    this.eventListener = null;
    this.bridge?.destroy();
    this.bridge = null;
  }
}

let registered = false;
export function defineAgentWorkbench(): void {
  if (registered) return;
  registered = true;
  if (!customElements.get('agent-workbench')) {
    customElements.define('agent-workbench', AgentWorkbenchElement);
  }
}