// @vitest-environment node
/**
 * /api/llm 路由测试：GET/POST 校验、PATCH/DELETE owner 校验、api_key 打码。
 * mock 认证层（getCurrentUser）与热注册（reloadUserLLM 为原实现）。
 */
import { NextResponse } from 'next/server';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { getDatabase, closeDatabase, getUserLLMRepository, getUserRepository } from '@/lib/store/sqlite';
import { hashPassword } from '@/lib/auth/password';
import { GET as listGET, POST } from '@/app/api/llm/route';
import { GET as itemGET, PATCH, DELETE } from '@/app/api/llm/[id]/route';

// mock 认证：getCurrentUser 返回当前用例注入的用户
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => {
    // 模块级可变闭包，由用例设置
    return (globalThis as Record<string, unknown>).__mockCurrentUser ?? null;
  }),
  authError: vi.fn((message = '请先登录', status = 401) =>
    NextResponse.json({ error: message }, { status }),
  ),
}));

const auth = (await import('@/lib/auth')) as unknown as {
  getCurrentUser: ReturnType<typeof vi.fn>;
};

const repo = getUserLLMRepository();

let userA: string;
let userB: string;

function setCurrent(userId: string | null) {
  (globalThis as Record<string, unknown>).__mockCurrentUser = userId
    ? { id: userId, username: 'u', email: null }
    : null;
}

/** 直接构造带 json 的 Request，无需 await */
function req(obj: unknown): Request {
  return { json: async () => obj } as unknown as Request;
}

beforeAll(async () => {
  getDatabase();
  const hash = await hashPassword('pass-123');
  userA = getUserRepository().create({ username: `llmrouteA_${Date.now()}`, passwordHash: hash });
  userB = getUserRepository().create({ username: `llmrouteB_${Date.now()}`, passwordHash: hash });
});

afterAll(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userA);
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userB);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userA, userB);
  vi.restoreAllMocks();
  closeDatabase();
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userA);
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userB);
  vi.clearAllMocks();
});

afterEach(() => {
  setCurrent(null);
});

describe('POST /api/llm', () => {
  it('未登录返回 401', async () => {
    setCurrent(null);
    const res = await POST(req({ protocol: 'openai', baseUrl: 'u', defaultModel: 'm' }));
    expect(res.status).toBe(401);
  });

  it('非法 protocol 返回 400', async () => {
    setCurrent(userA);
    const res = await POST(req({ protocol: 'invalid', baseUrl: 'u', defaultModel: 'm' }));
    expect(res.status).toBe(400);
  });

  it('缺 baseUrl / defaultModel 返回 400', async () => {
    setCurrent(userA);
    const r1 = await POST(req({ protocol: 'openai', defaultModel: 'm' }));
    expect(r1.status).toBe(400);
    const r2 = await POST(req({ protocol: 'openai', baseUrl: 'u' }));
    expect(r2.status).toBe(400);
  });

  it('导入成功后返回打码 apiKey 并归属于当前用户（触发热注册 getCurrentUser 调用）', async () => {
    setCurrent(userA);
    const res = await POST(
      req({
        protocol: 'openai',
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'sk-secret-key-123',
        name: '测试模型',
        defaultModel: 'm1',
        supportedModels: ['m1', 'm2'],
        contextWindow: 64000,
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.provider.hasApiKey).toBe(true);
    expect(data.provider.apiKey).not.toContain('sk-secret-key-123'); // 打码
    expect(data.provider.apiKey).toMatch(/\*\*\*/);

    // 归属校验：A 的列表含该 provider
    const aIds = repo.listByUser(userA).map((r) => r.id);
    expect(aIds).toContain(data.provider.id);
    expect(repo.listByUser(userB).map((r) => r.id)).not.toContain(data.provider.id);
    expect(data.provider.supportedModels).toEqual(['m1', 'm2']);
    expect(data.provider.contextWindow).toBe(64000);
    expect(auth.getCurrentUser).toHaveBeenCalled();
  });
});

describe('GET /api/llm（列表，apiKey 打码）', () => {
  it('未登录返回 401', async () => {
    setCurrent(null);
    const res = await listGET();
    expect(res.status).toBe(401);
  });

  it('返回该用户已导入列表且 apiKey 打码', async () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'https://a/v1', apiKey: 'sk-abcdefghij', defaultModel: 'm' });
    setCurrent(userA);
    const res = await listGET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.providers.length).toBe(1);
    expect(data.providers[0].apiKey).toContain('*');
    expect(data.providers[0].apiKey).not.toContain('sk-abcdefghij');
  });
});

describe('PATCH /api/llm/[id]', () => {
  it('空 apiKey 字符串不修改密钥', async () => {
    const created = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', apiKey: 'sk-original', defaultModel: 'm1' });
    setCurrent(userA);
    const id = created.id;
    const res = await PATCH(req({ defaultModel: 'm2', apiKey: '' }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.provider.defaultModel).toBe('m2');
    expect(repo.getById(id)?.apiKey).toBe('sk-original'); // 未覆盖
  });

  it('非本人操作他人 provider 返回 404', async () => {
    const created = repo.create({ userId: userB, protocol: 'openai', baseUrl: 'u', defaultModel: 'm-b' });
    setCurrent(userA); // A 操作 B 的
    const res = await PATCH(req({ defaultModel: 'x' }), { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(404);
  });

  it('删除他人 provider 返回 404', async () => {
    const created = repo.create({ userId: userB, protocol: 'openai', baseUrl: 'u', defaultModel: 'm-b' });
    setCurrent(userA);
    const res = await DELETE(req({}), { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/llm/[id]', () => {
  it('删除自己的 provider 成功且后不可见', async () => {
    const created = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm' });
    setCurrent(userA);
    const res = await DELETE(req({}), { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    expect(repo.getById(created.id)).toBeNull();
  });

  it('GET 读取他人 provider 返回 404', async () => {
    const created = repo.create({ userId: userB, protocol: 'openai', baseUrl: 'u', defaultModel: 'm-b' });
    setCurrent(userA);
    const res = await itemGET(req({}), { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(404);
  });
});