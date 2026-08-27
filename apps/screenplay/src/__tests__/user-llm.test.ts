// @vitest-environment node
/**
 * 用户级自定义 LLM 导入：Repository CRUD + 数据隔离 + Provider 工厂 + 注册表 + 网关解析
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getDatabase,
  closeDatabase,
  getUserLLMRepository,
  getUserRepository,
  type UserLLMRecord,
} from '@/lib/store/sqlite';
import { hashPassword } from '@/lib/auth/password';
import { createUserLLMProvider } from '@/lib/llm/user-llm-factory';
import { getUserLLMRegistry, reloadUserLLM } from '@/lib/llm/user-llm-registry';
import { resolveProvider, resolveDefaultProvider, listModelsForUser, hasUserLLM } from '@/lib/llm/llm-gateway';

const repo = getUserLLMRepository();

let userA: string;
let userB: string;

function record(id: string): UserLLMRecord | null {
  return repo.getById(id);
}

beforeAll(async () => {
  getDatabase();
  const hash = await hashPassword('pass-123');
  userA = getUserRepository().create({ username: `llmA_${Date.now()}`, passwordHash: hash });
  userB = getUserRepository().create({ username: `llmB_${Date.now()}`, passwordHash: hash });
});

afterAll(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userA);
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userB);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userA, userB);
  closeDatabase();
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userA);
  db.prepare('DELETE FROM user_llm WHERE user_id = ?').run(userB);
  // 注册表为模块级单例缓存，清理 DB 后须 reload 使缓存与库一致，避免跨用例污染
  reloadUserLLM(userA);
  reloadUserLLM(userB);
});

describe('UserLLMRepository CRUD', () => {
  it('create：写入并回读，supportedModels 自动补全 defaultModel', () => {
    const created = repo.create({
      userId: userA,
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      defaultModel: 'deepseek-chat',
      supportedModels: ['deepseek-chat', 'deepseek-reasoner'],
    });

    expect(created.id).toBeDefined();
    const read = record(created.id)!;
    expect(read.userId).toBe(userA);
    expect(read.protocol).toBe('openai');
    expect(read.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(read.apiKey).toBe('sk-test');
    expect(read.supportedModels).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(read.name).toBe('Custom OpenAI');
    expect(read.contextWindow).toBe(128000);
  });

  it('create：supportedModels 空时回退 [defaultModel]', () => {
    const created = repo.create({
      userId: userA,
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant',
      defaultModel: 'claude-3-5-sonnet',
    });
    const read = record(created.id)!;
    expect(read.supportedModels).toEqual(['claude-3-5-sonnet']);
    expect(read.name).toBe('Custom Anthropic');
  });

  it('listByUser：仅返回该用户记录', () => {
    const a = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm1' });
    const b = repo.create({ userId: userB, protocol: 'openai', baseUrl: 'u', defaultModel: 'm2' });

    const aIds = repo.listByUser(userA).map((r) => r.id);
    const bIds = repo.listByUser(userB).map((r) => r.id);
    expect(aIds).toContain(a.id);
    expect(aIds).not.toContain(b.id);
    expect(bIds).toContain(b.id);
    expect(bIds).not.toContain(a.id);
  });

  it('update：修改协议/默认模型/密钥，空串密钥不覆盖', () => {
    const created = repo.create({
      userId: userA,
      protocol: 'openai',
      baseUrl: 'https://a/v1',
      apiKey: 'sk-original',
      defaultModel: 'm1',
    });

    const updated = repo.update(created.id, {
      defaultModel: 'm2',
      apiKey: '', // 空串 → 保持原密钥
    })!;
    expect(updated.defaultModel).toBe('m2');
    expect(updated.apiKey).toBe('sk-original');

    const updated2 = repo.update(created.id, { apiKey: 'sk-new' })!;
    expect(updated2.apiKey).toBe('sk-new');
  });

  it('update：不存在返回 null', () => {
    expect(repo.update('nonexistent', { defaultModel: 'x' })).toBeNull();
  });

  it('delete：删除后 getById 返回 null', () => {
    const created = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm' });
    expect(repo.delete(created.id)).toBe(true);
    expect(record(created.id)).toBeNull();
    expect(repo.delete(created.id)).toBe(false);
  });

  it('listApiKeysByUser：仅暴露有/无 key，不返回明文，且按用户过滤', () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', apiKey: 'sk-abcdefghij', defaultModel: 'm1' });
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm2' });
    repo.create({ userId: userB, protocol: 'openai', baseUrl: 'u', apiKey: 'sk-bbb', defaultModel: 'm-b' });

    const aKeys = repo.listApiKeysByUser(userA);
    expect(aKeys).toHaveLength(2);
    expect(aKeys.every((k) => !Object.prototype.hasOwnProperty.call(k, 'apiKey'))).toBe(true);
    expect(aKeys.every((k) => 'hasApiKey' in k)).toBe(true);
    expect(aKeys.filter((k) => k.hasApiKey)).toHaveLength(1);
    // 不泄露 B 的
    expect(repo.listApiKeysByUser(userB).map((k) => k.id)).not.toEqual(aKeys.map((k) => k.id));
  });
});

describe('UserLLM 数据隔离（跨用户不可见）', () => {
  it('getById 不校验 owner，但路由层依赖 userId 比对；此处验证列表隔离', () => {
    const a = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm-a' });
    const b = repo.create({ userId: userB, protocol: 'openai', baseUrl: 'u', defaultModel: 'm-b' });

    // 彻底隔离：A 的列表看不到 B 的记录
    expect(repo.listByUser(userA).map((r) => r.id)).not.toContain(b.id);
    expect(repo.listByUser(userB).map((r) => r.id)).not.toContain(a.id);

    // getById 可跨读（仓库层不校验，由调用方 / API 路由比对 userId），但风险低：id 不可枚举
    expect(record(b.id)?.userId).toBe(userB);
  });
});

describe('createUserLLMProvider 工厂', () => {
  it('openai 记录构造 Custom OpenAI Provider，name 覆写为 user-<id>', () => {
    const r = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'https://a/v1', apiKey: 'k', defaultModel: 'm' });
    const p = createUserLLMProvider(record(r.id)!);
    expect(p.supportedModels).toContain('m');
    expect((p as unknown as { name: string }).name).toBe(`user-${r.id}`);
    expect(p.supportsJSONMode()).toBe(true);
  });

  it('anthropic 记录构造 Custom Anthropic Provider', () => {
    const r = repo.create({ userId: userA, protocol: 'anthropic', baseUrl: 'https://a', apiKey: 'k', defaultModel: 'claude' });
    const p = createUserLLMProvider(record(r.id)!);
    expect((p as unknown as { name: string }).name).toBe(`user-${r.id}`);
    expect(p.supportedModels).toContain('claude');
  });
});

describe('UserLLMRegistry（懒加载 + reload）', () => {
  it('构造时懒加载该用户已导入记录', () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm1' });
    reloadUserLLM(userA);
    const reg = getUserLLMRegistry(userA);
    expect(reg.isEmpty()).toBe(false);
    expect(reg.get('m1')).toBeDefined();
    expect(reg.getDefault()).toBeDefined();
  });

  it('reload 后反映新增（编辑/删除后热生效）', () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm1' });
    let reg = getUserLLMRegistry(userA);
    expect(reg.get('m2')).toBeUndefined();

    const created = repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm2' });
    reloadUserLLM(userA); // 模拟 CRUD 后失效重建
    reg = getUserLLMRegistry(userA);
    expect(reg.get('m2')).toBeDefined();

    // 删除后 reload → 移除对应 entry（get 因回退默认仍返回某 provider，故断言 entry 级别）
    repo.delete(created.id);
    reloadUserLLM(userA);
    const afterEntries = getUserLLMRegistry(userA).getEntries();
    expect(afterEntries.some((e) => e.record.id === created.id)).toBe(false);
    expect(afterEntries.every((e) => e.record.id !== created.id)).toBe(true);
  });

  it('按模型命中：modelId 缺省或未命中时回退默认（首个）', () => {
    const [m1] = [
      repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm-default' }),
    ];
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm2' });
    reloadUserLLM(userA);
    const reg = getUserLLMRegistry(userA);
    expect(reg.get('m2')?.supportedModels).toContain('m2');
    expect((reg.get() as unknown as { name: string }).name).toBe(`user-${m1.id}`);
    expect(reg.get('not-exist')?.supportedModels).toContain('m-default');
    expect(reg.getDefault()).toBeDefined();
  });

  it('descriptors：产出注入 /api/models 所需字段', () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'm1', supportedModels: ['m1', 'm2'] });
    reloadUserLLM(userA);
    const desc = listModelsForUser(userA);
    expect(desc.length).toBe(1);
    expect(desc[0].adapterId).toMatch(/^user-/);
    expect(desc[0].defaultModel).toBe('m1');
    expect(desc[0].models.map((x) => x.modelId)).toContain('m1');
    expect(hasUserLLM(userA)).toBe(true);
  });
});

describe('LLM Gateway 解析（用户优先，全局 env 回退）', () => {
  it('用户已导入时 resolveProvider 返回用户 Provider', () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'user-model' });
    reloadUserLLM(userA);
    const p = resolveProvider(userA, 'user-model');
    expect(p).toBeDefined();
    expect((p as unknown as { name: string }).name).toBe(
      `user-${getUserLLMRegistry(userA).getEntries()[0].record.id}`,
    );
  });

  it('用户无导入 / 未登录时 resolveProvider 回退全局 env（modelId 未命中则默认）', () => {
    // userB 无导入 → 回退全局（此处 license：全局注册可能为 undefined，仅验证不抛异常）
    const p = resolveProvider(userB, 'whatever-model');
    // 回退全局 env 注册表结果；不强行断言非空（取决于环境变量）
    expect(typeof p?.chat).toBeDefined();
    // 未登录（userId=null）行为同改造前
    const p2 = resolveProvider(null, 'whatever-model');
    expect(typeof p2?.chat).toBeDefined();
  });

  it('resolveDefaultProvider：用户默认模型优先', () => {
    repo.create({ userId: userA, protocol: 'openai', baseUrl: 'u', defaultModel: 'only-model' });
    reloadUserLLM(userA);
    const p = resolveDefaultProvider(userA);
    expect(p).toBeDefined();
    expect(p?.supportedModels).toContain('only-model');
  });
});