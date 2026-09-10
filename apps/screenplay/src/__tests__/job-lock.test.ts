// @vitest-environment node
/**
 * 恢复锁契约测试（FIX-05）· 双后端
 *
 * 锁语义：DB 持久化 CAS（UPDATE ... WHERE 未持有或已过期）+ TTL 过期可夺 + 心跳续锁。
 * PG leg 仅在 DATABASE_URL 配置时追加运行（describeBackends 自动分流）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeBackends, setupBackend } from './helpers/dual-backend';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';
import { jobStore, RECOVER_LOCK_TTL_MS } from '@/lib/store/job-store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeBackends('恢复锁 · 双后端一致（FIX-05）', (kind) => {
  let teardown: () => void;
  const repo = getJobRepository();

  beforeAll(() => {
    teardown = setupBackend(kind);
  });
  afterAll(() => {
    teardown();
  });

  function mkJob(): string {
    return repo.create({
      novelText: 'x',
      chapterTexts: [],
      modelId: 'm',
      selectedChapters: [],
      temperature: 0.3,
    });
  }

  it('获取锁 → 未过期不可重入、他人不可获取；释放后可再获取', () => {
    const id = mkJob();
    expect(repo.tryAcquireRecoverLock(id, 'A', RECOVER_LOCK_TTL_MS)).toBe(true);
    expect(repo.tryAcquireRecoverLock(id, 'A', RECOVER_LOCK_TTL_MS)).toBe(false);
    expect(repo.tryAcquireRecoverLock(id, 'B', RECOVER_LOCK_TTL_MS)).toBe(false);
    expect(repo.releaseRecoverLock(id, 'B')).toBe(false); // 非持有者不能释放
    expect(repo.releaseRecoverLock(id, 'A')).toBe(true);
    expect(repo.tryAcquireRecoverLock(id, 'B', RECOVER_LOCK_TTL_MS)).toBe(true);
    repo.releaseRecoverLock(id, 'B');
  });

  it('TTL 过期 → 锁可被夺取（模拟进程崩溃后的自愈）', async () => {
    const id = mkJob();
    expect(repo.tryAcquireRecoverLock(id, 'A', 50)).toBe(true);
    await sleep(80);
    expect(repo.tryAcquireRecoverLock(id, 'B', 50)).toBe(true);
    repo.releaseRecoverLock(id, 'B');
  });

  it('心跳续锁 → 保活期间不可被夺；非持有者续锁失败', async () => {
    const id = mkJob();
    expect(repo.tryAcquireRecoverLock(id, 'A', 150)).toBe(true);
    await sleep(100);
    expect(repo.refreshRecoverLock(id, 'A')).toBe(true); // 续到 now
    await sleep(100); // 距上次续锁 100ms < TTL 150ms
    expect(repo.tryAcquireRecoverLock(id, 'B', 150)).toBe(false);
    expect(repo.refreshRecoverLock(id, 'B')).toBe(false);
    repo.releaseRecoverLock(id, 'A');
  });

  it('jobStore 包装层：tryLockRecover / refresh / unlock 全走 DB 锁', () => {
    const id = mkJob();
    expect(jobStore.tryLockRecover(id)).toBe(true);
    expect(jobStore.isRecovering(id)).toBe(true);
    expect(jobStore.refreshRecoverLock(id)).toBe(true);
    jobStore.unlockRecover(id);
    expect(jobStore.isRecovering(id)).toBe(false);
    // 释放后其他 owner 可获取（验证确实写库）
    expect(repo.tryAcquireRecoverLock(id, 'other', RECOVER_LOCK_TTL_MS)).toBe(true);
    repo.releaseRecoverLock(id, 'other');
  });
});
