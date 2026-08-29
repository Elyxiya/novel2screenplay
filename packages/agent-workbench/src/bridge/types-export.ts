// bridge/types-export.ts
// 从 bridge.ts / protocol.ts 统一导出类型，供 index.ts 汇总（避免循环依赖）。
import type { WorkbenchMessage, WorkbenchMessageType } from './protocol';
import type { WorkbenchCommand, WorkbenchBridge } from './bridge';

export type { WorkbenchMessage, WorkbenchMessageType, WorkbenchBridge, WorkbenchCommand };

export interface WorkbenchStartPayload {
  novelText: string;
  title?: string;
  author?: string;
  instruction?: string;
}
export interface WorkbenchReviewPayload {
  taskId: string;
  phaseId: string;
  action: 'approve' | 'retry' | 'discard';
}
export interface WorkbenchRevisePayload {
  taskId: string;
  phaseId: string;
  instruction: string;
}