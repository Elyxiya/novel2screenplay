// bridge/protocol.ts
// 点 3 桥协议：agent-workbench（面板/面板宿主）↔ 宿主应用 之间唯一的通信通道。
// 设计纪律（restrained-rework-3-points §3.2）：
//   - 面板内不持有任何 /api/agent/* 的 fetch/SSE 逻辑、不持有 cookie/token；
//   - 面板只通过桥上报"意图"（workbench:start/review/revise），由宿主执行真实调用；
//   - 宿主通过 workbench:event 回推 agent 事件；面板用 agentChatReducer 消化为 UI 状态；
//   - 安全：双向 MessageEvent.origin 白名单校验，非白名单来源一律拒绝（伪造 origin 拒绝）。

/** origin 白名单（build 期配置）：面板允许与哪些 host 通信。 */
export const WORKBENCH_ORIGIN_ALLOWLIST: string[] = [
  'http://localhost:3004', // web 宿主（3002 为 dev server 占用，demo 宿主移至 3004）
  'http://127.0.0.1:3004',
  'http://localhost:3003', // iframe 面板宿主（跨域：面板文档所在 origin）
  'http://127.0.0.1:3003',
];

export type WorkbenchMessageType =
  | 'workbench:hello' // 建立连接时的握手（面板→宿主，带 protocolVersion）
  | 'workbench:hello:ack' // 宿主确认（宿主→面板）
  | 'workbench:start' // 面板意图：发起 Agent 转换（面板→宿主）
  | 'workbench:review' // 面板意图：人工介入动作（面板→宿主）
  | 'workbench:revise' // 面板意图：带修改建议的介入（面板→宿主）
  | 'workbench:event' // 宿主→面板：agent 事件（原 SSE data.event 载荷）
  | 'workbench:error' // 宿主→面板：本地失败（无 taskId 可用的轻量错误）
  | 'workbench:log' // 宿主→面板：附加日志（虚拟化列表的数据源之一）
  | 'workbench:navigate'; // 面板意图：请求宿主导航（等价原 useRouter().push 的 onNavigate 回调）

/** 板面→宿主：启动 Agent 转换 */
export interface WorkbenchStartPayload {
  novelText: string;
  title?: string;
  author?: string;
  instruction?: string;
}

/** 板面→宿主：人工介入 */
export interface WorkbenchReviewPayload {
  taskId: string;
  phaseId: string;
  action: 'approve' | 'retry' | 'discard';
}

/** 板面→宿主：带建议重生成 */
export interface WorkbenchRevisePayload {
  taskId: string;
  phaseId: string;
  instruction: string;
}

export interface WorkbenchMessage<_T extends WorkbenchMessageType = WorkbenchMessageType> {
  type: WorkbenchMessageType;
  /** 同一任务链路内的相关 id（start 后回填）。 */
  refId?: string;
  /** 命令/事件的载荷（面板→宿主意图 或 宿主→面板事件）。 */
  payload?: unknown;
  _v: 1; // 协议版本
}

export type InboundWorkbenchMessage = // 面板→宿主
  | (WorkbenchMessage & { type: 'workbench:hello'; refId: string })
  | (WorkbenchMessage & { type: 'workbench:start'; refId: string; payload: WorkbenchStartPayload })
  | (WorkbenchMessage & { type: 'workbench:review'; refId: string; payload: WorkbenchReviewPayload })
  | (WorkbenchMessage & { type: 'workbench:revise'; refId: string; payload: WorkbenchRevisePayload });

export type OutboundWorkbenchMessage = // 宿主→面板
  | (WorkbenchMessage & { type: 'workbench:hello:ack' })
  | (WorkbenchMessage & { type: 'workbench:event'; refId?: string; payload: unknown })
  | (WorkbenchMessage & { type: 'workbench:error'; refId?: string; payload: { message: string } })
  | (WorkbenchMessage & { type: 'workbench:log'; refId?: string; payload: { level: string; message: string } })
  | (WorkbenchMessage & { type: 'workbench:navigate'; refId?: string; payload: { to: string } });

export type WorkbenchMessageIncoming = InboundWorkbenchMessage | OutboundWorkbenchMessage;

const KNOWN_TYPES: WorkbenchMessageType[] = [
  'workbench:hello',
  'workbench:hello:ack',
  'workbench:start',
  'workbench:review',
  'workbench:revise',
  'workbench:event',
  'workbench:error',
  'workbench:log',
  'workbench:navigate',
];

/**
 * 校验消息形状：必须是带 type/_v 的对象，type 在白名单内。
 * 注意：这里只校验"结构"，origin 校验在该对象未创建前（事件层）完成，
 * 见 isTrustedOrigin() / createOriginGuard()。
 */
export function isValidProtocolMessage(msg: unknown): msg is WorkbenchMessageIncoming {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== 'string' || m._v !== 1) return false;
  return KNOWN_TYPES.indexOf(m.type as WorkbenchMessageType) >= 0;
}

/** 该 origin 是否被白名单接受。 */
export function isTrustedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return WORKBENCH_ORIGIN_ALLOWLIST.indexOf(origin) >= 0;
}

/**
 * 构造一个 message 事件监听器，它在内部分发前先做 origin 校验。
 * 返回一个「已做 origin 校验、仅当通过才调用 handler(msg)」的包装函数。这保证
 * 伪造 origin（非白名单窗口投递）的消息永远不会进入业务 handler。
 */
export function createOriginGuard(
  handler: (msg: WorkbenchMessageIncoming) => void,
): (ev: MessageEvent) => void {
  return (ev) => {
    if (!isTrustedOrigin(ev.origin)) {
      // 拒绝伪造 origin：不投递、不通知（静默丢弃，与"面板被动"原则一致）。
      return;
    }
    if (!isValidProtocolMessage(ev.data)) return;
    handler(ev.data as WorkbenchMessageIncoming);
  };
}