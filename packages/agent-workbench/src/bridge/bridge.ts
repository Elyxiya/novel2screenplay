// bridge/bridge.ts
// WorkbenchBridge：一个双向 postMessage 通道的两端共用实现。
// 面板侧通过代理对象调用 sendStart/sendReview/sendRevise 上报意图；
// 宿主侧通过 onCommand 回调接收这些意图并执行真实业务调用，再用 sendEvent 回推事件。
import {
  createOriginGuard,
  isTrustedOrigin,
  WorkbenchMessage,
} from './protocol';

export type WorkbenchCommand =
  | { type: 'workbench:start'; refId: string; payload: { novelText: string; title: string; author: string; instruction: string } }
  | { type: 'workbench:review'; refId: string; payload: { taskId: string; phaseId: string; action: 'approve' | 'retry' | 'discard' } }
  | { type: 'workbench:revise'; refId: string; payload: { taskId: string; phaseId: string; instruction: string } }
  | { type: 'workbench:navigate'; refId: string; payload: { to: string } };

export interface WorkbenchBridgeConfig {
  /** 目标窗口（面板侧=父窗口，宿主侧=iframe contentWindow）。 */
  target: Window;
  /** 目标 origin（发给 target 时 targetOrigin 参数，校验时 use 同源判定）。 */
  targetOrigin: string;
  /** 接收命令/事件的 handler。 */
  onMessage: (msg: WorkbenchMessage) => void;
  /** 覆盖协议默认 origin 校验（测试注入用）。默认 isTrustedOrigin。 */
  isTrusted?: (origin: string | null | undefined) => boolean;
}

let seq = 0;
const nextRefId = () => `wb_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export class WorkbenchBridge {
  private config: WorkbenchBridgeConfig;
  private listener: (ev: MessageEvent) => void;

  constructor(config: WorkbenchBridgeConfig) {
    this.config = config;
    const guard = createOriginGuard(this.handle.bind(this));
    // 保留 handler 引用以便 remove。
    this.listener = (ev) => guard(ev);
    window.addEventListener('message', this.listener);
  }

  protected handle(msg: WorkbenchMessage): void {
    // 对端桥可能只注入命令/事件处理器（onCommand/on），未提供 onMessage 即按无操作对待
    // —— 例如 self 后置自回声（targetOrigin='*' 时同窗回投）不应抛错破坏监听。
    this.config.onMessage?.(msg);
  }

  protected send(msg: WorkbenchMessage): void {
    this.config.target.postMessage(msg, this.config.targetOrigin);
  }

  /** 面板→宿主：启动转换。 */
  sendStart(payload: { novelText: string; title: string; author: string; instruction: string }): string {
    const refId = nextRefId();
    this.send({ type: 'workbench:start', refId, _v: 1, payload });
    return refId;
  }

  /** 面板→宿主：人工介入动作。 */
  sendReview(payload: { taskId: string; phaseId: string; action: 'approve' | 'retry' | 'discard' }): string {
    const refId = nextRefId();
    this.send({ type: 'workbench:review', refId, _v: 1, payload });
    return refId;
  }

  /** 面板→宿主：带建议重生成。 */
  sendRevise(payload: { taskId: string; phaseId: string; instruction: string }): string {
    const refId = nextRefId();
    this.send({ type: 'workbench:revise', refId, _v: 1, payload });
    return refId;
  }

  destroy(): void {
    window.removeEventListener('message', this.listener);
  }
}

/** 面板侧专用桥：面向窗口上报意图，并把宿主回推事件无保留传给 reducer 消费。 */
export class PanelBridge extends WorkbenchBridge {
  constructor(config: WorkbenchBridgeConfig & { isTrusted?: (origin: string | null | undefined) => boolean }) {
    super(config);
    // 面板侧：把自己标记为「通信对端」以便宿主桩可定向。
    if (typeof (window as unknown as Record<string, unknown>).parent !== 'undefined') {
      // no-op
    }
  }
}

export { isTrustedOrigin };

/** 宿主侧专用桥：收到命令后回调 onCommand，并用 sendEvent/sendError 回推。 */
export class HostBridge extends WorkbenchBridge {
  private onCommand: (cmd: WorkbenchCommand) => void;

  constructor(
    config: WorkbenchBridgeConfig & {
      onCommand: (cmd: WorkbenchCommand) => void;
    },
  ) {
    super({ ...config });
    this.onCommand = config.onCommand;
  }

  protected override handle(msg: WorkbenchMessage): void {
    const t = msg.type;
    if (t === 'workbench:start' || t === 'workbench:review' || t === 'workbench:revise' || t === 'workbench:navigate') {
      this.onCommand(msg as unknown as WorkbenchCommand);
      return;
    }
    super.handle(msg);
  }

  /** 宿主→面板：回推 agent 事件。 */
  sendEvent(payload: unknown): void {
    this.send({ type: 'workbench:event', refId: nextRefId(), _v: 1, payload });
  }

  /** 宿主→面板：错误。 */
  sendError(message: string): void {
    this.send({ type: 'workbench:error', refId: nextRefId(), _v: 1, payload: { message } });
  }
}