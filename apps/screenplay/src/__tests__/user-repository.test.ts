// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getUserRepository } from '@/lib/store/sqlite/user-repository';
import { getDatabase, closeDatabase } from '@/lib/store/sqlite/db';
import { hashPassword } from '@/lib/auth/password';

describe('user-repository 用户账户', () => {
  const repo = getUserRepository();
  const TEST_USERS = ['测试甲', '测试乙', 'auth_dup_user'];
  let userId: string;

  beforeAll(() => {
    getDatabase();
  });

  afterAll(() => {
    const db = getDatabase();
    for (const u of TEST_USERS) db.prepare('DELETE FROM users WHERE username = ?').run(u);
    closeDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    for (const u of TEST_USERS) db.prepare('DELETE FROM users WHERE username = ?').run(u);
    userId = repo.create({ username: '测试甲', email: 'a@test.dev', passwordHash: 'salt$hash' });
  });

  it('create 后可按用户名/邮箱/id 查询，公开信息不含密码', async () => {
    const user = repo.getByUsername('测试甲')!;
    expect(user.id).toBe(userId);
    expect(user.email).toBe('a@test.dev');
    expect(repo.getByEmail('a@test.dev')?.id).toBe(userId);
    expect(repo.getById(userId)?.username).toBe('测试甲');

    const pub = repo.toPublic(user);
    expect(pub).toEqual({ id: userId, username: '测试甲', email: 'a@test.dev', createdAt: user.createdAt });
    expect(JSON.stringify(pub)).not.toContain('passwordHash');
    expect(JSON.stringify(pub)).not.toContain('salt');
  });

  it('用户名与邮箱唯一约束由代码层保证', () => {
    expect(() => repo.create({ username: '测试甲', passwordHash: 'x$y' })).toThrow();
    expect(() => repo.create({ username: '测试乙', email: 'a@test.dev', passwordHash: 'x$y' })).toThrow();
    // 未占用则正常创建
    const id = repo.create({ username: '测试乙', email: 'b@test.dev', passwordHash: 'x$y' });
    expect(repo.getById(id)?.email).toBe('b@test.dev');
  });

  it('updatePassword 更新密码哈希', async () => {
    repo.updatePassword(userId, 'new$hash');
    expect(repo.getById(userId)?.passwordHash).toBe('new$hash');
  });

  it('delete 删除用户', () => {
    repo.delete(userId);
    expect(repo.getById(userId)).toBeNull();
  });

  it('与 scrypt 集成：注册 → 校验密码 → 改密码 → 新密码生效', async () => {
    const hash = await hashPassword('initial-pass');
    const id = repo.create({ username: 'auth_e2e', email: 'e2e@test.dev', passwordHash: hash });
    const { verifyPassword } = await import('@/lib/auth/password');
    expect(await verifyPassword('initial-pass', repo.getById(id)!.passwordHash)).toBe(true);

    const newHash = await hashPassword('changed-pass');
    repo.updatePassword(id, newHash);
    expect(await verifyPassword('changed-pass', repo.getById(id)!.passwordHash)).toBe(true);
    expect(await verifyPassword('initial-pass', repo.getById(id)!.passwordHash)).toBe(false);

    repo.delete(id);
  });
});
