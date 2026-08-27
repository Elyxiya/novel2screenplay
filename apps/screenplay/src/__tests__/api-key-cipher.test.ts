// @vitest-environment node
/**
 * API Key 加密（AES-256-GCM）专项测试
 *
 * 覆盖：
 * - 加解密往返、密文永不含明文、随机 IV（同明文两次密文不同）
 * - 空密钥、旧明文透传、密文识别
 * - 篡改/损坏/密钥不匹配 → 解密兜底为空
 *   - 可配 env USER_LLM_KEY 派生密钥
 * - 仓库层"落库即密文"保证：原始行存的是密文，读侧还原明文
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptedApiKey,
  LEGACY_MARKER,
} from '@/lib/llm/api-key-cipher';
import {
  getDatabase,
  closeDatabase,
  getUserLLMRepository,
  getUserRepository,
} from '@/lib/store/sqlite';
import { hashPassword } from '@/lib/auth/password';

const repo = getUserLLMRepository();
const PREFIX = 'enc:v1:';

let userId: string;

beforeAll(async () => {
  getDatabase();
  const hash = await hashPassword('pass-key');
  userId = getUserRepository().create({ username: `key_${Date.now()}`, passwordHash: hash });
});

afterAll(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  closeDatabase();
});

describe('encryptApiKey / decryptApiKey', () => {
  it('加密结果为 enc:v1: 前缀密文，密文串中不含明文字样', () => {
    const plain = 'sk-this-is-a-secret-1234567890';
    const enc = encryptApiKey(plain);
    expect(enc.startsWith(PREFIX)).toBe(true);
    expect(enc).not.toContain(plain);
    // 三段式（iv.tag.ct）
    const body = enc.slice(PREFIX.length);
    expect(body.split('.')).toHaveLength(3);
  });

  it('往返：decrypt(encrypt(x)) === x', () => {
    for (const plain of ['sk-a', 'sk-with-中文密钥!@#', 'a'.repeat(200)]) {
      expect(decryptApiKey(encryptApiKey(plain))).toBe(plain);
    }
  });

  it('同明文两次加密产生不同密文（随机 IV）', () => {
    const enc1 = encryptApiKey('sk-same');
    const enc2 = encryptApiKey('sk-same');
    expect(enc1).not.toBe(enc2);
    expect(decryptApiKey(enc1)).toBe('sk-same');
    expect(decryptApiKey(enc2)).toBe('sk-same');
  });

  it('空字符串密钥：不落密文，直接返回空串', () => {
    expect(encryptApiKey('')).toBe('');
    expect(decryptApiKey('')).toBe('');
  });

  it('旧明文透传：无前缀的存量值原样返回', () => {
    expect(decryptApiKey('sk-legacy-plaintext')).toBe('sk-legacy-plaintext');
  });
});

describe('isEncryptedApiKey', () => {
  it('加密值返回 true，旧明文 / 空串返回 false', () => {
    expect(isEncryptedApiKey(encryptApiKey('sk-x'))).toBe(true);
    expect(isEncryptedApiKey('sk-plain')).toBe(false);
    expect(isEncryptedApiKey('')).toBe(false);
    expect(isEncryptedApiKey(LEGACY_MARKER)).toBe(false); // 迁移挑选谓词：enc:% 不算"已加密"
  });
});

describe('解密兜底（异常/攻击场景）', () => {
  it('篡改密文（翻转一位）→ 认证失败返回空串', () => {
    const enc = encryptApiKey('sk-tamper-target');
    // 翻转密文段（第 3 段）首字符，确保确实改动一个密文字节而非 base64 填充位
    const head = `${PREFIX}${enc.slice(PREFIX.length).split('.').slice(0, 2).join('.')}.`;
    const ct = enc.slice(PREFIX.length).split('.')[2];
    const flipped = `${head}${(ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)}`;
    expect(flipped).not.toBe(enc);
    expect(decryptApiKey(flipped)).toBe('');
  });

  it('损坏格式（段数不足）→ 返回空串', () => {
    expect(decryptApiKey(`${PREFIX}bm9pc2U=`)).toBe(''); // 仅一段 base64
    expect(decryptApiKey(`${PREFIX}bm9pc2U=.YWJj`)).toBe(''); // 两段，无密文
  });

  it('IV 长度不合法 → 返回空串', () => {
    const enc = encryptApiKey('sk-iv');
    const body = enc.slice(PREFIX.length);
    const parts = body.split('.');
    // 用超短 IV 替换（非法长度）
    const bad = `${PREFIX}c2hvcnQ=.${parts[1]}.${parts[2]}`;
    expect(decryptApiKey(bad)).toBe('');
  });
});

describe('env USER_LLM_KEY 派生密钥', () => {
  const PREV = process.env.USER_LLM_KEY;

  afterAll(() => {
    if (PREV === undefined) delete process.env.USER_LLM_KEY;
    else process.env.USER_LLM_KEY = PREV;
  });

  it('配置密钥后加解密往返成功', () => {
    process.env.USER_LLM_KEY = 'a-strong-production-secret';
    expect(decryptApiKey(encryptApiKey('sk-prod'))).toBe('sk-prod');
  });

  it('密钥变更后，旧密文无法解密（返回空串）', () => {
    process.env.USER_LLM_KEY = 'first-key';
    const enc = encryptApiKey('sk-rotation');
    expect(decryptApiKey(enc)).toBe('sk-rotation');

    process.env.USER_LLM_KEY = 'rotated-key';
    expect(decryptApiKey(enc)).toBe('');
  });
});

describe('仓库层落库即密文保证', () => {
  it('create 后原始行存密文（非明文），读侧还原明文', () => {
    const plain = 'sk-repo-secret';
    const created = repo.create({
      userId,
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: plain,
      defaultModel: 'deepseek-chat',
    });

    // 原始行 = 密文，绝不等于明文
    const raw = getDatabase()
      .prepare('SELECT api_key FROM user_llm WHERE id = ?')
      .get(created.id) as { api_key: string };
    expect(raw.api_key.startsWith(PREFIX)).toBe(true);
    expect(raw.api_key).not.toContain(plain);

    // 读侧还原明文
    expect(repo.getById(created.id)!.apiKey).toBe(plain);

    repo.delete(created.id);
  });

  it('update 覆盖密钥后原始行同样为密文', () => {
    const created = repo.create({
      userId,
      protocol: 'openai',
      baseUrl: 'u',
      apiKey: 'sk-old',
      defaultModel: 'm',
    });
    repo.update(created.id, { apiKey: 'sk-new-secret' });

    const raw = getDatabase()
      .prepare('SELECT api_key FROM user_llm WHERE id = ?')
      .get(created.id) as { api_key: string };
    expect(raw.api_key.startsWith(PREFIX)).toBe(true);
    expect(raw.api_key).not.toContain('sk-new-secret');
    expect(repo.getById(created.id)!.apiKey).toBe('sk-new-secret');

    repo.delete(created.id);
  });
});