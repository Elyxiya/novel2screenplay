/**
 * Handoff Protocol - Agent 交接协议
 *
 * 定义 Agent 之间任务交接的标准流程，
 * 包括上下文传递、状态同步和错误处理。
 */

import type { AgentRole } from './roles';

export type HandoffStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface HandoffContext {
  /** 任务 ID */
  taskId: string;
  /** 来源 Agent */
  fromRole: AgentRole;
  fromInstanceId: string;
  /** 目标 Agent */
  toRole: AgentRole;
  toInstanceId?: string;
  /** 交接状态 */
  status: HandoffStatus;
  /** 交接原因 */
  reason: string;
  /** 传递的数据 */
  payload: HandoffPayload;
  /** 时间戳 */
  createdAt: number;
  completedAt: number | null;
  /** 错误信息 */
  error?: string;
}

export interface HandoffPayload {
  /** 工作产物（如转换后的剧本片段） */
  workProduct?: string;
  /** 分析结果（如角色列表） */
  analysisResult?: unknown;
  /** 质量评估 */
  qualityAssessment?: QualityAssessment;
  /** 上下文摘要 */
  contextSummary: string;
  /** 关键决策点 */
  decisions?: string[];
  /** 待处理项 */
  pendingItems?: string[];
  /** 建议的后续步骤 */
  suggestedNextSteps?: string[];
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

export interface QualityAssessment {
  score: number; // 0-100
  passed: boolean;
  dimensions: {
    format: number;
    consistency: number;
    coherence: number;
    drama: number;
  };
  issues: string[];
  suggestions: string[];
}

/**
 * 交接请求
 */
export interface HandoffRequest {
  taskId: string;
  fromRole: AgentRole;
  fromInstanceId: string;
  toRole: AgentRole;
  reason: string;
  payload: HandoffPayload;
  options?: HandoffOptions;
}

export interface HandoffOptions {
  /** 是否需要等待确认 */
  requireAck?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
  /** 失败时是否回退 */
  fallbackToRole?: AgentRole;
}

/**
 * 交接结果
 */
export interface HandoffResult {
  success: boolean;
  handoff: HandoffContext;
  accepted: boolean;
  message?: string;
}

/**
 * 交接协议接口
 */
export interface HandoffProtocol {
  /** 请求交接 */
  requestHandoff(request: HandoffRequest): Promise<HandoffResult>;
  /** 接受交接 */
  acceptHandoff(handoffId: string): Promise<void>;
  /** 拒绝交接 */
  rejectHandoff(handoffId: string, reason: string): Promise<void>;
  /** 完成交接 */
  completeHandoff(handoffId: string, result: HandoffPayload): Promise<void>;
  /** 取消交接 */
  cancelHandoff(handoffId: string): Promise<void>;
  /** 获取交接状态 */
  getHandoff(handoffId: string): HandoffContext | undefined;
  /** 获取任务的所有交接历史 */
  getHandoffsForTask(taskId: string): HandoffContext[];
}

/**
 * 创建新的交接上下文
 */
export function createHandoffContext(
  fromRole: AgentRole,
  fromInstanceId: string,
  toRole: AgentRole,
  taskId: string,
  reason: string,
  payload: HandoffPayload,
): HandoffContext {
  return {
    taskId,
    fromRole,
    fromInstanceId,
    toRole,
    status: 'pending',
    reason,
    payload,
    createdAt: Date.now(),
    completedAt: null,
  };
}

/**
 * 验证交接请求的有效性
 */
export function validateHandoffRequest(request: HandoffRequest): { valid: boolean; error?: string } {
  if (!request.taskId) {
    return { valid: false, error: '缺少任务 ID' };
  }
  if (!request.fromRole) {
    return { valid: false, error: '缺少源角色' };
  }
  if (!request.toRole) {
    return { valid: false, error: '缺少目标角色' };
  }
  if (!request.payload.contextSummary) {
    return { valid: false, error: '缺少上下文摘要' };
  }
  // 不能交接给相同角色
  if (request.fromRole === request.toRole) {
    return { valid: false, error: '不能交接给相同角色' };
  }
  return { valid: true };
}

/**
 * 预定义的交接流程
 */
export const HANDOFF_WORKFLOWS = {
  /** 分析 → 写作流程 */
  analysisToWriting: {
    from: 'analyzer',
    to: 'writer',
    reason: '分析完成，开始场景转换',
    requiredPayload: ['analysisResult'],
  },
  /** 写作 → 编辑流程 */
  writingToEditing: {
    from: 'writer',
    to: 'editor',
    reason: '初稿完成，开始润色',
    requiredPayload: ['workProduct'],
  },
  /** 编辑 → 验证流程 */
  editingToValidation: {
    from: 'editor',
    to: 'validator',
    reason: '润色完成，进行质量验证',
    requiredPayload: ['workProduct'],
  },
  /** 验证失败 → 重新编辑 */
  validationFailToEditing: {
    from: 'validator',
    to: 'editor',
    reason: '质量不达标，需要重新修改',
    requiredPayload: ['qualityAssessment'],
  },
  /** 验证通过 → 监督者确认 */
  validationPassToSupervisor: {
    from: 'validator',
    to: 'supervisor',
    reason: '质量达标，等待最终确认',
    requiredPayload: ['qualityAssessment'],
  },
} as const;
