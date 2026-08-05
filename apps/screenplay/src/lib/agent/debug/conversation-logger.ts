/**
 * Agent 调试日志 - 对话记录器
 *
 * 按 taskId 组织调试会话，记录 Agent 生命周期内的：
 * - LLM 请求/响应（含 token 用量与耗时）
 * - 工具调用（参数、结果、耗时）
 * - 状态转换与任务事件
 * - 编排器阶段日志
 *
 * 会话条目保存在内存环形缓冲中，可选落盘为 JSONL 文件
 * （AGENT_DEBUG_FILE=1 时启用，写入 logs/agent-debug/<taskId>.jsonl）。
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────────────────────

export type DebugLogType =
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'state_change'
  | 'task_event'
  | 'orchestrator_log';

export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLogEntry {
  id: string;
  taskId: string;
  seq: number;
  timestamp: number;
  type: DebugLogType;
  level: DebugLogLevel;
  data: Record<string, unknown>;
}

export interface DebugSessionMeta {
  phase?: string;
  role?: string;
  jobId?: string;
  modelId?: string;
}

export interface DebugSession {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  meta: DebugSessionMeta;
  entries: DebugLogEntry[];
}

export interface AgentConversationLoggerOptions {
  /** 每个会话的最大条目数（环形缓冲，默认 500） */
  maxEntriesPerSession?: number;
  /** 记录的超长文本截断长度（默认 2000 字符） */
  maxTextLength?: number;
  /** 是否落盘 JSONL（默认由 AGENT_DEBUG_FILE 环境变量决定） */
  persistToFile?: boolean;
  /** JSONL 输出目录（默认 logs/agent-debug） */
  logDir?: string;
}

// ── 工具函数 ───────────────────────────────────────────────────────────────

/** 截断超长文本，保留开头与结尾 */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const head = Math.floor(maxLen * 0.7);
  return `${text.slice(0, head)}\n...[已截断，省略 ${text.length - maxLen} 字符]...\n${text.slice(-(maxLen - head))}`;
}

/** 将任意值转换为可记录的安全文本（对象 JSON 化 + 截断） */
export function safeStringify(value: unknown, maxLen: number): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (value === undefined) {
    text = 'undefined';
  } else if (value === null) {
    text = 'null';
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return truncateText(text, maxLen);
}

// ── 核心类 ─────────────────────────────────────────────────────────────────

export class AgentConversationLogger {
  private sessions = new Map<string, DebugSession>();
  private maxEntriesPerSession: number;
  private maxTextLength: number;
  private persistToFile: boolean;
  private logDir: string;

  constructor(options: AgentConversationLoggerOptions = {}) {
    this.maxEntriesPerSession = options.maxEntriesPerSession ?? 500;
    this.maxTextLength = options.maxTextLength ?? 2000;
    this.persistToFile =
      options.persistToFile ?? process.env.AGENT_DEBUG_FILE === '1';
    this.logDir = options.logDir ?? path.join(process.cwd(), 'logs', 'agent-debug');
  }

  // ── 会话管理 ────────────────────────────────────────────────────────────

  /** 开启（或复用）一个调试会话 */
  beginSession(taskId: string, meta: DebugSessionMeta = {}): DebugSession {
    const existed = this.sessions.has(taskId);
    const session = this.ensureSession(taskId, meta);
    if (!existed) {
      this.append(taskId, {
        type: 'task_event',
        level: 'info',
        data: { event: 'session_begin', meta: session.meta },
      });
    }
    return session;
  }

  /** 追加一条日志条目（自动生成 id/seq/timestamp） */
  append(
    taskId: string,
    entry: Omit<DebugLogEntry, 'id' | 'taskId' | 'seq' | 'timestamp'>,
  ): DebugLogEntry {
    const session = this.ensureSession(taskId);
    const full: DebugLogEntry = {
      id: `log_${Date.now()}_${randomUUID().slice(0, 8)}`,
      taskId,
      seq: (session.entries.at(-1)?.seq ?? -1) + 1,
      timestamp: Date.now(),
      ...entry,
    };

    session.entries.push(full);
    session.updatedAt = full.timestamp;

    // 环形缓冲：超限丢弃最旧
    if (session.entries.length > this.maxEntriesPerSession) {
      session.entries.splice(0, session.entries.length - this.maxEntriesPerSession);
    }

    if (this.persistToFile) this.persistEntry(full);
    return full;
  }

  // ── 便捷方法 ────────────────────────────────────────────────────────────

  log(taskId: string, type: DebugLogType, level: DebugLogLevel, data: Record<string, unknown>): DebugLogEntry {
    return this.append(taskId, { type, level, data });
  }

  // ── 查询 ────────────────────────────────────────────────────────────────

  getSession(taskId: string): DebugSession | undefined {
    const session = this.sessions.get(taskId);
    return session ? this.cloneSession(session) : undefined;
  }

  listSessions(): DebugSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
      .map((s) => this.cloneSession(s));
  }

  getAll(): DebugSession[] {
    return this.listSessions();
  }

  /** 清理所有会话（可选择同步删除文件） */
  clear(): void {
    this.sessions.clear();
  }

  get maxLength(): number {
    return this.maxTextLength;
  }

  // ── 内部工具 ────────────────────────────────────────────────────────────

  private ensureSession(taskId: string, meta: DebugSessionMeta = {}): DebugSession {
    let session = this.sessions.get(taskId);
    if (!session) {
      session = {
        taskId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: { ...meta },
        entries: [],
      };
      this.sessions.set(taskId, session);
    } else if (Object.keys(meta).length > 0) {
      session.meta = { ...session.meta, ...meta };
      session.updatedAt = Date.now();
    }
    return session;
  }

  private cloneSession(session: DebugSession): DebugSession {
    return {
      ...session,
      meta: { ...session.meta },
      entries: session.entries.map((e) => ({
        ...e,
        data: { ...e.data },
      })),
    };
  }

  private persistEntry(entry: DebugLogEntry): void {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      const file = path.join(this.logDir, `${entry.taskId}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      // 落盘失败不阻断主流程，降级为静默
      console.warn(`[AgentDebug] JSONL 落盘失败 (${entry.taskId}):`, err);
    }
  }
}

// ── 单例 ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__novel2screenplay_agent_debug_logger__';

/**
 * 全局单例日志器。
 * 在 Node 与 edge runtime 下均挂载于 globalThis。
 */
export function getAgentDebugLogger(): AgentConversationLogger {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new AgentConversationLogger();
  }
  return g[GLOBAL_KEY] as AgentConversationLogger;
}

/** 调试功能开关：生产环境（未显式开启 AGENT_DEBUG）时不收集 */
export function isDebugEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.AGENT_DEBUG === '1';
}
