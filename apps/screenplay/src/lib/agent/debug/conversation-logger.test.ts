import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AgentConversationLogger,
  truncateText,
  safeStringify,
} from './conversation-logger';

// 模块级 mock node:fs，仅当 persistToFile=true 时被调用
const fsMock = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: fsMock,
  ...fsMock,
}));

describe('AgentConversationLogger', () => {
  let logger: AgentConversationLogger;

  beforeEach(() => {
    logger = new AgentConversationLogger({ persistToFile: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fsMock.appendFileSync.mockReset();
    fsMock.mkdirSync.mockReset();
  });

  it('beginSession 创建会话并写入 session_begin 事件', () => {
    const session = logger.beginSession('task-1', { phase: 'analyze', role: 'analyzer' });
    expect(session.taskId).toBe('task-1');
    expect(session.meta.phase).toBe('analyze');
    expect(session.meta.role).toBe('analyzer');
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0].type).toBe('task_event');
    expect(session.entries[0].data.event).toBe('session_begin');
  });

  it('beginSession 对已有会话幂等复用', () => {
    logger.beginSession('task-1');
    const session = logger.beginSession('task-1', { phase: 'convert' });
    // 仅一个 session_begin
    expect(session.entries.filter((e) => e.data.event === 'session_begin')).toHaveLength(1);
    // meta 合并
    expect(session.meta.phase).toBe('convert');
  });

  it('append 自动生成 id/seq/timestamp', () => {
    logger.beginSession('task-1');
    const e1 = logger.append('task-1', { type: 'llm_request', level: 'debug', data: { m: 1 } });
    const e2 = logger.append('task-1', { type: 'llm_response', level: 'debug', data: { m: 2 } });
    expect(e1.id).toMatch(/^log_/);
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.taskId).toBe('task-1');
    expect(typeof e1.timestamp).toBe('number');
  });

  it('append 在会话不存在时自动创建（不触发递归）', () => {
    const entry = logger.append('ghost', { type: 'orchestrator_log', level: 'info', data: { m: 'x' } });
    expect(entry.taskId).toBe('ghost');
    const session = logger.getSession('ghost');
    expect(session?.entries).toHaveLength(1);
  });

  it('环形缓冲：超出 maxEntriesPerSession 时丢弃最旧', () => {
    const small = new AgentConversationLogger({ maxEntriesPerSession: 3, persistToFile: false });
    small.beginSession('t');
    for (let i = 0; i < 5; i++) {
      small.append('t', { type: 'orchestrator_log', level: 'info', data: { i } });
    }
    const session = small.getSession('t')!;
    expect(session.entries).toHaveLength(3);
    // 保留了 seq 3,4,5（不含 session_begin 0），确认丢弃最旧
    const seqs = session.entries.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([3, 4, 5]);
  });

  it('truncateText 对超长文本截断并保留头尾', () => {
    const long = 'a'.repeat(5000);
    const out = truncateText(long, 1000);
    expect(out.length).toBeLessThan(1200);
    expect(out).toContain('已截断');
    expect(out.startsWith('aaa')).toBe(true);
    expect(out.endsWith('aaa')).toBe(true);
  });

  it('truncateText 对短文本原样返回', () => {
    const short = 'hello';
    expect(truncateText(short, 100)).toBe('hello');
  });

  it('safeStringify 处理对象、undefined、null', () => {
    expect(safeStringify({ a: 1 }, 100)).toBe('{"a":1}');
    expect(safeStringify(undefined, 100)).toBe('undefined');
    expect(safeStringify(null, 100)).toBe('null');
  });

  it('listSessions 按更新时间倒序', async () => {
    logger.beginSession('a');
    await new Promise((r) => setTimeout(r, 5));
    logger.beginSession('b');
    // b 最后更新（追加一条日志使其 updatedAt 晚于 a）
    logger.append('b', { type: 'orchestrator_log', level: 'info', data: { m: 'x' } });
    const list = logger.listSessions();
    expect(list.map((s) => s.taskId)).toEqual(['b', 'a']);
  });

  it('clear 清空所有会话', () => {
    logger.beginSession('a');
    logger.clear();
    expect(logger.listSessions()).toHaveLength(0);
  });

  it('clearByUserId 仅清理指定用户的会话', () => {
    logger.beginSession('a', { userId: 'user-1' });
    logger.beginSession('b', { userId: 'user-2' });
    logger.beginSession('c'); // 旧会话（无 userId）
    logger.clearByUserId('user-1');
    const remaining = logger.listSessions().map((s) => s.taskId);
    expect(remaining).toEqual(expect.arrayContaining(['b', 'c']));
    expect(remaining).not.toContain('a');
  });

  it('getSession 返回深拷贝，修改不影响内部', () => {
    logger.beginSession('a');
    const s1 = logger.getSession('a')!;
    s1.entries.push(s1.entries[0]); // 修改拷贝
    const s2 = logger.getSession('a')!;
    expect(s2.entries).toHaveLength(1);
  });

  it('persistToFile=true 时写入 JSONL 文件', () => {
    fsMock.appendFileSync.mockClear();
    fsMock.mkdirSync.mockClear();
    const fileLogger = new AgentConversationLogger({ persistToFile: true, logDir: '/tmp/logs' });
    fileLogger.beginSession('t');
    fileLogger.append('t', { type: 'llm_request', level: 'debug', data: { m: 1 } });
    expect(fsMock.mkdirSync).toHaveBeenCalled();
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('t.jsonl'),
      expect.stringContaining('llm_request'),
      'utf8',
    );
  });

  it('JSONL 落盘失败不抛错（静默降级）', () => {
    fsMock.appendFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fileLogger = new AgentConversationLogger({ persistToFile: true, logDir: '/tmp/logs' });
    expect(() => fileLogger.beginSession('t')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});
