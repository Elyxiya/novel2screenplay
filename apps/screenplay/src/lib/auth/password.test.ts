import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password 密码哈希与校验', () => {
  it('哈希格式为 salt$hash，两次哈希不同', async () => {
    const h1 = await hashPassword('my-secret-123');
    const h2 = await hashPassword('my-secret-123');
    expect(h1).toContain('$');
    expect(h1).not.toBe(h2); // 随机盐
    const [salt, hash] = h1.split('$');
    expect(salt.length).toBe(32); // 16 字节 hex
    expect(hash.length).toBe(128); // 64 字节 hex
  });

  it('正确密码校验通过，错误密码失败', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
    expect(await verifyPassword('wrong-horse', hash)).toBe(false);
    expect(await verifyPassword('correct-horse ', hash)).toBe(false);
  });

  it('非法存储格式返回 false（不抛出）', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'noseparator')).toBe(false);
    expect(await verifyPassword('x', '$$')).toBe(false);
  });

  it('支持 72 位长度边界密码', async () => {
    const long = 'a'.repeat(72);
    const hash = await hashPassword(long);
    expect(await verifyPassword(long, hash)).toBe(true);
  });
});
