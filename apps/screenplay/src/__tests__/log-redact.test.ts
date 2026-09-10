import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactString, redactValue } from '@/lib/agent/debug/redact';
import { AgentConversationLogger } from '@/lib/agent/debug/conversation-logger';

describe('redactString（FIX-23 脱敏规则）', () => {
  it('掩码 API key / Bearer / JWT', () => {
    expect(redactString('key=sk-abc123DEF456ghi789 完成')).toBe('key=sk-*** 完成');
    expect(redactString('Authorization: Bearer eyJhbGciOi.payloadpart.sigpart')).toBe('Authorization: Bearer ***');
    expect(redactString('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgHIJK')).toBe('token jwt:***');
  });

  it('掩码邮箱与手机号', () => {
    expect(redactString('联系 zhang.san+test@example.com.cn 处理')).toBe('联系 ***@*** 处理');
    expect(redactString('手机号 13812345678 已登记')).toBe('手机号 [phone] 已登记');
    expect(redactString('订单 2026090112345678')).toBe('订单 2026090112345678'); // 18 位非手机号不动
  });

  it('短文本保持原文；超 2000 字 hash 化（含长度）', () => {
    expect(redactString('普通调试信息')).toBe('普通调试信息');
    const long = '字'.repeat(2001);
    const out = redactString(long);
    expect(out.startsWith('[long-text sha256:')).toBe(true);
    expect(out).toContain('len=2001');
    expect(out).not.toContain('字');
  });
});

describe('redactValue（深遍历）', () => {
  it('对象/数组递归脱敏，非字符串类型原样', () => {
    const entry = {
      type: 'request',
      data: {
        messages: [{ role: 'system', content: '使用 sk-live-1234567890ABCDEF 调用' }],
        options: { temperature: 0.5, retries: 2, stream: false },
        contact: null,
      },
    };
    const redacted = redactValue(entry);

    expect(redacted.data.messages[0].content).toBe('使用 sk-*** 调用');
    expect(redacted.data.options).toEqual({ temperature: 0.5, retries: 2, stream: false });
    expect(redacted.data.contact).toBeNull();
  });
});

describe('conversation-logger 落盘集成', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-debug-redact-'));

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('JSONL 落盘文件中无明文密钥/邮箱/手机号', () => {
    const logger = new AgentConversationLogger({ persistToFile: true, logDir: tmpDir });
    logger.beginSession('task_redact', { modelId: 'test' });
    logger.append('task_redact', {
      type: 'llm_request',
      level: 'info',
      data: {
        messages: [
          { role: 'user', content: '用 sk-live-9f8e7d6c5b4a 请求，联系 ops@example.com 或 13812345678' },
        ],
      },
    });

    const file = path.join(tmpDir, 'task_redact.jsonl');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).not.toContain('sk-live-9f8e7d6c5b4a');
    expect(content).not.toContain('ops@example.com');
    expect(content).not.toContain('13812345678');
    expect(content).toContain('sk-***');
    expect(content).toContain('***@***');
    expect(content).toContain('[phone]');
  });
});
