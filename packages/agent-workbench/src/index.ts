// index.ts
// @novel/agent-workbench 入口：注册 <agent-workbench> web component。
// 用法（宿主脚本，无 Next 依赖）：
//   import { defineAgentWorkbench } from '@novel/agent-workbench';
//   defineAgentWorkbench();
// 面板与宿主的桥协议见 ./bridge/protocol.ts；单测见 src/__tests__/protocol.test.ts。
export { defineAgentWorkbench, AgentWorkbenchElement } from './WorkbenchElement';
export { WorkbenchPanel, WorkbenchHost } from './components/WorkbenchPanel';
export { PanelBridge, HostBridge, WorkbenchBridge } from './bridge/bridge';
export {
  WORKBENCH_ORIGIN_ALLOWLIST,
  isTrustedOrigin,
  createOriginGuard,
  isValidProtocolMessage,
} from './bridge/protocol';
export type {
  WorkbenchMessage,
  WorkbenchMessageType,
  WorkbenchStartPayload,
  WorkbenchReviewPayload,
  WorkbenchRevisePayload,
  WorkbenchCommand,
} from './bridge/types-export';
export { agentChatReducer, initialState } from './state/chat-state';
export type { AgentChatState, AgentChatEvent } from './state/chat-state';