// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDramaRepository, type DramaRepository } from '@/lib/store/sqlite/drama-repository';
import { getDatabase, closeDatabase } from '@/lib/store/sqlite/db';

describe('drama-repository 短剧分镜存储', () => {
  const repo: DramaRepository = getDramaRepository();
  const TEST_TITLE = '测试分镜';
  let dramaId: string;

  beforeAll(() => {
    getDatabase();
  });

  afterAll(() => {
    const db = getDatabase();
    db.prepare(`DELETE FROM dramas WHERE title = ?`).run(TEST_TITLE);
    closeDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare(`DELETE FROM dramas WHERE title = ?`).run(TEST_TITLE);
    dramaId = repo.create({
      sourceJobId: 'job_test_1',
      sourceNovelId: 'novel_test_1',
      title: TEST_TITLE,
      dramaYaml: 'formatVersion: novel2drama-v1\nshots:\n  - shotId: shot_1\n',
      userId: null,
    });
  });

  it('create 后 get / list 正常，溯源字段完整', () => {
    const record = repo.get(dramaId)!;
    expect(record.title).toBe(TEST_TITLE);
    expect(record.sourceJobId).toBe('job_test_1');
    expect(record.sourceNovelId).toBe('novel_test_1');
    expect(record.dramaYaml).toContain('novel2drama-v1');

    const summaries = repo.list();
    const found = summaries.find(s => s.id === dramaId);
    expect(found).toBeDefined();
    expect(found?.totalShots).toBe(1);
  });

  it('findBySourceJobId 幂等查找（同一剧本只生成一份分镜）', () => {
    const found = repo.findBySourceJobId('job_test_1');
    expect(found?.id).toBe(dramaId);

    // 未生成过 → null
    expect(repo.findBySourceJobId('job_none')).toBeNull();
  });

  it('多用户隔离：不同 userId 不可见', () => {
    repo.create({
      sourceJobId: 'job_user_a',
      title: '用户A分镜',
      dramaYaml: 'formatVersion: novel2drama-v1',
      userId: 'user_a',
    });
    const listOfB = repo.list('user_b');
    expect(listOfB.find(s => s.title === '用户A分镜')).toBeUndefined();
    const listOfA = repo.list('user_a');
    expect(listOfA.find(s => s.title === '用户A分镜')).toBeDefined();
  });

  it('update 可单独更新标题或 YAML，且保留其他字段', () => {
    // 只更新标题
    expect(repo.update(dramaId, { title: '新标题' })).toBe(true);
    let record = repo.get(dramaId)!;
    expect(record.title).toBe('新标题');
    expect(record.dramaYaml).toContain('novel2drama-v1');
    expect(record.sourceJobId).toBe('job_test_1');

    // 只更新 YAML
    expect(repo.update(dramaId, { dramaYaml: 'formatVersion: novel2drama-v1\nshots:\n  - shotId: shot_9\n' })).toBe(true);
    record = repo.get(dramaId)!;
    expect(record.title).toBe('新标题');
    expect(record.dramaYaml).toContain('shot_9');

    // 同时更新
    expect(repo.update(dramaId, { title: '标题+YAML', dramaYaml: 'formatVersion: novel2drama-v1\nshots:\n  - shotId: shot_2\n' })).toBe(true);
    record = repo.get(dramaId)!;
    expect(record.title).toBe('标题+YAML');
    expect(record.dramaYaml).toContain('shot_2');
  });

  it('update 不存在的 id 返回 false', () => {
    expect(repo.update('drama_not_exist', { title: 'x' })).toBe(false);
  });

  it('delete 后 get 返回 null', () => {
    repo.delete(dramaId);
    expect(repo.get(dramaId)).toBeNull();
  });
});
